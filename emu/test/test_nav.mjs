// bin/nav.mjs's session (src/lab/nav.mjs NavSession) on the body of OM_EMU_MODEL (docs/model-survey.md finding 160):
//   navSession  (firmware) a nav session in time mode on the TFT: its own GUI bring-up passes its checks, which read
//               the body's shape by rules (src/fw/facts.mjs: the GUI buffer tables' records per kind, the icon words
//               iconStores, the API object apiObject, the device records guiDevices, the tasks started); OPEN posts the
//               build's index of E143's message 0x9624 (NavSession.index_of: E143's 0x87, two lower where the event
//               map lacks E143's 107 and 108) and the GUI reaches the state the firmware names SS_MENU/ID_ST_MENU
//               (src/fw/facts.mjs menuState: 0x0b02 on the ListMenu builds, 0x1102 on the Menu_Viewer ones), within
//               WAIT:1000 where the open first sleeps in lab time (E146, E147: ID_ST_MENU_ENTRY after OPEN); the menu's
//               texts are drawn and its frame differs from the start's (on SYNC_HELD's bodies it strictly does not:
//               the display sync nav does not release); DOWN keeps the menu's state and changes the frame; MENU, MENU end at
//               the closed state 0x0104. The control, on a body whose map is shifted (OPEN's index not E143's): E143's
//               index posted as such (EV:135) does not reach the menu's state
//   node emu/test/test_nav.mjs   (with OM_EMU_MODEL=E146 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';

// the bodies besides E143 whose nav session the test covers (bin/test.mjs runs each in a child): every ported body
// whose nav bring-up and menu open run (X, 2026-11-16). Not among them (docs/model-survey.md finding 160): E145, E129
// and E132, whose GUI state is 0 after the lab's creation of the GUI (not POWER_ON; why is not read), and E118 and
// E120, whose GUI takes OPEN's message 0x9624 in POWER_ON and stays there (why is not read)
export const NAV_BODIES = ['E146', 'E147', 'E144', 'E148', 'E139', 'E134', 'E137', 'E142', 'E140', 'E125', 'E130', 'E133', 'E122'];
// the bodies whose GUI's updates are display requests of type 3 (S-DISPSYNC's kind in play, src/lab/camapp.mjs), which
// stay pending until an image sync only the application sends: nav runs no application, so their menu runs (its
// state, its texts drawn) and the composite stays blank (X: E137's requests from 0x507d537c and E122's from
// 0x502c076a, d0 3, at the start, OPEN and DOWN; no OSD plane committed). Expected strictly: the frame unchanged by OPEN
// and DOWN
export const SYNC_HELD = ['E137', 'E142', 'E140', 'E125', 'E130', 'E133', 'E122'];
const OPEN_MESSAGE = 0x9624, CLOSED = 0x0104;

async function labEnv() {
  const { loadImage, loadBlock } = await import('../checks/lib/env.mjs');
  return { rom: loadImage(), resBlock: loadBlock(), createHash, loaded: 'auto' };
}

export async function navSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const N = await import('../src/lab/nav.mjs');
  const MM = await import('../src/lab/menu.mjs');
  const { words_to_rgb } = await import('../src/lab/display.mjs');
  const env = await labEnv();
  const h4 = (v) => '0x' + v.toString(16).padStart(4, '0');
  const open = () => new N.NavSession(env, { open_menu: false, png: 'none', time: true, device: 'tft' }).enter();
  let nav;
  try { nav = open(); } catch (e) {
    ok(false, `${MODEL}: the nav bring-up: ${e.message.slice(0, 400)}`);
    return { checks, bad };
  }
  const digest = () => createHash('sha256').update(words_to_rgb(nav.lab.compose('tft').words)).digest('hex');
  const shifted = nav.index_of(N.OPEN) !== N.OPEN;
  try {
    ok(nav.lab.state() === MM.STATE_POWER_ON, `${MODEL}: the bring-up ends at POWER_ON (${h4(nav.lab.state())})`);
    ok(nav.lab.state_names.get(MM.STATE_MENU) === 'SS_MENU/ID_ST_MENU', `${MODEL}: STATE_MENU ${h4(MM.STATE_MENU)} is named ${nav.lab.state_names.get(MM.STATE_MENU)}`);
    const start = digest();
    const r = nav.step('OPEN');
    ok(r.messages.length === 1 && r.messages[0] === h4(OPEN_MESSAGE), `${MODEL}: OPEN posts message ${h4(OPEN_MESSAGE)} (index ${r.indices}, ${r.messages})`);
    if (nav.lab.state() !== MM.STATE_MENU) nav.step('WAIT:1000');
    ok(nav.lab.state() === MM.STATE_MENU, `${MODEL}: OPEN reaches the menu's state ${h4(MM.STATE_MENU)} (${r.state.gui} ${r.state.gui_name}, then ${h4(nav.lab.state())})`);
    const menu = digest(), held = SYNC_HELD.includes(MODEL);
    ok(r.texts.length > 0 || nav.steps.slice(1).some((x) => x.texts.length), `${MODEL}: the menu's open draws its texts`);
    ok(held ? menu === start : menu !== start, `${MODEL}: the menu's frame ${held ? 'is the start\'s (the display sync held)' : 'differs from the start\'s'}`);
    const d = nav.step('DOWN');
    ok(d.state.gui === h4(MM.STATE_MENU) && d.texts.length > 0 && (held ? digest() === menu : digest() !== menu), `${MODEL}: DOWN keeps the menu's state, draws, and ${held ? 'leaves the held frame' : 'changes the frame'} (${d.state.gui})`);
    nav.step('MENU');
    if (nav.lab.state() !== CLOSED) nav.step('MENU');
    ok(nav.lab.state() === CLOSED, `${MODEL}: MENU, MENU close the menu (${h4(nav.lab.state())})`);
  } catch (e) {
    ok(false, `${MODEL}: ${e.message.slice(0, 600)}`);
  } finally { nav.close(); }
  // the control: E143's index posted as such on a shifted map is another message and does not open the menu
  if (shifted) {
    const c = open();
    try {
      const r = c.step(`EV:${N.OPEN}`);
      if (c.lab.state() !== MM.STATE_MENU) c.step('WAIT:1000');
      ok(r.messages[0] !== h4(OPEN_MESSAGE) && c.lab.state() !== MM.STATE_MENU, `${MODEL}: control: E143's index ${N.OPEN} posts ${r.messages[0]} and does not open the menu (${h4(c.lab.state())})`);
    } catch (e) {
      ok(false, `${MODEL}: control: ${e.message.slice(0, 600)}`);
    } finally { c.close(); }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await navSession();
  console.log(`nav session: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
