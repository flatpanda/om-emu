// The card and the file system (docs/hle-gaps.md 4.8, 4.8.4): an SD card in the first slot behind the firmware's SD
// command layer, and the firmware's own storage stack above it, natively: sdmem, sd_mount, sdmem_format, logsec, dosfat
// (FAT / exFAT), the DCF modules, fileif, and the file tasks FILECLBK, FILEFGND and DCFPROC_SUB. On a body whose MODELS
// entry runs it (card_fs native: E143, E146, E147, E144, E139, E137, E142, E140, E125, E130, E133, E145, E134, E129,
// E132 and the E118 family's E122, E118 and E120: every body since 2026-10-30), at the seams src/fw/facts.mjs
// fileSystem reads in its firmware (with the evidence; STORAGE_E143 for the lab's build); a body that did not run it
// would keep S-CARD's card without a file system (src/lab/camapp.mjs), its card_fs with the reason.
//
//   H-FILEINIT  the file system's bring-up (the boot task's call, storage.init) natively before the application starts:
//               its queues and semaphores, logsec's and the SD host's init, the file layer, the card driver's detect
//               states, and the tasks it starts (FILEFGND, DCFPROC_SUB and on some bodies a third, by the static ids
//               their starts read: storage.tasks); then FILECLBK, the file module's task, started (act_tsk; the boot's
//               start of it is not traced)
//   S-SDHOST    the SD host's registers (the board's pages, src/fw/board.mjs sd: both ports' and the GPIO page of the
//               card's pins and power) are lab-stub pages that keep what the firmware writes; the SD core's SD_INFO2
//               reads its clock-divider bit set, the one bit the host's set-up polls (I: TMIO's SCLKDIVEN, the bus
//               idle). No interrupt is ever raised: the UHS-II PHY's link-up wait runs out (about 120 ms of lab time),
//               as with a card without UHS-II, and the firmware falls back to the SD interface
//   S-SDPOWER   the SD driver's card supply request (storage.card_power), a synchronous send to a queue whose receiver
//               does not run in the lab (which task it is, ?), is answered 0 at its send (the send from that request
//               only; the E144 family's E144, E137, E142, E140, E125 and E130 meet it once at the bring-up, X; E143's,
//               E146's, E147's and E139's requests return before their send, X)
//   S-SDSWITCH  the SD driver's switch of a card line by a request to the sub-CPU (storage.card_switch: E118's,
//               whose request goes out over the sub-CPU's serial link, which the lab does not model; E122 and E120 set
//               a GIO pin), answered at its send: the request's callback is called with status 0, as the sub-CPU's
//               answer would have it called (I: that the sub-CPU answers 0), and the send returns 0. Without it the
//               driver's poll for the callback slept 1 ms at a time for good (X: E118's bring-up, to the 2,000,000-call limit)
//   S-SDCARD    the card (src/lab/sdcard.mjs: an 8 GiB SDHC card, or the host's capacity, SDXC above 32 GiB) at the
//               SD command layer (storage.command): each command the firmware sends is answered there, its response,
//               its data and its status written into the command (at its fields, storage.command_fields: the E118
//               family's lie 4 to 12 bytes lower than E143's) and its completion called at once, as the layer itself
//               does for a busy port; sd_mount's card init, the transfers and the format run natively above it
//   S-FSNAND    the file system's NAND area (storage.nand.area: 512 KiB of NAND on E143, 384 or 256 KiB of the E144
//               family's flash, the E118 family's two file-layer records in flash) behind its access
//               (storage.nand.access): it reads erased (0xff) on a camera that
//               never saved it (the lab's NAND and flash are not modelled), and the firmware's writes are kept for the
//               session
//   S-ALBM      the album manager's per-drive init (where the rule finds one) returns at once: ALBM_MAIN, which it
//               would start, sends its first request to the image engine (0x5048ee61 on E143, a kind 14 fill on the
//               imgpro unit 0x9c600000, whose model S-IMGPRO the IRQ attach of camapp 3's H-IMGPROINIT serves only
//               after the mount: docs/hle-gaps.md 4.3.1), and the movie module it asks does not run
//   S-RECFILE   (not on E143, E146 and E147, where REC_FILE runs natively in its task from REC_IMAGE's packet,
//               src/lab/rec.mjs) the picture's file at a release's END_SHOOTING_PICTURE (src/lab/camapp.mjs S-CARD),
//               the JPEG the capture pipeline would hand REC_FILE, which does not run: a JPEG the lab encodes
//               (src/lab/jpeg.mjs: S-SCENE's frame at the capture, each 8 x 8 block its mean, or a black frame). On a
//               build whose recorder the rule reads (fact 'recorder', src/fw/facts.mjs: E144 and E148) the file is
//               recorded as REC_FILE's modules record one (record()): their requests, sent to the file module, which
//               runs each natively: the camera's clock read for the time stamp, the fnode of the next DCF number (its
//               name from the stamp's month and day, the folder made where it is new), the cluster reservation, the
//               chain write of the bytes, the directory entry and the fnode's registration in the DCF database, whose
//               counts and next number then follow the picture in the same session. Elsewhere the file module's own
//               file requests (mkdir, fopen 'wb', fwrite in chunks, fclose; the FlashAir configuration writer's calls)
//               put the JPEG at the DCF name the numbering mount gave (folder 100: C:\DCIM\100OMSYS or 100OLYMP, file
//               P1010001.JPG and on; the DCF module's initial names, storage.names, D), and the DCF database learns of
//               the file at the next mount
//   S-CARD      (the insertion) the media control's requests on a card insertion, sent to the file module's queue as
//               the HLS media layer would send them (it does not run in the lab; which requests it sends, and in which
//               order, is I): the FAT mount; on a card with no file system the format (the request Card Formatting
//               makes, I) and the mount again; the DCF process's card-in and list commands; the DCF numbering mount,
//               which leaves the drive mounted (the drive status's bit 0x1000). The same at a runtime insertion
//               (src/lab/media.mjs S-MEDIA), and at a removal the DCF process's card out; after a format from the menu
//               the DCF numbering mount again, for the next file number (src/lab/media.mjs S-MDACTRL)
import { FirmwareError, where, disasm, runtime } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { RTOS } from './rtos.mjs';
import { K_CFLUSH } from './menu.mjs';
import { STUB } from './display.mjs';
import { SdCard, SECTOR } from './sdcard.mjs';
import { MODEL, MODEL_INFO, fact } from '../fw/model.mjs';
import { RecFile, REC_NATIVE } from './rec.mjs';
import { BOARD } from '../fw/board.mjs';
import { STORAGE_E143, STORAGE_LIB, CARD_DETECT_E143, RECORDER_E143 } from '../fw/facts.mjs';

export class StorageError extends FirmwareError {}

// The facts of this body's file system, or null where its MODELS entry does not run it (card_fs, each body's with its
// reason): the seams src/fw/facts.mjs fileSystem reads (fact 'storage'), the storage library's own numbers
// (STORAGE_LIB there, with their evidence), the card driver's detect table (fact 'card.detect'), its board's SD host
// pages (src/fw/board.mjs sd), the HLS side (src/lab/media.mjs) where the entry gives it, and REC's recorder (fact
// 'recorder', null where the rule reads none)
export function storageFacts() {
  const cf = MODEL_INFO.card_fs;
  if (!cf?.native) return null;
  const f = fact('storage', STORAGE_E143);
  if (!f) throw new StorageError(`${MODEL}: src/fw/models.mjs card_fs is native but src/fw/facts.mjs fileSystem found no file system`);
  const { drive, ...lib } = STORAGE_LIB;
  return { ...f, ...lib, names: { ...f.names, drive }, detect: fact('card.detect', CARD_DETECT_E143).table, host: BOARD.sd, hls: cf.hls ?? null,
    recorder: fact('recorder', RECORDER_E143) ?? null };
}
export const STORAGE = storageFacts();

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const OLYQEWR = [...RTOS].find(([, n]) => n === 'OlyQeWr')[0];
const ALLOW = 0x100, NALLOW = 32, PRESET = 0x400, NPRESET = 128;   // the lab stub's tables (src/dev/stub.mjs)
const WAI = 4, REQUEST_SLICE_MS = 5, REQUEST_LIMIT_MS = 10000, FOREVER = -1 >>> 0;
const DRIVE = 0, DRIVE_MOUNTED = 0x1000;
const DCF_CARD_IN = 1, DCF_LISTS = 3;
// the DCF process's command 5, a picture's fnode by its index (from 1) in the drive's list: {u16 5, u16 drive, u32 the
// index, the fnode back at +8, u16 1 at +12}, as the fnode getter 0x50874bc9 sends it from another task (D)
const DCF_FNODE = 5, DCF_FNODE_AT = 8, DCF_FNODE_FLAG = 1;
const ERASED = 0xff, WRITE_CHUNK = 32768;
const SWITCH_BYTE = 16;           // S-SDSWITCH: the request's switch byte (src/fw/facts.mjs fileSystem card_switch, D)
// the word of the lab's FILECLBK messages, its low half a count; a reply of REQUEUE puts the message back on the queue
// (`cmp 0xfff0,d0` at the reply's caller, docs/hle-gaps.md 4.8.8, D)
const REQUEST_TAG = 0x4C41 << 16, REQUEUE = 0xFFF0;
// S-RECFILE's REC requests (record(); STORAGE_LIB rec, src/fw/facts.mjs; D from E143's recorder 0x519f9dd7 and the
// builders it calls, unless tagged). The DCF block (64 bytes, 0x519f9df5; kept from the open to the registration):
// +2 drive, +4 the folder's 8.3 name with 'xxx' for its number (0x5054a903), +16 and +20 the file's time stamp
// (0x5054a922, 0x5054a92a), +32 flags (0 for a JPEG, 0x5054a93c), the fnode back at +24 (0x50879108). The fnode:
// +8 its folder's dnode, +12 its name's eight letters (0x5087a253: the file letter, the stamp's month in hex, its
// day, the number), +20 its extension (0x5054a9b8), +38 its number, +44 the first cluster and +48 the size
// (0x5054aeaa, 0x5054aeb0), +86 flags, +88 its DCF kind (0x5054aea4); the dnode: +8 its 8.3 name, +22 its number,
// +28 its directory's cluster, +32..+47 its entry's place (0x50872238). The reservation's block: +4 3, +6 drive,
// +16 the size, +36 the mode, the first cluster back at +0 (0x5088885c..0x50888880). The chain write's (116 bytes):
// +6 drive, +8 the cluster, +12 the sector in it, +16 the sectors, +20 the buffer, +28 the mode, +32 the cluster, +36
// the bytes (0x5054aa8d..0x5054aad5). The entry's (100 bytes): +4 4, +6 drive, +8 the folder's cluster, +16 the name
// (eight letters and the extension's word), +20 the mode, +24 the size, +32 and +36 the stamp, +40 the first cluster,
// +46 the attribute (0x20, an archive), +84.. the dnode's entry place (0x5054adda..0x5054ae30)
const REC = {
  block: 64, chain: 116, entry: 100, folder: 'xxx', drive: 2, folder_name: 4, stamp: [16, 20], flags: 32, fnode: 24,
  f: { dnode: 8, name: 12, ext: 20, number: 38, cluster: 44, size: 48, flags: 86, kind: 88 },
  d: { name: 8, number: 22, cluster: 28, place: 32 },
  // the reservation's modes: 2 first, then 0 where it finds no cluster (0x5087e21a, from 0x5054a9e3); the entry's
  // flag of a JPEG recorded in mode 2 (fnode +86 bit 2, 0x5054ad8a)
  reserve_op: 3, modes: [2, 0], flag_mode2: 4, entry_op: 4, archive: 0x20,
};
const SECTORS = (bytes) => Math.ceil(bytes / SECTOR);   // 0x50880d1c's 512-byte form (the port state's +168 0, X)
// the FAT time stamp of a clock record {u16 year, month, day, hour, minute, second} (0x5012ba46)
const fatStamp = ([y, mo, d, h, mi, s]) => ((y - 1980) << 25 | mo << 21 | d << 16 | h << 11 | mi << 5 | s >> 1) >>> 0;
const CLOCK_RECORD = 10, CLOCK_STATUS = 8;

export class Storage {
  // session: the PlaySession; f: STORAGE. The card: the host's (env.card: {open() -> SdCard, save(card)},
  // node's OM_EMU_CARD, host/card.mjs), else a blank one for the session
  constructor(session, f) {
    this.s = session; this.lab = session.lab; this.f = f;
    this.host = this.lab.env.card ?? null;
    this.card = this.host ? this.host.open() : new SdCard();
    this.nand = new Uint8Array(f.nand.area[1]).fill(ERASED);
    this.nand_writes = 0;
    this.log = [];                 // [kind, detail] of every stand-in action at the bring-up and the insertion
    this.commands = 0;             // SD commands answered
    this.flushes = 0;              // K-CFLUSH calls from the file system answered
    this.powered = 0;              // S-SDPOWER: the card supply requests answered
    this.switches = 0;             // S-SDSWITCH: the card line's requests answered
    this.fileclbk = null;          // FILECLBK's task id
    this.mounted = false;          // the drive status's mount bit after the insertion (false while the card is out)
    this.removals = 0;             // runtime removals and insertions (src/lab/media.mjs)
    this.insertions = 0;
    this.formatted = false;        // the insertion formatted the card
    this.dcf = null;               // the DCF numbering mount's next folder and file
    this.next_file = null;         // S-RECFILE: the next picture's file number
    this.files = [];               // S-RECFILE: the pictures' files written, {path, size}
    this.drive_status = null;
    this.tag = 0;                  // the lab's dosfat requests read by the reply: the last one's tag and its status
    this.reply = null;
    // REC_FILE natively where the body gives rec_native (src/lab/rec.mjs; MODELS), in S-RECFILE's place
    this.rec = REC_NATIVE ? new RecFile(this) : null;
  }
  // H-FILEINIT, H-FILECLBK, S-SDHOST, S-SDCARD, S-FSNAND, S-ALBM, then the insertion (S-CARD); in the play bring-up,
  // before the application starts
  bring_up() {
    const lab = this.lab, f = this.f;
    this.install_host();
    lab.hook(f.command, (h, r) => this._command(h, r), 'S-SDCARD');
    lab.hook(f.nand.access, (h, r) => this._nand(h, r), 'S-FSNAND');
    if (f.card_power !== null) {
      const { send, ret } = f.card_power, power = (prev) => (h, r) => {
        if (r.mdr >>> 0 !== runtime(ret)) return prev(h, r);
        const b = lab.sim.read(r.a0 >>> 0, 4);
        this.powered += 1;
        this.log.push(['power', `the card's supply request {${b[1]}, ${b[2]}, ${b[3]}}: answered`]);
        return h.finish(r, { d0: 0 });
      };
      if (lab.hooks.has(runtime(send))) lab.wrap(send, power);   // (the hook keeps its name)
      else lab.hook(send, power((h, r) => lab.passthrough(r)), 'S-SDPOWER');
    }
    if (f.card_switch) {
      const { send, ret, callback } = f.card_switch, sw = (prev) => (h, r) => {
        if (r.mdr >>> 0 !== runtime(ret)) return prev(h, r);
        const req = r.a0 >>> 0, on = lab.sim.read(req + SWITCH_BYTE, 1)[0];
        this.switches += 1;
        this.log.push(['switch', `the card line's request ${lab.sim.read(req, 2)[0] | lab.sim.read(req + 1, 1)[0] << 8} (switch ${on}): answered`]);
        return h.finish_after(r, callback, { a0: req, d0: 0 });
      };
      if (lab.hooks.has(runtime(send))) lab.wrap(send, sw);
      else lab.hook(send, sw((h, r) => lab.passthrough(r)), 'S-SDSWITCH');
    }
    if (f.album_init !== null) lab.hook(f.album_init, (h, r) => { this.log.push(['albm', `drive ${r.d0 & 0xFF}: not started`]); h.finish(r, { d0: 0 }); }, 'S-ALBM');
    lab.wrap(K_CFLUSH, (prev) => (h, r) => {
      if (disasm(r.mdr) !== f.cflush) return prev(h, r);
      this.flushes += 1;
      return h.finish(r);
    }, 'K-CFLUSH');
    // the tasks the bring-up starts, by their static ids (the words of the image the starts read)
    const entries = new Map([...lab.nk.tasks()].map(([t, [e]]) => [t, e]));
    const tids = f.tasks.map((w) => lab.sim.read(w, 1)[0] | lab.sim.read(w + 1, 1)[0] << 8);
    for (const t of tids) {
      if (!entries.has(t)) throw new StorageError(`H-FILEINIT: the bring-up starts task ${t}, which is not a static task`);
      lab.lt.allow.add(entries.get(t));
    }
    lab.call(f.init, null, null, null, 2000000);
    for (const t of tids) this._task(entries.get(t), 'H-FILEINIT');
    this.s.settle('H-FILEINIT');
    lab.lt.allow.add(f.fileclbk.entry);
    const tid = this._tid(f.fileclbk.entry, 'H-FILECLBK');
    const [rc] = lab.nk.svc('act_tsk', { d0: tid });
    if (rc !== 0) throw new StorageError(`H-FILECLBK: act_tsk(${tid}) = ${rc}`);
    this.fileclbk = tid;
    this.s.settle('H-FILECLBK');
    if (!this.idle()) throw new StorageError(`H-FILECLBK: FILECLBK (task ${tid}) is not waiting on its queue after its start`);
    this.insert();
  }
  // S-SDHOST: the pages in the stub's allow table and the polled bit in its presets, in their first free entries
  install_host() {
    const sim = this.lab.sim, free = (base, n, size) => {
      for (let i = 0; i < n; i++) if (!(sim.u32(STUB + base + size * i + size - 4) & 1)) return i;
      throw new StorageError(`S-SDHOST: the lab stub's table at +0x${base.toString(16)} is full`);
    };
    for (const [page, size] of this.f.host.pages) sim.write(STUB + ALLOW + 12 * free(ALLOW, NALLOW, 12), pack('<III', page, size, 1));
    for (const [addr, value] of this.f.host.idle) sim.write(STUB + PRESET + 16 * free(PRESET, NPRESET, 16), pack('<IIII', addr, value, 0, 1));
  }
  _tid(entry, who) {
    const tids = [...this.lab.nk.tasks()].filter(([, [e]]) => e === entry).map(([t]) => t);
    if (tids.length !== 1) throw new StorageError(`${who}: ${tids.length} static tasks with entry ${h8(entry)}, want one`);
    return tids[0];
  }
  _task(entry, who) {
    const tid = this._tid(entry, who), st = this.lab.nk.state(tid) & 0xF;
    if (st !== WAI && st !== 2) throw new StorageError(`${who}: task ${tid} (${h8(entry)}) is in state 0x${st.toString(16)} after the init, not started`);
    return tid;
  }
  // FILECLBK waits on its queue with no message in hand
  idle() {
    const lab = this.lab, t = this.fileclbk;
    return (lab.nk.state(t) & 0xF) === WAI && !lab.nk.timed_waiters().includes(t) && lab.sim.u32(this.f.fileclbk.busy) === 0;
  }
  // One message to the file module's queue, with no reply queue (FILECLBK replies to queue 0 with nothing), and lab
  // time runs in slices until FILECLBK waits on its queue again; word: the message's word; returns the parameter
  // block's bytes and the lab time it took
  request(code, param, size, label, who = 'S-CARD', word = 0) {
    const lab = this.lab, s = this.s;
    const payload = lab.alloc(pack('<IIII', 0, word, code, param), 4);
    const desc = lab.alloc(pack('<II', payload, 16), 4);
    const r = lab.call(OLYQEWR, { d0: this.f.fileclbk.queue, d1: FOREVER, a0: desc }, null, null, 2000000);
    if (r.d0 !== 0) throw new StorageError(`${who}: ${label}: OlyQeWr to the file module's queue = ${r.d0 | 0}`);
    const t0 = lab.lab_time();
    for (;;) {
      s.settle(`${who} ${label}`);
      if (this.idle()) break;
      if (lab.lab_time() - t0 > REQUEST_LIMIT_MS * 1e6) throw new StorageError(`${who}: ${label}: FILECLBK still busy after ${REQUEST_LIMIT_MS} ms of lab time`);
      lab.elapse(REQUEST_SLICE_MS, `${who} ${label}`);
    }
    const ms = Math.round((lab.lab_time() - t0) / 1e5) / 10;
    return [lab.sim.read(param, size), ms];
  }
  // A dosfat request: its error, in the block where dosfat stores it (storage.fat_error, +48), else the status
  // FILECLBK replies with (the E118 family's dosfat does not store it, docs/hle-gaps.md 4.8.8, D)
  _fat(code, label, who) {
    const blk = this.lab.alloc(new Uint8Array(128), 4);
    this.lab.sim.write(blk + 4, pack('<HH', 0, DRIVE));
    const at = this.f.fat_error;
    let b, ms, err;
    if (at !== null) {
      [b, ms] = this.request(code, blk, 128, label, who);
      err = b[at] | b[at + 1] << 8;
    } else ({ status: err, ms } = this.ask(code, blk, 128, label, who));
    this.log.push([label, `error 0x${err.toString(16)} after ${ms} ms`]);
    return err;
  }
  // A request and the status FILECLBK replies with (a0 the message, d0 its status), observed while the request is
  // out: its word is the tag. Returns {status, bytes (the block's), ms}
  ask(code, blk, size, label, who) {
    const lab = this.lab, reply = this.f.fileclbk.reply, tag = (REQUEST_TAG | (this.tag = (this.tag + 1) & 0xFFFF)) >>> 0;
    let bytes, ms;
    this.reply = null;
    lab.observe(reply, (l, r) => {
      if (l.sim.u32((r.a0 >>> 0) + 4) === tag && (r.d0 & 0xFFFF) !== REQUEUE) this.reply = r.d0 & 0xFFFF;
    }, 'obs-fileclbk-reply');
    try { [bytes, ms] = this.request(code, blk, size, label, who, tag); } finally { lab.hooks.delete(runtime(reply)); }
    if (this.reply === null) throw new StorageError(`${who}: ${label}: FILECLBK made no reply`);
    return { status: this.reply, bytes, ms };
  }
  // The insertion's requests (S-CARD); at runtime (who S-MEDIA) the card is S-SDCARD's again before them
  insert(who = 'S-CARD') {
    const lab = this.lab, f = this.f, c = f.codes;
    if (!this.card.present) throw new StorageError(`${who}: the insertion's requests with the card out of the slot`);
    let err = this._fat(c.mount, 'mount', who);
    if (err === f.unformatted) {
      err = this._fat(c.format, 'format', who);
      if (err !== 0) throw new StorageError(`${who}: the format returned 0x${err.toString(16)}`);
      this.formatted = true;
      err = this._fat(c.mount, 'mount', who);
    }
    if (err !== 0) throw new StorageError(`${who}: the FAT mount returned 0x${err.toString(16)}`);
    for (const [cmd, label] of [[DCF_CARD_IN, 'dcf card in'], [DCF_LISTS, 'dcf lists']]) this._dcf(cmd, label, who);
    this.renumber(who);
    this.drive_status = this.status_word();
    this.mounted = (this.drive_status & DRIVE_MOUNTED) !== 0;
    this.log.push(['drive', `status ${h8(this.drive_status)}`]);
    if (!this.mounted) throw new StorageError(`${who}: the drive status after the insertion is ${h8(this.drive_status)}, not mounted (0x1000)`);
  }
  // A DCF process command {u16 command, u16 drive}
  _dcf(cmd, label, who) {
    const lab = this.lab, prm = lab.alloc(pack('<HHIII', cmd, DRIVE, 0, 0, 0), 4);
    const [, ms] = this.request(this.f.codes.dcf, prm, 16, label, who);
    this.log.push([label, `detect state ${lab.sim.read(this.f.detect + 2 * DRIVE, 2)[0]} after ${ms} ms`]);
  }
  // A picture of the DCF database by its index (from 1): {folder, number} from its fnode and its folder's dnode, or null
  // where the DCF process answers none
  fnode(index, who = 'S-CARD') {
    const lab = this.lab, sim = lab.sim, prm = lab.alloc(new Uint8Array(16), 4);
    sim.write(prm, pack('<HHI', DCF_FNODE, DRIVE, index));
    sim.write(prm + 12, pack('<H', DCF_FNODE_FLAG));
    const { status } = this.ask(this.f.codes.dcf, prm, 16, 'dcf fnode', who);
    const fn = status === 0 ? sim.u32(prm + DCF_FNODE_AT) >>> 0 : 0, dn = fn ? sim.u32(fn + REC.f.dnode) >>> 0 : 0;
    if (!dn) return null;
    const u16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; };
    return { folder: u16(dn + REC.d.number), number: u16(fn + REC.f.number) };
  }
  // The DCF numbering mount: the next folder and file (S-RECFILE's names)
  renumber(who) {
    const lab = this.lab, blk = lab.alloc(pack('<HH', 0, DRIVE), 4);
    lab.sim.write(blk + 4, new Uint8Array(124));
    const [b, ms] = this.request(this.f.codes.number, blk, 48, 'dcf number', who);
    this.dcf = { folder: b[42] | b[43] << 8, file: b[44] | b[45] << 8 };
    this.next_file = this.dcf.file;
    this.log.push(['dcf number', `next folder ${this.dcf.folder}, file ${this.dcf.file} after ${ms} ms`]);
  }
  // S-MEDIA's removal: the card is out of the slot (S-SDCARD answers nothing), then the DCF process's card out and
  // sdmem's card info cleared (the next mount initialises the card again)
  remove(who = 'S-MEDIA') {
    this._dcf(this.f.card_out, 'dcf card out', who);
    const req = this.lab.alloc(new Uint8Array(128), 4);                          // drive 0: sdmem's card info cleared
    const [b] = this.request(this.f.card_info, req, 64, 'sdmem card info', who);
    this.log.push(['sdmem card info', `status 0x${(b[60] | b[61] << 8).toString(16)}`]);
    this.drive_status = this.status_word();
    this.mounted = false;
    this.removals += 1;
    this.log.push(['drive', `status ${h8(this.drive_status)}`]);
  }
  // A fileif request (storage.fileif, src/fw/facts.mjs STORAGE_LIB): the block's result word
  fileif(code, args, label) {
    const prm = this.lab.alloc(pack('<IIIII', 0, ...[...args, 0, 0, 0, 0].slice(0, 4)), 4);
    const [b] = this.request(code, prm, 4, label);
    return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;
  }
  cstr(text) {
    const b = new Uint8Array(text.length + 1);
    for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
    return this.lab.alloc(b, 4);
  }
  // S-RECFILE: the picture's bytes to a file of the DCF; returns {path, size, folder, number} (record() also the
  // cluster, the stamp and the clock record)
  write_picture(bytes) { return this.rec ? this.rec_picture(bytes) : this.f.recorder ? this.record(bytes) : this.fileif_picture(bytes); }
  // REC_FILE natively (src/lab/rec.mjs): its file, with the header REC_IMAGE's header maker builds
  rec_picture(bytes) {
    const file = this.rec.record(bytes);
    this.next_file = file.number + 1;
    this.files.push(file);
    this.log.push(['rec', `${file.path}: ${file.size} bytes (header ${file.header}) from cluster ${file.cluster}, dated '${file.date}'`]);
    return file;
  }
  rec_layout() { return REC; }       // the fnode's and the dnode's fields (src/lab/rec.mjs)
  // S-RECFILE where the rule reads the build's recorder: the file as REC_FILE's modules record one (the recorder
  // E143 0x519f9dd7), each of its requests to the file module (REC; STORAGE_LIB rec) with REC's block, which FILECLBK
  // runs natively; the recorder's lock (0x5054a850) is not taken, nothing else records in the lab. The camera's
  // clock read (fact recorder.time) gives the time stamp; the fnode of the next DCF number (open: dcfnum op 1, which
  // makes the folder where it is new and names the file by the stamp's month and day), its extension; the
  // reservation of the file's first cluster (mode 2, then 0 where it finds none); the chain write of the bytes from
  // it (dosfat op 4; the bytes padded with 0 to whole sectors, the size the bytes'); the directory entry in the
  // fnode's folder; the fnode's kind, first cluster and size, and its registration (dcfnum op 2: the DCF database's
  // counts, its next number). A status not 0 stops the session (the recorder would cancel the fnode, 0x519f9ea7: its
  // error path is not modelled)
  record(bytes) {
    const lab = this.lab, sim = lab.sim, f = this.f, c = f.rec.codes, who = 'S-RECFILE';
    const ok = (code, blk, size, label) => {
      const { status } = this.ask(code, blk, size, label, who);
      if (status !== 0) throw new StorageError(`${who}: ${label}: FILECLBK's status 0x${status.toString(16)}`);
    };
    const cstr = (text, n) => { const b = new Uint8Array(n); for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i); return b; };
    const text = (a, n) => String.fromCharCode(...sim.read(a, n)).replace(/[\0 ]+$/, '');
    // the time stamp: the camera's clock read into the time record
    const rec = lab.alloc(new Uint8Array(CLOCK_RECORD), 4);
    lab.call(f.recorder.time, { a0: rec }, null, null, 2000000);
    const t = sim.read(rec, CLOCK_RECORD), date = [t[0] | t[1] << 8, t[2], t[3], t[4], t[5], t[6]], stamp = fatStamp(date);
    // the fnode
    const blk = lab.alloc(new Uint8Array(REC.block), 4);
    sim.write(blk + REC.drive, pack('<H', DRIVE));
    sim.write(blk + REC.folder_name, cstr(`${REC.folder}${f.names.folder}`.padEnd(11), 12));
    for (const at of REC.stamp) sim.write(blk + at, pack('<I', stamp));
    ok(c.open, blk, REC.block, 'dcf open');
    const fn = sim.u32(blk + REC.fnode) >>> 0, dn = fn ? sim.u32(fn + REC.f.dnode) >>> 0 : 0;
    if (!fn || !dn) throw new StorageError(`${who}: dcf open: fnode ${h8(fn)}, its folder ${h8(dn)}`);
    sim.write(fn + REC.f.ext, cstr(f.names.ext, 4));
    // the first cluster
    const res = lab.alloc(new Uint8Array(48), 4);
    let cluster = 0, mode;
    for (mode of REC.modes) {
      sim.write(res, new Uint8Array(48));
      sim.write(res + 4, pack('<HH', REC.reserve_op, DRIVE));
      sim.write(res + 16, pack('<I', bytes.length));
      sim.write(res + 36, pack('<I', mode));
      ok(c.reserve, res, 48, 'reserve');
      if ((cluster = sim.u32(res) >>> 0) !== 0) break;
    }
    if (!cluster) throw new StorageError(`${who}: reserve: no free cluster`);
    // the bytes
    const sectors = SECTORS(bytes.length), data = new Uint8Array(sectors * SECTOR);
    data.set(bytes);
    const chain = lab.alloc(new Uint8Array(REC.chain), 4);
    sim.write(chain + 6, pack('<HIIII', DRIVE, cluster, 0, sectors, lab.alloc(data, 64)));
    sim.write(chain + 28, pack('<III', mode, cluster, bytes.length));
    ok(c.write, chain, REC.chain, 'chain write');
    // the directory entry
    const name = lab.alloc(new Uint8Array(12), 4);
    sim.write(name, sim.read(fn + REC.f.name, 8));
    sim.write(name + 8, sim.read(fn + REC.f.ext, 4));
    const entry = lab.alloc(new Uint8Array(REC.entry), 4), place = sim.read(dn + REC.d.place, 16);
    const pl = (o) => place[o] | place[o + 1] << 8 | place[o + 2] << 16 | place[o + 3] << 24;
    sim.write(entry + 4, pack('<HHIII', REC.entry_op, DRIVE, sim.u32(dn + REC.d.cluster), 0, name));
    sim.write(entry + 20, pack('<IIIIII', mode, bytes.length, 0, stamp, stamp, cluster));
    sim.write(entry + 46, Uint8Array.of(REC.archive));
    // the dnode's entry place (0x50872238): its +12, +0 | 0x4000, +2 | 0x8000, +4, +8
    sim.write(entry + 84, pack('<IHHII', pl(12), (place[0] | place[1] << 8 | 0x4000), (place[2] | place[3] << 8 | 0x8000), pl(4), pl(8)));
    if (mode === REC.modes[0]) { const fl = sim.read(fn + REC.f.flags, 2); sim.write(fn + REC.f.flags, pack('<H', (fl[0] | fl[1] << 8) | REC.flag_mode2)); }
    ok(c.entry, entry, REC.entry, 'directory entry');
    // the registration
    sim.write(fn + REC.f.kind, Uint8Array.of(f.rec.kind));
    sim.write(fn + REC.f.cluster, pack('<II', cluster, bytes.length));
    ok(c.register, blk, REC.block, 'dcf register');
    const folder = sim.read(dn + REC.d.number, 2), num = sim.read(fn + REC.f.number, 2);
    const file = { path: `${f.names.drive}:\\DCIM\\${text(dn + REC.d.name, 11)}\\${text(fn + REC.f.name, 8)}.${f.names.ext}`, size: bytes.length,
      folder: folder[0] | folder[1] << 8, number: num[0] | num[1] << 8, cluster, stamp, clock: { date, status: t[CLOCK_STATUS] | t[CLOCK_STATUS + 1] << 8 } };
    this.next_file = file.number + 1;
    this.files.push(file);
    this.log.push(['recfile', `${file.path}: ${file.size} bytes from cluster ${cluster} (mode ${mode}), stamped ${date.join('-')}`]);
    return file;
  }
  // S-RECFILE elsewhere: the picture's bytes to its DCF file through fileif; returns {path, size, folder, number}
  fileif_picture(bytes) {
    const { fileif: c, names: n } = this.f, lab = this.lab;
    if (this.next_file === null || this.next_file > 9999) throw new StorageError(`S-RECFILE: no DCF file number (${this.next_file})`);
    const dcim = `${n.drive}:\\DCIM`, dir = `${dcim}\\${this.dcf.folder}${n.folder}`;
    const path = `${dir}\\${n.file}${String(this.next_file).padStart(4, '0')}.${n.ext}`;
    for (const d of [dcim, dir]) this.fileif(c.mkdir, [this.cstr(d)], 'mkdir');    // a folder that exists: an error result, no change
    const fp = this.fileif(c.open, [this.cstr(path), this.cstr('wb')], 'fopen');
    if (!fp) throw new StorageError(`S-RECFILE: fopen(${path}, wb) failed`);
    for (let o = 0; o < bytes.length; o += WRITE_CHUNK) {
      const part = bytes.subarray(o, Math.min(bytes.length, o + WRITE_CHUNK));
      const n2 = this.fileif(c.write, [lab.alloc(part, 64), 1, part.length, fp], 'fwrite');
      if (n2 !== part.length) throw new StorageError(`S-RECFILE: fwrite of ${part.length} bytes to ${path} wrote ${n2}`);
    }
    const rc = this.fileif(c.close, [fp], 'fclose');
    if (rc !== 0) throw new StorageError(`S-RECFILE: fclose(${path}) = ${rc}`);
    const file = { path, size: bytes.length, folder: this.dcf.folder, number: this.next_file };
    this.next_file += 1;
    this.files.push(file);
    return file;
  }
  // the file layer's drive status, natively
  status_word(drive = DRIVE) { return this.lab.call(this.f.status, { d0: drive }, null, null, 200000).d0 >>> 0; }
  // S-SDCARD: one SD command answered by the card
  _command(h, r) {
    const sim = this.lab.sim, c = r.a0 >>> 0, L = this.f.command_fields;
    const code = sim.u32(c + L.code), arg = sim.u32(c + L.arg), buf = sim.u32(c + L.buffer), count = sim.u32(c + L.count), bsize = sim.u32(c + L.block);
    const x = this.card.exec(code, arg, count, bsize);
    this.commands += 1;
    if (x.status === 0) {
      sim.write(c + L.resp, pack('<IIII', ...x.resp));
      if (x.data) sim.write(buf, x.data.subarray(0, Math.min(x.data.length, count * bsize || x.data.length)));
      if (x.write) {
        const b = sim.read(buf, count * SECTOR);
        for (let i = 0; i < count; i++) this.card.writeSector(arg + i, b.subarray(SECTOR * i, SECTOR * (i + 1)));
      }
    }
    sim.write(c + L.status, pack('<H', x.status));
    h.finish_after(r, disasm(sim.u32(c + 8)), { a0: c, d0: x.status });
  }
  // S-FSNAND: the NAND access for the file system's area: read (op f.nand.read) or write (f.nand.write) of d0 bytes
  // between a0 (memory) and a1 (flash); any other access stops the session
  _nand(h, r) {
    const sim = this.lab.sim, { area: [base, size], read, write } = this.f.nand;
    const mem = r.a0 >>> 0, flash = r.a1 >>> 0, n = r.d0 >>> 0, op = r.d1 >>> 0, off = flash - base;
    if (off < 0 || off + n > size || (op !== read && op !== write)) {
      throw new StorageError(`S-FSNAND: NAND access 0x${op.toString(16)} of ${n} bytes at flash ${h8(flash)} from ${where(r.mdr)}: only the file system's area (${h8(base)}, ${size} bytes) is modelled`);
    }
    if (op === read) sim.write(mem, this.nand.subarray(off, off + n));
    else { this.nand.set(sim.read(mem, n), off); this.nand_writes += 1; }
    this.log.push(['nand', `${op === read ? 'read' : 'write'} ${n} bytes at +0x${off.toString(16)} from ${where(r.mdr)}`]);
    h.finish(r, { d0: 0 });
  }
  // the host keeps the card when the session ends, if the firmware wrote to it
  close() { if (this.host && this.card.take_dirty()) this.host.save(this.card); }
  take_log() { return this.log.splice(0); }
  // the slot at run time (a card input's record, src/lab/play.mjs)
  slot() { return { present: this.card.present, mounted: this.mounted, removals: this.removals, insertions: this.insertions }; }
  status() {
    return { mounted: this.mounted, formatted: this.formatted, dcf: this.dcf, drive_status: this.drive_status === null ? null : h8(this.drive_status),
      card: { kind: this.card.kind, sectors: this.card.sectors, stored: this.card.data.size, reads: this.card.reads, writes: this.card.writes },
      commands: this.commands, flushes: this.flushes, nand_writes: this.nand_writes, files: this.files.length, next_file: this.next_file };
  }
}
