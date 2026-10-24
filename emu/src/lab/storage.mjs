// The card and the file system (docs/hle-gaps.md 4.8; src/fw/models.mjs storage has the evidence for every address):
// an SD card in the first slot behind the firmware's SD command layer, and the firmware's own storage stack above it,
// natively: sdmem, sd_mount, sdmem_format, logsec, dosfat (FAT / exFAT), the DCF modules, fileif, and the file tasks
// FILECLBK, FILEFGND and DCFPROC_SUB. On a body whose MODELS entry gives `storage` (E143); elsewhere S-CARD keeps its
// card without a file system (src/lab/camapp.mjs).
//
//   H-FILEINIT  the file system's bring-up (the boot task's call, storage.init) natively before the application starts:
//               its queues and semaphores, logsec's and the SD host's init, the file layer, the card driver's detect
//               states, and the two tasks it starts (FILEFGND, DCFPROC_SUB); then FILECLBK, the file module's task,
//               started (act_tsk; the boot's start of it is not traced)
//   S-SDHOST    the SD host's registers (both ports' pages and the GPIO page of the card's pins and power) are lab-stub
//               pages that keep what the firmware writes; the SD core's SD_INFO2 reads its clock-divider bit set, the
//               one bit the host's set-up polls (I: TMIO's SCLKDIVEN, the bus idle). No interrupt is ever raised: the
//               UHS-II PHY's link-up wait runs out (about 120 ms of lab time), as with a card without UHS-II, and the
//               firmware falls back to the SD interface
//   S-SDCARD    the card (src/lab/sdcard.mjs, an 8 GiB SDHC card) at the SD command layer (storage.command): each command
//               the firmware sends is answered there, its response, its data and its status written into the command
//               and its completion called at once, as the layer itself does for a busy port; sd_mount's card init,
//               the transfers and the format run natively above it
//   S-FSNAND    the file system's NAND area (storage.nand.area, 512 KiB of flash) behind the NAND access storage.nand.access: it reads
//               erased (0xff) on a camera that never saved it (the lab's NAND is not modelled), and the firmware's
//               writes are kept for the session
//   S-ALBM      the album manager's per-drive init returns at once: ALBM_MAIN, which it would start, allocates its first
//               request's id with udf07 (docs/om1-udf-spec.md row 14, kept faulting), and the movie module it asks does
//               not run
//   S-RECFILE   the picture's file at a release's END_SHOOTING_PICTURE (src/lab/camapp.mjs S-CARD), in place of
//               REC_FILE, which does not run: the file module's own file requests (mkdir, fopen 'wb', fwrite in
//               chunks, fclose; the FlashAir configuration writer's calls) put a JPEG the lab encodes
//               (src/lab/jpeg.mjs: S-SCENE's frame at the capture, each 8 x 8 block its mean, or a black frame) at
//               the DCF name the numbering mount gave (folder 100: C:\DCIM\100OMSYS, file P1010001.JPG and on; the
//               DCF module's initial names, D; the camera's names carry its clock's month and day, I). The DCF
//               database is not told of the file (REC_FILE's DCF steps are not read): the firmware's image count
//               stays 0 until the next mount, and the next file number is the lab's
//   S-CARD      (the insertion) the media control's requests on a card insertion, sent to the file module's queue as
//               the HLS media layer would send them (it does not run in the lab; which requests it sends, and in which
//               order, is I): the FAT mount; on a card with no file system the format (the request Card Formatting
//               makes, I) and the mount again; the DCF process's card-in and list commands; the DCF numbering mount,
//               which leaves the drive mounted (the drive status's bit 0x1000)
import { FirmwareError, where, disasm } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { RTOS } from './rtos.mjs';
import { K_CFLUSH } from './menu.mjs';
import { STUB } from './display.mjs';
import { SdCard, SECTOR } from './sdcard.mjs';

export class StorageError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const OLYQEWR = [...RTOS].find(([, n]) => n === 'OlyQeWr')[0];
const ALLOW = 0x100, NALLOW = 32, PRESET = 0x400, NPRESET = 128;   // the lab stub's tables (src/dev/stub.mjs)
const WAI = 4, REQUEST_SLICE_MS = 5, REQUEST_LIMIT_MS = 10000, FOREVER = -1 >>> 0;
const DRIVE = 0, DRIVE_MOUNTED = 0x1000;
const DCF_CARD_IN = 1, DCF_LISTS = 3;
const ERASED = 0xff, WRITE_CHUNK = 32768;

export class Storage {
  // session: the PlaySession; f: MODEL_INFO.storage. The card: the host's (env.card: {open() -> SdCard, save(card)},
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
    this.fileclbk = null;          // FILECLBK's task id
    this.mounted = false;          // the drive status's mount bit after the insertion
    this.formatted = false;        // the insertion formatted the card
    this.dcf = null;               // the DCF numbering mount's next folder and file
    this.next_file = null;         // S-RECFILE: the next picture's file number
    this.files = [];               // S-RECFILE: the pictures' files written, {path, size}
    this.drive_status = null;
  }
  // H-FILEINIT, H-FILECLBK, S-SDHOST, S-SDCARD, S-FSNAND, S-ALBM, then the insertion (S-CARD); in the play bring-up,
  // before the application starts
  bring_up() {
    const lab = this.lab, f = this.f;
    this.install_host();
    lab.hook(f.command, (h, r) => this._command(h, r), 'S-SDCARD');
    lab.hook(f.nand.access, (h, r) => this._nand(h, r), 'S-FSNAND');
    lab.hook(f.album_init, (h, r) => { this.log.push(['albm', `drive ${r.d0 & 0xFF}: not started`]); h.finish(r, { d0: 0 }); }, 'S-ALBM');
    const [lo, hi] = f.code;
    lab.wrap(K_CFLUSH, (prev) => (h, r) => {
      const ra = disasm(r.mdr);
      if (ra < lo || ra >= hi) return prev(h, r);
      this.flushes += 1;
      return h.finish(r);
    }, 'K-CFLUSH');
    for (const e of f.tasks) lab.lt.allow.add(e);
    lab.call(f.init, null, null, null, 2000000);
    for (const e of f.tasks) this._task(e, 'H-FILEINIT');
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
  // time runs in slices until FILECLBK waits on its queue again; returns the parameter block's bytes
  request(code, param, size, label) {
    const lab = this.lab, s = this.s;
    const payload = lab.alloc(pack('<IIII', 0, 0, code, param), 4);
    const desc = lab.alloc(pack('<II', payload, 16), 4);
    const r = lab.call(OLYQEWR, { d0: this.f.fileclbk.queue, d1: FOREVER, a0: desc }, null, null, 2000000);
    if (r.d0 !== 0) throw new StorageError(`S-CARD: ${label}: OlyQeWr to the file module's queue = ${r.d0 | 0}`);
    const t0 = lab.lab_time();
    for (;;) {
      s.settle(`S-CARD ${label}`);
      if (this.idle()) break;
      if (lab.lab_time() - t0 > REQUEST_LIMIT_MS * 1e6) throw new StorageError(`S-CARD: ${label}: FILECLBK still busy after ${REQUEST_LIMIT_MS} ms of lab time`);
      lab.elapse(REQUEST_SLICE_MS, `S-CARD ${label}`);
    }
    const ms = Math.round((lab.lab_time() - t0) / 1e5) / 10;
    return [lab.sim.read(param, size), ms];
  }
  _fat(code, label) {
    const blk = this.lab.alloc(new Uint8Array(128), 4);
    this.lab.sim.write(blk + 4, pack('<HH', 0, DRIVE));
    const [b, ms] = this.request(code, blk, 128, label);
    const err = b[48] | b[49] << 8;
    this.log.push([label, `error 0x${err.toString(16)} after ${ms} ms`]);
    return err;
  }
  insert() {
    const lab = this.lab, f = this.f, c = f.codes;
    let err = this._fat(c.mount, 'mount');
    if (err === f.unformatted) {
      err = this._fat(c.format, 'format');
      if (err !== 0) throw new StorageError(`S-CARD: the format returned 0x${err.toString(16)}`);
      this.formatted = true;
      err = this._fat(c.mount, 'mount');
    }
    if (err !== 0) throw new StorageError(`S-CARD: the FAT mount returned 0x${err.toString(16)}`);
    for (const [cmd, label] of [[DCF_CARD_IN, 'dcf card in'], [DCF_LISTS, 'dcf lists']]) {
      const prm = lab.alloc(pack('<HHIII', cmd, DRIVE, 0, 0, 0), 4);
      const [, ms] = this.request(c.dcf, prm, 16, label);
      this.log.push([label, `detect state ${lab.sim.read(f.detect + 2 * DRIVE, 2)[0]} after ${ms} ms`]);
    }
    const blk = lab.alloc(pack('<HH', 0, DRIVE), 4);
    lab.sim.write(blk + 4, new Uint8Array(124));
    const [b, ms] = this.request(c.number, blk, 48, 'dcf number');
    this.dcf = { folder: b[42] | b[43] << 8, file: b[44] | b[45] << 8 };
    this.next_file = this.dcf.file;
    this.log.push(['dcf number', `next folder ${this.dcf.folder}, file ${this.dcf.file} after ${ms} ms`]);
    this.drive_status = this.status_word();
    this.mounted = (this.drive_status & DRIVE_MOUNTED) !== 0;
    this.log.push(['drive', `status ${h8(this.drive_status)}`]);
    if (!this.mounted) throw new StorageError(`S-CARD: the drive status after the insertion is ${h8(this.drive_status)}, not mounted (0x1000)`);
  }
  // A fileif request (models.mjs storage.fileif): the block's result word
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
  // S-RECFILE: the picture's bytes to its DCF file; returns {path, size}
  write_picture(bytes) {
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
    this.next_file += 1;
    const file = { path, size: bytes.length };
    this.files.push(file);
    return file;
  }
  // the file layer's drive status, natively
  status_word(drive = DRIVE) { return this.lab.call(this.f.status, { d0: drive }, null, null, 200000).d0 >>> 0; }
  // S-SDCARD: one SD command answered by the card
  _command(h, r) {
    const sim = this.lab.sim, c = r.a0 >>> 0;
    const code = sim.u32(c + 24), arg = sim.u32(c + 28), buf = sim.u32(c + 48), count = sim.u32(c + 52), bsize = sim.u32(c + 56);
    const x = this.card.exec(code, arg, count, bsize);
    this.commands += 1;
    if (x.status === 0) {
      sim.write(c + 32, pack('<IIII', ...x.resp));
      if (x.data) sim.write(buf, x.data.subarray(0, Math.min(x.data.length, count * bsize || x.data.length)));
      if (x.write) {
        const b = sim.read(buf, count * SECTOR);
        for (let i = 0; i < count; i++) this.card.writeSector(arg + i, b.subarray(SECTOR * i, SECTOR * (i + 1)));
      }
    }
    sim.write(c + 74, pack('<H', x.status));
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
  status() {
    return { mounted: this.mounted, formatted: this.formatted, dcf: this.dcf, drive_status: this.drive_status === null ? null : h8(this.drive_status),
      card: { sectors: this.card.sectors, stored: this.card.data.size, reads: this.card.reads, writes: this.card.writes },
      commands: this.commands, flushes: this.flushes, nand_writes: this.nand_writes, files: this.files.length, next_file: this.next_file };
  }
}
