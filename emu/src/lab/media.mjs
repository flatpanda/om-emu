// The HLS media side of the card, on a body whose file system runs natively (src/lab/storage.mjs; MODEL_INFO.card_fs.hls
// in src/fw/models.mjs has the evidence for every address, docs/hle-gaps/4.8.md 4.8.3 the record). The camera application's
// media control (OlyHfwOpeMdaCtrl: its requests, its receptor and its reactive) runs natively; the two HLS components
// it talks to, the function component CmpCst_Function and the media manager CapMed_MediaManager, do not run in the lab
// (camapp 1 runs no HLS component, camapp 2's bring-up does not create them: X, neither reacted to a format or a card
// switch). Their parts are stood in at their seams, with the firmware's own event objects (operator new and each
// class's constructor), delivered through the reception's synchronous slot, which hands them to the receptors natively:
//
//   S-MDACTRL  the media control's start (TRA 1511, which S-TRAACK answers) for a format (command 1), as the function
//              component runs it: executeMediaFormatStart's call of api_media's format natively, so the file module
//              formats the card from the firmware's own request; each of the file module's progress events then a
//              progress notification (1513, kind 3) with the component's own percent (getMediaProgress, natively); at
//              the module's reply to the API queue the component's end: the slots' format flags (natively, under the
//              component's own tests), 1513 at 100, 697 {1, media}, and the result 1514 {kind 72, 0}, which takes the
//              application from "Busy" back to the menu. Before the result the DCF numbering mount (storage.mjs), for
//              the next file number: I, the component starts a request after a format whose completion sends the
//              result (its class is not read; a remount, I). The component sends 1513 / 1514 through the reception's
//              asynchronous slot, to the reactive's OXF main thread, which does not run in camapp 1: the synchronous
//              slot stands in for that thread's dispatch (I). Since 2026-11-16 the erase all (command 3, the
//              playback menu's Erase All, f.ctrl.erase_all, docs/hle-gaps/4.8.md 4.8.15) as well, where the build's
//              erase-all call is read (src/fw/facts.mjs pictureErase, fact erase.erase_all) and the DCF database
//              holds the pictures: executeEraseAllStart's call of the picture file API's erase all natively (it
//              posts FILECLBK the DCF edit's ALL_DELETE, which erases every picture but the locked ones natively,
//              its own delete mount among its steps), the progress as the format's (the same getMediaProgress and
//              progress event), and at the reply the same end, without the DCF numbering mount (the component
//              starts its remount request for the format alone, D) and with S-CARD's records of the erased
//              pictures dropped. Since 2026-11-22 (docs/hle-gaps/4.8.md 4.8.16) the unlock all (command 5, Reset All
//              Images' Reset Protect, f.ctrl.unlock_all): executeUnlockAllStart's notification of the Wi-Fi remote
//              take component natively (f.ctrl.wifi), then the picture file API's unlock all (fact
//              erase.unlock_all), which posts FILECLBK the DCF edit's OBJ_UNLOCK of every object, natively; and the
//              rating-exclusive erase all (command 6, Erase All's Save, f.ctrl.rating_erase, on E143 and E148):
//              the API's ALL_DELETE with the option 0x10 (fact erase.rating_erase), whose walk keeps every picture
//              with an Exif Rating of 1 or more, natively; both with the erase all's progress and end (the unlock all
//              erases nothing, S-CARD's records stay). Since 2026-11-22 too (docs/hle-gaps/4.8.md 4.8.21) the copy
//              all (command 2, f.ctrl.copy_all, E143 and E146, 4.8.27): the picture file API's copy all between the two slots
//              natively, with its own progress function and the component's end check of the record's media's
//              count. Any other command (the copy all 2 where f.ctrl has no copy_all, and command 6 where f.ctrl
//              has no rating_erase), and an error status, stops the session: the component's other starts
//              and its error kinds (70 / 71 / 118) are not modelled. The ids are E143's: a later build renumbers them
//              (src/fw/models.mjs card_fs.hls of E146, E147 and E148), and the log names each event by the id its
//              constructor gave it
//   S-MEDIA    the media manager's part of a card's removal and insertion, from the card switch's change: UI_IN decodes
//              the switch natively (and calls the file layer's own callback for it) and publishes the slot's switch
//              event; the stand-in reads the switch's level through UI_IN's getter natively. Out (level 1, I): the
//              slot's mount state word unmounted (the firmware's setter, as unmountPreprocess sets it), the DCF
//              process's card out (storage.mjs) and the notification 711 {kind, 0, 0} (the application posts its
//              card-out event). In (level 0): 711 {kind, 1, 0} (its card-in event), S-CARD's insertion requests, the
//              mount state mounted and 711 {kind, 1, 2} (notifyRecMountEnd: EV_MEDIA_MOUNT_REC) and {kind, 1, 8}
//              (mountProcEnd). Each notification's layout and sender is D; which ones the media manager sends at a
//              change, and in which order, is I. The level's meaning is D on E143 and E146 (the SD driver's detect
//              takes level 0 for a card in the slot, docs/hle-gaps/4.8.md 4.8.12), I elsewhere (models.mjs slots).
//              The same for the second slot's card and switch on a body whose second slot the lab models
//              (storage.mjs S-SDCARD), where no media manager runs. With control camapp 3 the firmware's own media
//              manager runs and takes the second slot's change itself (X): S-MEDIA then only reads the slot's state
//              back. And, where no media manager runs, the slots' media flags (S-CARD's, flags()): the manager's
//              slot update sets a slot's flag (f.ctrl.flag: 15261 + slot on E143) to 1 where the slot is mounted and
//              to 0 where it is not (0x50bba897, D); S-CARD sets them so after its insertions and S-MEDIA after each
//              change, through the store's setter the update uses
//   S-MDAEND   (the E118 family and the E144 family but E148, whose facts the rule reads: src/fw/facts.mjs mediaHls,
//              fact 'media'; no S-MDACTRL there) the camera base's part of the media control's end. Their application
//              runs the media control itself, in its event manager's process (OlyHfwOpeMdaCtrlProcessEvFw; the E144
//              family's in two steps and with the slots' format flags, docs/model-survey.md finding 151): Card
//              Setup's Format calls api_media's format, the file module formats the card and replies, and the
//              process's progress callbacks drive the bar, all natively (X). The start's command is read where the
//              application makes it (f.cab.start: d0 the command, d1 the media); any command but the format stops
//              the session (the others are not driven here). At its end the process sends the camera base
//              (Cab_CameraBase, an HLS component on the OXF main thread, which does not run) a request event that
//              carries a closure (+28: the closure, its +12 the argument, +16 the function, vt[0] its call), whose
//              function posts the result callback (CBC 16, kind 72 for a format) and ends the media lock (D). The
//              event goes to the camera base's queue natively and stays there, as every event to the camera base
//              does in the lab; after the step S-MDAEND runs the DCF numbering mount (storage.mjs: the next file
//              number, I as S-MDACTRL's) and then the closure through its own vt[0], natively. That the camera base
//              calls the closure once its request is done is I (its handler passes the closure on with a request
//              of its own, not read, ?); an event without a closure function (the format's first, 12986 on E122,
//              611 on E144) is logged and left, the camera base's work for it not done (?). The process's sends on
//              its other path (another command's end or an error, f.cab.other) stop the session
import { FirmwareError, disasm, runtime, where } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { RTOS } from './rtos.mjs';
import { MODEL } from '../fw/model.mjs';

export class MediaError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const OLYQEWR = [...RTOS].find(([, n]) => n === 'OlyQeWr')[0];
const LIMIT = 50000000, REPLY_LIMIT_MS = 30000, PROGRESS_DONE = 100, LEVEL_OUT = 1;
const SLOT = 0, SECOND = 1;         // the first slot, drive 0, and the second, drive 1 (storage.mjs)
// the media status bits the manager's slot update tests (flags(), D): mounted, the two error bits, and the bit that
// keeps the flag
const FLAG_MOUNTED = 0x1000, FLAG_ERRORS = 4 | 8, FLAG_KEEP = 0x4000;
// S-MEDIA's media status of a slot (S-CARD's words, camapp.mjs card_status: slot 0 at CARD_STATUS, slot 1 at
// CARD_STATUS - 8; the setter's names: 0 NO_MOUNT, 0x1001 NOT_PRESENT, 0xf000 OK): NOT_PRESENT after a removal and
// with the slot empty at the start; NO_MOUNT from an insertion's change to its mount's end, then OK (or NO_MOUNT if
// slot 2's card is unformatted/unmounted). These are the values the firmware's own media manager leaves in the second
// slot's word under control camapp 3 (X, E143: NOT_PRESENT after a start with the slot empty and after a removal;
// NO_MOUNT at an insertion, then its device's status after the mount), written at a change first by the sequence
// parts' card-switch case of the slot (level not 0: the mount state 0 and NOT_PRESENT; level 0: NO_MOUNT) and then by
// the manager's status update of every slot from its device, after its notification of the change (D on E143 and E147,
// both slots' cases; the setter of every one of the 19 bodies' expanded images has a caller that passes NOT_PRESENT
// so, X; the addresses are in docs/hle-gaps/4.8.md 4.8.3). Under control camapp 3 the second slot's word is left to
// the firmware's own media manager (X)
export const MEDIA_NO_MOUNT = 0, MEDIA_NOT_PRESENT = 0x1001, MEDIA_OK = 0xF000;
// S-MDACTRL's commands, by their key in f.ctrl (src/fw/models.mjs card_fs.hls.ctrl: the command each sends), and the
// picture file API's call of each in the fact 'erase' (src/fw/facts.mjs pictureErase)
const WHAT = { format: 'format', erase_all: 'erase all', unlock_all: 'unlock all', rating_erase: 'rating-exclusive erase all', copy_all: 'copy all' };
const FACT = { [WHAT.erase_all]: 'erase_all', [WHAT.unlock_all]: 'unlock_all', [WHAT.rating_erase]: 'rating_erase' };

export class HlsMedia {
  // session: the PlaySession; storage: its Storage (storage.mjs), whose facts carry hls
  constructor(session, storage) {
    this.s = session; this.lab = session.lab; this.storage = storage; this.f = storage.f.hls;
    this.log = [];                  // [kind, detail] of every stand-in action
    this.ctrl = null;               // S-MDACTRL: the command in progress {cmd, what, api, media, cbc, token, t0, progress, sent, reply}
    this.formats = 0;               // formats finished
    this.erases = 0;                // S-MDACTRL: erase alls finished (the rating-exclusive one too)
    this.unlocks = 0;               // S-MDACTRL: unlock alls finished
    this.copies = 0;                // S-MDACTRL: copy alls finished
    this.switched = false;          // S-MEDIA: the slot's card switch changed, not yet handled
    this.switched2 = false;         // S-MEDIA: the second slot's (a body whose second slot the lab models)
    this.notified = [];             // the notifications delivered, [id or 711 state, the reception's answer]
    this.ends = [];                 // S-MDAEND: the media control's requests to the camera base, not yet handled
    this.ended = 0;                 // S-MDAEND: their closures run
    this.mda = null;                // S-MDAEND: the media control's start in progress {cmd, media}
    this.started = null;            // the last media control start seen, either way {cmd, media}
  }
  install() {
    const lab = this.lab, f = this.f, slot = f.slots[SLOT], two = this.storage.f.slots, slot2 = two ? f.slots[SECOND] : null;
    // the second slot: the HLS side's switch codes are the ones the SD driver's detect names (storage.mjs slots)
    if (two && f.slots.some((x, i) => x.switch !== two.detect.switches[i])) throw new MediaError(`S-MEDIA: the slots' card switches ${f.slots.map((x) => h8(x.switch))} are not the SD driver's detect's ${two.detect.switches.map(h8)}`);
    if (f.cab) this._install_end();
    // the file module's reply to the API queue for the format's token (S-MDACTRL)
    if (f.ctrl) lab.wrap(OLYQEWR, (prev) => (h, r) => {
      const c = this.ctrl;
      if (c !== null && c.reply === null && (r.d0 & 0xFFFF) === c.queue) {
        const p = lab.sim.u32(r.a0 >>> 0);
        if (lab.sim.u32(p + 4) === c.token) { const b = lab.sim.read(p, 2); c.reply = b[0] | b[1] << 8; }
      }
      return prev(h, r);
    });                                                                  // observed: the hook keeps its name
    // module events: the format's progress (S-MDACTRL), the slot's card switch (S-MEDIA)
    const pub = (r) => {
      const code = r.d0 >>> 0;
      if (f.ctrl && code === f.ctrl.progress_event && this.ctrl !== null) this.ctrl.progress += 1;
      if (code === (f.switch_event | slot.switch) >>> 0) this.switched = true;
      if (slot2 && code === (f.switch_event | slot2.switch) >>> 0) this.switched2 = true;
    };
    if (lab.hooks.has(runtime(f.publish))) lab.wrap(f.publish, (prev) => (h, r) => { pub(r); return prev(h, r); });
    else lab.hook(f.publish, (h, r) => { pub(r); lab.passthrough(r); }, 'S-MEDIA (events)');
  }
  // a format runs (S-MDACTRL's from TRA 1511 to its result, S-MDAEND's from the application's start to its end) or a
  // card switch or an end is not yet handled: the card input refuses (play.mjs), camapp's pump ticks
  busy() { return this.ctrl !== null || this.mda !== null || this.switched || this.switched2 || this.ends.length > 0; }
  // S-MDAEND: the media control process's sends of its requests to the camera base (f.cab.post called from one of
  // f.cab.sites), recorded with the closure each carries
  _install_end() {
    const lab = this.lab, c = this.f.cab, sites = new Set(c.sites.map(runtime)), other = new Set(c.other.map(runtime));
    const seen = (r) => {
      if (other.has(r.mdr >>> 0)) throw new MediaError(`S-MDAEND: the media control's request to the camera base from ${where(r.mdr)}, the path of another command or an error: not modelled`);
      if (!sites.has(r.mdr >>> 0)) return;
      const sim = lab.sim, ev = r.a0 >>> 0, clo = sim.u32(ev + c.closure) >>> 0, idb = sim.read(ev + 4, 2);
      this.ends.push({ ev, id: idb[0] | idb[1] << 8, clo, fn: clo ? sim.u32(clo + c.fn) >>> 0 : 0, from: where(r.mdr) });
    };
    if (lab.hooks.has(runtime(c.post))) lab.wrap(c.post, (prev) => (h, r) => { seen(r); return prev(h, r); });
    else lab.hook(c.post, (h, r) => { seen(r); lab.passthrough(r); }, 'S-MDAEND');
    const start = (r) => {
      const cmd = r.d0 & 0xFF, media = r.d1 & 0xFFFF;
      this.log.push(['control', `command ${cmd}, media ${media} (the application's own start)`]);
      this.started = { cmd, media };
      if (cmd !== c.format) throw new MediaError(`S-MDAEND: the media control's command ${cmd} (media ${media}): only the format's (${c.format}) end is stood in`);
      if (this.mda !== null) throw new MediaError('S-MDAEND: a second media control start while the format runs');
      this.mda = { cmd, media };
    };
    if (lab.hooks.has(runtime(c.start))) lab.wrap(c.start, (prev) => (h, r) => { start(r); return prev(h, r); });
    else lab.hook(c.start, (h, r) => { start(r); lab.passthrough(r); }, 'S-MDAEND (start)');
  }
  _end(e) {
    const lab = this.lab;
    if (!e.fn) { this.log.push(['end', `request ${e.id} to the camera base from ${e.from}: no closure function, its handling not done`]); return; }
    if (this.mda === null) throw new MediaError(`S-MDAEND: request ${e.id} to the camera base from ${e.from} with no media control start seen`);
    this.storage.renumber('S-MDAEND');
    const call = disasm(lab.sim.u32(lab.sim.u32(e.clo)));
    this.log.push(['end', `request ${e.id} to the camera base from ${e.from}: its closure ${h8(e.clo)} (${h8(disasm(e.fn))}) run through ${h8(call)}`]);
    this.mda = null;
    lab.calls(call, { a0: e.clo }, undefined, undefined, LIMIT);
    this.s.settle('S-MDAEND');
    this.ended += 1;
    this.formats += 1;
    this.s.camapp?.card_formatted?.();
  }
  // ---- the firmware's events, delivered as their senders deliver them
  _new(size) {
    const ev = this.lab.call(this.f.new, { d0: size, d1: 0, a0: 0 }, null, null, LIMIT).a0 >>> 0;
    if (!ev) throw new MediaError(`S-MEDIA: operator new(${size}) returned 0`);
    return ev;
  }
  // the reception's synchronous slot: every receptor that takes the event handles it in its reactive, now
  _deliver(ev, what) {
    const lab = this.lab, rec = lab.call(this.f.reception, null, null, null, LIMIT).a0 >>> 0;
    const fn = lab.sim.u32(lab.sim.u32(rec) + 4 * this.f.sync_slot);
    const r = lab.calls(disasm(fn), { a0: rec, a1: ev }, undefined, undefined, LIMIT);
    this.s.settle(`S-MEDIA ${what}`);
    this.notified.push([what, r.d0 >>> 0]);
    this.log.push(['notify', `${what}: the reception answered ${r.d0 >>> 0}`]);
  }
  // an event's id, as its constructor stored it (+4, u16)
  _id(ev) { const b = this.lab.sim.read(ev + 4, 2); return b[0] | b[1] << 8; }
  // 1513 / 1514: {id, CBC, word +32, words +36, +40}
  _result(id, cbc, w32, w36, w40) {
    const [ctor, size] = this.f.events.result, ev = this._new(size);
    this.lab.call(ctor, { a0: ev, d0: id, d1: cbc, a1: w32 }, pack('<II', w36, w40), null, LIMIT);
    this._deliver(ev, `${id} {${cbc}, ${w32}, ${w36}, ${w40}}`);
  }
  _media(w28, media) {
    const [ctor, size] = this.f.events.media, ev = this._new(size);
    this.lab.call(ctor, { a0: ev, d0: w28, d1: media }, null, null, LIMIT);
    this._deliver(ev, `${this._id(ev)} {${w28}, ${media}}`);
  }
  _mount(kind, flag, state) {
    const [ctor, size] = this.f.events.mount, ev = this._new(size);
    this.lab.call(ctor, { a0: ev, d0: kind, d1: flag, a1: state }, null, null, LIMIT);
    this._deliver(ev, `${this._id(ev)} {${kind}, ${flag}, ${state}}`);
  }
  _mount_state(kind, value) {
    const lab = this.lab, p = lab.alloc(pack('<I', value), 4);
    lab.call(this.f.mount.set, { d0: kind, a0: p }, null, null, LIMIT);
    this.log.push(['mount state', `kind ${kind}: ${value}`]);
  }
  mount_state(kind) { return this.lab.call(this.f.mount.get, { d0: kind }, null, null, LIMIT).d0 >>> 0; }
  // a slot's media status (MEDIA_NOT_PRESENT's evidence), through S-CARD's word (slot 0: CARD_STATUS, slot 1: CARD_STATUS - 8)
  _status(value, i = SLOT) {
    const at = this.s.camapp.card_status(value, i);
    this.log.push(['media status', `${i === SLOT ? '' : 'slot 2: '}${h8(at)}: 0x${value.toString(16)}`]);
  }
  // ---- S-MDACTRL
  // S-TRAACK's exec of TRA 1511: the request's command, media and option, while the request lives
  control(req) {
    const lab = this.lab, c = this.f.ctrl, b = lab.sim.read(req, c.option + 2);
    const cmd = b[c.cmd], media = b[c.media] | b[c.media + 1] << 8, option = b[c.option] | b[c.option + 1] << 8;
    this.log.push(['control', `command ${cmd}, media ${media}, option ${option}`]);
    this.started = { cmd, media };
    const what = WHAT[Object.keys(WHAT).find((k) => c[k] !== undefined && c[k] === cmd)];
    const api = what === WHAT.format ? c.api : what === WHAT.copy_all ? this._copy_all_api(cmd, media, option) : what ? this._file_api(cmd, media, what) : null;
    if (api === null) throw new MediaError(`S-MDACTRL: the media control's command ${cmd} (media ${media}): only ${Object.keys(WHAT).filter((k) => c[k] !== undefined).map((k) => `the ${WHAT[k]} (${c[k]})`).join(', ')} are stood in`);
    if (this.ctrl !== null) throw new MediaError(`S-MDACTRL: a second media control start while command ${this.ctrl.cmd} runs`);
    this.ctrl = { cmd, what, api, media, option, count0: null, cbc: null, token: null, queue: null, t0: null, progress: 0, sent: 0, reply: null };
  }
  // the copy all's call (executeCopyAllStart's, E143 0x50ceba68: the picture file API's copy all, API 0x7000e, d0 the
  // start record's +2, d1 its +4, taken here as the request's media and option, I; it posts FILECLBK code 38 with
  // both drives and returns the token), where the model names it (f.ctrl.copy, E143 and E146) and its bytes and the
  // count's read as the build's (each opens with its own API id's load), and both cards are in the lab's slots
  _copy_all_api(cmd, media, option) {
    const f = this.f.ctrl.copy, img = this.lab.image, two = this.storage.f.slots;
    const opens = (at, id, skip) => [0xfc, 0xcc, id & 0xff, id >>> 8 & 0xff, id >>> 16 & 0xff, id >>> 24].every((b, i) => img[at - 0x50000000 + skip + i] === b);
    if (!opens(f.api, 0x7000E, 2) || !opens(f.count, 0x70011, 1)) throw new MediaError(`S-MDACTRL: the copy all's API ${h8(f.api)} or its count ${h8(f.count)} does not open with its API id in ${MODEL}'s build`);
    if (!two || media > SECOND || option > SECOND || media === option) throw new MediaError(`S-MDACTRL: the media control's command ${cmd} (copy all, media ${media}, option ${option}): a copy between the lab's two slots only`);
    return f.api;
  }
  // the picture file API's call a start other than the format's makes (src/fw/facts.mjs pictureErase, fact 'erase'):
  // executeEraseAllStart's erase all (E143 0x50cebba1: API 0x70010, d0 the media; for media 0 or 1 it posts FILECLBK
  // the DCF edit's ALL_DELETE, code 0x25, and returns the token), executeUnlockAllStart's unlock all (0x50cebc59: API
  // 0x70025, d0 the media, d1 0: OBJ_UNLOCK, code 0x24, with the option of every object) and
  // executeRatingExclusiveEraseAllStart's (0x50cebd29: API 0x7004e, d0 the media: ALL_DELETE with the option 0x10, the
  // rated pictures kept); on a body whose build's call the rule reads and whose DCF database holds the pictures (each
  // edit walks what the database lists), else refused
  _file_api(cmd, media, what) {
    const cam = this.s.camapp, at = cam?.erase_facts?.()?.[FACT[what]] ?? null;
    if (at === null) throw new MediaError(`S-MDACTRL: the media control's command ${cmd} (${what}, media ${media}): the rule reads no picture file API's ${what} in ${MODEL}'s build`);
    if (!cam.dcf_db()) throw new MediaError(`S-MDACTRL: the media control's command ${cmd} (${what}, media ${media}): ${MODEL}'s DCF database learns of the lab's pictures only at a mount`);
    return at;
  }
  _start() {
    const lab = this.lab, f = this.f.ctrl, c = this.ctrl, what = c.what;
    c.cbc = lab.call(f.cbc, { d0: c.cmd }, null, null, LIMIT).d0 >>> 0;
    const qb = lab.sim.read(f.reply_queue, 2);
    c.queue = qb[0] | qb[1] << 8;
    // the unlock all's start first notifies the Wi-Fi remote take component (CapWif_WifiRemoteTake), natively: its
    // instance (the getter makes it at the first call) and Wifi_Notify_Callback(event, 0, instance, 0), as
    // executeUnlockAllStart calls them (E143 0x50cebc9d..0x50cebcad, D); with no wireless connection the notify
    // API (0x503f654e, API 0xb000e) sends nothing (X: none of its three senders runs)
    if (what === WHAT.unlock_all) {
      const w = f.wifi, inst = lab.call(w.instance, null, null, null, LIMIT).a0 >>> 0;
      const r = lab.call(w.notify, { d0: w.event, d1: 0, a0: inst, a1: 0 }, null, null, LIMIT).d0 >>> 0;
      this.log.push([what, `the Wi-Fi remote take ${h8(inst)} notified of ${h8(w.event)}: ${r}`]);
    }
    c.t0 = lab.lab_time();
    // (the copy all: the start keeps the count of the record's media first, executeCopyAllStart 0x50cebab5, D)
    if (what === WHAT.copy_all) c.count0 = lab.call(f.copy.count, { d0: c.media }, null, null, LIMIT).d0 >>> 0;
    // (d1: the copy all's the record's +4, the destination; the unlock all's 0 unlocks, 1 locks, and
    // executeUnlockAllStart passes 0, D)
    c.token = lab.call(c.api, { d0: c.media, d1: what === WHAT.copy_all ? c.option : 0 }, null, null, LIMIT).d0 >>> 0;
    if (!c.token) throw new MediaError(`S-MDACTRL: the ${what} of media ${c.media} returned no token`);
    this.log.push([what, `media ${c.media}${what === WHAT.copy_all ? `, option ${c.option}, the count ${c.count0}` : ''}: token ${h8(c.token)}, the callback id ${c.cbc}, the reply on queue ${c.queue}`]);
    this.s.settle(`S-MDACTRL ${what}`);
  }
  _what() { return this.ctrl.what; }
  // getMediaProgress natively (api_media 0x503f093a: the file module's done words 0x62ae4cd8 x 100 / its total
  // 0x62ae4cd4, 0 for no total), the progress of the format, the erase all and the unlock all. The rating-exclusive
  // erase all's own getRatingExclusiveEraseAllProgress (E143 0x50cebdbb) wants the component (it divides the
  // 0x04020011 event's parameter x 100 by the total the component kept from 0x04020010, 0x50ce4ad0, D); both events
  // carry those same two words (0x50890247, 0x5089029a, D), so getMediaProgress gives its quotient
  _progress() {
    const lab = this.lab, f = this.f, c = this.ctrl;
    // (the copy all's own progress function, getCopyAllProgress: the copied of the total, 0x5041899b, D)
    const pct = lab.calls(c.cmd === f.ctrl.copy_all ? f.ctrl.copy.progress : f.ctrl.progress, { d0: c.cmd }, undefined, undefined, LIMIT).d0 >>> 0;
    c.sent = c.progress;
    this._result(f.ids.progress, c.cbc, f.ctrl.kinds.progress, pct, 0);
  }
  _finish() {
    const lab = this.lab, f = this.f, c = this.ctrl, what = this._what();
    if (c.reply !== 0) throw new MediaError(`S-MDACTRL: the ${what}'s reply status 0x${c.reply.toString(16)}: the component's error path is not modelled`);
    const ms = Math.round((lab.lab_time() - c.t0) / 1e5) / 10;
    this.log.push([what, `the file module's reply 0 after ${ms} ms, ${c.progress} progress event(s)`]);
    // the copy all's end check (0x50cec5d1, D): the record's media's count still the start's answers 0xf0000024,
    // the component's error path, which is not modelled
    if (what === WHAT.copy_all) {
      c.count1 = lab.call(f.ctrl.copy.count, { d0: c.media }, null, null, LIMIT).d0 >>> 0;
      this.log.push([what, `the end check: media ${c.media}'s count ${c.count0} -> ${c.count1}`]);
      if (c.count1 === c.count0) throw new MediaError(`S-MDACTRL: the copy all's end check: media ${c.media}'s count ${c.count1} is the start's, the component's error ${h8(f.ctrl.copy.no_copy)}: not modelled`);
    }
    f.slots.forEach((slot, i) => {                       // the format flags of the slots that are mounted
      const st = lab.call(f.ctrl.status, { d0: i }, null, null, LIMIT).d0 & 0xFFFF;
      if (!(st & 1) && this.mount_state(slot.kind) === f.mount.mounted) {
        lab.call(f.ctrl.flag[0], { d0: f.ctrl.flag[1] + i, d1: 1 }, null, null, LIMIT);
        this.log.push([what, `slot ${i}: flag ${f.ctrl.flag[1] + i} set`]);
      }
    });
    this._result(f.ids.progress, c.cbc, f.ctrl.kinds.progress, PROGRESS_DONE, 0);
    this._media(1, c.media);
    // the erase alls, the unlock all and the copy all: no remount (the component starts that request after a format
    // alone, E143 0x50cec36e, D); the DCF edit's delete mount ran in FILECLBK. The unlock all erases nothing: S-CARD's records stay
    if (what !== WHAT.format) {
      this.ctrl = null;
      if (what === WHAT.unlock_all) this.unlocks += 1;
      else if (what === WHAT.copy_all) this.copies += 1;
      else { this.erases += 1; this.s.camapp?.card_erased?.(); }
      this._result(f.ids.result, c.cbc, f.ctrl.kinds.done, 0, 0);
      return;
    }
    // (the second slot's card, where the lab models it: its own drive's mount, and its state and flag after it)
    const second = this.storage.f.slots && c.media === SECOND;
    this.storage.renumber('S-MDACTRL', second ? SECOND : SLOT);
    if (second) {
      const st2 = this.storage.refresh(SECOND);
      if (!this.manager()) this._status(st2.mounted ? MEDIA_OK : MEDIA_NO_MOUNT, SECOND);
      this.flags();
    }
    this.ctrl = null;
    this.formats += 1;
    this.s.camapp?.card_formatted?.();
    this._result(f.ids.result, c.cbc, f.ctrl.kinds.done, 0, 0);
  }
  // ---- S-MEDIA
  level(i = SLOT) { return this.lab.call(this.f.switch_level, { d0: this.f.slots[i].switch }, null, null, LIMIT).d0 >>> 0; }
  // a slot's card switch changed (i: the first slot, or SECOND)
  _changed(i = SLOT) {
    const st = this.storage, kind = this.f.slots[i].kind, m = this.f.mount, level = this.level(i), one = st._slot(i), card = st.card_of(i);
    const of = i === SLOT ? '' : 'slot 2: ';
    if (i === SLOT) this.switched = false; else this.switched2 = false;
    this.log.push(['switch', `${of}the card switch's level ${level}, the card ${card?.present ? 'in' : 'out of'} the slot`]);
    // the second slot with the firmware's own media manager (control camapp 3): the manager takes the change (X)
    if (i !== SLOT && this.manager()) {
      // (each change counted as the manager is handed it: its mount comes 0.2 to 1.3 s after an insertion, X)
      const now = st.refresh(i);
      if (level === LEVEL_OUT) now.removals += 1; else now.insertions += 1;
      this.log.push(['switch', `${of}left to the firmware's media manager: the drive status ${h8(now.drive_status)}`]);
      return;
    }
    if (level === LEVEL_OUT) {
      // (a second card its insertion left unmounted, one with no file system, goes out as a mounted one: under
      // control camapp 3 the manager unmounts it, sends 711 {8, 0, 0} and clears its flag the same way, X)
      if (!st.held(i)) { this.log.push(['switch', `${of}no card was mounted: nothing to unmount`]); return; }
      this._mount_state(kind, m.unmounted);
      this._status(MEDIA_NOT_PRESENT, i);
      st.remove('S-MEDIA', i);
      this._mount(kind, 0, 0);
      this.flags();
      return;
    }
    if (one.mounted) { this.log.push(['switch', `${of}the card is mounted already`]); return; }
    if (!card?.present) { this.log.push(['switch', `${of}no card in the slot: no mount (I: what the media manager does then is not read)`]); return; }
    this._status(MEDIA_NO_MOUNT, i);
    this._mount(kind, 1, 0);
    st.insert('S-MEDIA', i);
    one.insertions += 1;
    this._mount_state(kind, m.mounted);
    this._status(one.mounted ? MEDIA_OK : MEDIA_NO_MOUNT, i);
    this._mount(kind, 1, m.rec_end);
    this._mount(kind, 1, m.end);
    this.flags();
  }
  // whether the firmware's own media manager runs (control camapp 3 creates it; camapp 1 and 2 do not, X)
  manager() { return !!this.s.camapp?.native_tra; }
  // S-CARD's media flags on a body whose second slot the lab models, where no media manager runs: each slot's flag as
  // the manager's slot update leaves it (CapMed_MediaManager 0x50bba897, D), by the slot's media status read natively
  // (f.ctrl.status): 1 where the slot is mounted (the DCF mount's bit 0x1000, the device's test 0x50d8a16a) or has
  // the bit 4 or 8 (a card with no file system has 4, X), else 0 unless the status has the bit 0x4000 (left as it
  // is); through the store's setter the update uses. The manager's start clears an empty slot's flag itself
  // (0x50bb7c53..0x50bb7c6e), which the same rule gives (its status is 1, no card). The update's other condition, the
  // slot controller's own state (its +168 not 0: not mounted), is the manager's and is taken as 0 (I). The update's
  // other work for a flag of 1 is not done: the setting 4510 (slot 1) or 4521 (slot 2) to -1 and api_rec's
  // 0x504169b2 for both slots (0x50bba8ff..0x50bba95a, D; what they keep is not read)
  flags() {
    const lab = this.lab, f = this.f, st = this.storage;
    if (!st.f.slots || !f.ctrl || this.manager()) return;
    f.slots.forEach((slot, i) => {
      const status = lab.call(f.ctrl.status, { d0: i }, null, null, LIMIT).d0 & 0xFFFF;
      const on = status & (FLAG_MOUNTED | FLAG_ERRORS) ? 1 : status & FLAG_KEEP ? null : 0;
      if (on === null) { this.log.push(['flag', `${f.ctrl.flag[1] + i} left (slot ${i + 1}'s media status ${h8(status)})`]); return; }
      lab.call(f.ctrl.flag[0], { d0: f.ctrl.flag[1] + i, d1: on }, null, null, LIMIT);
      this.log.push(['flag', `${f.ctrl.flag[1] + i} = ${on} (slot ${i + 1}'s media status ${h8(status)})`]);
    });
  }
  // After a step or an idle slice (camapp.mjs pump): the work the components would do meanwhile
  tick() {
    const c = this.ctrl;
    if (c !== null) {
      if (c.token === null) this._start();
      if (c.progress > c.sent) this._progress();
      if (c.reply !== null) this._finish();
      else if (this.lab.lab_time() - c.t0 > REPLY_LIMIT_MS * 1e6) throw new MediaError(`S-MDACTRL: no reply to the ${c.what} (token ${h8(c.token)}) after ${REPLY_LIMIT_MS} ms of lab time`);
    }
    while (this.ends.length) this._end(this.ends.shift());                   // S-MDAEND
    if (this.switched && this.ctrl === null) this._changed();
    if (this.switched2 && this.ctrl === null) this._changed(SECOND);
  }
  take_log() { return this.log.splice(0); }
  status() {
    return { formatting: this.ctrl !== null || this.mda !== null, formats: this.formats, ...(this.erases && { erases: this.erases }), ...(this.unlocks && { unlocks: this.unlocks }), ...(this.copies && { copies: this.copies }), ...(this.f.cab && { ends: this.ended }), switch_pending: this.switched, notified: this.notified.length,
      mount_state: this.mount_state(this.f.slots[SLOT].kind),
      // the second slot, once it holds a card (a session with the default empty slot keeps the document it had)
      ...(this.storage.second?.card && this.f.slots[SECOND] ? { switch2_pending: this.switched2, mount_state2: this.mount_state(this.f.slots[SECOND].kind) } : {}) };
  }
}

