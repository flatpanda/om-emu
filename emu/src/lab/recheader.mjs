// The E118 family's picture header natively (src/fw/models.mjs exif_native: E122, E118, E120; docs/model-survey.md
// findings 102 to 105): the file S-RECFILE writes (src/lab/storage.mjs) is the header REC_IMAGE's own header maker
// builds and the lab's JPEG stream after it, as rec_jpeg_exec leaves the file's buffer for REC_FILE. Every address
// and offset is the one the rule reads in the body's firmware (fact 'rec_header', src/fw/facts.mjs recHeader, with
// E122's as its evidence; this file names no address, src/lab's literals being E143's: bin/port.mjs). The offsets
// below are E122's; E118's and E120's packet is 280 bytes with pExifParam +188, Addr +264 and HeaderSize +260, their
// EXIF parameter blocks 20084 and 20004 bytes with the time record at +18340 and +18284 (D).
//
//   H-EXIFINIT  (as on E143) the EXIF module's init (exif.init; its one caller is the start function's, which the lab
//               does not run) natively before the first picture: the EXIF parameter template (exif.template, 22080
//               bytes) with its Make and Model (X: 'OLYMPUS CORPORATION' and 'PEN-F' after it on E122). The family's
//               template init has no cache flush (it ends in three stores), so nothing is answered
//   S-EXIFPRM   (as on E143) the shot's EXIF parameter block (the packet's pExifParam, +124), which TAKE fills on the
//               camera (I, as on E143; the template's copy has three callers, not read) and the lab does not run: the
//               template copied by that copy (exif.copy) natively, the camera's clock read natively (clock.read, the
//               function after the clock setting clock.set) into the capture's time record (+18404, I: TAKE's, as on
//               E143; the EXIF set formats the dates from there), and the dates formatted natively as the EXIF set
//               does (exif.date: the format 0x4200 into DateTimeOriginal +2313, copied to CreateDate +2333 and
//               DateTime +1364). The EXIF set itself does not run: called natively on the block it divides by zero in
//               TAKE's state (X; docs/model-survey.md finding 103), so exposure, aperture, ISO, focal length and the
//               image size stay the template's (0). No record is set for the header maker to divide by: it divides
//               by none of the block's zeros (X, the three)
//   S-RECHDR    rec_jpeg_exec around its header maker (jpeg.exec, REC_IMAGE's: REC's pools, REC_MAIN and the image
//               pipeline do not run in the lab): the packet as rec_jpeg_exec hands it to rec_jpeg_make_header (Mode
//               +68 4097, the still that rec_make_image sends to rec_make_image_exec and rec_jpeg_exec, D; pExifParam
//               the block; Addr +200 the file's buffer; every other field 0, as no stage the lab runs sets it, I), the
//               buffer the lab's (a fresh allocation, 0 but for the stream; whether REC's pool buffer is cleared before
//               the header is written is not read, ?), with the encoder's stream after the header area (the lab's JPEG
//               without its JFIF APP0 at Addr + 41984, I: where the header maker's APP1 ends, as S-JPEGENC places it
//               on E143); then rec_jpeg_make_header (jpeg.make_header) natively, which writes HeaderSize (+196,
//               41984), SOI, APP1 Exif of 41982 bytes and the EXIF module's TIFF data in it (its serializer: IFD0, the
//               Exif IFD with the Olympus maker notes, IFD1's thumbnail slot of length 0; X, refs/exif.mjs). The file
//               is the buffer's HeaderSize bytes and the stream after them, the stream's SOI under APP1's last 2 bytes
//               (41984..41985, as on E143, I: the camera's encoder, too, writes a whole JPEG there)
import { FirmwareError } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { MODEL, MODEL_INFO, fact } from '../fw/model.mjs';
import { encoderStream } from './rec.mjs';

export class RecHeaderError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// whether the body's MODELS entry gives exif_native; recHeaderFacts, the facts the rule reads (throws for none)
export const EXIF_NATIVE = MODEL_INFO.exif_native === true;
export const recHeaderFacts = () => {
  const f = fact('rec_header', null);
  if (!f) throw new RecHeaderError(`${MODEL}: src/fw/models.mjs exif_native, but src/fw/facts.mjs recHeader reads no header maker`);
  return f;
};
const STILL = 4097;          // Mode: the still (rec_make_image -> rec_make_image_exec -> rec_jpeg_exec, D: finding 102)
const SOI = [0xFF, 0xD8], APP1 = [0xFF, 0xE1], EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0];
const CALL_LIMIT = 20000000;

export class RecHeader {
  // storage: src/lab/storage.mjs Storage (its session)
  constructor(storage) {
    this.st = storage; this.s = storage.s; this.lab = storage.lab;
    this.R = recHeaderFacts();
    this.started = false;
    this.headers = [];             // each picture's {header, make, model, date, clock}
  }
  get header() { return this.R.jpeg.header; }
  text(a, n) { return String.fromCharCode(...this.lab.sim.read(a, n)).replace(/\0[\s\S]*$/, '').trimEnd(); }
  // H-EXIFINIT, at the first picture (I: in the lab nothing reads the EXIF module's state before it, as TAKE and REC
  // do not run; at the bring-up it would shift every later session's instruction counts for no change the firmware
  // sees)
  bring_up() {
    this.started = true;
    const X = this.R.exif;
    this.lab.call(X.init, null, null, null, CALL_LIMIT);
    const make = this.text(X.template + X.tags.make, 24);
    if (!make) throw new RecHeaderError(`H-EXIFINIT: the EXIF template ${h8(X.template)} has no Make after the init ${h8(X.init)}`);
    this.st.log.push(['exif', `EXIF template Make '${make}', Model '${this.text(X.template + X.tags.model, 24)}'`]);
  }
  // S-EXIFPRM: the shot's EXIF parameter block; returns its address, the capture's clock record and the date
  exif_param() {
    const lab = this.lab, sim = lab.sim, X = this.R.exif, D = X.date, x = lab.alloc(new Uint8Array(X.size), 64);
    lab.call(X.copy, { a0: x }, null, null, CALL_LIMIT);
    lab.call(this.R.clock.read, { a0: x + X.time }, null, null, CALL_LIMIT);
    lab.call(D.format, { a0: x + D.original, a1: x + X.time, d0: D.code }, null, null, CALL_LIMIT);
    for (const to of [D.created, D.modified]) lab.call(D.copy, { a0: x + to, a1: x + D.original }, null, null, CALL_LIMIT);
    const t = sim.read(x + X.time, 10);
    return { x, clock: { date: [t[0] | t[1] << 8, t[2], t[3], t[4], t[5], t[6]], status: t[8] | t[9] << 8 }, date: this.text(x + D.original, 20) };
  }
  // The picture's file from the lab's JPEG (a JFIF file, src/lab/jpeg.mjs): S-EXIFPRM, then S-RECHDR with the header
  // maker natively. Returns the file's bytes (the header, then the stream)
  file(jpeg) {
    if (!this.started) this.bring_up();
    const lab = this.lab, sim = lab.sim, R = this.R, P = R.packet.fields, H = R.jpeg.header, who = 'S-RECHDR';
    const stream = encoderStream(jpeg);
    const { x, clock, date } = this.exif_param();
    const pk = lab.alloc(new Uint8Array(R.packet.size), 4), buf = lab.alloc(new Uint8Array(H + stream.length), 64);
    sim.write(buf + H, stream);
    sim.write(pk + P.Mode, pack('<H', STILL));
    sim.write(pk + P.pExifParam, pack('<I', x));
    sim.write(pk + P.Addr, pack('<I', buf));
    lab.call(R.jpeg.make_header, { a0: pk }, null, null, CALL_LIMIT);
    const size = sim.u32(pk + P.HeaderSize) >>> 0, head = sim.read(buf, 12);
    const at = (o, b) => b.every((v, k) => head[o + k] === v);
    if (size !== H || !at(0, SOI) || !at(2, APP1) || !at(6, EXIF)) {
      throw new RecHeaderError(`${who}: rec_jpeg_make_header ${h8(R.jpeg.make_header)} left HeaderSize ${size} (want ${H}) and the buffer's head ${[...head].map((v) => v.toString(16).padStart(2, '0')).join(' ')} (want SOI, APP1 Exif)`);
    }
    const make = this.text(x + R.exif.tags.make, 24), model = this.text(x + R.exif.tags.model, 24);
    this.headers.push({ header: size, make, model, date, clock });
    this.st.log.push(['exif', `header ${size} bytes by rec_jpeg_make_header: Make '${make}', Model '${model}', dated '${date}'`]);
    return sim.read(buf, H + stream.length);
  }
}
// The stand-ins a RecHeader uses (src/lab/player.mjs's list)
export const recHeaderStandIns = () => ['H-EXIFINIT', 'S-EXIFPRM', 'S-RECHDR'];
