// The play module natively under control camapp 3 (docs/hle-gaps.md 4.8.11, 4.8.13; E143 only, the Player's
// camapp_play_native, off by default): segment 9's PLAY tasks take the HLS play components' requests on PLAY_EXEC
// themselves, load the picture's file from the card, parse its Exif and JPEG headers and ask the image library for
// the view's decode, which runs natively on the pipeline block's model (src/dev/imgpipe.mjs). Addresses are E143's (D
// unless tagged).
//
//   H-PLAYSTART  the play module's six tasks started with act_tsk in USTART5's order (task 39, 0x501e9e94: after its
//                waits for the stages 8, 9 and 10, 0x501e9ec0..0x501e9ef2, and its calls 0x518f724a and 0x50155412,
//                it starts them at 0x501e9f17..0x501e9fab, the tids from the id words below, each logged by name):
//                PLAY_MAIN (25, 0x518a5a7a), PLAY_LOAD (24), PLAY_IMAGE (23), PLAY_SOUND (26), PLAY_DECODE (118) and
//                PLAY_LOADDRAW (119). Each runs its own init at its start (PLAY_MAIN's play_init 0x518a5a3c) and then
//                waits on its queue (X); the play module has no init of its own in the start functions (D: neither
//                0x518f724a, which checks a log area at 0x63ae0000 and starts the task of the word 0x60042e34, nor
//                0x50155412 is the play module's; neither runs in the lab). Run after CA_MAIN's start: on the camera
//                USTART4 starts CA_MAIN (0x501e9e03) before it starts USTART5 (0x501e9e5c, D). The conditions the
//                camera waits for first are not met in the lab then (X: the stages 8 and 10 not readied, USTART4's
//                two bytes 0; what they mark is ?, docs/hle-gaps.md 4.8.11). PLAY_EXEC (0x3f) leaves S-MODACK:
//                PLAY_MAIN takes the play API's requests and answers them to their reply queue
//   S-IMGPIPE    the view's decode, the image library's request the play module makes: the library's issue
//                0x5048f331 and its wait 0x5048f6e4, called only by the play module, from
//                play_img_make_view_division (0x518b44fc: 0x518b478b, 0x518b4799) and the decode before it
//                (0x518b446f, 0x518b447d), D. The issue's block (a0): +0 the request (120 bytes, 0x518b452e): +0 the
//                file's address in the play buffer (X: a bus address, the whole file, SOI first), +8 u16 the source
//                format (7171, or 7170 where the play record's +24 is 1; X: 7170 for the lab's 4:2:2 picture), +10 u16
//                the width rounded up to 16, +12 / +14 and +16 / +18 the width and height, +28 a work buffer for the
//                decoded planes, +36 its bytes; +4 the destination (the request's +64): +0 its address, +8 u16 the
//                format 3074 (0x518b4643), +10 u16 the pitch in pixels rounded up to 64, +12 / +14 the width and
//                height. The issue makes it the library's kind 10 (0x5048f39d), whose generic handler 0x5046d994
//                packs the pipeline block's words, sets its units up and starts them; the codec at 0x99900000 decodes
//                the stream and the resizer writes the destination (src/dev/imgpipe.mjs, the block's and the codec's
//                model: the decode with the lab's own baseline decoder, the scaling under A-IMGPIPE-2, the run's time
//                A-IMGPIPE-1). Its end comes through IRQ 288 (the handler 0x5048bb88, which H-IMGPROINIT's attach
//                0x5048c3a0 registers), and the request's callback (0x518b4b0b) and the wait run natively. The lab
//                records each request at the issue
//   S-PLAYDEC    what remains of the decode's stand-in: a request the library would run with a pre-reduction ahead
//                of the resizer, which the block's model refuses (its unit is not read). The library picks it per axis
//                by the ratio ((source - 1) * 100 << 10) / ((destination - 1) * 100), .10 fixed (0x50477e57..86,
//                0x50478284..0x504782ac; reduction() below; 0x504e23a5: the first of the 40 thresholds at 0x5066fb58
//                the ratio does not exceed; that row's first halfword, 0x506a4a64's pointers: 0 none, 1, 3 or 7): a
//                ratio above 3327, 3.249 (X: the detail view's 474 x 316 of 1620 x 1080, 3504 and 3507; the view's 900
//                x 600, 1844 and 1844, has none). For such a request the issue
//                and its wait return 0 (accepted, done) from the play module's call sites, the request recorded;
//                nothing is written to the destination and the request's callback (0x518b4b0b) is not called (I: the
//                done path's phases are not read)
//   A-JPEGDHT-1  the camera's JPEG carries the Huffman tables the firmware's own JPEG header maker writes (its op 0,
//                0x50428ee6 -> 0x50428f7f: 420 bytes from 0x60626338, one DHT segment with T.81 Annex K.3's four
//                tables), so the lab's stream (S-JPEGENC, src/lab/jpeg.mjs) carries that segment, read from the
//                image, in place of its one-symbol AC tables: the play module's JPEG parse 0x50429055 refuses a DC
//                table whose code count is not 12 and an AC table whose count is not 162 (0x5042928a, 0x504292c0:
//                12428, X: the lab's tables failed there and the header getter answered 6152). I: the encoder's own
//                output is not read
import { FirmwareError, where, disasm } from './hle.mjs';
import { dhtTables } from './jpeg.mjs';
import { ON_LAB_MODEL } from '../fw/model.mjs';

export class PlayModError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// E143's play module (D):
//   tasks   USTART5's starts in order: [the id word, the name its log gives] (0x501e9f10..0x501e9fab)
//   dht     the header maker's Huffman tables (op 0's copy at 0x50428f7f): their address and length
//   prefilter  the image library's rows by scale ratio (0x504e23a5): the thresholds (halfwords, run-time 0x60690b78),
//           the rows' pointers (run-time 0x606c5a84) and their number; a row's first halfword is its pre-reduction
//   issue   the image library's issue and wait the play module's decode calls, each with the return addresses of its
//           two call sites (0x518b446f / 0x518b478b, 0x518b447d / 0x518b4799)
//   request the request's fields the lab records at the issue: the source's address, format and size, the size the
//           library's packing scales from (+16 / +18, 0x50477e57), the work buffer and its bytes, the destination's
//           address, format, pitch and size (above)
export const PLAY_MODULE_E143 = {
  tasks: [[0x60042D58, 'PLAY_MAIN'], [0x60042D56, 'PLAY_LOAD'], [0x60042D54, 'PLAY_IMAGE'], [0x60042D5A, 'PLAY_SOUND'],
    [0x60042E12, 'PLAY_DECODE'], [0x60042E14, 'PLAY_LOADDRAW']],
  dht: { at: 0x60626338, bytes: 420 },
  prefilter: { thresholds: 0x60690B78, rows: 0x606C5A84, n: 40 },
  issue: { fn: 0x5048F331, from: [0x518B4476, 0x518B4792] },
  wait: { fn: 0x5048F6E4, from: [0x518B4484, 0x518B47A0] },
  request: { src: 0, format: 8, width: 12, height: 14, area_width: 16, area_height: 18, work: 28, bytes: 36 },
  dest: { addr: 0, format: 8, pitch: 10, width: 12, height: 14 },
};
const WAI = 4;
// the play module runs natively on E143 only (its addresses are not read on another body)
export const PLAY_NATIVE = ON_LAB_MODEL;

export class PlayModule {
  // session: the play session; camapp: its camera application (src/lab/camapp.mjs), under control camapp 3
  constructor(session, camapp) {
    if (!PLAY_NATIVE) throw new PlayModError('the play module natively (camapp_play_native) is E143\'s only');
    this.s = session; this.lab = session.lab; this.ca = camapp;
    this.P = PLAY_MODULE_E143;
    this.unit = this.lab.sim.m.devices.imgpipe ?? null;      // S-IMGPIPE (src/dev/imgpipe.mjs)
    if (!this.unit) throw new PlayModError('the play module natively: the board has no pipeline block (src/fw/board.mjs imgpipe)');
    this.tids = [];                // H-PLAYSTART: [tid, name] as started
    this.decodes = [];             // each request at the issue {from, src, format, width, height, dst, ...}
    this.waits = 0;
    this.pending = 0;              // S-PLAYDEC: issues stood in and not yet waited for
    this._dht = null;
  }
  // A-JPEGDHT-1: the firmware's DHT segment, read from the image and checked (one segment of the four tables)
  get dht() {
    if (this._dht) return this._dht;
    const b = this.lab.sim.read(this.P.dht.at, this.P.dht.bytes), t = dhtTables(b);
    if (t.size !== 4 || [0x00, 0x10, 0x01, 0x11].some((k) => !t.has(k))) throw new PlayModError(`A-JPEGDHT-1: the DHT at ${h8(this.P.dht.at)} holds tables ${[...t.keys()].map((k) => k.toString(16))}`);
    this._dht = b;
    return b;
  }
  // The ratios and pre-reduction codes [x, y] the image library picks for a request (rec: its fields above; a code 0
  // is none). Its packing 0x50477d5b scales from the source's +16 / +18 to the destination's +12 / +14: per axis the
  // ratio ((source - 1) * 100 << 10) / ((destination - 1) * k), .10 fixed, from a 32-bit dividend to a 16-bit quotient
  // (0x50477e57..0x50477e86, 0x50478284..0x504782ab; X: 1844 for 1620 to 900, the firmware's own at 0x504782ac), k 100
  // for a source format whose bits 15..10 are not 1, 3 or 4 (0x50477d68..0x50477d7a, 0x50477e43; the play module's
  // 7170 and 7171 are 7; the others take k from a table, not read: refused). An axis whose ratio is above 1024
  // (0x504e2437) takes the row of the first threshold the ratio does not exceed, the last row above them all
  // (0x504e23a5..0x504e23c8). X: both of the play module's requests reach this choice (0x50478271)
  reduction(rec) {
    const sim = this.lab.sim, T = this.P.prefilter, u16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; };
    if ([1, 3, 4].includes(rec.format >> 10)) throw new PlayModError(`S-PLAYDEC: the source format ${rec.format}: the image library's divisor for it is not read (0x50477d7d, 0x50477dca)`);
    const axis = (n, m) => {
      if (n < 1 || m < 2) throw new PlayModError(`S-PLAYDEC: ${n} source pixels to ${m}: the image library's ratio is not followed there`);
      const ratio = Math.floor(((((n - 1) * 100) << 10) >>> 0) / ((m - 1) * 100)) & 0xFFFF;
      if (ratio <= 1024) return [ratio, 0];
      let i = 0;
      while (i < T.n - 1 && ratio > u16(T.thresholds + 2 * i)) i++;
      return [ratio, u16(sim.u32(T.rows + 4 * i) >>> 0)];
    };
    const x = axis(rec.area_width, rec.dst_width), y = axis(rec.area_height, rec.dst_height);
    return { ratio: [x[0], y[0]], codes: [x[1], y[1]] };
  }
  // The decode's requests at the issue and the wait: recorded, and run natively on the block's model (S-IMGPIPE)
  // unless the library would pre-reduce the picture (S-PLAYDEC). The frames the block's runs wrote are those the
  // display may show unscaled (src/lab/display.mjs img_edge)
  install() {
    const lab = this.lab, sim = lab.sim, P = this.P, u32 = (a) => sim.u32(a) >>> 0;
    const u16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; };
    const stood = (r) => { if (lab.coverage !== null) lab.coverage.stub(r.pc, 'S-PLAYDEC'); lab.on_stub('S-PLAYDEC'); lab.finish(r, { d0: 0 }); };
    lab.hook(P.issue.fn, (h, r) => {
      if (!P.issue.from.includes(disasm(r.mdr))) throw new PlayModError(`the image library's issue ${h8(P.issue.fn)} from ${where(r.mdr)}: only the play module's decode is known to call it`);
      const blk = r.a0 >>> 0, req = u32(blk), dst = u32(blk + 4), Q = P.request, D = P.dest;
      const rec = { from: disasm(r.mdr), src: u32(req + Q.src), format: u16(req + Q.format), width: u16(req + Q.width), height: u16(req + Q.height),
        area_width: u16(req + Q.area_width), area_height: u16(req + Q.area_height),
        work: u32(req + Q.work), bytes: u32(req + Q.bytes), dst: u32(dst + D.addr), dst_format: u16(dst + D.format), pitch: u16(dst + D.pitch), dst_width: u16(dst + D.width), dst_height: u16(dst + D.height) };
      const pick = this.reduction(rec);
      rec.ratio = pick.ratio; rec.reduction = pick.codes;
      rec.stood_in = rec.reduction.some((k) => k !== 0);
      this.decodes.push(rec);
      this.ca.log.push(['playdec', `view decode from ${h8(rec.from)}: ${rec.width} x ${rec.height} (format ${rec.format}) at ${h8(rec.src)} -> ${rec.dst_width} x ${rec.dst_height} (format ${rec.dst_format}, pitch ${rec.pitch}) at ${h8(rec.dst)}${rec.stood_in ? `, pre-reduction ${rec.reduction}: not decoded (S-PLAYDEC)` : ''}`]);
      if (!rec.stood_in) return lab.passthrough(r);
      this.pending += 1;
      stood(r);
    }, 'obs-playdec');
    lab.hook(P.wait.fn, (h, r) => {
      if (!P.wait.from.includes(disasm(r.mdr))) throw new PlayModError(`the image library's wait ${h8(P.wait.fn)} from ${where(r.mdr)}: only the play module's decode is known to call it`);
      this.waits += 1;
      if (!this.pending) return lab.passthrough(r);
      this.pending -= 1;
      stood(r);
    }, 'obs-playdec');
    lab.img_decoded = () => this.unit.log;
  }
  // H-PLAYSTART: the six tasks in USTART5's order; each waits on its input afterwards
  start() {
    const lab = this.lab, sim = lab.sim;
    for (const [word, name] of this.P.tasks) {
      const b = sim.read(word, 2), tid = b[0] | b[1] << 8, entry = lab.nk.entry(tid);
      if (!tid || entry === null) throw new PlayModError(`H-PLAYSTART: ${name}'s id word ${h8(word)} names task ${tid}, which has no entry`);
      lab.lt.allow.add(entry);
      const [rc] = lab.nk.svc('act_tsk', { d0: tid });
      if (rc !== 0) throw new PlayModError(`H-PLAYSTART: act_tsk(${tid}) for ${name} = ${rc}`);
      this.s.settle(`H-PLAYSTART ${name}`);
      this.tids.push([tid, name]);
    }
    const busy = this.tids.filter(([t]) => (lab.nk.state(t) & 0xF) !== WAI || lab.nk.timed_waiters().includes(t));
    if (busy.length) throw new PlayModError(`H-PLAYSTART: ${busy.map(([t, n]) => `${n} (task ${t}, state 0x${lab.nk.state(t).toString(16)})`).join(', ')} not waiting after the start`);
    this.ca.log.push(['playmod', `${this.tids.map(([t, n]) => `${n} ${t}`).join(', ')} started and waiting`]);
  }
}
// the stand-ins the native play module uses, in place of S-PLAYSEQ, S-PLAYCOMP and S-PLAYVIEW (src/lab/player.mjs)
export const PLAY_NATIVE_STAND_INS = ['H-PLAYSTART', 'S-IMGPIPE', 'A-IMGPIPE-1', 'A-IMGPIPE-2', 'S-PLAYDEC', 'A-JPEGDHT-1'];
