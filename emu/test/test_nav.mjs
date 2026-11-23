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
//               index posted as such (EV:135) does not reach the menu's state. The bring-up's body steps (model-survey
//               finding 162): on the bodies with the power task the power module's start ran (src/lab/menu.mjs
//               power_start: H-DPCINIT, S-SIOIIC on the TG-5s, H-PWRTASK), on E145, E129 and E132 lab time ran while
//               the GUI slept in POWER_ON's power-source read (H-GUISLEEP); on the bodies whose GUI waits for the connect
//               message (E118, E120) the session posted it (H-GUICONNECT, 0x9601 with lOutput 2); on the others
//               neither. Controls: without H-GUISLEEP the GUI state is 0 after the bring-up (E145, E129, E132), and
//               without power_start on the TG-5s (E129, E132; E145 reaches POWER_ON without it); without
//               H-GUICONNECT OPEN leaves the GUI at POWER_ON (E118, E120)
//   node emu/test/test_nav.mjs   (with OM_EMU_MODEL=E146 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';

// the bodies besides E143 whose nav session the test covers (bin/test.mjs runs each in a child): every ported body
// (X, 2026-11-16; E145, E129, E132, E118 and E120 since 2026-11-22, docs/model-survey.md finding 162)
export const NAV_BODIES = ['E146', 'E147', 'E144', 'E148', 'E139', 'E134', 'E137', 'E142', 'E140', 'E125', 'E130', 'E133', 'E122',
  'E145', 'E129', 'E132', 'E118', 'E120'];
// the bodies with the power task (fact power.task: src/lab/menu.mjs power_start runs), those whose GUI sleeps in its
// POWER_ON entry (H-GUISLEEP runs lab time) and those whose GUI waits for the connect message (src/lab/nav.mjs
// gui_connect)
export const POWER_BODIES = ['E144', 'E148', 'E137', 'E142', 'E140', 'E145', 'E129', 'E132'], SLEEP_BODIES = ['E145', 'E129', 'E132'];
export const CONNECT_BODIES = ['E118', 'E120'];
// the bodies whose GUI's updates are display requests of type 3 (S-DISPSYNC's kind in play, src/lab/camapp.mjs), which
// stay pending until an image sync only the application sends: nav runs no application, so their menu runs (its
// state, its texts drawn) and the composite stays blank (X: E137's requests from 0x507d537c and E122's from
// 0x502c076a, d0 3, at the start, OPEN and DOWN; no OSD plane committed; E145's from 0x506d4d35, E129's from
// 0x506a59ce, E132's from 0x506a5fde, E118's from 0x502a9201, type 3, and E120's record form from 0x5067b99e, at OPEN
// and DOWN, 2026-11-22). Expected strictly: the frame unchanged by OPEN and DOWN
export const SYNC_HELD = ['E137', 'E142', 'E140', 'E125', 'E130', 'E133', 'E122', 'E145', 'E129', 'E132', 'E118', 'E120'];
const OPEN_MESSAGE = 0x9624, CLOSED = 0x0104;

async function labEnv() {
  const { loadImage, loadBlock } = await import('../checks/lib/env.mjs');
  return { rom: loadImage(), resBlock: loadBlock(), createHash, loaded: 'auto' };
}

export async function navSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { show } = await import('../src/util/show.mjs');
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
    const power = POWER_BODIES.includes(MODEL), sleep = SLEEP_BODIES.includes(MODEL), connect = CONNECT_BODIES.includes(MODEL), ps = nav.lab.power_started;
    ok(power ? ps !== null && ps.tid > 0 && ps.dpc === true && (ps.sio !== null) === !!MODEL_INFO.sio_devices : ps === null,
      `${MODEL}: the power module's start ${power ? 'ran' : 'did not run'} (${show(ps && { dpc: ps.dpc, sio: ps.sio?.labels ?? null, tid: ps.tid })})`);
    ok(sleep ? nav.lab.gui_sleep_ms > 0 : nav.lab.gui_sleep_ms === 0, `${MODEL}: H-GUISLEEP ${sleep ? 'ran lab time' : 'ran none'} (${nav.lab.gui_sleep_ms} ms)`);
    ok(connect ? nav.gui_connected?.message === '0x9601' && nav.gui_connected.loutput === 2 : nav.gui_connected === null,
      `${MODEL}: H-GUICONNECT ${connect ? 'posted 0x9601 with lOutput 2' : 'did not run'} (${show(nav.gui_connected)})`);
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
  // the controls of the body steps: without power_start the GUI's POWER_ON entry is not done (its caller word unset,
  // state 0); without H-GUICONNECT the GUI's gate drops OPEN
  const bare = (what, lab) => {
    class BareSession extends N.NavSession { static lab_class = lab; }
    let msg = null;
    try { new BareSession(env, { open_menu: false, png: 'none', time: true, device: 'tft' }).enter().close(); } catch (e) { msg = e.message; }
    ok(msg !== null && msg.includes('GUI state 0x0000'), `${MODEL}: control: without ${what} the bring-up ends at GUI state 0 (${msg?.slice(0, 200)})`);
  };
  if (SLEEP_BODIES.includes(MODEL)) bare('H-GUISLEEP', class extends N.NavLab { gui_sleep() { this.gui_sleep_ms = 0; } });
  if (SLEEP_BODIES.includes(MODEL) && MODEL_INFO.sio_devices) bare('the power module\'s start', class extends N.NavLab { power_start() { this.power_started = null; } });
  if (CONNECT_BODIES.includes(MODEL)) {
    class Unconnected extends N.NavSession { gui_connect() { this.gui_connected = null; } }
    const c = new Unconnected(env, { open_menu: false, png: 'none', time: true, device: 'tft' }).enter();
    try {
      c.step('OPEN');
      ok(c.lab.state() === MM.STATE_POWER_ON, `${MODEL}: control: without H-GUICONNECT OPEN leaves the GUI at POWER_ON (${h4(c.lab.state())})`);
    } catch (e) {
      ok(false, `${MODEL}: control (H-GUICONNECT): ${e.message.slice(0, 600)}`);
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
