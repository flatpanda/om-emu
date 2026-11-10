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
// flag 265 (0x60043182): bit 2 the queue (its receive 0x5054dd40, 316 bytes, then the handler 0x5053f354), bit 0 a
// second input (0x5054ebc8; not read further). E146 and E147 (D): the packet is 276 bytes with other offsets (their
// dump's), and REC_IMAGE keeps the image's address and size not in it but in an image record of 52 bytes that the
// packet's +180 points at; REC_FILE is task 27 there too.
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
//               focal length, the lens and the image size stay the template's (0)
//   S-RECIMAGE  REC_IMAGE's part (its task does not run: its image needs the image pipeline): the packet as REC_IMAGE
//               hands a single-slot JPEG to REC_FILE (the fields below), REC_IMAGE's rec_jpeg_exec (0x505497e5) run
//               natively on it, which allocates the file's buffer from REC's pool 3 (0x5054bb12), clears the header
//               area, has the image made (S-JPEGENC), builds the header with rec_jpeg_make_header (0x50549bf1: the EXIF
//               parameters, SOI, APP1 Exif by the EXIF module's serializer 0x50429935 with its Olympus maker notes and
//               IFD1's thumbnail slot, APP1 XMP; HeaderSize 41984) and sets BuffAddr1 / BuffSize1 to Addr / Size
//               (0x50549a00); then REC_IMAGE's post 0x5053990f natively, and lab time runs until REC_FILE has handled
//               the packet (its handler's return, 0x5053f20d). On E146 and E147 the image record first: REC_IMAGE's
//               own init of it (D: it clears the record, sets its +48 and points the packet's +180 at it) on a record
//               the lab allocates, where REC_IMAGE's task keeps it on its stack
//   S-JPEGENC   the image pipeline's work inside rec_jpeg_exec, where the lab has no image pipeline: the JPEG encode
//               rec_jpeg_make_image (0x50549b42, an imgpro_mdl request 0x50491699) writes the lab's JPEG stream
//               (src/lab/jpeg.mjs, without its JFIF APP0: SOI, DQT, SOF0, DHT, SOS, the data, EOI) at Addr + HeaderSize
//               and sets Size (+192; on E146 and E147 the image record's +12) to HeaderSize + the stream's length (I:
//               the file's size, as REC_FILE writes
//               BuffSize1 bytes from BuffAddr1); the header maker, which runs after the encode (0x505498ab, then
//               0x505498c3), ends its XMP segment 2 bytes past HeaderSize and writes them (X: 0a 00), over the stream's
//               SOI (I: the camera's encoder, too, writes a whole JPEG there); and the image engine's fill 0x5048ee61
//               of the header area (called from 0x5054c9d3), a kind 14 request to the imgpro unit 0x9c600000: 0 into
//               the aligned middle, as its caller fills the head and tail itself (0x5054c982). The unit's model
//               (S-IMGPRO, docs/hle-gaps.md 4.3.1) computes the fill, but the request waits for the unit's end, which
//               rec_jpeg_exec run here, outside REC_IMAGE's task, cannot (X under camapp 3: all tasks blocked)
//
// REC_FILE then runs natively in its task: rec_file_destination_record (0x50540345) by RecordDevice bit 0 to
// rec_make_file (0x5053f294) and rec_file_record (0x5053fec0): the DCF open of the next number (0x5054a894), the
// cluster reservation (0x5054a9e3), the chain write (0x5054aa51), the directory entry (0x5054acea) and the registration
// (0x5054ae50), each a FILECLBK request; then the buffer freed to its pool (0x5054bbfd), the shot's DCF checkout
// (0x50540784 -> 0x5087e0de: no pending entry, 0xd01, REC's warning 0x1e001001: the media check-in, api 0x5040f2ec from
// the HLS side, does not run), and the release of the resources REC_MAIN would have taken (0x50540cac: 0x500044f2 with
// 101..104 refused, warnings 0x1e01500d). With Free (+302) 0 REC_FILE sends no completion: with it set it replies
// {Status, Number, Packet} to the ObjResponse queue (+32, 0x5053984b) and posts the HandleTarget's events (0x50025095,
// 0x5054059e..0x505405ae), which only a requester (TAKE through api_rec, which does not run) would take.
import { FirmwareError, runtime, disasm, where } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { K_CFLUSH } from './menu.mjs';
import { MODEL_INFO, fact } from '../fw/model.mjs';
import { REC_FILE_E143 } from '../fw/facts.mjs';

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
// the shot's EXIF parameter block (S-EXIFPRM): the fields the lab writes are the rule's (exif: E143's the EXIF module's
// tag table at body 0x6058e0, {u16 tag, u16 type, u32 bytes, u32 offset}, gives DateTime 0x0132 +1364, DateTimeOriginal
// 0x9003 +4089, CreateDate 0x9004 +4109, DigitalZoomRatio 0xa404 +4228)
// the packet's fields (the dump 0x50541561's names: fact rec_file packet) and what S-RECIMAGE gives them; every other
// field 0, as REC_MAIN's clear leaves it (0x50539e89..0x50539f0e)
const STILL = 4097;          // Mode: REC_MAIN's still (0x5053a349); REC_IMAGE makes its image
const NO_MEDIA = 0xFFFF;     // Media2: no second slot (0x5053dd14)
const CARD = 1;              // RecordDevice bit 0: the card (0x50540392, 0x50540418)
const JPEG = 1;              // FileType: the extension and DCF kind tables' index 1 (0x5053fee3; JPG, kind 1)
const SHOT = 1;              // HandleTarget: TAKE's shot id (I: the lab's one shot; 0x5053a41e accepts 1..117)
const ASPECT = 1;            // ImgAspect (?: which aspect 1 names is not read)
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
    this.handled = null;           // the last packet's status at REC_FILE's handler return
    this.pictures = 0;
    this.started = false;
  }
  get header() { return this.R.jpeg.header; }
  // H-EXIFINIT, H-RECINIT, H-RECFILE, at the first picture (I: in the lab nothing reads REC's or the EXIF module's
  // state before it, as TAKE, REC_MAIN and REC_IMAGE do not run; at the bring-up they would shift every later session's
  // instruction counts for no change the firmware sees)
  bring_up() {
    this.started = true;
    const lab = this.lab, R = this.R, X = R.exif;
    lab.wrap(K_CFLUSH, (prev) => (h, r) => disasm(r.mdr) === X.cflush ? h.finish(r) : prev(h, r), 'K-CFLUSH');
    lab.call(X.init, null, null, null, 2000000);
    const make = this.text(X.template + X.tags.make, 24);
    if (!make) throw new RecError(`H-EXIFINIT: the EXIF template ${h8(X.template)} has no Make after the init`);
    lab.call(R.init, null, null, null, 2000000);
    this.s.settle('H-RECINIT');
    lab.lt.allow.add(R.task.entry);
    const [rc] = lab.nk.svc('act_tsk', { d0: R.task.id });
    if (rc !== 0) throw new RecError(`H-RECFILE: act_tsk(${R.task.id}) = ${rc}`);
    this.s.settle('H-RECFILE');
    if (!this.waiting()) throw new RecError(`H-RECFILE: REC_FILE (task ${R.task.id}) is not waiting on its flag after its start`);
    this.st.log.push(['rec', `EXIF template Make '${make}', REC_FILE (task ${R.task.id}) waiting`]);
  }
  text(a, n) { return String.fromCharCode(...this.lab.sim.read(a, n)).replace(/\0[\s\S]*$/, '').trimEnd(); }
  waiting() {
    const lab = this.lab, t = this.R.task.id;
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
    const t = sim.read(x + X.time, 10);
    return { x, clock: { date: [t[0] | t[1] << 8, t[2], t[3], t[4], t[5], t[6]], status: t[8] | t[9] << 8 }, date: this.text(x + D.original, 20) };
  }
  // The picture's file from the lab's JPEG (a JFIF file, src/lab/jpeg.mjs): S-EXIFPRM, S-RECIMAGE with S-JPEGENC, then
  // REC_FILE natively. Returns the file's record {path, size, folder, number, cluster, stamp, clock, header, date}
  record(jpeg) {
    const lab = this.lab, sim = lab.sim, R = this.R, J = R.jpeg, I = J.image, P = R.packet.fields, who = 'S-RECIMAGE';
    if (!this.started) this.bring_up();
    if (!this.waiting()) throw new RecError(`${who}: REC_FILE (task ${R.task.id}) is not waiting on its flag`);
    const stream = encoderStream(jpeg);
    const { x, clock, date } = this.exif_param();
    const pk = lab.alloc(new Uint8Array(R.packet.size), 4);
    const put = (field, fmt, v) => sim.write(pk + P[field], pack(fmt, v));
    put('pExifParam', '<I', x); put('HandleTarget', '<I', SHOT); put('Mode', '<H', STILL); put('Media', '<H', 0);
    put('Media2', '<H', NO_MEDIA); put('RecordDevice', '<H', CARD); put('ImgAspect', '<B', ASPECT); put('FileType', '<B', JPEG);
    // REC_IMAGE's image record where the body keeps the image's address and size there (E146, E147): REC_IMAGE's own
    // init of it, which clears it and points the packet at it
    if (I.record) lab.call(I.record.init, { a0: pk, a1: lab.alloc(new Uint8Array(I.record.bytes), 4) }, null, null, 2000000);
    const image = () => (I.record ? sim.u32(pk + I.record.at) >>> 0 : pk);
    // S-JPEGENC: the encode and the header area's fill, for this run of rec_jpeg_exec only
    let encoded = 0;
    lab.hook(J.make_image, (h, r) => {
      const at = image(), addr = sim.u32(at + I.addr) >>> 0;   // (the header maker runs after the encode)
      sim.write(addr + J.header, stream);
      sim.write(at + I.size, pack('<I', J.header + stream.length));
      encoded += 1;
      h.finish(r, { d0: 0 });
    }, 'S-JPEGENC');
    lab.hook(J.fill, (h, r) => {
      if (disasm(r.mdr) !== J.fill_return) throw new RecError(`S-JPEGENC: the image engine's fill ${h8(J.fill)} from ${where(r.mdr)}: only REC's header clear (return ${h8(J.fill_return)}) is stood in`);
      sim.write(r.a0 >>> 0, new Uint8Array(r.d0 >>> 0).fill(r.d1 & 0xFF));
      h.finish(r, { d0: 0 });
    }, 'S-JPEGENC');
    try { lab.call(J.exec, { a0: pk }, null, null, 2000000); } finally {
      lab.hooks.delete(runtime(J.make_image)); lab.hooks.delete(runtime(J.fill));
    }
    const u32 = (f) => sim.u32(pk + P[f]) >>> 0, u16 = (f) => { const b = sim.read(pk + P[f], 2); return b[0] | b[1] << 8; };
    const header = u32('HeaderSize'), addr = sim.u32(image() + I.addr) >>> 0, size = u32('BuffSize1');
    if (encoded !== 1 || u16('Status') !== 0 || header !== J.header || u32('BuffAddr1') !== addr || size !== header + stream.length) {
      throw new RecError(`${who}: rec_jpeg_exec left Status 0x${u16('Status').toString(16)}, HeaderSize ${header}, Addr ${h8(addr)}, BuffAddr1 ${h8(u32('BuffAddr1'))}, BuffSize1 ${size} (the stream ${stream.length} bytes, encoded ${encoded} times)`);
    }
    // REC_IMAGE's post, then REC_FILE's handling, observed at its handler's return
    this.handled = null;
    lab.observe(R.task.handled, (l, r) => { this.handled = r.d0 & 0xFFFF; }, 'obs-rec-file');
    try {
      const q = sim.read(R.task.queue, 2), r = lab.call(R.packet.post, { a0: pk, d0: q[0] | q[1] << 8 }, null, null, 2000000);
      if (r.d0 !== 1) throw new RecError(`${who}: the post ${h8(R.packet.post)} to REC_FILE's queue returned ${r.d0 | 0}`);
      const t0 = lab.lab_time();
      for (;;) {
        this.s.settle(`${who} REC_FILE`);
        if (this.handled !== null && this.waiting()) break;
        if (lab.lab_time() - t0 > LIMIT_MS * 1e6) throw new RecError(`${who}: REC_FILE has not handled the packet after ${LIMIT_MS} ms of lab time`);
        lab.elapse(SLICE_MS, `${who} REC_FILE`);
      }
    } finally { lab.hooks.delete(runtime(R.task.handled)); }
    if (this.handled !== 0) throw new RecError(`REC_FILE: the packet's status 0x${this.handled.toString(16)}`);
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
