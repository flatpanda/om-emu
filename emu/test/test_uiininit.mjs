// UI_IN's module init natively at the play bring-up (src/lab/play.mjs H-UIININIT, S-WAKEFACTOR; src/fw/models.mjs
// uiin_init; docs/hle-gaps/4.7.md 4.7.17), E143:
//   uiinInitUnits    (firmware: E143's image, no session) the init's calls read from its bytes are the seven of
//                    0x5014bf91 in order; the wake factor's getter and the SCPU init's store of 1 for bit 0 of the
//                    interface's word 0x90 are where the entry says; the key table the key step reads for variant 0
//                    holds the power switch's code 0x000c at the power button's factor 1. Control: an image whose
//                    init has another instruction where its ret is is refused
//   uiinInitSession  a play session's start with the init (the default) and with the mutant no-uiininit (H-UIINRING,
//                    S-BOOTKEY and H-UIINSCAN, the path before): the stand-ins (H-UIININIT and S-WAKEFACTOR, neither
//                    S-BOOTKEY nor H-UIINRING nor H-UIINSCAN with the init), the boot key 0x000c both ways, the wake
//                    factor 1, two IRQ 320 callbacks (PER_SCPU's and UI_IN's), the interface word 0x98e00004 cleared,
//                    no error log (the A/D channel open finds its channel: H-ADINIT, test_adc.mjs; its 0x28001511
//                    there before, 4.7.17); and the same screen, frame and lab time both ways at the start and
//                    after each of MENU, down, OK, MENU (the key handling)
//   node emu/test/test_uiininit.mjs [units|session]
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// E143 (D): UI_IN's module init and its calls; the SCPU init's factor for bit 0 of word 0x90 (`mov (a0),d0; btst
// 1,d0; beq; mov 1,d0` at 0x5004ddda, a0 = 0x98e00090); UI_IN's variant word and the key step's key-table list
// (0x5014e3c8: `mov 0x6034f958,a0`); the IRQ 320 callback count byte (0x5004df0f) and the interface word 0x04
const INIT = 0x5014BF91, CALLS = [0x5014CB5F, 0x5014E3AB, 0x5014CE00, 0x5014D49E, 0x5005D36A, 0x5014D62E, 0x5014D97A];
const FACTOR_BIT0 = [0x5004DDDA, [0x70, 0xF8, 0xEC, 0x01, 0xC8, 0x06, 0x80, 0x01]];
const KEY_TABLES = 0x6034F958, CALLBACK_COUNT = 0xA32BFF5C, SCPU_WORD4 = 0x98E00004, POWER = 0x000C;
const KEYS = ['menu', 'down', 'ok', 'menu'];

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

export async function uiinInitUnits() {
  const t = tester(), { ok } = t;
  const { ON_LAB_MODEL, MODEL_INFO, IMAGE_BASE, MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return t;
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { uiinInitCalls, WAKE_POWER_BUTTON } = await import('../src/lab/play.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const { imageView } = await import('../src/fw/image.mjs');
  const image = loadImage(), v = imageView(image, IMAGE_BASE, MODEL), f = MODEL_INFO.uiin_init;
  const { stores, calls } = uiinInitCalls(image, INIT);
  ok(f?.init === INIT && JSON.stringify(calls) === JSON.stringify(CALLS) && f.left.every((c) => calls.includes(c)) && calls.includes(f.ad_errlog[1]),
    `the init ${h8(INIT)} calls ${calls.map(h8).join(' ')}; the entry leaves ${f?.left.map(h8).join(' ')}`);
  ok(stores[0] === 0xA32DAB3C && stores[1] === 0xA32DABA4, `the init's two stores: ${stores.map(h8).join(' ')}`);
  const [word, getter] = f.wake, g = runtime(getter);
  ok(v.u8(g) === 0xFC && v.u8(g + 1) === 0xAC && v.u32(g + 2) === word, `the wake factor's getter ${h8(getter)} reads ${h8(word)}`);
  const [at, bytes] = FACTOR_BIT0;
  ok(bytes.every((b, i) => v.u8(runtime(at) + i) === b) && WAKE_POWER_BUTTON === 1, `the SCPU init stores ${WAKE_POWER_BUTTON} for bit 0 of word 0x90 at ${h8(at)}`);
  const table = v.u32(KEY_TABLES);         // variant 0 (CONTROLS are variant 0; the bring-up checks the variant word)
  ok(v.u32(table + 4 * WAKE_POWER_BUTTON) === POWER && v.u32(table) !== POWER, `the key table ${h8(table)}: factor ${WAKE_POWER_BUTTON} gives 0x${v.u32(table + 4 * WAKE_POWER_BUTTON).toString(16)}, factor 0 0x${v.u32(table).toString(16)}`);
  // control: the init with its ret replaced is refused
  const bad = new Uint8Array(image), ret = runtime(INIT) + 0x32 - IMAGE_BASE;
  ok(bad[ret] === 0xDF, `the init's ret at ${h8(INIT + 0x32)}`);
  bad[ret] = 0x00;
  let e = null;
  try { uiinInitCalls(bad, INIT); } catch (x) { e = x; }
  ok(e !== null && /not a call or its ret/.test(e.message), `control: an init without its ret is refused: ${e?.message ?? 'read'}`);
  return t;
}

async function startAndKeys(mutant) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { parseToken, stepInputs } = await import('../host/session.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, x_mutant: mutant }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  const at = () => ({ gui: pl.status_doc?.gui_name ?? null, frame: pl.frame?.[3] ?? null, ns: lab.lab_time() });
  const r = { used: pl.stand_ins_in_use(), init: s.uiin_init ?? null, boot_key: s.boot_key ?? null, key: lab.sim.u32(0xA32DAB30),
    factor: lab.sim.read(0xA32BFF5E, 2)[0], callbacks: lab.sim.read(CALLBACK_COUNT, 1)[0], word4: lab.sim.u32(SCPU_WORD4), states: [] };
  pl.publish_status?.();
  r.states.push(at());
  for (const k of KEYS) {
    for (const inp of stepInputs(parseToken(k))) { const seq = pl.submit(inp); pl.tick(); pl.pop_result(seq); }
    pl.publish_status?.();
    r.states.push(at());
  }
  pl.close_session();
  return r;
}

export async function uiinInitSession() {
  const t = tester(), { ok } = t;
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return t;
  const n = await startAndKeys(null), o = await startAndKeys('no-uiininit');
  ok(n.used.includes('H-UIININIT') && n.used.includes('S-WAKEFACTOR') && !['S-BOOTKEY', 'H-UIINRING', 'H-UIINSCAN'].some((x) => n.used.includes(x)),
    `the init's stand-ins: ${n.used.filter((x) => /UIIN|BOOTKEY|WAKE/.test(x))}`);
  ok(['S-BOOTKEY', 'H-UIINRING', 'H-UIINSCAN'].every((x) => o.used.includes(x)) && !o.used.includes('H-UIININIT'), `control (no-uiininit): ${o.used.filter((x) => /UIIN|BOOTKEY|WAKE/.test(x))}`);
  ok(n.init !== null && n.boot_key === null && n.key === POWER && o.key === POWER && n.factor === 1 && o.factor === 0,
    `the boot key 0x${n.key.toString(16)} natively (factor ${n.factor}), 0x${o.key.toString(16)} by S-BOOTKEY (factor ${o.factor})`);
  ok(n.callbacks === 2 && o.callbacks === 2 && n.word4 === 0, `IRQ 320 callbacks ${n.callbacks} / ${o.callbacks}; word 0x04 ${h8(n.word4)}`);
  ok(JSON.stringify(n.init?.errlog) === '[]' && n.init?.scan?.reply === '04880000', `the init's error log ${JSON.stringify(n.init?.errlog)} (none with H-ADINIT), scan ${JSON.stringify(n.init?.scan)}`);
  ok(n.states.every((x) => x.frame !== null), `frames published: ${JSON.stringify(n.states)}`);
  ok(JSON.stringify(n.states) === JSON.stringify(o.states), `the start and ${KEYS.join(', ')}: ${JSON.stringify(n.states)} natively, ${JSON.stringify(o.states)} without`);
  ok(new Set(n.states.map((x) => x.gui)).size > 1, `the keys change the screen: ${n.states.map((x) => x.gui).join(' ')}`);
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ?? 'all';
  let failed = 0;
  for (const [name, fn] of [['units', uiinInitUnits], ['session', uiinInitSession]]) {
    if (which !== 'all' && which !== name) continue;
    const r = await fn();
    console.log(`UI_IN's module init, ${name}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    failed += r.bad.length;
  }
  process.exit(failed ? 1 : 0);
}
