// The HLS media side of the card, on a body whose file system runs natively (src/lab/storage.mjs; MODEL_INFO.card_fs.hls
// in src/fw/models.mjs has the evidence for every address, docs/hle-gaps.md 4.8.3 the record). The camera application's
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
//              slot stands in for that thread's dispatch (I). Any other command, and an error status, stops the
//              session: the component's other starts and its error kinds (70 / 71 / 118) are not modelled
//   S-MEDIA    the media manager's part of a card's removal and insertion, from the card switch's change: UI_IN decodes
//              the switch natively (and calls the file layer's own callback for it) and publishes the slot's switch
//              event; the stand-in reads the switch's level through UI_IN's getter natively. Out (level 1, I): the
//              slot's mount state word unmounted (the firmware's setter, as unmountPreprocess sets it), the DCF
//              process's card out (storage.mjs) and the notification 711 {kind, 0, 0} (the application posts its
//              card-out event). In (level 0): 711 {kind, 1, 0} (its card-in event), S-CARD's insertion requests, the
//              mount state mounted and 711 {kind, 1, 2} (notifyRecMountEnd: EV_MEDIA_MOUNT_REC) and {kind, 1, 8}
//              (mountProcEnd). Each notification's layout and sender is D; which ones the media manager sends at a
//              change, and in which order, is I. The level's meaning is I (models.mjs slots)
import { FirmwareError, disasm, runtime } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { RTOS } from './rtos.mjs';

export class MediaError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const OLYQEWR = [...RTOS].find(([, n]) => n === 'OlyQeWr')[0];
const LIMIT = 50000000, REPLY_LIMIT_MS = 30000, PROGRESS_DONE = 100, LEVEL_OUT = 1;
const SLOT = 0;                     // the first slot, drive 0 (storage.mjs)

export class HlsMedia {
  // session: the PlaySession; storage: its Storage (storage.mjs), whose facts carry hls
  constructor(session, storage) {
    this.s = session; this.lab = session.lab; this.storage = storage; this.f = storage.f.hls;
    this.log = [];                  // [kind, detail] of every stand-in action
    this.ctrl = null;               // S-MDACTRL: the format in progress {cmd, media, cbc, token, t0, progress, sent, reply}
    this.formats = 0;               // formats finished
    this.switched = false;          // S-MEDIA: the slot's card switch changed, not yet handled
    this.notified = [];             // the notifications delivered, [id or 711 state, the reception's answer]
  }
  install() {
    const lab = this.lab, f = this.f, slot = f.slots[SLOT];
    // the file module's reply to the API queue for the format's token (S-MDACTRL)
    lab.wrap(OLYQEWR, (prev) => (h, r) => {
      const c = this.ctrl;
      if (c !== null && c.reply === null && (r.d0 & 0xFFFF) === c.queue) {
        const p = lab.sim.u32(r.a0 >>> 0);
        if (lab.sim.u32(p + 4) === c.token) c.reply = lab.sim.read(p, 2)[0] | lab.sim.read(p + 1, 1)[0] << 8;
      }
      return prev(h, r);
    });                                                                  // observed: the hook keeps its name
    // module events: the format's progress (S-MDACTRL), the slot's card switch (S-MEDIA)
    const pub = (r) => {
      const code = r.d0 >>> 0;
      if (code === f.ctrl.progress_event && this.ctrl !== null) this.ctrl.progress += 1;
      if (code === (f.switch_event | slot.switch) >>> 0) this.switched = true;
    };
    if (lab.hooks.has(runtime(f.publish))) lab.wrap(f.publish, (prev) => (h, r) => { pub(r); return prev(h, r); });
    else lab.hook(f.publish, (h, r) => { pub(r); lab.passthrough(r); }, 'S-MEDIA (events)');
  }
  busy() { return this.ctrl !== null || this.switched; }
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
  // 1513 / 1514: {id, CBC, word +32, words +36, +40}
  _result(id, cbc, w32, w36, w40) {
    const [ctor, size] = this.f.events.result, ev = this._new(size);
    this.lab.call(ctor, { a0: ev, d0: id, d1: cbc, a1: w32 }, pack('<II', w36, w40), null, LIMIT);
    this._deliver(ev, `${id} {${cbc}, ${w32}, ${w36}, ${w40}}`);
  }
  _media(w28, media) {
    const [ctor, size] = this.f.events.media, ev = this._new(size);
    this.lab.call(ctor, { a0: ev, d0: w28, d1: media }, null, null, LIMIT);
    this._deliver(ev, `697 {${w28}, ${media}}`);
  }
  _mount(kind, flag, state) {
    const [ctor, size] = this.f.events.mount, ev = this._new(size);
    this.lab.call(ctor, { a0: ev, d0: kind, d1: flag, a1: state }, null, null, LIMIT);
    this._deliver(ev, `711 {${kind}, ${flag}, ${state}}`);
  }
  _mount_state(kind, value) {
    const lab = this.lab, p = lab.alloc(pack('<I', value), 4);
    lab.call(this.f.mount.set, { d0: kind, a0: p }, null, null, LIMIT);
    this.log.push(['mount state', `kind ${kind}: ${value}`]);
  }
  mount_state(kind) { return this.lab.call(this.f.mount.get, { d0: kind }, null, null, LIMIT).d0 >>> 0; }
  // ---- S-MDACTRL
  // S-TRAACK's exec of TRA 1511: the request's command, media and option, while the request lives
  control(req) {
    const lab = this.lab, c = this.f.ctrl, b = lab.sim.read(req, c.option + 2);
    const cmd = b[c.cmd], media = b[c.media] | b[c.media + 1] << 8, option = b[c.option] | b[c.option + 1] << 8;
    this.log.push(['control', `command ${cmd}, media ${media}, option ${option}`]);
    if (cmd !== c.format) throw new MediaError(`S-MDACTRL: the media control's command ${cmd} (media ${media}): only the format (${c.format}) is stood in`);
    if (this.ctrl !== null) throw new MediaError('S-MDACTRL: a second media control start while the format runs');
    this.ctrl = { cmd, media, cbc: null, token: null, queue: null, t0: null, progress: 0, sent: 0, reply: null };
  }
  _start() {
    const lab = this.lab, f = this.f.ctrl, c = this.ctrl;
    c.cbc = lab.call(f.cbc, { d0: c.cmd }, null, null, LIMIT).d0 >>> 0;
    c.queue = lab.sim.read(f.reply_queue, 2)[0] | lab.sim.read(f.reply_queue + 1, 1)[0] << 8;
    c.t0 = lab.lab_time();
    c.token = lab.call(f.api, { d0: c.media }, null, null, LIMIT).d0 >>> 0;
    if (!c.token) throw new MediaError(`S-MDACTRL: api_media's format of media ${c.media} returned no token`);
    this.log.push(['format', `media ${c.media}: token ${h8(c.token)}, the callback id ${c.cbc}, the reply on queue ${c.queue}`]);
    this.s.settle('S-MDACTRL format');
  }
  _progress() {
    const lab = this.lab, f = this.f, c = this.ctrl;
    const pct = lab.calls(f.ctrl.progress, { d0: c.cmd }, undefined, undefined, LIMIT).d0 >>> 0;
    c.sent = c.progress;
    this._result(f.ids.progress, c.cbc, f.ctrl.kinds.progress, pct, 0);
  }
  _finish() {
    const lab = this.lab, f = this.f, c = this.ctrl;
    if (c.reply !== 0) throw new MediaError(`S-MDACTRL: the format's reply status 0x${c.reply.toString(16)}: the component's error path is not modelled`);
    const ms = Math.round((lab.lab_time() - c.t0) / 1e5) / 10;
    this.log.push(['format', `the file module's reply 0 after ${ms} ms, ${c.progress} progress event(s)`]);
    f.slots.forEach((slot, i) => {                       // the format flags of the slots that are mounted
      const st = lab.call(f.ctrl.status, { d0: i }, null, null, LIMIT).d0 & 0xFFFF;
      if (!(st & 1) && this.mount_state(slot.kind) === f.mount.mounted) {
        lab.call(f.ctrl.flag[0], { d0: f.ctrl.flag[1] + i, d1: 1 }, null, null, LIMIT);
        this.log.push(['format', `slot ${i}: flag ${f.ctrl.flag[1] + i} set`]);
      }
    });
    this._result(f.ids.progress, c.cbc, f.ctrl.kinds.progress, PROGRESS_DONE, 0);
    this._media(1, c.media);
    this.storage.renumber('S-MDACTRL');
    this.ctrl = null;
    this.formats += 1;
    this.s.camapp?.card_formatted?.();
    this._result(f.ids.result, c.cbc, f.ctrl.kinds.done, 0, 0);
  }
  // ---- S-MEDIA
  level() { return this.lab.call(this.f.switch_level, { d0: this.f.slots[SLOT].switch }, null, null, LIMIT).d0 >>> 0; }
  _changed() {
    const st = this.storage, kind = this.f.slots[SLOT].kind, m = this.f.mount, level = this.level();
    this.switched = false;
    this.log.push(['switch', `the card switch's level ${level}, the card ${st.card.present ? 'in' : 'out of'} the slot`]);
    if (level === LEVEL_OUT) {
      if (!st.mounted) { this.log.push(['switch', 'no card was mounted: nothing to unmount']); return; }
      this._mount_state(kind, m.unmounted);
      st.remove('S-MEDIA');
      this._mount(kind, 0, 0);
      return;
    }
    if (st.mounted) { this.log.push(['switch', 'the card is mounted already']); return; }
    if (!st.card.present) { this.log.push(['switch', 'no card in the slot: no mount (I: what the media manager does then is not read)']); return; }
    this._mount(kind, 1, 0);
    st.insert('S-MEDIA');
    st.insertions += 1;
    this._mount_state(kind, m.mounted);
    this._mount(kind, 1, m.rec_end);
    this._mount(kind, 1, m.end);
  }
  // After a step or an idle slice (camapp.mjs pump): the work the components would do meanwhile
  tick() {
    const c = this.ctrl;
    if (c !== null) {
      if (c.token === null) this._start();
      if (c.progress > c.sent) this._progress();
      if (c.reply !== null) this._finish();
      else if (this.lab.lab_time() - c.t0 > REPLY_LIMIT_MS * 1e6) throw new MediaError(`S-MDACTRL: no reply to the format (token ${h8(c.token)}) after ${REPLY_LIMIT_MS} ms of lab time`);
    }
    if (this.switched && this.ctrl === null) this._changed();
  }
  take_log() { return this.log.splice(0); }
  status() {
    return { formatting: this.ctrl !== null, formats: this.formats, switch_pending: this.switched, notified: this.notified.length,
      mount_state: this.mount_state(this.f.slots[SLOT].kind) };
  }
}

