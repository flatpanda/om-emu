// UI_IN's GIO key pins (src/dev/gio.mjs, board gio_keys; src/lab/play.mjs H-GIOKEYS and S-GPIO-TP's call-site answers;
// docs/hle-gaps/4.7.md 4.7.21), E143:
//   gioKeysUnits    (firmware: E143's image, no session) the key init's table read from its bytes names pins 18, 47,
//                   20, 48, 49, 108, 25, 131 for group 1's bits 0..7 and eight IO expander pins for bits 8..15; the
//                   board's pins agree with the GIO driver's tables (each pin's word, its interrupt record's dedicated
//                   flag, IRQ, status and enable words and bits), and the driver's class-0 map on core 0 turns 131
//                   into 164. Control: a key init whose list load differs is refused
//   gioKeysSession  a play session's start: H-GIOKEYS in use, the key init run, the pins at the idle image's levels
//                   in group 1's old state, every pin armed with none pending and its IRQ attached at level 5; with
//                   the mutant no-uiininit no pin armed. A tap on the TFT gives HFW its PRESS (S-GPIO-TP answered at the
//                   driver's reads). Evidence of the native path: pin 18 (OK) taken low and back high decodes OK's
//                   press 0x02000004 and release 0x02010004 through the pins' interrupt and UI_IN's own callback
//   node emu/test/test_giokeys.mjs [units|session]
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// E143 (D): the GIO driver's pin table, its slot table and interrupt records, the class-0 map list; UI_IN's key init
const PIN_WORDS = 0x60025FF8, SLOTS = 0x60026788, RECORDS = 0x600268F4, MAP_LISTS = 0x6034DEF4;
const KEY_INIT = 0x5014D62E, KEY_PINS = [18, 47, 20, 48, 49, 108, 25, 131], OK_PIN = 18;
const OK_PRESS = 0x02000004, OK_RELEASE = 0x02010004, TAP = [300, 200];

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

export async function gioKeysUnits() {
  const t = tester(), { ok } = t;
  const { ON_LAB_MODEL, MODEL_INFO, IMAGE_BASE, MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return t;
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { uiinKeyPins, uiin_layout } = await import('../src/lab/play.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const { imageView } = await import('../src/fw/image.mjs');
  const image = loadImage(), v = imageView(image, IMAGE_BASE, MODEL), keys = MODEL_INFO.uiin_init?.keys, groups = uiin_layout(image).groups;
  ok(keys?.[0] === KEY_INIT && !MODEL_INFO.uiin_init.left.includes(KEY_INIT), `the entry runs the key init: keys ${JSON.stringify(keys)}, left ${MODEL_INFO.uiin_init?.left}`);
  const k = uiinKeyPins(image, keys, groups);
  const gio = k.keys.filter(({ pin }) => !(pin >>> 24)), exp = k.keys.filter(({ pin }) => pin >>> 24);
  ok(k.group === 1 && k.old === 0xA32DADAC && k.table === 0x602241D0, `the key init's group ${k.group}, old state ${h8(k.old)}, table ${h8(k.table)}`);
  ok(JSON.stringify(gio.map(({ bit, pin }) => [bit, pin])) === JSON.stringify(KEY_PINS.map((p, i) => [i, p])), `the GIO pins ${JSON.stringify(gio)}`);
  ok(exp.length === 8 && exp.every(({ bit, pin }) => bit >= 8 && [2, 3].includes(pin >>> 24)), `the expander pins ${JSON.stringify(exp.map(({ bit, pin }) => [bit, h8(pin)]))}`);
  // the board's pins against the driver's tables
  const pins = BOARD.gio_keys.pins;
  for (const p of pins) {
    const slot = v.u16(SLOTS + 2 * p.pin), rec = RECORDS + 32 * slot, w = (o) => v.u32(rec + o);
    ok(v.u32(PIN_WORDS + 4 * p.pin) === p.word && w(0) === p.word && w(4) === (p.shared ? 0 : 1) && w(8) === p.irq && w(16) === p.status && w(20) === p.enable
      && w(24) === p.bits[0] && w(28) === p.bits[1], `pin ${p.pin}: board ${JSON.stringify(p)}; tables word ${h8(v.u32(PIN_WORDS + 4 * p.pin))}, record ${h8(rec)} ${[0, 4, 8, 12, 16, 20, 24, 28].map((o) => h8(w(o))).join(' ')}`);
  }
  // the class-0 map on core 0: list (MAP_LISTS)[0] {pairs, count}
  const list = v.u32(MAP_LISTS), n = v.u8(MAP_LISTS + 4), map = new Map();
  for (let i = 0; i < n; i++) map.set(v.u32(list + 8 * i), v.u32(list + 8 * i + 4));
  const phys = KEY_PINS.map((p) => map.get(p) ?? p);
  ok(JSON.stringify(phys) === JSON.stringify(pins.map((p) => p.pin)), `the table's pins on core 0 ${JSON.stringify(phys)}, the board's ${JSON.stringify(pins.map((p) => p.pin))}`);
  // control: a key init whose list load names another list is refused
  const bad = new Uint8Array(image), at = runtime(KEY_INIT) + 0x21 - IMAGE_BASE;
  bad[at] ^= 0x04;
  let e = null;
  try { uiinKeyPins(bad, keys, groups); } catch (x) { e = x; }
  ok(e !== null && /does not load its variant, the list/.test(e.message), `control: another list is refused: ${e?.message ?? 'read'}`);
  return t;
}

async function session(mutant, act) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, x_mutant: mutant }, env);
  pl.open_session();
  try { return await act(pl, pl.session, pl.session.lab); } finally { pl.close_session(); }
}

export async function gioKeysSession() {
  const t = tester(), { ok } = t;
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return t;
  const IRQ = await import('../src/lab/irq.mjs');
  const armed = (gio) => gio.pins.map((p, i) => (gio.enable[i] & (p.bits[0] | p.bits[1])) !== 0);
  await session(null, (pl, s, lab) => {
    const gio = lab.sim.m.devices.gio_keys, k = s.uiin_init?.keys;
    ok(pl.stand_ins_in_use().includes('H-GIOKEYS') && s.uiin_init?.calls.includes(h8(KEY_INIT)), `the key init run: ${JSON.stringify(s.uiin_init?.calls)}`);
    ok(JSON.stringify(k?.pins) === JSON.stringify([[0, 18, 18, 1], [1, 47, 47, 1], [2, 20, 20, 1], [3, 48, 48, 0], [4, 49, 49, 1], [5, 108, 108, 0], [6, 25, 25, 1], [7, 131, 164, 0]]) && k.old === '5700',
      `the pins [bit, table pin, pin, level] ${JSON.stringify(k?.pins)}, the old state ${k?.old}`);
    ok(armed(gio).every(Boolean) && gio.pins.every((p, i) => !(gio.status[i] & gio.enable[i])), `every pin armed, none pending: ${gio.pins.map((p, i) => `${p.pin} ${h8(gio.status[i])}/${h8(gio.enable[i])}`).join(', ')}`);
    ok(gio.pins.every((p) => lab.nk.intc.level(p.irq) === 1 << 5 && lab.sim.u32(IRQ.HANDLER_TABLE + 4 * p.irq) !== 0), `the pins' IRQs attached at level 5: ${gio.pins.map((p) => `${p.irq}:${lab.nk.intc.level(p.irq).toString(16)}`).join(' ')}`);
    // a tap: the touch driver accepts it (S-GPIO-TP at its reads)
    const g0 = lab.gestures.length;
    for (const action of ['down', 'up']) s.touch(action, ...TAP);
    s.idle_slice(lab.lab_time() + 500e6);
    while (s.pending_touch()) s.touch_gui_step();
    const gestures = lab.gestures.slice(g0).map((g) => [g.name, g.x, g.y]);
    ok(gestures.some(([n, x, y]) => n === 'PRESS' && x === TAP[0] && y === TAP[1]) && s.gpio_tp_answered > 0, `the tap's gestures ${JSON.stringify(gestures)}, S-GPIO-TP answers ${s.gpio_tp_answered}`);
    // OK through its pin: low, then high again, with lab time between
    const codes = (level) => { const n0 = lab.uiin_decoded.length; gio.setLevel(OK_PIN, level); s.step('WAIT:100'); return lab.uiin_decoded.slice(n0).map(([, c]) => c); };
    const down = codes(0), up = codes(1);
    ok(down.includes(OK_PRESS) && !down.includes(OK_RELEASE) && up.includes(OK_RELEASE), `pin ${OK_PIN} low decodes ${down.map(h8).join(' ')}; high again ${up.map(h8).join(' ')}`);
  });
  await session('no-uiininit', (pl, s, lab) => {
    const gio = lab.sim.m.devices.gio_keys;
    ok(!pl.stand_ins_in_use().includes('H-GIOKEYS') && !armed(gio).some(Boolean), `control (no-uiininit): no pin armed (${gio.pins.map((p, i) => h8(gio.enable[i])).join(' ')})`);
  });
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ?? 'all';
  let failed = 0;
  for (const [name, fn] of [['units', gioKeysUnits], ['session', gioKeysSession]]) {
    if (which !== 'all' && which !== name) continue;
    const r = await fn();
    console.log(`UI_IN's GIO key pins, ${name}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    failed += r.bad.length;
  }
  process.exit(failed ? 1 : 0);
}
