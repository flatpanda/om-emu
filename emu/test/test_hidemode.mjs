// The hidden service screens (docs/hle-gaps.md 4.6.5; src/lab/play.mjs H-STARTKEY):
//   hideModeSite     (firmware) the MENU state step's site in USTART5 read by its instructions (startKeySite) on E143:
//                    MENU's code 0x0089, the camera state kind 0x2751, the key state read 0x5014c015 and the write
//                    0x5004188b; and a byte of the site changed is refused with its offset (the control).
//   hideModeSession  (firmware, E143) a session with --held menu: H-STARTKEY in use and property 4519 at 0 after the
//                    start, MENU, Setup's page 3, Monitor Adjust, OK, INFO, OK reaches SS_MENU_MAIN/ID_ST_HIDE_MODE,
//                    UP, DOWN, LEFT, RIGHT, S2, UP and RIGHT keep it (PAGE 1, PAGE 2); no poke. The control: the same
//                    keys without the hold leave 4519 at 1 (written by the step) and OK goes back to the menu.
//   node emu/test/test_hidemode.mjs [--session]   (exit 1 on a failure)
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const HIDE = 'SS_MENU_MAIN/ID_ST_HIDE_MODE', MENU = 'SS_MENU/ID_ST_MENU';
// MENU, two pages right to the Setup tab's page 3, DOWN to Monitor Adjust, OK, INFO (the colour page), OK
const TO_OK = ['menu', 'right', 'right', 'down', 'ok', 'info', 'ok'];
const CODE = ['up', 'down', 'left', 'right', 's2', 'up', 'right'];

export async function hideModeSite() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, IMAGE_BASE } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks, bad };
  const { loadImage } = await import('../bin/run.mjs');
  const { imageView } = await import('../src/fw/image.mjs');
  const { startKeySite, START_KEY_SITE } = await import('../src/lab/play.mjs');
  const img = loadImage();
  const site = startKeySite(imageView(img, IMAGE_BASE, MODEL));
  ok(!site.why && site.code === 0x89 && site.kind === 0x2751 && site.key_state === 0x5014c015 && site.write === 0x5004188b && site.read === 0x500417da,
    `E143: the MENU state step reads ${JSON.stringify(site)}, want code 0x89, kind 0x2751, 0x5014c015, 0x5004188b, 0x500417da`);
  const c = img.slice(), off = START_KEY_SITE - 0x50000000 + 15;
  c[off] = 0x05;                                          // `clr d1` (04) made `clr d2`
  const changed = startKeySite(imageView(c, IMAGE_BASE, MODEL));
  ok(/byte \+15 is 0x5, not 0x4/.test(changed.why ?? ''), `E143: a changed byte at ${h8(START_KEY_SITE + 15)} is refused (${changed.why ?? 'read as a site'})`);
  return { checks, bad };
}

export async function hideModeSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks, bad };
  const { openSession } = await import('../host/session.mjs');
  for (const held of [true, false]) {
    const tag = held ? '--held menu' : 'no hold';
    const s = await openSession(held ? { held: ['menu'] } : {});
    try {
      const step = (t) => { const r = s.step(t); if (!r.ok) throw new Error(`${tag}: ${t}: ${r.error}`); return r; };
      ok(s.player.stand_ins_in_use().includes('H-STARTKEY'), `${tag}: H-STARTKEY in use`);
      const v = step('setting:4519').setting.value;
      ok(v === (held ? 0 : 1), `${tag}: property 4519 reads ${v} after the start, want ${held ? 0 : 1}`);
      let last = null;
      for (const t of TO_OK) last = step(t);
      ok(last.gui === (held ? HIDE : MENU), `${tag}: Monitor Adjust's OK leads to ${last.gui}, want ${held ? HIDE : MENU}`);
      if (held) {
        const after = CODE.map((t) => step(t).gui);
        ok(after.every((g) => g === HIDE), `${tag}: the code's keys and RIGHT stay in ${HIDE} (${after.join(', ')})`);
      }
      ok(s.pokes === undefined || s.pokes.length === 0, `${tag}: no poke`);
    } finally { s.close?.(); }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const i = await hideModeSite();
  console.log(`the hidden screens' MENU state step on ${MODEL}: ${i.checks - i.bad.length}/${i.checks}`);
  i.bad.forEach((x) => console.log('  ', x));
  let fail = i.bad.length;
  if (process.argv.includes('--session')) {
    const s = await hideModeSession();
    console.log(`the hidden screens in a ${MODEL} session: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
