// The second card slot on the bodies whose slots the rule reads (src/fw/models.mjs card_fs.second_slot with the
// detect UI_IN's level alone: E139, E134, E125; docs/hle-gaps/4.8.md 4.8.17, 4.8.29), on the body of OM_EMU_MODEL,
// in play sessions (firmware). X unless tagged. test_storage.mjs --slot2 covers E143 and E146, whose HLS control
// S-CARD's flags need; these bodies have none, so this test reads the slots through the SD driver's detect, the
// file layer's drive status, S-SDCARD's port counts and the cards themselves:
//   one card    the detect answers a card in slot 1 and none in slot 2 (the word's 0x1301), drive 1's status 1, no
//               command on port 1; S2 with the save slot (card.slots record.slot) at slot 2 makes no file, back at
//               slot 1 S2 writes C:\DCIM\100OLYMP\P1010001.JPG, read back on the card by refs/volume.mjs; no
//               synchronous send to the slave ASIC's queue (S-SASIC)
//   two cards   a blank card in slot 1, the first session's card in slot 2. E139 and E125: both detects 0, both
//               drives mounted (status 0x13780), the second card mounted on its own port and its DCF database
//               counting its picture (next file 2); S2 at slot 2 writes D:\DCIM\100OLYMP\P1010002.JPG, at slot 1
//               C:\...\P1010001.JPG; read back, the second card holds files 1 and 2 and the first file 1 only.
//               E134: the second card's mount sends the access lamp's state 2 ({client 4, state 2}) to the slave
//               ASIC's queue SASIC_SLAVE from the lamp callback (the send returning to 0x50658614, D), which
//               S-SASIC answers; its file requests then go to the slave ASIC over CCI, which the lab does not run,
//               so the bring-up stops with the card unmounted (drive status 0x8608) and no command on port 1
//               (src/lab/storage.mjs insert_second)
//   node emu/test/test_slot2_rule.mjs        (OM_EMU_MODEL=E139|E134|E125; exit 1 on a failed check)
import { SdCard } from '../src/lab/sdcard.mjs';
import { openVolume } from '../refs/volume.mjs';

const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
const { Player } = await import('../src/lab/player.mjs');
const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
const { STORAGE: F, SECOND, DRIVE_NO_CARD } = await import('../src/lab/storage.mjs');
const { SASIC_SLAVE_NAMES, MenuLab } = await import('../src/lab/menu.mjs');
const { objectNameId } = await import('../src/fw/facts.mjs');

// the SD driver's detect for an empty slot, and a mounted drive's status (docs/hle-gaps/4.8.md 4.8.17, X)
const DETECT_NO_CARD = 0x1301, DRIVE_MOUNTED = 0x13780;
// E134's access lamp callback: the return of its synchronous send to SASIC_SLAVE (0x5065860d's call, D) and the
// message it sends for state 2 ({lamp field 4, state 2}, 0x50658597..0x506585cc, D); by body: only E134 has it
// and the drive status the firmware leaves the second card's drive in (X)
const SASIC_SEND = { E134: { ret: 0x50658614, msg: [4, 2], drive: 0x8608 } };
// the labs whose S-SASIC reads its queue (observed only: the send's record outlives a bring-up that stops)
const sasicLabs = [], sasicIds = MenuLab.prototype.sasic_ids;
MenuLab.prototype.sasic_ids = function () { if (!sasicLabs.includes(this)) sasicLabs.push(this); return sasicIds.call(this); };

const bad = [];
let checks = 0;
const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
const J = JSON.stringify, hx = (v) => '0x' + (v >>> 0).toString(16);

if (!F?.slots || !MODEL_INFO.card_fs?.second_slot || F.hls?.ctrl) {
  console.log(`${MODEL}: not a body whose second slot the rule reads (card.slots, no HLS control)`);
  process.exit(1);
}
const { slot: SAVE } = F.slots.record, names = F.names;
const DIR = `DCIM/100${names.folder}`, file = (n) => `${DIR}/${names.file}${String(n).padStart(4, '0')}.${names.ext}`;
const second = String.fromCharCode(names.drive.charCodeAt(0) + 1);
const holder = (card) => ({ open: () => card, save() {} });
const env = () => ({ rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 });
const player = (card, card2 = null) => {
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { ...env(), card: holder(card), ...(card2 ? { card2: holder(card2) } : {}) });
  pl.open_session();
  return pl;
};
const idle = (s, ms) => { const to = s.lab.lab_time() + ms * 1e6; while (s.lab.lab_time() < to) s.idle_slice(Math.min(to, s.lab.lab_time() + 50e6)); };
const shoot = (s) => { s.key('s1', 'down'); s.camapp.pump(); idle(s, 600); s.key('s2', 'down'); s.camapp.pump(); idle(s, 1200); s.key('s2', 'up'); s.key('s1', 'up'); s.camapp.pump(); idle(s, 800); };
const state = (s) => ({ det: [0, 1].map((d) => s.storage.detect(d)), drive: [0, 1].map((d) => s.storage.status_word(d)), ports: [...s.storage.port_commands] });
const show = (x) => J({ ...x, det: x.det.map(hx), drive: x.drive.map(hx) });
const vol = (card) => { try { return openVolume((lba, n) => card.read(lba, n)); } catch { return null; } };
const has = (card, n) => vol(card)?.find(file(n)) ?? null;
const sasicSends = (s) => s.lab.sasic_sends.map(([q, , msg, site]) => [q, msg, site]);

// the object-name table: the slave ASIC's queue and task on E134 alone (D, the 19 images: 221 and 145 on E134)
const image = loadImage(), [sq, st] = SASIC_SLAVE_NAMES.map((n) => objectNameId(image, n)), want = SASIC_SEND[MODEL] ?? null;
ok(want ? sq === 221 && st === 145 : sq === null && st === null, `${MODEL}'s object-name table: ${SASIC_SLAVE_NAMES.join(', ')} ${sq}, ${st}`);

const cardA = new SdCard(), cardB = new SdCard();
// ---- one card: slot 2 empty
let pl = null;
try {
  pl = player(cardA);
  const s = pl.session;
  idle(s, 1500);
  const x = state(s);
  ok(x.det[0] === 0 && x.det[SECOND] === DETECT_NO_CARD && x.drive[0] === DRIVE_MOUNTED && x.drive[SECOND] === DRIVE_NO_CARD && x.ports[0] > 0 && x.ports[SECOND] === 0,
    `one card: the detect answers a card in slot 1 and none in slot 2, drive 1 has no card, port 1 no command: ${show(x)}`);
  s.set(SAVE, 1); idle(s, 300);
  shoot(s);
  ok(s.storage.files.length === 0, `one card, the save slot (setting ${SAVE}) at slot 2: no file (${J(s.storage.files.map((f) => f.path))})`);
  s.set(SAVE, 0); idle(s, 300);
  shoot(s);
  const f = s.storage.files[0], f1 = has(cardA, 1);
  ok(s.storage.files.length === 1 && f.path === `${names.drive}:\\${DIR.replace('/', '\\')}\\${names.file}0001.${names.ext}` && f1?.size === f.size,
    `one card, the save slot at slot 1: S2's file ${f?.path} on the card (${f1?.size} bytes, read independently)`);
  ok(s.lab.sasic_sends.length === 0 && !pl.stand_ins_in_use().includes('S-SASIC'), `one card: no send to the slave ASIC's queue: ${J(sasicSends(s))}`);
} catch (e) { bad.push(`one card: ${e.message.slice(0, 600)}`); }
try { pl?.close_session(); } catch { /* closed */ }

// ---- two cards: a blank one in slot 1, the card with the picture in slot 2
if (want) {
  let stop = null;
  sasicLabs.length = 0;
  try { pl = player(cardB, cardA); } catch (e) { stop = e.message; }
  const sends = sasicLabs.flatMap((l) => l.sasic_sends.map(([q, , msg, site]) => [q, msg, site]));
  ok(sends.length > 0 && J(sends[0]) === J([sq, want.msg, hx(want.ret)]) && sends.every(([q, , site]) => q === sq && site === hx(want.ret)),
    `two cards: the access lamp's sends to the slave ASIC's queue, S-SASIC's: ${J(sends)}`);
  ok(stop !== null && !/queue 221/.test(stop) && /drive 1: the firmware left the second card unmounted/.test(stop)
    && stop.includes(`drive status 0x${want.drive.toString(16).padStart(8, '0')}, 0 commands on its port`),
    `two cards: the bring-up passes the slave ASIC's queue and stops at the second card's mount: ${stop?.slice(0, 400)}`);
} else {
  try {
    pl = player(cardB, cardA);
    const s = pl.session, store = s.storage;
    idle(s, 1500);
    const x = state(s);
    ok(x.det.join() === '0,0' && x.drive.every((d) => d === DRIVE_MOUNTED) && x.ports[SECOND] > 0 && store.second.mounted && !store.second.formatted && store.second.dcf?.file === 2,
      `two cards: both detects 0, both drives mounted, the second on its own port and not formatted by the lab, its next file ${store.second.dcf?.file}: ${show(x)}`);
    ok(s.lab.sasic_sends.length === 0 && !pl.stand_ins_in_use().includes('S-SASIC'), `two cards: no send to a slave ASIC's queue: ${J(sasicSends(s))}`);
    s.set(SAVE, 1); idle(s, 300);
    shoot(s);
    const d = store.files[0], f2 = has(cardA, 2);
    ok(store.files.length === 1 && d.path.startsWith(`${second}:`) && d.number === 2 && f2?.size === d.size && has(cardA, 1) && !has(cardB, 1),
      `two cards, the save slot at slot 2: S2's file ${d?.path} on the second card (${f2?.size} bytes beside its first picture, read independently), none on the first`);
    s.set(SAVE, 0); idle(s, 300);
    shoot(s);
    const c = store.files[1], f1 = has(cardB, 1);
    ok(store.files.length === 2 && c.path.startsWith(`${names.drive}:`) && f1?.size === c.size && !has(cardA, 3),
      `two cards, the save slot at slot 1: S2's file ${c?.path} on the first card (${f1?.size} bytes), the second card got none`);
  } catch (e) { bad.push(`two cards: ${e.message.slice(0, 600)}`); }
  try { pl?.close_session(); } catch { /* closed */ }
}

console.log(`${MODEL}'s second card slot by the rule: ${checks - bad.length}/${checks}`);
bad.forEach((t) => console.log('  ', t));
process.exitCode = bad.length ? 1 : 0;
