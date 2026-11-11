// The play module natively under control camapp 3 (docs/hle-gaps.md 4.8.11; E143 only, the Player's
// camapp_play_native, off by default): segment 9's PLAY tasks take the HLS play components' requests on PLAY_EXEC
// themselves, load the picture's file from the card, parse its Exif and JPEG headers and ask the image library for
// the view's decode; the decode is the one stand-in. Addresses are E143's (D unless tagged).
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
//   S-PLAYDEC    the view's decode, the image library's request the play module makes and the lab cannot run: the
//                library's issue 0x5048f331 and its wait 0x5048f6e4, called only by the play module, from
//                play_img_make_view_division (0x518b44fc: 0x518b478b, 0x518b4799) and the decode before it
//                (0x518b446f, 0x518b447d), D. The issue's block (a0): +0 the request (120 bytes, 0x518b452e): +0 the
//                file's address in the play buffer (X: the whole file, SOI first), +8 u16 the source format (7171,
//                or 7170 where the play record's +24 is 1; X: 7170 for the lab's 4:2:2 picture), +10 u16 the width
//                rounded up to 16, +12 / +14 and +16 / +18 the width and height, +36 the source plane's bytes; +4
//                the destination (the request's +64): +0 its address, +8 u16 the format 3074 (0x518b4643), +10 u16
//                the pitch in pixels rounded up to 64, +12 / +14 the width and height. Natively the issue makes it
//                the library's kind 10 (X: the dispatch 0x5046d814 reads 10 at the request's +16), whose handler
//                0x5046d994 sets up the units (0x5048134d) and writes the unit at 0x9c200000 first at +0x2d8
//                (0x5048d4c0, X: the lab refuses it), a unit the lab does not model. S-PLAYDEC records the request and
//                answers the issue and the wait with 0 (accepted, done) from these call sites only; nothing is
//                written to the destination (the view keeps what was there: the decode is not modelled) and the
//                request's callback (0x518b4b0b, its phases 21, 22, 15 and 38) is not called (I: the done path's
//                phases are not read)
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
//   issue   the image library's issue and wait the play module's decode calls, each with the return addresses of its
//           two call sites (0x518b446f / 0x518b478b, 0x518b447d / 0x518b4799)
//   request the request's fields S-PLAYDEC records: the source's address, format and size, the destination's
//           address, format, pitch and size (above); FORMAT_VIEW the destination format the decode sets (0x518b4643)
export const PLAY_MODULE_E143 = {
  tasks: [[0x60042D58, 'PLAY_MAIN'], [0x60042D56, 'PLAY_LOAD'], [0x60042D54, 'PLAY_IMAGE'], [0x60042D5A, 'PLAY_SOUND'],
    [0x60042E12, 'PLAY_DECODE'], [0x60042E14, 'PLAY_LOADDRAW']],
  dht: { at: 0x60626338, bytes: 420 },
  issue: { fn: 0x5048F331, from: [0x518B4476, 0x518B4792] },
  wait: { fn: 0x5048F6E4, from: [0x518B4484, 0x518B47A0] },
  request: { src: 0, format: 8, width: 12, height: 14, bytes: 36 },
  dest: { addr: 0, format: 8, pitch: 10, width: 12, height: 14 },
};
const FORMAT_VIEW = 3074, WAI = 4;
// the play module runs natively on E143 only (its addresses are not read on another body)
export const PLAY_NATIVE = ON_LAB_MODEL;

export class PlayModule {
  // session: the play session; camapp: its camera application (src/lab/camapp.mjs), under control camapp 3
  constructor(session, camapp) {
    if (!PLAY_NATIVE) throw new PlayModError('the play module natively (camapp_play_native) is E143\'s only');
    this.s = session; this.lab = session.lab; this.ca = camapp;
    this.P = PLAY_MODULE_E143;
    this.tids = [];                // H-PLAYSTART: [tid, name] as started
    this.decodes = [];             // S-PLAYDEC: each request {from, src, format, width, height, dst, ...}
    this.waits = 0;
    this.pending = 0;              // issues not yet waited for
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
  // S-PLAYDEC: the issue and the wait, from the play module's two call sites only
  install() {
    const lab = this.lab, sim = lab.sim, P = this.P, u32 = (a) => sim.u32(a) >>> 0;
    const u16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; };
    lab.hook(P.issue.fn, (h, r) => {
      if (!P.issue.from.includes(disasm(r.mdr))) throw new PlayModError(`S-PLAYDEC: the image library's issue ${h8(P.issue.fn)} from ${where(r.mdr)}: only the play module's decode is stood in`);
      const blk = r.a0 >>> 0, req = u32(blk), dst = u32(blk + 4), Q = P.request, D = P.dest;
      const rec = { from: disasm(r.mdr), src: u32(req + Q.src), format: u16(req + Q.format), width: u16(req + Q.width), height: u16(req + Q.height),
        bytes: u32(req + Q.bytes), dst: u32(dst + D.addr), dst_format: u16(dst + D.format), pitch: u16(dst + D.pitch), dst_width: u16(dst + D.width), dst_height: u16(dst + D.height) };
      const soi = sim.read(rec.src, 2);
      if (soi[0] !== 0xFF || soi[1] !== 0xD8 || rec.dst_format !== FORMAT_VIEW) throw new PlayModError(`S-PLAYDEC: a request ${JSON.stringify(rec)} whose source does not open with SOI (${[...soi]}) or whose destination is not format ${FORMAT_VIEW}`);
      this.decodes.push(rec);
      this.pending += 1;
      this.ca.log.push(['playdec', `view decode from ${h8(rec.from)}: ${rec.width} x ${rec.height} (format ${rec.format}) at ${h8(rec.src)} -> ${rec.dst_width} x ${rec.dst_height} (format ${rec.dst_format}, pitch ${rec.pitch}) at ${h8(rec.dst)}, not decoded`]);
      h.finish(r, { d0: 0 });
    }, 'S-PLAYDEC');
    lab.hook(P.wait.fn, (h, r) => {
      if (!P.wait.from.includes(disasm(r.mdr))) throw new PlayModError(`S-PLAYDEC: the image library's wait ${h8(P.wait.fn)} from ${where(r.mdr)}: only the play module's decode is stood in`);
      if (!this.pending) throw new PlayModError(`S-PLAYDEC: a wait from ${where(r.mdr)} with no decode issued`);
      this.pending -= 1; this.waits += 1;
      h.finish(r, { d0: 0 });
    }, 'S-PLAYDEC');
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
export const PLAY_NATIVE_STAND_INS = ['H-PLAYSTART', 'S-PLAYDEC', 'A-JPEGDHT-1'];
