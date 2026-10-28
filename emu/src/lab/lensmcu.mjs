// S-LENSMCU: the lens's own microcontroller at the far end of the lens serial controller (src/dev/lensssc.mjs;
// docs/hle-gaps.md 4.4.2, the evidence), a model of the frames the body's lens driver sends and of the replies its
// parsers read. The lens is the one S-LENS stood for, the M.Zuiko 12-40mm F2.8 PRO (LENS_1240): its identity, name,
// focal lengths and apertures are the values S-LENS wrote into the driver's record (I: the lens's published
// specification), now carried by the protocol's replies; a field the lab has no value for is 0 (A-LENSMCU-1). This
// module needs no firmware (the tests).
//
// The seam (what a later model of the lens's firmware puts in its place): frame(f) -> the reply's bytes on the wire
// (or null for none), f = {cls, code, p1, p2, tx, mode, count, dma} as the controller sees the frame: its header's class,
// code and two parameter bytes, its data bytes, the mode word, the packet's count and whether the reply goes by DMA.
// A frame the model does not know throws a LensError naming it; the controller stops the session there.
//
// The protocol (D unless tagged; the body's addresses, E143): the lens driver turns a request (type, command id,
// sub-code) into a frame: type 6 requests through the table 0x602f33bc (0x502ba920: command id -> class and code, the
// class 0xc0 or 0xc1 and 0xb0 or 0xb1 by the lens's protocol version, 0x502af723, and its block mode, 0x502ac8b4; the
// sub-code's two bytes the header's parameters), type 5 and type 3 through their own builders (0x502ba64e,
// 0x502b861d). The reply of a frame of class 0x8x or 0xcx carries one byte more than its parser reads (the driver
// takes the controller's count less one, 0x502c1ea7; I: a check byte, its value ? and unread: 0 here). The parsers by
// command id are dispatched at 0x502bacaf; multi-byte fields are little-endian (0x5012b3e3, 0x5012b3fb). The frames
// the lens's start sends, in order (X, docs/hle-gaps.md 4.4.2):
//   (initial)  header 0, mode 7: the wake-up (0x502c545b), no reply
//   b0 f2      type 5 (0x502ba64e, code 0xf2 for its first form): no reply is parsed (0x502ba7d9)
//   c0 f6      id 1: u16 the protocol version (0x6296c924..: 0x0b0a is an old lens, read as 0x1000; bits 1 or 3 set
//              mark the newer protocol, 0x502af723), u16 the lens's serial clock (0x502c12a4 turns it into the
//              controller's divider; 500 gives the divider the driver starts with, 575) (0x502af357)
//   c0 f4      id 9: u16 a, u16 b: a > 1 and 0 < b < 13 put the lens in a block mode (0x502ac85f)
//   a0 f5      id 6, sub-code 1: no reply
//   c1 f9      id 3: the lens ID (6 bytes, 0x6296cd2e), 12 bytes (0x6296cd34; a serial number, I), u16 (0x6296cd40;
//              the lens firmware's version, I) (0x502af58d)
//   c1 02      id 80, sub-code 0: a count n of function words, n u32 (record +119096, +119104) (0x502b1522)
//   c3 f0      id 64: the lens's characteristics block (0x502affc2, below)
//   c2 f3      id 7: n records of 8 u32 and a u16 per zoom step, column by column (record +8256, 36 bytes each;
//              0x502acbd1)
//   c1 fe      id 71: (record +1140) x n bytes (record +9445; 0x502b0b7d), unless the lens ID is in the built-in table
//              0x60214d4c (13 lenses, 0x502b0bce)
//   81 e4      id 76: n u16 (record +11494; 0x502b114c), unless the ID is in 0x60216758 (6 lenses)
//   c1 01      id 77: 32 u16 (record +117810; 0x502b120a)
//   c1 2f      id 89: 2 bytes (record +117808; 0x502b10a9)
//   60 f0      type 3, command 101 with 5 data bytes: no reply
//   c1 80      id 69 (and 75): the lens's state (0x502b263d, below), polled from then on
// n is the zoom steps' count of the characteristics block. A-LENSMCU-1 (A): the lens's flags (record +1096), its
// function words and its tables beyond the characteristics S-LENS wrote are 0; so are its serial number and firmware
// version. A-LENSMCU-2 (A): the protocol version is 0x130a, the newest the driver tests for (0x50122ad9), with no block
// mode; which version the 12-40 reports is ?.
import { FirmwareError } from './errors.mjs';

export class LensError extends FirmwareError {}

const hx = (v, n = 2) => (v >>> 0).toString(16).padStart(n, '0');
export const frameName = (f) => `${hx(f.cls)} ${hx(f.code)} [${hx(f.p1)} ${hx(f.p2)}]${f.tx.length ? ` data ${Array.from(f.tx, (b) => hx(b)).join(' ')}` : ''}`;

// The lens (I: the 12-40mm F2.8 PRO's specification, as S-LENS had it): the ID S-LENS wrote (the lens table entry
// 0x1019, 0x506ea4f3), its name, the zoom steps' focal lengths in mm and the apertures as APEX x 256 (F2.8 761,
// F22 2283, the unit 0x5057379f converts), wide open and stopped down at every step
export const LENS_1240 = Object.freeze({
  id: [0x00, 0x00, 0x19, 0x10, 0x00, 0x00], name: '12-40mm F2.8 PRO',
  zoom: [12, 14, 17, 20, 25, 30, 35, 40], ap: [761, 2283],
  version: 0x130a, clock_khz: 500,
});

// a little-endian writer
class Out {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 0xff); return this; }
  u16(v) { this.b.push(v & 0xff, (v >>> 8) & 0xff); return this; }
  u32(v) { this.u16(v & 0xffff); this.u16(v >>> 16); return this; }
  bytes(a, n = a.length) { for (let i = 0; i < n; i++) this.u8(a[i] ?? 0); return this; }
  zeros(n) { for (let i = 0; i < n; i++) this.u8(0); return this; }
  done() { return Uint8Array.from(this.b); }
}
// A-LENSMCU-3 (A): one byte a zoom step in id 71's table (record +1140; the driver logs a frame of class 0xcx with no
// data as an error, 0x40, 0x502c1558, X: with 0 bytes a step the reply of c1 fe was refused)
const BYTES_PER_STEP = 1;
// the check byte the classes 0x8x and 0xcx carry after their data (0x502c1ea7; its value is ?, unread)
const CHECKED = (cls) => (cls & 0xf0) === 0xc0 || (cls & 0xf0) === 0x80;

export class LensMcu {
  constructor(lens = LENS_1240) {
    this.lens = lens;
    this.zoom = 0;                 // the zoom step the ring is at (S-SCENE's focal length, the nearest step)
    this.frames = [];              // every frame: [name, reply length]
    this.counts = new Map();       // frame name -> times seen
  }
  // the zoom ring set to the step nearest focal_mm; true when the step changed
  setFocal(focal_mm) {
    let z = 0;
    this.lens.zoom.forEach((fl, i) => { if (Math.abs(fl - focal_mm) < Math.abs(this.lens.zoom[z] - focal_mm)) z = i; });
    if (z === this.zoom) return false;
    this.zoom = z;
    return true;
  }
  focal() { return this.lens.zoom[this.zoom]; }
  frame(f) {
    const name = frameName(f), h = this.handler(f);
    if (!h) throw new LensError(`S-LENSMCU: the lens has no answer for the frame ${name} (mode ${f.mode}${f.dma ? ', DMA' : ''})`);
    const data = h.call(this, f);
    const reply = data === null ? null : CHECKED(f.cls) ? Uint8Array.from([...data, 0]) : data;
    this.frames.push([name, reply ? reply.length : 0]);
    const k = `${hx(f.cls)} ${hx(f.code)}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    return reply;
  }
  handler(f) {
    const { cls, code, p1, p2 } = f;
    if (cls === 0x00 && code === 0x00 && f.mode === 7) return () => null;                  // the wake-up
    if ((cls === 0xb0 || cls === 0xb1) && code === 0xf2) return () => null;                // type 5's first form
    if ((cls === 0xc0 || cls === 0xc1) && code === 0xf6) return this.version;              // id 1
    if ((cls === 0xc0 || cls === 0xc1) && code === 0xf4) return this.blockMode;            // id 9
    if (cls === 0xa0 && code === 0xf5 && p1 === 1 && p2 === 0) return () => null;          // id 6, sub-code 1
    if ((cls === 0xc0 || cls === 0xc1) && code === 0xf9) return this.identity;             // id 3
    if (cls === 0xc1 && code === 0x02 && p1 === 0 && p2 === 0) return this.functions;      // id 80, sub-code 0
    if (cls === 0xc3 && code === 0xf0) return this.characteristics;                        // id 64
    if (cls === 0xc2 && code === 0xf3) return this.zoomRecords;                            // id 7
    if (cls === 0xc1 && code === 0xfe) return this.zoomBytes;                              // id 71
    if (cls === 0x81 && code === 0xe4) return this.zoomWords;                              // id 76
    if (cls === 0xc1 && code === 0x01) return () => new Out().zeros(64).done();            // id 77: 32 u16
    if (cls === 0xc1 && code === 0x2f) return () => new Out().zeros(2).done();            // id 89: 2 bytes
    if (cls === 0x60 && code === 0xf0 && f.tx.length === 5) return () => null;             // type 3, command 101
    if (cls === 0xc1 && code === 0x80) return this.state;                                  // id 69, 75
    return null;
  }
  version() { return new Out().u16(this.lens.version).u16(this.lens.clock_khz).done(); }
  blockMode() { return new Out().u16(0).u16(0).done(); }
  identity() { return new Out().bytes(this.lens.id, 6).zeros(12).u16(0).done(); }
  functions() { return new Out().u8(0).done(); }
  // id 64 (0x502affc2): u32 flags (+1096), the ID (+1100), the name (32 bytes, +1106), n the zoom steps (<= 32,
  // +1138), a byte (+1139), c (<= 64, +1140: id 71's bytes per step), two bytes (+1141, +1142), k (<= 15, +1143),
  // u16 the wide and the tele focal length (+1144, +1146), 12 bytes (+1148), u16 (+1160); then the zoom steps' entries
  // (+1164 + 16 i) column by column, 8 u16 each (+0 the focal length, +2 / +4 the apertures, +6 / +8 the actual ones,
  // the record dump's L_FLenc, L_APmin, L_APmax, L_APACTmin, L_APACTmax, 0x50118d20; +10..+14 not named); 65 bytes
  // (+1680), a byte, 3 u16 (+1745..); n u16 (+1776); n u16, or n bytes when bit 0 of the header's second parameter is
  // clear (+1840); n bytes (+1904); 4 bytes (+1936); for n > 1 four groups (+164, +344, +524, +704 of +1776's base, at
  // record +1776) of 5 x 18 u16, for n = 1 four of 5 x 3 u16 and 30 bytes; then for m = k + 1: 3 x 4m u16 and 5 x 4m
  // bytes (+3620); u32 and 21 u16 and 12 bytes (+8184..+8252: u32, 4, 4, 4 and 3 u16, 3 x 4 bytes, 3 x 3 u16, 2 u16,
  // a byte); and, when the reply is as long as the driver's size check wants (0x502b0a2c), a byte and a u16 (+8253,
  // +8254). The values are S-LENS's (I) and 0 elsewhere (A-LENSMCU-1)
  characteristics(f) {
    const L = this.lens, n = L.zoom.length, k = 0, m = k + 1, o = new Out();
    o.u32(0).bytes(L.id, 6);
    const name = new Array(32).fill(0);
    for (let i = 0; i < L.name.length && i < 32; i++) name[i] = L.name.charCodeAt(i);
    o.bytes(name).u8(n).u8(0).u8(BYTES_PER_STEP).u8(0).u8(0).u8(k).u16(L.zoom[0]).u16(L.zoom[n - 1]).zeros(12).u16(0);
    const col = (fn) => { for (let i = 0; i < n; i++) o.u16(fn(i)); };
    col((i) => L.zoom[i]);                                    // +0 the focal length
    col(() => L.ap[0]); col(() => L.ap[1]);                   // +2, +4
    col(() => L.ap[0]); col(() => L.ap[1]);                   // +6, +8
    col(() => 0); col(() => 0); col(() => 0);                 // +10, +12, +14
    o.zeros(65).u8(0).u16(0).u16(0).u16(0);
    col(() => 0);                                             // +1776
    if (f.p2 & 1) col(() => 0); else o.zeros(n);              // +1840
    o.zeros(n).zeros(4);                                      // +1904, +1936
    if (n === 1) o.zeros(4 * 5 * 3 * 2 + 30); else o.zeros(4 * 5 * 18 * 2);
    o.zeros(3 * 4 * m * 2 + 5 * 4 * m);                       // +3620
    o.u32(0).zeros(2 * (4 + 4 + 4 + 3)).zeros(12).zeros(2 * 9).u16(0).u16(0).u8(0);   // +8184..+8252
    o.u8(0).u16(0);                                           // +8253, +8254
    return o.done();
  }
  zoomRecords() { const n = this.lens.zoom.length; return new Out().zeros(n * (8 * 4 + 2)).done(); }
  zoomBytes() { return new Out().zeros(BYTES_PER_STEP * this.lens.zoom.length).done(); }
  zoomWords() { return new Out().zeros(2 * this.lens.zoom.length).done(); }
  // id 69 (0x502b263d; the sync layer's poll, its sub-code 0x0600 from 0x502c3669..0x502c369c: the header's second
  // parameter 6): u32 the lens's status (record +4, the record dump's L_STATUS_M, 0x50118662), the zoom step (+8,
  // L_ZMENC), a byte (+9), u16 (+12, read x 5; 0xffff reads -1), u16 the actual aperture (+16, L_APACTnow; its copy
  // at +18 is left alone for this sub-code, bit 0x400), two bytes (+20, +21), 8 u16 for the parameter's bit 1 (+22),
  // and a list of (first parameter, 0 here, + 1) u16 (+40; 0x8000 ends it). The values S-LENS wrote (status 0x8000,
  // the zoom step, the aperture wide open) and 0 elsewhere (A-LENSMCU-1); another parameter is not decoded
  state(f) {
    if (f.p1 !== 0 || f.p2 !== 6) throw new LensError(`S-LENSMCU: the state frame ${frameName(f)} is not decoded (only [00 06])`);
    const o = new Out().u32(0x8000).u8(this.zoom).u8(0).u16(0).u16(this.lens.ap[0]).u8(0).u8(0);
    o.zeros(16);                                          // the parameter's bit 1: 8 u16
    o.u16(0);                                             // the list: one entry
    return o.done();
  }
}
