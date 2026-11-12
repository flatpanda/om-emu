// The erase in playback, natively (src/lab/camapp.mjs H-OBJDEL, S-PLAYSEQ's eraseCurrent; docs/model-survey.md
// findings 137 to 142):
//   eraseSession  (firmware) a play session on the body of OM_EMU_MODEL (E143 by default): start, S1 and S2 three
//                 times (three pictures on the card), the first one locked by the firmware's own DCF edit (FILECLBK's
//                 DCFED_OBJ_LOCK for its fnode, sent here as the test's own action: its directory entry read-only on
//                 the card, the media API's attribute 1), PLAY (the newest shown), then the erase dialog (Delete, UP,
//                 OK) twice: PlaySingleFrame::eraseCurrent (21) each time, which S-PLAYSEQ performs with the
//                 firmware's own calls. After each: the DCF database's count, the picture shown (the last one where
//                 the erased one was the last) and its number, the GUI's state, and the card read back by the
//                 independent FAT reader (refs/volume.mjs, refs/fat.mjs): the file's entry gone and marked deleted
//                 (0xe5, its other name bytes, first cluster and size kept), every cluster of its chain free in the
//                 FAT, the free count and FSInfo's up by the chain, the other files' bytes untouched. The protected
//                 picture, the last left: the lab refuses its erase (the component answers 0xf000003a there) and
//                 the firmware's own object delete, asked directly, erases nothing (status 0, the file kept). Unlocked
//                 by the DCF edit again and erased: No Picture, no picture counted, the emptied folder removed from
//                 DCIM and its cluster free. PLAY back to the shooting screen, S1 and S2: the next picture's folder
//                 and number as the firmware's delete mount left them (X: 100-0001 again in a new folder), counted
//                 and on the card. Then the requests S-PLAYSEQ refuses, each at its execute as the observer meets it:
//                 the erases whose component path is not read (23, 301, 510, 395, 396, 497; the synchronous 265) and
//                 the edits' saves (finding 141's fifteen), with nothing taken.
//                 On a body without the native erase (the rule reads no calls, or its DCF database does not hold the
//                 pictures in the session: ERASE_NATIVE has the others) the session takes two pictures and checks that
//                 eraseCurrent is refused at its execute and both files stay.
//   node emu/test/test_erase.mjs   (with OM_EMU_MODEL=E146 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

// the bodies whose eraseCurrent runs natively (X, 2026-11-11; the rule's calls and REC_FILE's or the recorder's
// registration in the DCF database, src/lab/camapp.mjs erase_native), held strictly both ways
export const ERASE_NATIVE = new Set(['E143', 'E146', 'E147', 'E144', 'E148', 'E139', 'E134', 'E137', 'E142', 'E140', 'E125']);
// the bodies whose Delete in playback opens the erase dialog in the lab (X; finding 138 for E143, finding 111 for
// the others); on a native body outside them the session erases by S-PLAYSEQ's erase itself (erase() below)
export const ERASE_DIALOG = new Set(['E143', 'E146', 'E147', 'E144', 'E148', 'E139', 'E134', 'E142', 'E140', 'E130', 'E133']);
// of the native bodies, those whose shooting service starts again after PLAY's return from playback in the lab (X); on
// the others S1 and S2 release nothing there, with or without an erase (X: PLAY and PLAY again with no picture on
// E142; not the erase's, open), so the next picture's number is not taken there
export const SHOOTS_AFTER_PLAY = new Set(['E143', 'E146', 'E147', 'E144', 'E148', 'E139', 'E134', 'E125']);
const START_KEYS = { E132: ['up', 'ok', 'up', 'ok', 'up', 'ok', 'up', 'ok', 'up', 'ok'] };
const WIZARD = 'SS_MENU_MAIN/ID_ST_WIZARD_MENU_ENTRY', SINGLE = 'SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE', NONE = 'SS_PLAY_SINGLE/ID_ST_NO_PICTURE';
// FILECLBK's codes of the DCF edit's lock and unlock of one object (DCFED_OBJ_LOCK, DCFED_OBJ_UNLOCK: dcfedit's ops 4
// and 5, E143 0x50872e28; the block's +2 drive, +4 the fnode, +12 0), D
const DCFED_OBJ_LOCK = 0x23, DCFED_OBJ_UNLOCK = 0x24, READ_ONLY = 0x01;
const REFUSED_ERASES = [23, 301, 510, 395, 396, 497], REFUSED_SAVES = [120, 131, 142, 164, 173, 186, 281, 284, 331, 404, 408, 456, 477, 533, 535];
const SYNC_ERASE = 265, RSB_REQUEST = 236;

export async function eraseSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const { openVolume } = await import('../refs/volume.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab, cam = s.camapp, st = s.storage;
  const press = (k) => { s.key(k, 'down'); cam.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); cam.pump(); s.idle_slice(lab.lab_time() + 1200e6); };
  const name = () => lab.state_names.get(lab.state());
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const native = ERASE_NATIVE.has(MODEL), dialog = ERASE_DIALOG.has(MODEL);
  ok(cam.erase_native() === native, `${MODEL}: eraseCurrent ${cam.erase_native() ? 'runs natively' : 'is refused'}, ${native ? 'native' : 'refused'} expected (ERASE_NATIVE)`);
  if (!st) return { checks, bad: [...bad, `${MODEL}: no file system in the session`] };
  // the card as the independent reader sees it: the pictures' folder (or null), its entries by name with each one's
  // chain and bytes' digest, its deleted entries, the FAT's free count and FSInfo's
  const card = () => {
    const v = openVolume((lba, n) => st.card.read(lba, n)), dcim = v.find('DCIM'), dir = dcim && v.list(dcim).find((e) => e.dir && /^1\d\d/.test(e.name)) || null;
    const files = new Map((dir ? v.list(dir) : []).filter((e) => !e.dir).map((e) => [e.name, { ...e, chain: v.chain(e.cluster), sha: sha(v.data(e)) }]));
    return { v, dcim, dir, files, deleted: dir && v.type === 'FAT32' ? v.deleted(dir) : [], free: v.freeClusters(), fsinfo: v.fsInfo() };
  };
  const fileName = (pic) => [...card().files.keys()].find((n) => new RegExp(`${String(pic.number).padStart(4, '0')}\\.JPG$`).test(n));
  // one erase: through the GUI's dialog where Delete opens it (Delete, UP to Yes, OK: the GUI sends eraseCurrent and
  // S-PLAYSEQ finishes it); else S-PLAYSEQ's erase called here as the request would have it called (the firmware's
  // calls, the list and the image shown), then PLAY out and in, since no request tells that GUI of the erase
  const erase = () => {
    if (dialog) {
      press('delete');
      ok(name() === WIZARD, `${MODEL}: Delete ${name()} (the erase dialog)`);
      press('up');
      press('ok');
    } else { cam.play_erase({ id: 21 }); press('play'); press('play'); }
  };
  s.idle_slice(lab.lab_time() + 1500e6);
  if (!native) {
    for (const k of [...(START_KEYS[MODEL] ?? []), 's1', 's2', 's1', 's2']) press(k);
    const before = card();
    press('play');
    const rsb = lab.alloc(new Uint8Array(RSB_REQUEST + 8), 4), req = lab.alloc(pack('<IIIII', 21, 0, 0, 0, 0), 4);
    lab.sim.write(rsb + RSB_REQUEST, pack('<I', req));
    let refusal = null;
    try { cam.play_execute(rsb, 0); } catch (e) { refusal = e; }
    ok(refusal !== null && /S-PLAYSEQ: play request 21 \(PlaySingleFrame::eraseCurrent\) erases from the card/.test(refusal.message), `${MODEL}: eraseCurrent at its execute: ${refusal ? refusal.message.slice(0, 200) : 'no refusal'}`);
    const after = card();
    ok(before.files.size === 2 && after.files.size === 2 && cam.play_pending.length === 0, `${MODEL}: after the refusal ${after.files.size} of ${before.files.size} files on the card, ${cam.play_pending.length} request(s) taken`);
    return { checks, bad };
  }
  for (const k of [...(START_KEYS[MODEL] ?? []), 's1', 's2', 's1', 's2', 's1', 's2']) press(k);
  const shooting = lab.state();
  ok(cam.card_images() === 3 && cam.images.length === 3, `${MODEL}: three pictures on the card (${cam.card_images()} counted, ${cam.images.length} taken)`);
  // the first picture locked by the firmware's DCF edit, before the play start reads the pictures
  const edit = (code, index, label) => {
    const pic = st.fnode(index, 'test'), blk = lab.alloc(new Uint8Array(128), 4);
    lab.sim.write(blk + 2, pack('<H', 0));
    lab.sim.write(blk + 4, pack('<I', pic.fnode));
    return st.ask(code, blk, 128, label, 'test').status;
  };
  const attribute = (index) => lab.call(cam.erase_facts().attribute, { d0: 0, d1: index }, null, null, 2000000).d0 & 0xFF;
  const lock = edit(DCFED_OBJ_LOCK, 1, 'dcf lock');
  const c0 = card(), first = [...c0.files.values()][0];
  ok(lock === 0 && (first.attr & READ_ONLY) !== 0 && attribute(1) === 1 && attribute(2) === 0,
    `${MODEL}: the DCF edit's lock of picture 1: status ${lock}, ${first.name}'s attribute 0x${first.attr.toString(16)} on the card, the API's attribute ${attribute(1)} (picture 2's ${attribute(2)})`);
  press('play');
  ok(name() === SINGLE && cam.play_cur === 2 && cam.shown()?.number === 3, `${MODEL}: PLAY ${name()}, image ${cam.play_cur + 1} of 3 shown (number ${cam.shown()?.number})`);
  // erase the newest (the last index): the picture before it is shown; then that one: the first, the protected one
  for (const [number, left, shown] of [[3, 2, 2], [2, 1, 1]]) {
    const before = card(), file = fileName({ number }), e = before.files.get(file), frame = sha(s.frame('boundary', true)[2]);
    erase();
    const after = card(), gone = after.deleted.find((d) => d.cluster === e.cluster);
    ok(name() === SINGLE && cam.erased === 4 - number && cam.card_images() === left && cam.play_list.length === left && cam.images.length === left,
      `${MODEL}: erase of ${file}: ${name()}, ${cam.erased} erased, ${cam.card_images()} counted (${left} expected), ${cam.play_list.length} listed, ${cam.images.length} records`);
    ok(cam.play_cur === shown - 1 && cam.shown()?.number === shown && sha(s.frame('boundary', true)[2]) !== frame,
      `${MODEL}: after it image ${cam.play_cur === null ? '-' : cam.play_cur + 1} shown, number ${cam.shown()?.number} (${shown} expected), the frame ${sha(s.frame('boundary', true)[2]) === frame ? 'unchanged' : 'changed'}`);
    ok(!after.files.has(file) && after.files.size === left && gone && gone.tail === file.slice(1) && gone.size === e.size,
      `${MODEL}: ${file} on the card: ${after.files.has(file) ? 'still listed' : 'gone'}, deleted entry ${gone ? `'${gone.tail}' cluster ${gone.cluster} size ${gone.size}` : 'none'} (cluster ${e.cluster}, size ${e.size})`);
    const freed = e.chain.filter((c) => after.v.next(c) === 0).length;
    ok(freed === e.chain.length && after.free === before.free + e.chain.length && after.fsinfo?.free === after.free,
      `${MODEL}: ${freed} of its ${e.chain.length} clusters free in the FAT, the free count ${before.free} -> ${after.free}, FSInfo's ${after.fsinfo?.free}`);
    const kept = [...after.files.values()].filter((x) => before.files.get(x.name)?.sha === x.sha && before.files.get(x.name)?.cluster === x.cluster).length;
    ok(kept === left, `${MODEL}: ${kept} of the ${left} other files with their bytes and first cluster as before`);
  }
  // the protected picture: the GUI is told (S-PLAYCOMP's isProtect, the list's attribute) and its Delete opens no
  // dialog (E143's blinks the protect mark and returns to the single frame by itself within a second, X), the lab
  // refuses its erase, and the firmware's own object delete erases nothing
  {
    const before = card(), file = fileName({ number: 1 });
    ok(cam.play_list[0]?.attr === 1, `${MODEL}: the picture shown is protected in the list (attribute ${cam.play_list[0]?.attr})`);
    if (dialog) {
      press('delete');
      const at = name();
      s.idle_slice(lab.lab_time() + 1500e6);
      ok(at !== WIZARD && name() === SINGLE && cam.erased === 2 && cam.card_images() === 1, `${MODEL}: Delete on the protected picture: ${at} (no erase dialog), ${cam.erased} erased, ${cam.card_images()} counted, then ${name()}`);
    }
    let refusal = null;
    try { cam.play_erase({ id: 21 }); } catch (e) { refusal = e; }
    ok(refusal !== null && /for the protected picture 100-0001 .*0xf000003a/.test(refusal.message), `${MODEL}: eraseCurrent of the protected picture: ${refusal ? refusal.message.slice(0, 160) : 'no refusal'}`);
    const r = st.api_request(() => lab.call(cam.erase_facts().object_delete, { d0: 0, d1: 1, a0: 0 }, null, null, 20000000).d0 >>> 0, 'object delete (protected)', 'test');
    const after = card();
    ok(r.status === 0 && after.files.get(file)?.sha === before.files.get(file).sha && after.free === before.free && cam.card_images() === 1,
      `${MODEL}: the firmware's object delete of the protected picture: status ${r.status}, ${file} ${after.files.has(file) ? 'kept' : 'gone'}, ${cam.card_images()} counted`);
    const unlock = edit(DCFED_OBJ_UNLOCK, 1, 'dcf unlock'), c = card();
    ok(unlock === 0 && (c.files.get(file).attr & READ_ONLY) === 0 && attribute(1) === 0, `${MODEL}: the DCF edit's unlock: status ${unlock}, the entry's attribute 0x${c.files.get(file).attr.toString(16)}, the API's ${attribute(1)}`);
    // (the list's attribute is the play start's: PLAY out and in reads the pictures again)
    press('play'); press('play');
    ok(name() === SINGLE && cam.play_cur === 0 && cam.play_list[0]?.attr === 0, `${MODEL}: PLAY again ${name()}, image ${cam.play_cur === null ? '-' : cam.play_cur + 1}, attribute ${cam.play_list[0]?.attr}`);
  }
  // erase the last picture: No Picture, and the emptied folder gone
  {
    const before = card(), file = fileName({ number: 1 }), e = before.files.get(file), folder = before.dir;
    erase();
    const after = card(), dcim = after.v.type === 'FAT32' ? after.v.deleted(after.dcim) : [];
    ok(name() === NONE && cam.card_images() === 0 && cam.play_cur === null && cam.play_list.length === 0 && cam.images.length === 0,
      `${MODEL}: erase of the last picture: ${name()}, ${cam.card_images()} counted, image ${cam.play_cur === null ? 'none' : cam.play_cur + 1}`);
    ok(after.dir === null && dcim.some((d) => d.cluster === folder.cluster && d.tail === folder.name.slice(1)) && after.v.next(folder.cluster) === 0,
      `${MODEL}: the emptied folder ${folder.name}: ${after.dir ? 'still in DCIM' : 'gone'}, deleted entries [${dcim.map((d) => d.tail).join(' ')}], its cluster ${folder.cluster} ${after.v.next(folder.cluster) === 0 ? 'free' : 'in use'}`);
    ok(e.chain.every((c) => after.v.next(c) === 0) && after.free === before.free + e.chain.length + 1 && after.fsinfo?.free === after.free,
      `${MODEL}: the file's ${e.chain.length} clusters free, the free count ${before.free} -> ${after.free}, FSInfo's ${after.fsinfo?.free}`);
  }
  // back to shooting; the next picture's number as the delete mount left the numbering
  press('play');
  ok(lab.state() === shooting, `${MODEL}: PLAY back to 0x${lab.state().toString(16)} ${name()}, the shooting screen's 0x${shooting.toString(16)}`);
  press('s1'); press('s2');
  if (SHOOTS_AFTER_PLAY.has(MODEL)) {
    const c = card(), pic = cam.images[cam.images.length - 1];
    ok(cam.card_images() === 1 && c.files.size === 1 && pic?.folder === 100 && pic?.number === 1,
      `${MODEL}: the next picture: ${cam.card_images()} counted, ${[...c.files.keys()].join(' ')} on the card, ${pic?.folder}-${String(pic?.number).padStart(4, '0')}`);
  } else ok(!cam.shooting && cam.card_images() === 0, `${MODEL}: no shooting service after playback (SHOOTS_AFTER_PLAY): ${cam.shooting ? 'it runs' : 'none'}, ${cam.card_images()} counted`);
  // the requests S-PLAYSEQ refuses, each at its execute as the observer meets it (an RSB with that request)
  {
    const rsb = lab.alloc(new Uint8Array(RSB_REQUEST + 8), 4), req = lab.alloc(new Uint8Array(20), 4), n0 = cam.play_pending.length;
    lab.sim.write(rsb + RSB_REQUEST, pack('<I', req));
    const refused = (id) => { lab.sim.write(req, pack('<I', id)); try { cam.play_execute(rsb, 0); } catch (e) { return e.message; } return null; };
    const erases = REFUSED_ERASES.map((id) => [id, refused(id)]), saves = REFUSED_SAVES.map((id) => [id, refused(id)]);
    ok(erases.every(([id, m]) => m && m.includes(`S-PLAYSEQ: play request ${id} (`) && /erases from the card; its component path is not read/.test(m)),
      `${MODEL}: the erases refused at their execute: ${erases.map(([id, m]) => `${id} ${m ? 'refused' : 'TAKEN'}`).join(', ')}`);
    ok(saves.every(([id, m]) => m && m.includes(`S-PLAYSEQ: play request ${id} (`) && /saves an edit's file/.test(m)),
      `${MODEL}: the edits' saves refused at their execute: ${saves.map(([id, m]) => `${id} ${m ? 'refused' : 'TAKEN'}`).join(', ')}`);
    let sync = null;
    try { cam.play_sync(SYNC_ERASE, 0); } catch (e) { sync = e.message; }
    ok(sync !== null && /synchronous play request 265 \(PlayRecord::erase\)/.test(sync) && cam.play_pending.length === n0, `${MODEL}: the synchronous erase 265: ${sync ? 'refused' : 'TAKEN'}, ${cam.play_pending.length - n0} request(s) taken by the refusals`);
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await eraseSession();
  console.log(`the erase in playback: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
