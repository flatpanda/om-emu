// The playback menu's Copy All with two cards, natively (src/lab/media.mjs S-MDACTRL's copy all; docs/hle-gaps/4.8.md
// 4.8.21):
//   copyAllSession  (firmware, E143) a blank card formatted by the lab in slot 1 of a first session, then put in slot
//                   2 of a second session with another blank card in slot 1; S1 and S2 twice (two pictures on card
//                   1), MENU, the sub dial to the page that holds Copy All, the walker to Copy All and the confirm's
//                   Yes: the media control's start with the copy all's command, the copy run by the file module
//                   natively, and card 2 read back by the independent reader (refs/volume.mjs, as bin/card.mjs ls
//                   reads a card): the same DCF file names with the same bytes as card 1's.
//   node emu/test/test_copyall.mjs   (exit 1 on a failure)
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

export const COPY_ALL = new Set(['E143']);
const COPY_ALL_CMD = 2, MAX_TABS = 8;

export async function copyAllSession() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { openVolume } = await import('../refs/volume.mjs');
  const { SdCard } = await import('../src/lab/sdcard.mjs');
  const { MenuWalk, screenTexts } = await import('../src/lab/menuwalk.mjs');
  if (!COPY_ALL.has(MODEL)) return { checks, bad, notes };
  const env = () => ({ rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) });
  const holder = (card) => ({ open: () => card, save() {} });
  const player = (card, card2 = null) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' },
      { ...env(), card: holder(card), ...(card2 ? { card2: holder(card2) } : {}) });
    pl.open_session();
    return pl;
  };
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const files = (card) => {
    const v = openVolume((lba, n) => card.read(lba, n)), dcim = v.find('DCIM');
    const dirs = dcim ? v.list(dcim).filter((e) => e.dir && /^1\d\d/.test(e.name)) : [];
    return new Map(dirs.flatMap((d) => v.list(d).filter((e) => !e.dir).map((e) => [`${d.name}/${e.name}`, sha(v.data(e))])));
  };
  // a blank card formatted by the lab in a first session's slot 1 (the lab formats slot 1's card alone)
  const card2 = new SdCard(), card1 = new SdCard();
  let pl = player(card2);
  pl.session.idle_slice(pl.session.lab.lab_time() + 1500e6);
  pl.close_session();
  card2.state = 'idle'; card2.selected = false; card2.bus4 = false;
  pl = player(card1, card2);
  const s = pl.session, lab = s.lab, cam = s.camapp, media = cam.media;
  const press = (k) => { s.key(k, 'down'); cam.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); cam.pump(); s.idle_slice(lab.lab_time() + 600e6); };
  // (the File page draws the row as 'Copy All ', with a trailing space, X)
  const texts = () => screenTexts(lab.draw_log, s.frame('boundary')).map((t) => t.text);
  s.idle_slice(lab.lab_time() + 1500e6);
  ok(files(card2).size === 0 && s.storage.second.mounted, `${MODEL}: card 2 formatted, empty and mounted (${files(card2).size} files, mounted ${s.storage.second.mounted})`);
  for (const k of ['s1', 's2', 's1', 's2']) press(k);
  const src = files(card1);
  ok(src.size === 2, `${MODEL}: two pictures on card 1: ${[...src.keys()].join(' ')}`);
  press('menu');
  for (let i = 0; i < MAX_TABS && !texts().some((t) => t.trim() === 'Copy All'); i++) { s.dial_input('sub', 1); cam.pump(); s.idle_slice(lab.lab_time() + 600e6); }
  const walk = new MenuWalk({ press, frame: () => s.frame('boundary'), draws: () => lab.draw_log });
  walk.to([{ row: ['Copy All '] }]);
  const name = () => lab.state_names.get(lab.state());
  notes.push(`after Copy All: ${name()} ${JSON.stringify(texts())}`);
  for (const k of ['ok', 'up', 'ok', 'down', 'ok']) { if (media.started) break; press(k); notes.push(`after ${k}: ${name()} ${JSON.stringify(texts())} ${JSON.stringify(media.started)}`); }
  let stop = null;
  try {
    for (let i = 0; i < 400 && media.copies < 1; i++) s.idle_slice(lab.lab_time() + 50e6);
    s.idle_slice(lab.lab_time() + 1000e6);
  } catch (e) { stop = e.message; }
  notes.push(`log: ${JSON.stringify(media.log.slice(-12))}`);
  ok(stop === null, `${MODEL}: the copy all ran: ${stop?.slice(0, 400)}`);
  ok(media.started?.cmd === COPY_ALL_CMD, `${MODEL}: Copy All, Yes: the media control's start ${JSON.stringify(media.started)} (command ${COPY_ALL_CMD} expected)`);
  const dst = files(card2);
  ok(media.copies === 1 && dst.size === src.size && [...src].every(([n, h]) => dst.get(n) === h),
    `${MODEL}: card 2 holds card 1's DCF files with their bytes: ${[...dst.keys()].join(' ')} (card 1: ${[...src.keys()].join(' ')})`);
  ok(pl.stand_ins_in_use().includes('S-MDACTRL'), `${MODEL}: the player lists S-MDACTRL`);
  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await copyAllSession();
  console.log(`the menu's copy all: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  if (process.env.VERBOSE) r.notes.forEach((x) => console.log('  .', x));
  process.exit(r.bad.length ? 1 : 0);
}
