// The resource tables, natively (docs/hle-gaps.md 4.5 "The resource tables"; MODELS res_nand: E143): the firmware's
// resource API (res_size 0x501a976d, res_version 0x501a971e, res_read 0x501a921f) looks a resource up in tables that
// USTART_L's loader 0x501a8ca0 (its call at 0x500241d8) reads from the NAND: the sound index (type 2, RES_MODE_SOUND)
// at 0x4e420000, the images block's (type 3) at 0x4e1e0000, the large-data block's (type 0x8000) at 0x458c0000 and
// twelve sub-indexes it names (types 0x8001..0x800f through the byte map 0x602a49e3), and the resource block's (types
// 0 and 1) at 0x41ec0000, each table 32 bytes past its buffer, past the block's head (D, 0x501a8ca0..0x501a8de9). What
// the lab does in the boot's place:
//   H-RESINIT  the loader 0x501a8ca0 run natively at the play bring-up, in USTART_L's place before H-LENSINIT's lens
//              data cache load (USTART_L calls the loader at 0x500241d8, the cache load at 0x5002420e), then
//              USTART_L's own load of sound 0 (0x5002433b / 0x50024353: res_read(2, 0, 0xa4000000, res_size(2, 0) +
//              1024)). On the erased area res_size(2, 0) is 0xffffffff, the size argument wraps to 1023, and res_read
//              sets its last entry (0x501a934e) and takes its error path (the size below 1024, 0x501a93d5), which logs
//              0x1f000003 (0x501a942a, D; X: the step's error log) and leaves the descriptor {0, 0}; a later
//              res_read(2, 0, 0xa4000000) answers that descriptor without a read (0x501a9333..47, D), as a camera with
//              an erased area would. A camera with its factory area makes no such log (I). With the host's area the
//              load runs to the end and leaves the descriptor {0xa4000000, size + 1024} (X)
//   S-RESNAND  the NAND behind the access the card's file system and the lens caches use (src/lab/storage.mjs
//              S-FSNAND, src/lab/lens.mjs S-LENSNAND, layered as S-LENSNAND is over S-FSNAND): reads (the access's
//              read operation, fact storage nand.read) of the update's blocks at their load addresses, served from
//              the container as the camera stores them, head + descrambled body + tail (src/fw/nand.mjs; env.nand,
//              the host's view of them: the NAND extract, src/fw/labfw.mjs labNand, on node from unpacked/<code>,
//              checks/lib/env.mjs loadNand; the resource block's body from the lab's own copy, env.resBlock), and the
//              sound area at 0x4e420000 (res_nand.sound): erased (0xff) unless the host gives an image (env.soundArea:
//              the camera's own area is factory data, not in the update; a lab-made one in the TG-7's format,
//              src/fw/nand.mjs soundArea), the firmware's writes and erases inside the flash access guard's window
//              for it ([0x4e420000, 0x4e460000), 0x50000735, D) kept for the session. A read anywhere up to the RAM
//              log at 0x4e820000 (the guard's next window, D; that the area ends there is I) is served from the area,
//              erased past the window and the host's image: res_read of type 2 reads an entry's size + 1024 bytes
//              (0x501a937d, 0x501a9394, D), past the last entry's end. With --audio on and no env.soundArea the host's
//              image is the lab-made one (S-SOUNDRES, src/lab/soundres.mjs). Any other access goes on to the layers
//              below (S-FSNAND stops the session at an access outside its area)
// The loader's reads (X, E143): 16, all served from the container but the sound index; the tables then answer
// res_size(0, 0) = 0xe2800, res_size(3, 0) = 0x2800, res_size(0x8000, 0) = 0x167fc00, res_version = 0x01000000 (the
// heads' version 0x0100), and with the area erased res_size(2, 0) = 0xffffffff (test/test_resnand.mjs).
import { fact } from '../fw/model.mjs';
import { STORAGE_E143 } from '../fw/facts.mjs';
import { withBody, NandError } from '../fw/nand.mjs';
import { loadAddress } from './resources.mjs';
import { runtime, where, FirmwareError } from './hle.mjs';

export class ResNandError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the table pointers the loader sets (D, 0x501a8cd2..0x501a8de3): [buffer, table] per type, and the twelve sub-tables
export const TABLES = { 2: [0xA32DB17C, 0xA32DB180], 3: [0xA32DB198, 0xA32DB19C], 0x8000: [0xA32DB1B8, 0xA32DB1BC], 0: [0xA32DB328, 0xA32DB32C] };
export const SUB_TABLES = [0xA32DB1C4, 0xA32DB1F4], SUB_COUNT = 12;
// res_read's type-2 descriptor {pointer, size} (0x501a93ab, 0x501a9381), its last entry (0x501a934e) and the log of
// its error path (0x501a942a) (D)
export const SOUND_DESCRIPTOR = 0xA32DB188, SOUND_LAST = 0xA32DB184, SOUND_ERASED_LOG = 0x1F000003;

export class ResNand {
  // session: the PlaySession; info: MODELS res_nand; nand: env.nand ({areas, read(addr, n)}); image: env.soundArea or
  // null
  constructor(session, info, nand, image = null) {
    this.s = session;
    this.info = info;
    this.f = fact('storage', STORAGE_E143).nand;
    if (!nand || typeof nand.read !== 'function' || !Array.isArray(nand.areas)) throw new ResNandError('S-RESNAND: env.nand gives no NAND view ({areas, read(addr, n)}, src/fw/nand.mjs)');
    // the resource block's body from the lab's own copy (env.resBlock: a patch overlay's, or the browser's prefix)
    const res = session.env.resBlock;
    this.nand = res ? withBody(nand, loadAddress(res), res) : nand;
    const { load, guard, end } = info.sound;
    if (image !== null && !(image instanceof Uint8Array)) throw new ResNandError('S-RESNAND: env.soundArea is not a Uint8Array');
    if (image && image.length > end - load) throw new ResNandError(`S-RESNAND: a sound area of ${image.length} bytes, more than the ${end - load} up to the RAM log (${h8(end)})`);
    this.image = image;
    // the part of the NAND served as the sound area: up to the RAM log (that the area ends there is I), erased past the
    // guard window and the host's image. res_read of type 2 reads its entry's size + 1024 bytes (0x501a937d,
    // 0x501a9394, D), so the last entry's read runs past the image's end
    this.sound_end = end;
    // the guard window's bytes as the firmware may rewrite them (erased, or the host's image)
    this.window = new Uint8Array(guard[1] - guard[0]).fill(0xFF);
    if (image) this.window.set(image.subarray(guard[0] - load, guard[1] - load));
    this.reads = 0; this.writes = 0; this.erases = 0;
    this.log = [];
    this.tables = null;
    this.sound0 = null;
  }
  bring_up() {
    const s = this.s, lab = s.lab, { access } = this.f;
    const layer = (prev) => (h, r) => this._nand(h, r, prev);
    if (lab.hooks.has(runtime(access))) lab.wrap(access, layer, 'S-FSNAND, S-RESNAND');
    else lab.hook(access, layer((h, r) => { throw new ResNandError(`S-RESNAND: NAND access 0x${(r.d1 >>> 0).toString(16)} of ${r.d0 >>> 0} bytes at ${h8(r.a1)} from ${where(r.mdr)}: no layer below serves it`); }), 'S-RESNAND');
    const { loader, size, read, slot } = this.info;
    lab.step('H-RESINIT the resource loader 0x501a8ca0 (USTART_L 0x500241d8)', () => lab.call(loader, null, null, null, 2000000));
    this.tables = this.pointers();
    // a failed read leaves its buffer 0 (0x501a986a answers a0 = 0, 0x501a98a9), the table then 0x20 (D)
    const unset = this.buffers().filter(([, v]) => v === 0).map(([k]) => k);
    if (unset.length) throw new ResNandError(`H-RESINIT: after the loader the buffers of ${unset.join(', ')} are 0 (a NAND read that failed)`);
    // USTART_L's sound 0: res_read(2, 0, 0xa4000000, res_size(2, 0) + 1024). On the erased area the size wraps to
    // 1023 and res_read, having set its last entry (0x501a934e), takes its error path and logs 0x1f000003 (D); a later
    // res_read(2, 0, 0xa4000000) then answers the descriptor it left ({0, 0}) without a read (0x501a9333..47, D)
    const sim = lab.sim, st = new Uint8Array(4);
    let n = null;
    lab.step('H-RESINIT sound 0 (USTART_L 0x5002433b, 0x50024353)', () => {
      n = (lab.call(size, { d0: 2, d1: 0 }, null, null, 20000).d0 + 1024) >>> 0;
      new DataView(st.buffer).setUint32(0, n, true);
      lab.call(read, { d0: 2, d1: 0, a0: slot, a1: 0 }, st, null, 2000000);
    }, [], this.image ? [] : [SOUND_ERASED_LOG]);
    this.sound0 = [sim.u32(SOUND_DESCRIPTOR), sim.u32(SOUND_DESCRIPTOR + 4)];
    const want = this.image ? [slot, n] : [0, 0];
    if (this.sound0[0] !== want[0] || this.sound0[1] !== want[1] || sim.u32(SOUND_LAST) !== sim.u32(TABLES[2][1])) {
      throw new ResNandError(`H-RESINIT: sound 0's descriptor {${this.sound0.map(h8)}} (size argument ${h8(n)}), want {${want.map(h8)}}; last entry ${h8(sim.u32(SOUND_LAST))}, want the table's ${h8(sim.u32(TABLES[2][1]))}`);
    }
  }
  // the buffers the loader's reads answered, by name (each table 32 bytes past its buffer)
  buffers() {
    const sim = this.s.lab.sim, out = [];
    for (const [t, [buffer]] of Object.entries(TABLES)) out.push([`type ${Number(t) >= 0x8000 ? '0x' + Number(t).toString(16) : t}`, sim.u32(buffer)]);
    for (let i = 0; i < SUB_COUNT; i++) out.push([`sub ${i}`, sim.u32(SUB_TABLES[0] + 4 * i)]);
    return out;
  }
  // the table pointers by name: [type]: the table (buffer + 32), sub<i>: sub-table i
  pointers() {
    const sim = this.s.lab.sim, out = {};
    for (const [t, [, table]] of Object.entries(TABLES)) out[`type ${Number(t) >= 0x8000 ? '0x' + Number(t).toString(16) : t}`] = sim.u32(table);
    for (let i = 0; i < SUB_COUNT; i++) out[`sub ${i}`] = sim.u32(SUB_TABLES[1] + 4 * i);
    return out;
  }
  // S-RESNAND (over S-FSNAND, under S-LENSNAND)
  _nand(h, r, prev) {
    const sim = this.s.lab.sim, mem = r.a0 >>> 0, at = r.a1 >>> 0, n = r.d0 >>> 0, op = r.d1 >>> 0;
    const { load, guard } = this.info.sound;
    if (at >= load && at + n <= this.sound_end && n > 0) {
      const inGuard = at >= guard[0] && at + n <= guard[1];
      if (op === this.f.read) sim.write(mem, this.sound_bytes(at, n));
      else if ((op === this.f.write || op === this.info.erase) && inGuard) {
        if (op === this.f.write) { this.window.set(sim.read(mem, n), at - guard[0]); this.writes += 1; } else { this.window.fill(0xFF, at - guard[0], at - guard[0] + n); this.erases += 1; }
      } else throw new ResNandError(`S-RESNAND: NAND access 0x${op.toString(16)} of ${n} bytes at ${h8(at)} from ${where(r.mdr)}: the sound area takes reads, and writes and erases inside ${h8(guard[0])}..${h8(guard[1])}`);
      this.log.push(['sound', `${op === this.f.read ? 'read' : op === this.f.write ? 'write' : 'erase'} ${n} bytes at ${h8(at)} from ${where(r.mdr)}`]);
      return h.finish(r, { d0: 0 });
    }
    if (op === this.f.read && n > 0) {
      let b;
      try { b = this.nand.read(at, n); } catch (e) {
        if (e instanceof NandError) throw new ResNandError(`S-RESNAND: a read of ${n} bytes at ${h8(at)} from ${where(r.mdr)}: ${e.message}`);
        throw e;
      }
      if (b) {
        sim.write(mem, b);
        this.reads += 1;
        this.log.push(['nand', `read ${n} bytes at ${h8(at)} from ${where(r.mdr)}`]);
        return h.finish(r, { d0: 0 });
      }
    }
    return prev(h, r);
  }
  // the sound area's bytes [at, at + n): the guard window as the session left it, the host's image past it, erased
  // past that
  sound_bytes(at, n) {
    const { load, guard } = this.info.sound, out = new Uint8Array(n).fill(0xFF);
    for (let i = 0; i < n; i++) {
      const a = at + i;
      if (a >= guard[0] && a < guard[1]) out[i] = this.window[a - guard[0]];
      else if (this.image && a - load < this.image.length) out[i] = this.image[a - load];
    }
    return out;
  }
  status() {
    return { tables: this.tables && Object.fromEntries(Object.entries(this.tables).map(([k, v]) => [k, h8(v)])), sound: this.image ? `the host's image (${this.image.length} bytes)` : 'erased',
      ...(this.sound0 && { sound0: this.sound0.map(h8) }), reads: this.reads, writes: this.writes, erases: this.erases };
  }
  take_log() { return this.log.splice(0); }
}
