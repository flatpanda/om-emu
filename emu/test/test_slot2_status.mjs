// The second card slot's HLS media status word where no media manager runs (camapp 1)
// (src/lab/camapp.mjs S-CARD's CARD_STATUS - 8, src/lab/media.mjs S-MEDIA's _status;
// docs/hle-gaps/4.8.md 4.8.3, 4.8.12; src/fw/facts.mjs mediaStatus):
//   slot2StatusUnits    (firmware-free) the slot 2 media status word offset (-8 from slot 1's word on E143 and E130)
//                       and slotMediaStatus() mapping for empty / mounted / unmounted states
//   slot2StatusSession  (firmware) on the body of OM_EMU_MODEL (E143 by default):
//                       - at start with slot 2 empty: slot 2's word is MEDIA_NOT_PRESENT (0x1001)
//                       - inserting a blank (unformatted) card into slot 2: MEDIA_NO_MOUNT (0); removing it: MEDIA_NOT_PRESENT
//                       - at start with a formatted card in slot 2: MEDIA_OK (0xf000)
//                       - removing the formatted card from slot 2: MEDIA_NOT_PRESENT (0x1001)
//                       - inserting the formatted card back into slot 2: MEDIA_OK (0xf000), and removing it again: MEDIA_NOT_PRESENT
//   node emu/test/test_slot2_status.mjs [--units] [--session]
import { MEDIA_STATUS_E143 } from '../src/fw/facts.mjs';
import { MEDIA_NO_MOUNT, MEDIA_NOT_PRESENT, MEDIA_OK } from '../src/lab/media.mjs';
import { CARD_STATUS_SLOT2_OFFSET, cardStatusAddr, slotMediaStatus } from '../src/lab/camapp.mjs';

const J = JSON.stringify;
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

export function slot2StatusUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  ok(CARD_STATUS_SLOT2_OFFSET === -8, `CARD_STATUS_SLOT2_OFFSET is -8 (D on E143 and E130): ${CARD_STATUS_SLOT2_OFFSET}`);
  ok(cardStatusAddr(MEDIA_STATUS_E143, 0) === 0x60360BEC && cardStatusAddr(MEDIA_STATUS_E143, 1) === 0x60360BE4,
    `E143 media status words: slot 1 0x${cardStatusAddr(MEDIA_STATUS_E143, 0).toString(16)}, slot 2 0x${cardStatusAddr(MEDIA_STATUS_E143, 1).toString(16)} (want 0x60360bec, 0x60360be4)`);
  ok(cardStatusAddr(0x62399B14, 1) === 0x62399B0C,
    `E130 media status word: slot 2 0x${cardStatusAddr(0x62399B14, 1).toString(16)} (want 0x62399b0c)`);
  const err = thrown(() => cardStatusAddr(MEDIA_STATUS_E143, 2));
  ok(err !== null && /unexpected slot 2/.test(err.message), `cardStatusAddr refuses slot 2: ${err?.message}`);
  ok(slotMediaStatus(false, false) === MEDIA_NOT_PRESENT, `empty slot -> MEDIA_NOT_PRESENT: 0x${slotMediaStatus(false, false).toString(16)}`);
  ok(slotMediaStatus(true, true) === MEDIA_OK, `present and mounted -> MEDIA_OK: 0x${slotMediaStatus(true, true).toString(16)}`);
  ok(slotMediaStatus(true, false) === MEDIA_NO_MOUNT, `present and unmounted -> MEDIA_NO_MOUNT: 0x${slotMediaStatus(true, false).toString(16)}`);
  return { checks, bad };
}

export async function slot2StatusSession() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL, fact } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { SdCard } = await import('../src/lab/sdcard.mjs');
  if (!STORAGE?.hls || !STORAGE?.slots) {
    return { checks: 1, bad: [`${MODEL}: the lab runs no dual-slot card with its HLS media side`], notes };
  }
  const WORD1 = fact('media_status', MEDIA_STATUS_E143);
  const WORD2 = cardStatusAddr(WORD1, 1);
  const hx = (v) => '0x' + (v >>> 0).toString(16);
  const idle = (s, ms) => { const to = s.lab.lab_time() + ms * 1e6; while (s.lab.lab_time() < to) s.idle_slice(Math.min(to, s.lab.lab_time() + 50e6)); };
  const env = () => ({ rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 });
  const holder = (card) => ({ open: () => card, save() {} });
  const words = (s) => ({ w1: hx(s.lab.sim.u32(WORD1)), w2: hx(s.lab.sim.u32(WORD2)), m2: !!s.storage.second?.mounted, p2: !!s.storage.second?.card?.present });

  // ---- Session 1: slot 2 empty at start (and formats cardA in slot 1 for Session 2)
  const cardA = new SdCard();
  let pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { ...env(), card: holder(cardA) });
  try {
    pl.open_session();
    const s = pl.session;
    ok(pl.phase === 'running', `session 1 (slot 2 empty) opens: ${pl.phase} ${pl.error?.message ?? ''}`);
    idle(s, 1500);
    const a0 = words(s);
    ok(a0.w1 === hx(MEDIA_OK) && a0.w2 === hx(MEDIA_NOT_PRESENT) && !a0.p2 && !a0.m2,
      `start with slot 2 empty: slot 1 ${a0.w1} (OK), slot 2 (${hx(WORD2)}) ${a0.w2} (NOT_PRESENT): ${J(a0)}`);
    // insert a blank (unformatted) card into slot 2 -> MEDIA_NO_MOUNT, then remove -> MEDIA_NOT_PRESENT
    pl.run_input({ type: 'card', action: 'insert', slot: 2 });
    idle(s, 1500);
    const a1 = words(s);
    ok(a1.w1 === hx(MEDIA_OK) && a1.w2 === hx(MEDIA_NO_MOUNT) && a1.p2 && !a1.m2,
      `blank card inserted into slot 2: unmounted, slot 2 word ${a1.w2} (NO_MOUNT): ${J(a1)}`);
    pl.run_input({ type: 'card', action: 'remove', slot: 2 });
    idle(s, 1000);
    const a2 = words(s);
    ok(a2.w1 === hx(MEDIA_OK) && a2.w2 === hx(MEDIA_NOT_PRESENT) && !a2.p2 && !a2.m2,
      `blank card removed from slot 2: slot 2 word ${a2.w2} (NOT_PRESENT): ${J(a2)}`);
    notes.push(`${MODEL} session 1 (${hx(WORD2)}): empty ${a0.w2}, blank in ${a1.w2}, blank out ${a2.w2}`);
  } catch (e) { bad.push(`${MODEL} session 1: ${e.message.slice(0, 500)}`); }
  try { pl.close_session(); } catch { /* closed */ }

  // ---- Session 2: formatted cardA in slot 2, remove -> NOT_PRESENT, insert -> OK, remove -> NOT_PRESENT
  cardA.state = 'idle'; cardA.selected = false; cardA.bus4 = false;
  const cardB = new SdCard();
  pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { ...env(), card: holder(cardB), card2: holder(cardA) });
  try {
    pl.open_session();
    const s = pl.session;
    ok(pl.phase === 'running', `session 2 (formatted card in slot 2) opens: ${pl.phase} ${pl.error?.message ?? ''}`);
    idle(s, 1500);
    const b0 = words(s);
    ok(b0.w1 === hx(MEDIA_OK) && b0.w2 === hx(MEDIA_OK) && b0.p2 && b0.m2,
      `start with formatted card in slot 2: slot 1 ${b0.w1}, slot 2 ${b0.w2} (OK), mounted: ${J(b0)}`);
    pl.run_input({ type: 'card', action: 'remove', slot: 2 });
    idle(s, 1000);
    const b1 = words(s);
    ok(b1.w1 === hx(MEDIA_OK) && b1.w2 === hx(MEDIA_NOT_PRESENT) && !b1.p2 && !b1.m2,
      `formatted card removed from slot 2: slot 2 word ${b1.w2} (NOT_PRESENT): ${J(b1)}`);
    pl.run_input({ type: 'card', action: 'insert', slot: 2 });
    idle(s, 1500);
    const b2 = words(s);
    ok(b2.w1 === hx(MEDIA_OK) && b2.w2 === hx(MEDIA_OK) && b2.p2 && b2.m2,
      `formatted card inserted into slot 2: mounted, slot 2 word ${b2.w2} (OK): ${J(b2)}`);
    pl.run_input({ type: 'card', action: 'remove', slot: 2 });
    idle(s, 1000);
    const b3 = words(s);
    ok(b3.w1 === hx(MEDIA_OK) && b3.w2 === hx(MEDIA_NOT_PRESENT) && !b3.p2 && !b3.m2,
      `formatted card removed again from slot 2: slot 2 word ${b3.w2} (NOT_PRESENT): ${J(b3)}`);
    notes.push(`${MODEL} session 2 (${hx(WORD2)}): start ${b0.w2}, out ${b1.w2}, in ${b2.w2}, out ${b3.w2}`);
  } catch (e) { bad.push(`${MODEL} session 2: ${e.message.slice(0, 500)}`); }
  try { pl.close_session(); } catch { /* closed */ }

  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), all = !argv.includes('--units') && !argv.includes('--session');
  let n = 0;
  if (all || argv.includes('--units')) {
    const u = slot2StatusUnits();
    console.log(`slot 2 media status units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    n += u.bad.length;
  }
  if (all || argv.includes('--session')) {
    const s = await slot2StatusSession();
    console.log(`slot 2 media status session: ${s.checks - s.bad.length}/${s.checks}`);
    s.notes.forEach((x) => console.log('   note:', x));
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
