// The E-P7's Shortcut button (src/lab/play.mjs control shortcut: UI_IN key 0x1224, EV_PRESS_CUSTOM7_KEY on E142), in a
// scripted session (host/session.mjs) on the process's model:
//   shortcutSession  E142 (bin/test.mjs runs it in a child with OM_EMU_MODEL=E142): the row is wired at UI_IN's own
//                    entry for 0x1224 (group 1 byte 0 bit 6, type 2, polarity 0); after the start and a half press the
//                    GUI is not on the Colour Profile page, and a press of shortcut takes it to
//                    SS_MENU_LV/ID_ST_PROFILE_SELECT_MENU (the page Caduceus E-P7's FILM_DOWN_CRASH.md opens with the
//                    Shortcut button). E143 (bin/test.mjs's process): the row is not wired and a press is refused
//                    with its reason.
//   node emu/test/test_shortcut.mjs           (OM_EMU_MODEL=E142 for the E-P7)
export const PROFILE_PAGE = 'SS_MENU_LV/ID_ST_PROFILE_SELECT_MENU';

export async function shortcutSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { openSession } = await import('../host/session.mjs');
  const { BY_ID, SHORTCUT_CODE } = await import('../src/lab/play.mjs');
  const c = () => BY_ID.get('shortcut');
  if (MODEL === 'E143') {
    const s = await openSession({ model: 'E143' });
    const r = s.first.ok ? s.step('shortcut') : s.first;
    s.close();
    ok(c().status === 'not-wired' && /0x1224 is not in E143's UI_IN tables/.test(c().reason), `E143: the row is not wired: ${c().status} ${c().reason}`);
    ok(!r.ok && /not wired/.test(String(r.error)) && /0x1224 is not in E143's UI_IN tables/.test(String(r.error)), `E143: the press is refused with its reason (${r.error})`);
    return { checks, bad };
  }
  const s = await openSession({ model: MODEL });
  try {
    ok(c().status === 'wired' && JSON.stringify(c().uiin) === JSON.stringify([1, 0, 6, SHORTCUT_CODE, 2, 0]),
      `${MODEL}: the row is wired at UI_IN's entry: ${c().status} ${JSON.stringify(c().uiin)} ${c().reason}`);
    const recs = s.first.ok ? s.run(['wait:4500', 's1', 'wait:1500']) : [];
    const before = recs.at(-1);
    ok(before?.ok && before.gui !== PROFILE_PAGE, `${MODEL} control: before the press the GUI is ${before?.gui} (${before?.error ?? 'ok'})`);
    const r = s.step('shortcut');
    ok(r.ok && r.gui === PROFILE_PAGE, `${MODEL}: shortcut -> ${r.gui} (want ${PROFILE_PAGE}; ${r.error ?? 'ok'})`);
  } finally {
    s.close();
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await shortcutSession();
  console.log(`shortcut: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exitCode = r.bad.length ? 1 : 0;
}
