// REC_FILE natively on E143, E146 and E147 (src/fw/models.mjs rec_native; docs/hle-gaps.md 4.8.10): S2's picture
// file recorded by REC_FILE's own task from the packet REC_IMAGE posts it, with the file's header made by REC_IMAGE's
// own header maker. Addresses and offsets are E143's (D unless tagged); each body's are the ones the rule reads (fact
// 'rec_file', src/fw/facts.mjs recFile). The other bodies keep S-RECFILE (src/lab/storage.mjs).
//
// REC's packet (316 bytes): its fields by the firmware's own names, from the packet dump 0x50541561 (D). REC_MAIN
// builds it (0x50539e89..0x50539f0e clear it), REC_IMAGE posts it to REC_FILE's queue REC_EXEC_FILE 69 (0x6004324e)
// with 0x5053990f after its image (0x50542359; for the modes 4100, 4103, 4105 and 4115 at once, 0x50541f16): of the six
// references to the queue's id, three are REC_FILE's own (its init 0x5053f189, its receive and its exit), two
// REC_IMAGE's and one the object-name list's, so nothing else posts to it (D). REC_FILE (task 27, 0x5053f1a4) waits on
// flag 265 (0x60043182) for the pattern 3: 2 the queue (its receive 0x5054dd40, 316 bytes, then the handler 0x5053f354,
// which returns to 0x5053f20d), 1 REC's packet ring (its receive 0x5054ebc8(1), then the same handler, returning to
// 0x5053f249). The queue post after the image is not a normal JPEG's (E143, docs/hle-gaps.md 4.3.3, D): REC_IMAGE's
// 0x505422f1 posts there only where 0x5054ca14 gives 0 (Mode 4097 with the record's +38006 not 0 and 0x5054bf6c not 0,
// which needs the record's +38764 to be 22); a normal JPEG goes into the ring (0x5054eaf0, 120 slots of 316 bytes at
// 0xa3323a38) and REC_FILE's flag is set across the cores (0x5054de46, by REC's bind table 0xa332ce5c, entry 7:
// REC_FILE's flag, pattern 1, core 0, then cpu_conn 0x50035afd). E146 and E147 (D): the packet is 276 bytes with other
// offsets (their dump's), and REC_IMAGE keeps the image's address and size not in it but in an image record of 52
// bytes that the packet's +180 points at, which REC_IMAGE's task keeps on its stack and inits itself; REC_FILE is
// task 27 and REC_IMAGE task 28 there too, and a normal JPEG takes the same ring (docs/hle-gaps.md 4.3.5).
//
//   H-EXIFINIT  the EXIF module's init (0x504298bd, the start function's call at 0x501e9a7c, not run by the lab)
//               natively before the first picture: the EXIF parameter template (0x62a6c358, 92252 bytes; 0x5042aca2:
//               the versions 0231 / 0100, R98, and Make and Model from the settings store, ids 11073 and 25329, through
//               0x5042ceb5), then the cache flush K-CFLUSH 0x5004e68a (called from 0x504298ef), answered
//   H-RECINIT   REC's module init (0x50539665, the start function's call at 0x501e9806) natively before the first
//               picture: its queues bound to its tasks' flags (REC_FILE's at 0x5053f189), REC's memory pools
//               (0x5054b00d)
//   H-RECFILE   REC_FILE (task 27) started with act_tsk, as the start function starts REC's tasks after the init (I:
//               which call starts it is not read); it then waits on its flag
//   S-EXIFPRM   the shot's EXIF parameter block (pExifParam, the packet's +28; on the camera TAKE's per-shot record,
//               0x503afc3e(HandleTarget), 92252 bytes), as TAKE would hand it to REC, whose shooting info TAKE fills
//               and the lab does not run: the template copied by TAKE's own copy (0x504298f9, TAKE's call 0x503bba70);
//               the camera's clock read natively (0x5012b7cd) into the capture's time record at +37800 (I: TAKE's; the
//               EXIF set 0x5042992d formats the dates from there, 0x5042c16e); the dates formatted natively as the EXIF
//               set does (0x5042c16a..0x5042c196: 0x5012bd20 with the format 0x4200 into DateTimeOriginal +4089, copied
//               to CreateDate +4109 and DateTime +1364); and three records whose zero the header maker would divide by,
//               which TAKE and the EXIF set fill: the crop areas +40858 (JPEG) and +40866 (RAW), {0, 0, 1, 1} (I: the
//               full frame, by 0x5054a031..0x5054a0ad's arithmetic (x + 1) * width / xden - 1), and the digital zoom
//               ratio +4228 (EXIF 0xa404) 1/1 (I: no digital zoom; 0x504287f1 divides by its denominator). The EXIF set
//               itself does not run: it divides by zero in TAKE's state (0x50398ca5, X), so exposure, aperture, ISO,
//               focal length, the lens and the image size stay the template's (0). Also the record's fields REC_IMAGE
//               reads (below) that TAKE's fill takes from the settings store, each
//               read natively with the settings read 0x500417da as TAKE's fill reads it (D): the bracket's +38074,
//               +38076, +38078, +38080 (ids 35217, 38737, 38769, 38785, halfwords) and +38086 (id 40401, a byte), from
//               0x503bbd26..0x503bbd98, from which rec_bracket_entry (0x5053b1dc) takes the last frame's index
//               (0x5053b33f..0x5053b375; with them 0 it is 65535 and REC_IMAGE loops, X), and the aspect +38122 (id
//               12417, a byte, 0x503bc035..0x503bc044), which rec_bracket_update makes the packet's ImgAspect
//               (0x5053b45d..0x5053b469); on E146 and E147 at the offsets the rule reads (+37726.., the aspect +37774)
//   REC_IMAGE's own task makes the packet's file buffer and header and hands it to REC_FILE natively, from the packet
//   REC_PREPRO's task posts it (H-RECIMAGE, S-RECREQ; docs/hle-gaps.md 4.3.3; on E146 and E147 since 2026-11-10, at
//   the addresses the rule reads, fact 'rec_image', src/fw/facts.mjs recImage, docs/hle-gaps.md 4.3.5, where the post
//   to REC_IMAGE's queue is REC_RAWNR's, the task REC_PREPRO posts a normal still to there, D):
//   H-RECSHARED REC's shared objects' init (0x5054dbe8: the packet rings' heads 0xa33235fc and slots 0xa3323a38, the
//               flag bind table 0xa332ce5c with REC_FILE's flag at entry 7, its done byte 0xa332ce59), natively before
//               the first picture: on the camera REC_MAIN_CPU2's task (0x5053d5dc) runs it at its start on CPU 2
//               (0x5053d5e4; also 0x5054ede9), which the lab does not run. Without it REC_IMAGE's set of REC_FILE's
//               flag finds no entry and REC_FILE never takes the packet (X)
//   H-RECIMGPRO the image library's IRQ attach (0x5048c3a0), its request ids' bitmap clear (0x5048ba3a) and the imgpro
//               unit's init (0x5050a6b2) natively before the first picture where the application's start did not run
//               them (camapp 3's H-IMGPROINIT does): REC's header clear asks the unit for a fill (below), whose end
//               comes as IRQ 300 (docs/hle-gaps.md 4.3.1)
//   H-RECIMAGE  REC_IMAGE (static task 28, 0x50541c45) started with act_tsk after REC_FILE (I: which call starts it is
//               not read); it waits on its queue REC_EXEC_IMAGE 70 (its id at 0x60043250; its receive 0x505398bf, 316
//               bytes) and handles each packet in its own task: rec_bracket_entry and _update (0x5053b1dc, 0x5053b39c:
//               FileType, ImgAspect, Free), rec_make_image_pre (0x50541db7), rec_make_image (0x50541e55) by Mode to
//               rec_make_image_exec (0x5054208e) and rec_jpeg_exec (0x505497e5: the buffer from REC's pool 3, the
//               header clear, whose aligned middle the imgpro unit fills (0x5048ee61, kind 14 mode 4, S-IMGPRO), the
//               encode (S-JPEGENC), rec_jpeg_make_header, BuffAddr1 / BuffSize1), rec_make_image_finish (0x50541ec5) to
//               0x505422f1, which hands the packet to REC_FILE through REC's ring (above), and pAlive's word cleared
//               (0x50541d5f), for each frame until rec_bracket_finish (0x5053b761) finds the last done
//   S-RECREQ    the request REC_IMAGE takes, where TAKE, api_rec, REC_MAIN and REC_PREPRO do not run: the packet as
//               REC_MAIN builds it (the fields below, every other 0 as its clear leaves it; ImgAspect left to
//               REC_IMAGE) with pAlive (+0) a word of the lab's, set to 1, posted to REC_IMAGE's queue with REC's post
//               0x5053990f as REC_PREPRO's task posts it after rec_precon_exec (0x5054edcf: the only post to that queue
//               on CPU 0, D); and the requester's side of REC_FILE's completion: with the packet's Free set
//               (REC_IMAGE's rec_bracket_update sets it, X) REC_FILE replies {Status, Number, Packet} to the
//               ObjResponse queue (0x5053984b from its handler, 0x5053f3bb), which no requester owns in the lab
//               (ObjResponse 0): the reply is taken there and answered as sent. Lab time runs until the reply and until
//               REC_IMAGE and REC_FILE wait on their inputs again. (S-RECIMAGE, REC_IMAGE's part in a lab call on E146
//               and E147, retired 2026-11-10: REC_IMAGE runs natively on all three, its rec_jpeg_exec in its own task:
//               the buffer from REC's pool 3 0x5054bb12, the header by rec_jpeg_make_header 0x50549bf1 with the EXIF
//               module's serializer 0x50429935, BuffAddr1 / BuffSize1 set at 0x50549a00; docs/hle-gaps.md 4.3.5)
//   S-JPEGENC   the image pipeline's work inside rec_jpeg_exec, where the lab has no image pipeline: the JPEG encode
//               rec_jpeg_make_image (0x50549b42) writes the lab's JPEG stream (src/lab/jpeg.mjs, without its JFIF
//               APP0: SOI, DQT, SOF0, DHT, SOS, the data, EOI) at Addr + HeaderSize and sets Size (+192; on E146 and
//               E147 the image record's +12) to HeaderSize + the stream's length (I: the file's size, as REC_FILE
//               writes BuffSize1 bytes from BuffAddr1); the header maker, which runs after the encode (0x505498ab, then
//               0x505498c3), ends its XMP segment 2 bytes past HeaderSize and writes them (X: 0a 00), over the stream's
//               SOI (I: the camera's encoder, too, writes a whole JPEG there). Natively rec_jpeg_make_image builds an
//               imgpro_mdl request (rec_ImgPro_CreateParam 0x50542363), creates it (0x50491699), sets its images
//               (rec_ImgPro_ImageParam 0x50542528), runs it (0x50542407: 0x50492758, 0x504929e9) and reads the result
//               (rec_ImgPro_Jpeg_Result 0x50542ce1): run natively on E143 it divides by zero inside
//               rec_ImgPro_ImageParam (0x505099e0, from 0x50509ac9: a geometry record's +4 and +6 are 0) before any
//               request to a pixel unit (X; docs/hle-gaps.md 4.3.3). (Until 2026-11-10 on E146 and E147 also the
//               header clear's fill, which runs natively on the imgpro unit now that REC_IMAGE's task does, 4.3.5)
//
// REC_FILE then runs natively in its task: rec_file_destination_record (0x50540345) by RecordDevice bit 0 to
// rec_make_file (0x5053f294) and rec_file_record (0x5053fec0): the DCF open of the next number (0x5054a894), the
// cluster reservation (0x5054a9e3), the chain write (0x5054aa51), the directory entry (0x5054acea) and the registration
// (0x5054ae50), each a FILECLBK request; then the buffer freed to its pool (0x5054bbfd), the shot's DCF checkout
// (0x50540784 -> 0x5087e0de: no pending entry, 0xd01, REC's warning 0x1e001001: the media check-in, api 0x5040f2ec from
// the HLS side, does not run), and the release of the resources REC_MAIN would have taken (0x50540cac: 0x500044f2 with
// 101..104 refused, warnings 0x1e01500d). With Free (+302) 0 REC_FILE sends no completion: with it set it replies
// {Status, Number, Packet} to the ObjResponse queue (+32, 0x5053984b) and posts the HandleTarget's events (0x50025095,
// 0x5054059e..0x505405ae), which only a requester (TAKE through api_rec, which does not run) would take: REC_IMAGE
// sets Free, so S-RECREQ takes the reply (the events' 0x50025095 returns at once unless 0xa31f1d26 is 119, D).
import { FirmwareError, runtime, disasm, where } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { K_CFLUSH } from './menu.mjs';
import { MODEL_INFO, fact } from '../fw/model.mjs';
import { REC_FILE_E143, REC_IMAGE_E143 } from '../fw/facts.mjs';

export class RecError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// REC_FILE natively on a body that gives rec_native (src/fw/models.mjs), at the addresses and layouts the rule reads
// (fact 'rec_file', src/fw/facts.mjs recFile, with their evidence): E143's REC_FILE_E143 there, the EXIF init
// 0x504298bd with its cache flush's return 0x504298f6 (H-EXIFINIT), the template 0x62a6c358 (0x504298c6) and TAKE's
// copy of it to a shot 0x504298f9, REC's init 0x50539665 (H-RECINIT), REC_FILE 0x5053f1a4 with its flag 0x60043182,
// its queue 0x6004324e and its handler's return 0x5053f20d, REC_IMAGE's post of a packet (a0) to a queue (d0)
// 0x5053990f, rec_jpeg_exec 0x505497e5 and rec_jpeg_make_image 0x50549b42 (S-JPEGENC), the image engine's fill
// 0x5048ee61 and REC's header clear's call to it 0x5054c9da, the clock read 0x5012b7cd (fact 'recorder'), the date
// format 0x5012bd20 and the string copy 0x50003843, REC_FILE's file contexts (92 bytes) for Media and Media2
// 0x62a8c4e4 and 0x62a8c540. The bodies' differences (E146 and E147: the packet of 276 bytes with other offsets, the
// image's address and size in REC_IMAGE's image record, another EXIF parameter block's size and offsets past its
// tags) are the rule's values; docs/hle-gaps.md 4.8.10
export const REC_NATIVE = MODEL_INFO.rec_native === true;
// REC_IMAGE's task natively (H-RECSHARED, H-RECIMGPRO, H-RECIMAGE, S-RECREQ; docs/hle-gaps.md 4.3.3, 4.3.5), wherever
// REC_FILE runs natively, at the addresses the rule reads (fact 'rec_image', src/fw/facts.mjs recImage, with their
// evidence; E143's REC_IMAGE_E143 there, the values given here by hand before the rule):
//   task      REC_IMAGE: static task 28, its entry, the word that holds its queue's id (REC_EXEC_IMAGE 70; read by its
//             receive 0x50541c4e, by REC_PREPRO's post 0x5054edda and by the object-name list, which only names it)
//   shared    REC's shared objects' init (REC_MAIN_CPU2's start, 0x5053d5e4) and its done byte (0x5054dd19)
//   imgpro    the image library's IRQ attach, its id bitmap's clear and the imgpro unit's init (camapp.mjs
//             H-IMGPROINIT's three), run by H-RECIMGPRO where the application's start did not run them
//   reply     REC's reply to a packet's ObjResponse (a0 the packet, d0 the status) and REC_FILE's call of it at its
//             handler's end (the return 0x5053f3c0, after its completion 0x5054051e and with Free set, 0x5053f3a5)
//   alive     pAlive's offset in the packet (the dump's first field), which REC_IMAGE clears after its image
//             (0x50541d5f)
//   settings  the settings read (d0 the id, a0 0 the store, d1 0), TAKE's at each of the reads below
//   take      TAKE's fill of the shot's record from the settings store: [setting id, record offset, bytes] as it reads
//             each (0x503bbd26..0x503bbd98 the bracket, 0x503bc035..0x503bc044 the aspect)
export const recImageFacts = () => fact('rec_image', REC_IMAGE_E143);
// the shot's EXIF parameter block (S-EXIFPRM): the fields the lab writes are the rule's (exif: E143's the EXIF module's
// tag table at body 0x6058e0, {u16 tag, u16 type, u32 bytes, u32 offset}, gives DateTime 0x0132 +1364, DateTimeOriginal
// 0x9003 +4089, CreateDate 0x9004 +4109, DigitalZoomRatio 0xa404 +4228)
// the packet's fields (the dump 0x50541561's names: fact rec_file packet) and what S-RECREQ gives them; every other
// field 0, as REC_MAIN's clear leaves it (0x50539e89..0x50539f0e); ImgAspect REC_IMAGE sets from the record's aspect
const STILL = 4097;          // Mode: REC_MAIN's still (0x5053a349); REC_IMAGE makes its image
const NO_MEDIA = 0xFFFF;     // Media2: no second slot (0x5053dd14)
const CARD = 1;              // RecordDevice bit 0: the card (0x50540392, 0x50540418)
const JPEG = 1;              // FileType: the extension and DCF kind tables' index 1 (0x5053fee3; JPG, kind 1)
const SHOT = 1;              // HandleTarget: TAKE's shot id (I: the lab's one shot; 0x5053a41e accepts 1..117)
const JFIF_APP0 = 0xE0;
// REC_FILE's file context and its DCF block (src/lab/storage.mjs REC for the fnode's and dnode's fields): the same on
// E146 and E147 (D: rec_file_record stores the context's +78 and +52 as E143's does; X: their files' fnodes and
// folders read back through them match the card)
const CTX = { dcf: 8, fnode: 36, status: 84 }, DCF_STAMP = 16;
const SLICE_MS = 5, LIMIT_MS = 20000, WAI = 4;
// HeaderSize: rec_jpeg_make_header's (0x5054a5b9), and the header area rec_jpeg_exec reserves before the encode: its
// buffer's size estimate adds it (0x5054a7b3) and its clear covers it (0x5054986f); the encoder's stream follows it
// (I). E143's here; each body's is the rule's (jpeg.header: 41984 on E146 and E147 too)
export const HEADER = REC_FILE_E143.jpeg.header;
// the rule's facts for this model (E143's given at REC_FILE_E143); throws on a body without them
export const recFacts = () => fact('rec_file', REC_FILE_E143);

export class RecFile {
  // storage: src/lab/storage.mjs Storage (its session, its fnode and name layouts, the recorder's clock read)
  constructor(storage) {
    this.st = storage; this.s = storage.s; this.lab = storage.lab;
    this.R = recFacts();
    this.pictures = 0;
    this.started = false;
    this.image = recImageFacts();  // REC_IMAGE natively (the rule's facts)
    this.imgpro_init = false;      // H-RECIMGPRO run (the application's start had not run the image library's init)
    this.images = [];              // each picture's REC_IMAGE run {task, encoded, reply, alive, fills, take}
  }
  get header() { return this.R.jpeg.header; }
  // whether H-RECIMGPRO runs (or ran) at the first picture: where camapp 3's H-IMGPROINIT did not run at the start
  imgpro_by_rec() { return !this.s.camapp?.imgpro_inited; }
  // H-EXIFINIT, H-RECINIT, H-RECSHARED, H-RECIMGPRO, H-RECFILE, H-RECIMAGE, at the first picture (I: in the lab nothing
  // reads REC's or the EXIF module's state before it, as TAKE, REC_MAIN and REC_PREPRO do not run; at the bring-up
  // they would shift every later session's instruction counts for no change the firmware sees)
  bring_up() {
    this.started = true;
    const lab = this.lab, R = this.R, X = R.exif, I = this.image;
    lab.wrap(K_CFLUSH, (prev) => (h, r) => disasm(r.mdr) === X.cflush ? h.finish(r) : prev(h, r), 'K-CFLUSH');
    lab.call(X.init, null, null, null, 2000000);
    const make = this.text(X.template + X.tags.make, 24);
    if (!make) throw new RecError(`H-EXIFINIT: the EXIF template ${h8(X.template)} has no Make after the init`);
    lab.call(R.init, null, null, null, 2000000);
    this.s.settle('H-RECINIT');
    lab.call(I.shared.init, null, null, null, 2000000);
    if (lab.sim.read(I.shared.done, 1)[0] !== 1) throw new RecError(`H-RECSHARED: REC's shared init ${h8(I.shared.init)} left its done byte ${h8(I.shared.done)} unset`);
    if (this.imgpro_by_rec()) {
      const unit = lab.sim.m.devices.imgpro;
      if (!unit) throw new RecError('H-RECIMGPRO: the board has no imgpro unit (src/fw/board.mjs imgpro)');
      for (const fn of I.imgpro) lab.call(fn, null, null, null, 200000);
      if (unit.powered || unit.runs) throw new RecError(`H-RECIMGPRO: the unit's init left it ${unit.powered ? 'powered' : 'with a run'}`);
      this.imgpro_init = true;
    }
    lab.lt.allow.add(R.task.entry);
    const [rc] = lab.nk.svc('act_tsk', { d0: R.task.id });
    if (rc !== 0) throw new RecError(`H-RECFILE: act_tsk(${R.task.id}) = ${rc}`);
    this.s.settle('H-RECFILE');
    if (!this.waiting()) throw new RecError(`H-RECFILE: REC_FILE (task ${R.task.id}) is not waiting on its flag after its start`);
    lab.lt.allow.add(I.task.entry);
    const [rc2] = lab.nk.svc('act_tsk', { d0: I.task.id });
    if (rc2 !== 0) throw new RecError(`H-RECIMAGE: act_tsk(${I.task.id}) = ${rc2}`);
    this.s.settle('H-RECIMAGE');
    if (!this.waiting(I.task.id)) throw new RecError(`H-RECIMAGE: REC_IMAGE (task ${I.task.id}) is not waiting on its queue after its start`);
    this.st.log.push(['rec', `EXIF template Make '${make}', REC_FILE (task ${R.task.id}) and REC_IMAGE (task ${I.task.id}) waiting`]);
  }
  text(a, n) { return String.fromCharCode(...this.lab.sim.read(a, n)).replace(/\0[\s\S]*$/, '').trimEnd(); }
  // a task waiting without a timeout (REC_FILE by default)
  waiting(t = this.R.task.id) {
    const lab = this.lab;
    return (lab.nk.state(t) & 0xF) === WAI && !lab.nk.timed_waiters().includes(t);
  }
  // S-EXIFPRM: the shot's EXIF parameter block; returns its address and the capture's clock record
  exif_param() {
    const lab = this.lab, sim = lab.sim, X = this.R.exif, D = X.date, x = lab.alloc(new Uint8Array(X.size), 64);
    lab.call(X.copy, { a0: x }, null, null, 2000000);
    lab.call(this.st.f.recorder.time, { a0: x + X.time }, null, null, 2000000);
    lab.call(D.format, { a0: x + D.original, a1: x + X.time, d0: D.code }, null, null, 2000000);
    for (const to of [D.created, D.modified]) lab.call(D.copy, { a0: x + to, a1: x + D.original }, null, null, 2000000);
    for (const at of X.crop) sim.write(x + at, pack('<HHHH', 0, 0, 1, 1));
    sim.write(x + X.tags.zoom, pack('<II', 1, 1));
    // the fields REC_IMAGE reads that TAKE's fill takes from the settings store, read as it reads them
    const take = {};
    for (const [id, at, n] of this.image.take) {
      const v = lab.call(this.image.settings, { d0: id, d1: 0, a0: 0 }, null, null, 2000000).d0 & (n === 1 ? 0xFF : 0xFFFF);
      sim.write(x + at, n === 1 ? Uint8Array.of(v) : pack('<H', v));
      take[id] = v;
    }
    const t = sim.read(x + X.time, 10);
    return { x, clock: { date: [t[0] | t[1] << 8, t[2], t[3], t[4], t[5], t[6]], status: t[8] | t[9] << 8 }, date: this.text(x + D.original, 20), take };
  }
  // The picture's file from the lab's JPEG (a JFIF file, src/lab/jpeg.mjs): S-EXIFPRM, then S-RECREQ and REC_IMAGE
  // natively with S-JPEGENC, then REC_FILE natively. Returns the file's record {path, size, folder, number, cluster,
  // stamp, clock, header, date}
  record(jpeg) {
    const lab = this.lab, sim = lab.sim, R = this.R, P = R.packet.fields, who = 'S-RECREQ';
    if (!this.started) this.bring_up();
    if (!this.waiting()) throw new RecError(`${who}: REC_FILE (task ${R.task.id}) is not waiting on its flag`);
    if (!this.waiting(this.image.task.id)) throw new RecError(`${who}: REC_IMAGE (task ${this.image.task.id}) is not waiting on its queue`);
    const stream = encoderStream(jpeg);
    const { x, clock, date, take } = this.exif_param();
    const pk = lab.alloc(new Uint8Array(R.packet.size), 4);
    const put = (field, fmt, v) => sim.write(pk + P[field], pack(fmt, v));
    put('pExifParam', '<I', x); put('HandleTarget', '<I', SHOT); put('Mode', '<H', STILL); put('Media', '<H', 0);
    put('Media2', '<H', NO_MEDIA); put('RecordDevice', '<H', CARD); put('FileType', '<B', JPEG);
    const { header, size } = this.image_native(pk, stream, take);
    // the file, from REC_FILE's context for Media (its fnode and folder, storage.mjs REC's layouts)
    const ctx = R.contexts[0], F = this.st.rec_layout(), fn = sim.u32(ctx + CTX.fnode) >>> 0, dn = fn ? sim.u32(fn + F.f.dnode) >>> 0 : 0;
    if (!fn || !dn) throw new RecError(`REC_FILE: its context ${h8(ctx)} holds fnode ${h8(fn)}, folder ${h8(dn)}`);
    const w16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; }, names = this.st.f.names;
    const file = {
      path: `${names.drive}:\\DCIM\\${this.text(dn + F.d.name, 11)}\\${this.text(fn + F.f.name, 8)}.${this.text(fn + F.f.ext, 4)}`,
      size: sim.u32(fn + F.f.size) >>> 0, folder: w16(dn + F.d.number), number: w16(fn + F.f.number),
      cluster: sim.u32(fn + F.f.cluster) >>> 0, stamp: sim.u32((sim.u32(ctx + CTX.dcf) >>> 0) + DCF_STAMP) >>> 0, clock, header, date,
    };
    if (file.size !== size) throw new RecError(`REC_FILE: the fnode's size ${file.size}, the packet's ${size}`);
    this.pictures += 1;
    return file;
  }
  // S-RECREQ's post of the packet pk to REC_IMAGE's queue (REC_PREPRO's post; on E146 and E147 REC_RAWNR's),
  // REC_IMAGE's task natively with S-JPEGENC's encode (the lab's stream), REC_FILE natively, S-RECREQ's reply taken;
  // lab time runs until the reply and both tasks wait again. Returns {header, size} as REC_FILE's packet has them at
  // its reply
  image_native(pk, stream, take) {
    const lab = this.lab, sim = lab.sim, R = this.R, J = R.jpeg, P = R.packet.fields, I = this.image, who = 'S-RECREQ';
    const imgpro = lab.sim.m.devices.imgpro, runs0 = imgpro?.runs ?? 0;
    const alive = lab.alloc(new Uint8Array(4), 4);
    sim.write(alive, pack('<I', 1));
    sim.write(pk + I.alive, pack('<I', alive));
    const u32 = (p, f) => sim.u32(p + P[f]) >>> 0;
    // S-JPEGENC: the encode, in REC_IMAGE's task, for this packet only (the header maker runs after it); the image's
    // address and size are the packet's, or where the body keeps them in REC_IMAGE's image record (E146, E147), the
    // record's the packet points at
    const run = { task: null, encoded: 0, addr: null, reply: null }, M = J.image;
    lab.hook(J.make_image, (h, r) => {
      const at = r.a0 >>> 0, img = M.record ? sim.u32(at + M.record.at) >>> 0 : at, addr = sim.u32(img + M.addr) >>> 0;
      if (u32(at, 'pExifParam') !== u32(pk, 'pExifParam')) throw new RecError(`S-JPEGENC: rec_jpeg_make_image on a packet ${h8(at)} that is not S-RECREQ's`);
      sim.write(addr + J.header, stream);
      sim.write(img + M.size, pack('<I', J.header + stream.length));
      run.encoded += 1; run.addr = addr;
      run.task = lab.lt.current() === lab.nk.tcb(I.task.id) ? I.task.id : null;
      h.finish(r, { d0: 0 });
    }, 'S-JPEGENC');
    // S-RECREQ: REC_FILE's reply at its handler's end, taken as the requester would take it
    lab.hook(I.reply.fn, (h, r) => {
      if (disasm(r.mdr) !== I.reply.from) throw new RecError(`S-RECREQ: REC's reply ${h8(I.reply.fn)} from ${where(r.mdr)}: only REC_FILE's (return ${h8(I.reply.from)}) is taken`);
      const p = r.a0 >>> 0;
      run.reply = { status: r.d0 & 0xFFFF, header: u32(p, 'HeaderSize'), addr: u32(p, 'BuffAddr1'), size: u32(p, 'BuffSize1'), aspect: sim.read(p + P.ImgAspect, 1)[0], free: sim.read(p + P.Free, 1)[0] };
      h.finish(r, { d0: 1 });
    }, 'S-RECREQ');
    try {
      const q = sim.read(I.task.queue, 2), r = lab.call(R.packet.post, { a0: pk, d0: q[0] | q[1] << 8 }, null, null, 2000000);
      if (r.d0 !== 1) throw new RecError(`${who}: the post ${h8(R.packet.post)} to REC_IMAGE's queue returned ${r.d0 | 0}`);
      const t0 = lab.lab_time();
      for (;;) {
        this.s.settle(`${who} REC_IMAGE`);
        if (run.reply && this.waiting() && this.waiting(I.task.id)) break;
        if (lab.lab_time() - t0 > LIMIT_MS * 1e6) throw new RecError(`${who}: no reply from REC_FILE after ${LIMIT_MS} ms of lab time (REC_IMAGE state 0x${lab.nk.state(I.task.id).toString(16)}, encoded ${run.encoded})`);
        lab.elapse(SLICE_MS, `${who} REC_IMAGE`);
      }
    } finally { lab.hooks.delete(runtime(J.make_image)); lab.hooks.delete(runtime(I.reply.fn)); }
    const y = run.reply, fills = (imgpro?.log ?? []).filter((f) => f.n > runs0);
    const record = { task: run.task, encoded: run.encoded, reply: y, alive: sim.u32(alive) >>> 0, fills: fills.map((f) => ({ mode: f.mode, dst: f.dst, bytes: f.bytes, rows: f.rows, value: f.value })), take };
    this.images.push(record);
    if (run.encoded !== 1 || run.task !== I.task.id || y.status !== 0 || y.header !== J.header || y.addr !== run.addr || y.size !== y.header + stream.length || record.alive !== 0) {
      throw new RecError(`${who}: REC_IMAGE encoded ${run.encoded} times${run.task === I.task.id ? ' in its task' : ''}, REC_FILE replied status 0x${y.status.toString(16)}, HeaderSize ${y.header}, BuffAddr1 ${h8(y.addr)} (the encode's ${h8(run.addr)}), BuffSize1 ${y.size} (the stream ${stream.length} bytes), pAlive ${record.alive}`);
    }
    return { header: y.header, size: y.size };
  }
}
// The stand-ins a RecFile uses (src/lab/player.mjs's list), with REC_IMAGE natively (H-RECIMGPRO where the
// application's start did not run the image library's init)
export function recStandIns(rec) {
  return ['H-EXIFINIT', 'H-RECINIT', 'H-RECSHARED', ...(rec.imgpro_by_rec() ? ['H-RECIMGPRO'] : []), 'H-RECFILE', 'H-RECIMAGE', 'S-EXIFPRM', 'S-RECREQ', 'S-JPEGENC'];
}
// The lab's JPEG as the encoder's stream: without the JFIF APP0 that follows its SOI (the file's APPn segments are the
// header's)
export function encoderStream(jpeg) {
  if (jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) throw new RangeError('encoderStream: no SOI');
  if (jpeg[2] !== 0xFF || jpeg[3] !== JFIF_APP0) return jpeg;
  const end = 4 + (jpeg[4] << 8 | jpeg[5]);
  const out = new Uint8Array(jpeg.length - (end - 2));
  out.set(jpeg.subarray(0, 2)); out.set(jpeg.subarray(end), 2);
  return out;
}
