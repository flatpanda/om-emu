// The playback menu's Erase All, natively (src/lab/media.mjs S-MDACTRL's erase all; docs/hle-gaps/4.8.md 4.8.15):
//   eraseAllSession  (firmware) a play session on the body of OM_EMU_MODEL (E143 by default): start, S1 and S2 three
//                    times (three pictures on the card), the first one locked by the firmware's own DCF edit
//                    (FILECLBK's DCFED_OBJ_LOCK, the test's own action, as test_erase.mjs's), MENU, the sub dial to the
//                    tab whose page holds Erase All (the playback menu's File page), then the walker
//                    (src/lab/menuwalk.mjs) to Erase All, Erase (the dialog's choice for the pictures with rating
//                    flags) and Yes: the media control's start with the erase all's command for the first card, the
//                    card input refused while it runs, the erase finished and the application back on the menu. Read
//                    back by the independent readers (refs/volume.mjs, refs/fat.mjs, as bin/card.mjs ls reads a card):
//                    the two unlocked files' entries marked deleted (0xe5, the other name bytes, first cluster and size
//                    kept), every cluster of their chains free in the FAT, the free count and FSInfo's up by the
//                    chains, the locked file kept with its bytes, first cluster and read-only bit, its folder kept; the
//                    firmware's count 1 and S-CARD's records 1. Unlocked by the DCF edit, the second Erase All: no
//                    picture counted, the emptied folder removed from DCIM, the free count the start's. MENU back to
//                    the shooting screen and S2: the next picture counted and on the card. Then (2026-11-22,
//                    docs/hle-gaps/4.8.md 4.8.16) a second picture, the first locked again by the DCF edit, Reset All
//                    Images, Reset Protect and Yes: the media control's unlock all (command 5) natively, the first
//                    file's read-only bit cleared on the card and its fnode's lock bit; the second picture rated 3 by
//                    the firmware's own DCF edit (OBJ_RATING, the test's own action, the Exif Rating tag 0x4746 read
//                    back as 3 by refs/exif.mjs, the rest of the file unchanged), and Erase All, Save and Yes: the
//                    rating-exclusive erase all (command 6) natively, the rated file kept with its bytes, the other
//                    erased; the firmware's count 1 (on E146 and E147, not in RATING_ERASE, Save is refused at S-MDACTRL
//                    with the command named and both files kept). On a body without the native erase all (no S-MDACTRL, or no
//                    erase-all call read: ERASE_ALL has the others) the session is not run.
//   node emu/test/test_eraseall.mjs   (with OM_EMU_MODEL=E146 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

// the bodies whose Erase All runs natively (X, 2026-11-16; S-MDACTRL's erase all, media.mjs), held strictly both
// ways: the media control's command 3 (models.mjs card_fs.hls.ctrl.erase_all: E143's start table, and the same
// command from the menu on E146, E147 and E148, X) and the picture file API's erase all the rule reads (src/fw/facts.mjs
// pictureErase's erase_all, the call each body's executeEraseAllStart makes, D: E146 0x50cfc463, E147 0x50d07a2c,
// E148 0x50a6c105). The other bodies have no S-MDACTRL (their application runs the media control itself, S-MDAEND)
export const ERASE_ALL = new Set(['E143', 'E146', 'E147', 'E148']);
export const ERASE_ALL_BODIES = ['E146', 'E147', 'E148', 'E144', 'E122'];
// the bodies whose rating-exclusive erase all (Erase All's Save, command 6) runs natively (X, 2026-11-22; models.mjs
// card_fs.hls.ctrl.rating_erase): E146's and E147's DCF edit takes its buffer from a memory pool past the lab's DRAM
// (docs/hle-gaps/4.8.md 4.8.16), so S-MDACTRL refuses the command there
export const RATING_ERASE = new Set(['E143', 'E148']);
const DCFED_OBJ_LOCK = 0x23, DCFED_OBJ_UNLOCK = 0x24, DCFED_OBJ_RATING = 0x2b, READ_ONLY = 0x01, ERASE_ALL_CMD = 3, UNLOCK_ALL_CMD = 5, SAVE_CMD = 6, MAX_TABS = 8;
// the DCF edit's OBJ_RATING block (dcfedit.c op 6, E143 0x508744e4, D): +2 the drive, +4 the fnode, +20 the rating,
// +24 a buffer of RATING_BUF bytes holding the file's head, which the edit's Exif rating set (0x5042aade) changes and
// its sector write (0x50873f37, dosfile operation 4, RATING_BUF >> 9 sectors from the file's first cluster) puts back
// (for the main image it reads nothing first, 0x5087412f; the rating API 0x504022b5, API 0x7004b, takes the buffer
// from its caller, 0x50534dd1, not read further: the test fills it from the card); the Exif Rating tag 0x4746 (IFD0)
const RATING_BUF = 0x10000, RATING = 3, EXIF_RATING = 0x4746;
const MENU = 'SS_MENU/ID_ST_MENU';

export async function eraseAllSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const { openVolume } = await import('../refs/volume.mjs');
  const { MenuWalk, screenTexts } = await import('../src/lab/menuwalk.mjs');
  const { readExif } = await import('../refs/exif.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab, cam = s.camapp, st = s.storage, media = cam.media;
  const native = !!media?.f.ctrl?.erase_all && !!cam.erase_facts()?.erase_all && cam.dcf_db();
  ok(native === ERASE_ALL.has(MODEL), `${MODEL}: the erase all ${native ? 'runs natively' : 'is not stood in'}, ${ERASE_ALL.has(MODEL) ? 'native' : 'not'} expected (ERASE_ALL)`);
  if (!native) return { checks, bad };
  const press = (k) => { s.key(k, 'down'); cam.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); cam.pump(); s.idle_slice(lab.lab_time() + 600e6); };
  const name = () => lab.state_names.get(lab.state());
  const texts = () => screenTexts(lab.draw_log, s.frame('boundary')).map((t) => t.text);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  // the card as the independent reader sees it (test_erase.mjs's)
  const card = () => {
    const v = openVolume((lba, n) => st.card.read(lba, n)), dcim = v.find('DCIM'), dir = dcim && v.list(dcim).find((e) => e.dir && /^1\d\d/.test(e.name)) || null;
    const files = new Map((dir ? v.list(dir) : []).filter((e) => !e.dir).map((e) => [e.name, { ...e, chain: v.chain(e.cluster), sha: sha(v.data(e)) }]));
    return { v, dcim, dir, files, deleted: dir && v.type === 'FAT32' ? v.deleted(dir) : [], free: v.freeClusters(), fsinfo: v.fsInfo() };
  };
  const edit = (code, index, label, more = null) => {
    const pic = st.fnode(index, 'test'), blk = lab.alloc(new Uint8Array(128), 4);
    lab.sim.write(blk + 2, pack('<H', 0));
    lab.sim.write(blk + 4, pack('<I', pic.fnode));
    if (more) more(blk);
    return st.ask(code, blk, 128, label, 'test').status;
  };
  // MENU, then the sub dial until the page holds Erase All, the walker to the item (Erase All, Reset All Images) and
  // the choice, UP to Yes (the confirm's cursor starts on No, X) and OK, its release with no idle after it, so the
  // command is still running
  const toEraseAll = (choice, item = 'Erase All') => {
    press('menu');
    for (let i = 0; i < MAX_TABS && !texts().includes('Erase All'); i++) { s.dial_input('sub', 1); cam.pump(); s.idle_slice(lab.lab_time() + 600e6); }
    const walk = new MenuWalk({ press, frame: () => s.frame('boundary'), draws: () => lab.draw_log });
    walk.to([{ row: [item] }, { row: [choice] }]);
    press('up');
    const confirm = texts();
    // (the start is taken at OK's press: while S-MDACTRL runs the card input is refused)
    s.key('ok', 'down');
    const running = media.ctrl !== null;
    let held = false;
    if (running) try { pl.run_input({ type: 'card', action: 'remove' }); } catch (e) { held = /media layer is busy/.test(e.message); }
    cam.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key('ok', 'up'); cam.pump();
    return { walk: walk.log, confirm, running, held };
  };
  // lab time until the erase all (or with key 'unlocks', the unlock all) is done
  const run = (n, key = 'erases') => {
    for (let i = 0; i < 200 && media[key] < n; i++) s.idle_slice(lab.lab_time() + 50e6);
    s.idle_slice(lab.lab_time() + 1000e6);
  };
  s.idle_slice(lab.lab_time() + 1500e6);
  const fresh = card();
  for (const k of ['s1', 's2', 's1', 's2', 's1', 's2']) press(k);
  ok(cam.card_images() === 3 && cam.images.length === 3, `${MODEL}: three pictures on the card (${cam.card_images()} counted, ${cam.images.length} taken)`);
  const lock = edit(DCFED_OBJ_LOCK, 1, 'dcf lock'), before = card(), [first, ...others] = [...before.files.values()];
  ok(lock === 0 && before.files.size === 3 && (first.attr & READ_ONLY) !== 0 && others.every((e) => (e.attr & READ_ONLY) === 0),
    `${MODEL}: the DCF edit's lock of picture 1: status ${lock}, ${[...before.files.values()].map((e) => `${e.name} 0x${e.attr.toString(16)}`).join(', ')}`);
  // the first Erase All: the locked picture stays
  const go1 = toEraseAll('Erase');
  ok(go1.confirm.includes('Yes') && media.started?.cmd === ERASE_ALL_CMD && media.started.media === 0,
    `${MODEL}: Erase All, Erase, Yes: the media control's start ${JSON.stringify(media.started)} (command ${ERASE_ALL_CMD}, media 0 expected; the walk ${go1.walk.join('; ')}; the confirm ${JSON.stringify(go1.confirm)})`);
  ok(go1.running && go1.held, `${MODEL}: while the erase all runs the card input is refused (S-MDACTRL ${go1.running ? 'running' : 'not running'} at OK's press, the removal ${go1.held ? 'refused' : 'taken'})`);
  run(1);
  ok(media.erases === 1 && media.ctrl === null && media.formats === 0, `${MODEL}: the erase all finished: ${JSON.stringify(media.status())}`);
  const after = card(), kept = after.files.get(first.name);
  ok(after.dir?.cluster === before.dir.cluster && after.files.size === 1 && kept?.sha === first.sha && kept.cluster === first.cluster && (kept.attr & READ_ONLY) !== 0,
    `${MODEL}: the locked ${first.name} kept with its bytes, first cluster and read-only bit in its folder: ${[...after.files.keys()].join(' ')}`);
  for (const e of others) {
    const gone = after.deleted.find((d) => d.cluster === e.cluster);
    ok(!after.files.has(e.name) && gone && gone.tail === e.name.slice(1) && gone.size === e.size && e.chain.every((c) => after.v.next(c) === 0),
      `${MODEL}: ${e.name}: ${after.files.has(e.name) ? 'still listed' : 'gone'}, deleted entry ${gone ? `'${gone.tail}' cluster ${gone.cluster} size ${gone.size}` : 'none'}, its ${e.chain.length} clusters ${e.chain.every((c) => after.v.next(c) === 0) ? 'free' : 'not all free'}`);
  }
  const chains = others.reduce((n, e) => n + e.chain.length, 0);
  ok(after.free === before.free + chains && after.fsinfo?.free === after.free, `${MODEL}: the free count ${before.free} -> ${after.free} (+${chains} expected), FSInfo's ${after.fsinfo?.free}`);
  ok(cam.card_images() === 1 && cam.images.length === 1 && cam.images[0].number === 1, `${MODEL}: after the erase all ${cam.card_images()} counted, ${cam.images.length} record(s) (picture ${cam.images[0]?.number})`);
  ok(name() === MENU && texts().includes('Erase All'), `${MODEL}: the application back on the menu's page: ${name()} ${JSON.stringify(texts())}`);
  ok(pl.stand_ins_in_use().includes('S-MDACTRL'), `${MODEL}: the player lists S-MDACTRL`);
  // unlocked, the second Erase All: none left, the emptied folder gone, the free count the start's
  press('menu');
  const unlock = edit(DCFED_OBJ_UNLOCK, 1, 'dcf unlock');
  ok(unlock === 0 && (card().files.get(first.name).attr & READ_ONLY) === 0, `${MODEL}: the DCF edit's unlock: status ${unlock}`);
  toEraseAll('Erase');
  run(2);
  const empty = card(), dcim = empty.v.type === 'FAT32' ? empty.v.deleted(empty.dcim) : [];
  ok(media.erases === 2 && cam.card_images() === 0 && cam.images.length === 0, `${MODEL}: the second erase all: ${media.erases} done, ${cam.card_images()} counted, ${cam.images.length} records`);
  // (DCIM stays: the start's card had none where the first picture made it, X)
  const made = fresh.dcim ? 0 : empty.dcim ? empty.v.chain(empty.dcim.cluster).length : 0;
  ok(empty.dir === null && empty.dcim && dcim.some((d) => d.cluster === before.dir.cluster && d.tail === before.dir.name.slice(1)) && empty.free === fresh.free - made && empty.fsinfo?.free === empty.free,
    `${MODEL}: the emptied folder ${before.dir.name} ${empty.dir ? 'still in DCIM' : 'gone'} (deleted entries [${dcim.map((d) => d.tail).join(' ')}]), DCIM ${empty.dcim ? 'kept' : 'gone'}, the free count ${empty.free} (the start's ${fresh.free}, DCIM ${fresh.dcim ? 'there' : `made since, ${made} cluster(s)`}), FSInfo's ${empty.fsinfo?.free}`);
  // back to shooting: the next picture
  press('menu');
  press('s1'); press('s2');
  const next = card(), pic = cam.images[cam.images.length - 1];
  ok(cam.card_images() === 1 && next.files.size === 1 && pic?.folder === 100 && pic?.number === 1,
    `${MODEL}: the next picture: ${cam.card_images()} counted, ${[...next.files.keys()].join(' ')} on the card, ${pic?.folder}-${String(pic?.number).padStart(4, '0')}`);
  // a second picture, the first locked again: Reset All Images, Reset Protect, Yes (the unlock all, command 5)
  press('s1'); press('s2');
  const relock = edit(DCFED_OBJ_LOCK, 1, 'dcf lock'), two = card(), [p1, p2] = [...two.files.values()];
  ok(relock === 0 && two.files.size === 2 && (p1.attr & READ_ONLY) !== 0 && (p2.attr & READ_ONLY) === 0,
    `${MODEL}: two pictures, the first locked: status ${relock}, ${[...two.files.values()].map((e) => `${e.name} 0x${e.attr.toString(16)}`).join(', ')}`);
  const two2 = two.v.data(p2).slice();         // (the volume reads the card at each call)
  const go5 = toEraseAll('Reset Protect', 'Reset All Images');
  ok(go5.confirm.includes('Yes') && media.started?.cmd === UNLOCK_ALL_CMD && media.started.media === 0 && go5.running,
    `${MODEL}: Reset All Images, Reset Protect, Yes: the media control's start ${JSON.stringify(media.started)} (command ${UNLOCK_ALL_CMD}, media 0 expected; the walk ${go5.walk.join('; ')}; the confirm ${JSON.stringify(go5.confirm)}), ${go5.running ? 'running' : 'not running'} at OK's press`);
  run(1, 'unlocks');
  const open = card(), u1 = open.files.get(p1.name);
  ok(media.unlocks === 1 && media.ctrl === null && u1 && (u1.attr & READ_ONLY) === 0 && u1.sha === p1.sha && open.files.size === 2 && (st.fnode(1, 'test').attr & 1) === 0,
    `${MODEL}: the unlock all: ${JSON.stringify(media.status())}, ${p1.name} 0x${u1?.attr.toString(16)} (read-only ${u1 && (u1.attr & READ_ONLY) ? 'kept' : 'cleared'}), ${open.files.size} files, the fnode's lock ${st.fnode(1, 'test').attr & 1}`);
  ok(name() === MENU && cam.card_images() === 2, `${MODEL}: after the unlock all the menu, ${cam.card_images()} counted: ${name()} ${JSON.stringify(texts())}`);
  // the second picture rated by the DCF edit, its buffer the file's head from the card (the menu closed first)
  for (let i = 0; i < 3 && name() === MENU; i++) press('menu');
  const rate = edit(DCFED_OBJ_RATING, 2, 'dcf rating', (blk) => {
    const buf = lab.alloc(st.card.read(open.v.sectorOf(p2.cluster), RATING_BUF >> 9), 4);
    lab.sim.write(blk + 20, pack('<II', RATING, buf));
  });
  const rated = card(), r2 = rated.files.get(p2.name), d2 = r2 && rated.v.data(r2), rating = d2 ? readExif(d2)?.ifd0.get(EXIF_RATING) : undefined;
  // (two bytes change: the Exif tag's value and the XMP packet's xmp:Rating digit, X)
  const diff = d2 ? [...d2].reduce((n, b, k) => n + (b !== two2[k]), 0) : -1, xmp = d2 ? Buffer.from(d2).includes(`xmp:Rating="${RATING}"`) : false;
  ok(rate === 0 && rating === RATING && xmp && d2.length === two2.length && diff === 2 && (r2.attr & READ_ONLY) === 0,
    `${MODEL}: the DCF edit's rating of ${p2.name}: status ${rate}, its Exif Rating ${rating} (${RATING} expected), the XMP's ${xmp ? '' : 'not '}${RATING}, ${diff} byte(s) changed (2 expected)`);
  // Erase All, Save, Yes: the rating-exclusive erase all (command 6), natively where RATING_ERASE has the body, else
  // refused at S-MDACTRL with the command named and nothing erased
  ok(!!media.f.ctrl.rating_erase === RATING_ERASE.has(MODEL), `${MODEL}: the rating-exclusive erase all ${media.f.ctrl.rating_erase ? 'stood in' : 'refused'}, ${RATING_ERASE.has(MODEL) ? 'stood in' : 'refused'} expected (RATING_ERASE)`);
  if (!RATING_ERASE.has(MODEL)) {
    let refusal = null;
    try { toEraseAll('Save'); } catch (e) { refusal = e.message; }
    ok(refusal !== null && new RegExp(`S-MDACTRL: the media control's command ${SAVE_CMD} \\(media 0\\)`).test(refusal) && card().files.size === 2,
      `${MODEL}: Erase All, Save, Yes: ${refusal ? refusal.slice(0, 200) : 'no refusal'}; ${card().files.size} file(s) on the card`);
    return { checks, bad };
  }
  const go6 = toEraseAll('Save');
  ok(go6.confirm.includes('Yes') && media.started?.cmd === SAVE_CMD && media.started.media === 0 && go6.running,
    `${MODEL}: Erase All, Save, Yes: the media control's start ${JSON.stringify(media.started)} (command ${SAVE_CMD}, media 0 expected), ${go6.running ? 'running' : 'not running'} at OK's press`);
  run(3);
  const saved = card(), k2 = saved.files.get(p2.name), gone1 = saved.deleted.find((d) => d.cluster === p1.cluster);
  ok(media.erases === 3 && media.ctrl === null && saved.files.size === 1 && k2?.sha === sha(d2) && k2.cluster === p2.cluster && gone1 && gone1.tail === p1.name.slice(1),
    `${MODEL}: the rating-exclusive erase all: ${JSON.stringify(media.status())}, on the card ${[...saved.files.keys()].join(' ')} (${p2.name} kept${k2?.sha === sha(d2) ? ' with its bytes' : ', bytes changed'}), ${p1.name} ${gone1 ? 'deleted' : 'not deleted'}`);
  ok(cam.card_images() === 1 && name() === MENU, `${MODEL}: after Save ${cam.card_images()} counted, ${name()}`);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await eraseAllSession();
  console.log(`the menu's erase all: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
