// S-RAWFRAME: a declared fill of the still shot's Bayer buffer, where the lab has no sensor readout (docs/hle-gaps.md
// 4.3.13, 4.3.14). On the camera the sensor's DRAM capture (4.3's seam C1: cam_seq_dram_capture.c, TAKE_DRAMCAP)
// writes the RAW frame into the buffer TAKE's allocation took from MM for the shot; in the lab nothing did, and a
// reader of its pixels got what the lab's DRAM held there. S-RAWFRAME writes a lab pattern (not a scene) of the
// buffer's geometry into it at S2's picture, after H-SHOTALLOC and before S-EXIFPRM (so before REC_PREPRO's place,
// whose white-balance step and the image library's run are its readers on the camera). Addresses are E143's (D unless
// tagged); each is taken through A() and its bytes are checked on the body before use: a body whose bytes differ keeps
// the buffer unwritten, with the reason (geometry() returns {skip}). So does a body whose MM block for the Bayer is no
// memory of the lab's: E143's bank 0 starts at 0xb8000000, where the lab's 384 MiB of DRAM end (src/fw/board.mjs
// dram_size), so by default S-RAWFRAME is not in use there; with 512 MiB it runs (X, docs/hle-gaps.md 4.3.14).
//
// Where each value comes from (E143):
//   the buffer    the shot entry's +2, the handle TAKE's Bayer lookup gives (0x503af9de: the entry's flag 1, `movhu
//                 (2,a0),d0`, 0x503afa22), which rec_ImgProCtrl_Src_Bayer asks (0x5054904d) and hands MM's
//                 handle-to-address MM_ADDR (0x50534dd1, called at 0x50549055) for the source's address; S-RAWFRAME
//                 asks the same two functions natively
//   MM's block    MM's bank table BANKS (0x606dc498: the bank handle >> 8, 8 bytes each, the pool object at +4), read
//                 from MM's allocation (`asl 3,d0; add BANKS,d0; mov d0,a2; inc4 a2; mov (a2),d0` at 0x50534a90) and
//                 handle-to-address (0x50534e23); the pool's handle-to-address method (its vtable's +8, called at
//                 0x50534e72) is, for bank 0's class, POOL_ADDR (0x505379bc): the handle's low byte n (1..192), the
//                 address (12,pool) * (n - 1) + (8,pool) while n <= the halfword (306,pool), else in a second region
//                 at (308,pool) (0x505379da..0x50537a08). So (12,pool) is the block size, and the fill must fit it.
//                 X on E143 (the lab's settings: TAKE's kind 3, the three MM kind 0 blocks of handles 1, 2 and 3):
//                 base 0xb8000000, block 0x1ffec00 bytes (33,549,312), the handles 1..3 at its multiples
//   the geometry  rec_ImgProCtrl_Src_Bayer's normal-still branch (GEOMETRY, 0x505492e6..0x50549317: the record's
//                 +38764 not 19, Mode not 8193 / 8198, the high-resolution and +7626 modes not taken): bits 12
//                 (`mov 12,d0; call 0x50547b9a`, the format 1031 at the source's +8), the source's +10 5360, +12
//                 5208, +14 3912 (the stride and the frame) and +16 5184, +18 3888 (the developed size); E146 writes the
//                 same values at other offsets (`0x5052704d`, its source record 8 bytes longer), so its bytes differ
//                 and it is skipped until a rule reads its form
//   A-RAWFRAME-1  (I) the layout the pipeline unit reads is not read: the fill takes the stride in pixels, two
//                 12-bit pixels packed little-endian in three bytes (8040 bytes a row, 31,452,480 bytes, inside
//                 MM's block; 16 bits a pixel would not fit it: 41,940,480), the colour filter RGGB from the first
//                 row, and the 152 pixels past the frame's 5208 in each row 0
// The pattern: R = 4095 x / (width - 1), B = 4095 y / (height - 1), both greens 2048 (a ramp in each channel, so a
// reader can tell rows, columns and the colour sites apart; it is no scene and no white balance)
import { A, isUnmapped } from '../fw/model.mjs';
import { runtime } from './hle.mjs';

export const RAWFRAME_E143 = {
  geometry: 0x505492E6,     // rec_ImgProCtrl_Src_Bayer's normal-still branch
  banks: 0x50534A90,        // MM's allocation: the bank table's entry of a kind
  mm_addr: 0x50534DD1,      // MM's handle-to-address (d0 the handle; the address in d0)
  pool_addr: 0x505379BC,    // bank 0's pool class: its handle-to-address method
  bayer: 0x503AF9DE,        // TAKE's lookup of a shot's Bayer handle (d0 the id)
};
// the branch's bytes (null: a call's displacement): clr d0; mov d0,(24,sp); mov BITS,d0; call FORMAT; movhu d0,(8,a2);
// mov STRIDE,d0; movhu d0,(10,a2); mov WIDTH,d0; movhu d0,(12,a2); mov HEIGHT,d0; movhu d0,(14,a2); mov CROPW,d0;
// movhu d0,(16,a2); mov CROPH,d0; movhu d0,(18,a2)
const GEOMETRY_FORM = [0x00, 0x42, 0x18, 0x80, null, 0xcd, null, null, 0x80, 0x10, 0xf8, 0x72, 0x08,
  0x2c, null, null, 0xf8, 0x72, 0x0a, 0x2c, null, null, 0xf8, 0x72, 0x0c, 0x2c, null, null, 0xf8, 0x72, 0x0e,
  0x2c, null, null, 0xf8, 0x72, 0x10, 0x2c, null, null, 0xf8, 0x72, 0x12];
// asl 3,d0; add BANKS,d0; mov d0,a2; inc4 a2; mov (a2),d0
const BANKS_FORM = [0xf8, 0xc0, 0x03, 0xfc, 0xc0, null, null, null, null, 0xf1, 0xe2, 0x52, 0x72];
// the pool method's base and block loads: mov (8,a2),d3 at +0x28, mov (12,a2),d0 at +0x45
const POOL_FORM = [[0x28, [0xf8, 0x0e, 0x08]], [0x45, [0xf8, 0x02, 0x0c]], [0x1e, [0x24, 0x32, 0x01]]];
const POOL_BASE = 8, POOL_BLOCK = 12, POOL_COUNT = 306;

const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const matches = (b, form) => form.every((v, i) => v === null || b[i] === v);
const u16 = (b, o) => b[o] | b[o + 1] << 8;

// The Bayer buffer's geometry by the firmware's own reader on this body, or {skip: reason} where its bytes differ or
// MM's block is not the lab's memory ({skip, again: true} where MM's bank 0 has no pool yet)
export function geometry(sim, R = RAWFRAME_E143) {
  const none = Object.entries(R).find(([, a]) => isUnmapped(A(a)));
  if (none) return { skip: `the port places no ${none[0]} (E143 ${h8(none[1])}) on this body` };
  const at = A(R.geometry), b = sim.read(runtime(at), GEOMETRY_FORM.length);
  if (!matches(b, GEOMETRY_FORM)) return { skip: `rec_ImgProCtrl_Src_Bayer's normal-still geometry ${h8(at)} has another form on this body` };
  const bk = sim.read(runtime(A(R.banks)), BANKS_FORM.length);
  if (!matches(bk, BANKS_FORM)) return { skip: `MM's bank table read ${h8(A(R.banks))} has another form on this body` };
  const pm = A(R.pool_addr);
  for (const [o, f] of POOL_FORM) if (!matches(sim.read(runtime(pm) + o, f.length), f)) return { skip: `MM's pool address method ${h8(pm)} has another form on this body` };
  const G = { bits: b[4], stride: u16(b, 14), width: u16(b, 20), height: u16(b, 26), crop: [u16(b, 32), u16(b, 38)],
    banks: (bk[5] | bk[6] << 8 | bk[7] << 16 | bk[8] << 24) >>> 0, mm_addr: A(R.mm_addr), pool_addr: runtime(pm), bayer: A(R.bayer) };
  // the frame in MM's first block of the Bayer's bank (MM kind 0, bank 0: the kind TAKE's allocation asks for the
  // still's kinds 0 and 3 without setting 59729) must be memory of the lab's: E143's bank 0 starts at 0xb8000000, where
  // the lab's DRAM ends (src/fw/board.mjs dram_size, 384 MiB; X), so there the fill is skipped with the reason
  const pool = sim.u32(G.banks + 4) >>> 0;
  if (!pool || sim.u32(sim.u32(pool) + 8) >>> 0 !== G.pool_addr) return { skip: `MM's bank 0 has no pool of the class ${h8(G.pool_addr)} (pool ${h8(pool)}; MM's init not run yet?)`, again: true };
  const base = sim.u32(pool + POOL_BASE) >>> 0, bytes = frameBytes(G);
  if (!mapped(sim, base) || !mapped(sim, base + bytes - 1)) return { skip: `MM's Bayer block ${h8(base)}..${h8(base + bytes)} (bank 0, its block 0x${(sim.u32(pool + POOL_BLOCK) >>> 0).toString(16)} bytes) lies outside the lab's DRAM` };
  return G;
}
export const frameBytes = (G) => G.stride * 3 / 2 * G.height;
// whether an address is memory of the lab's (a read of an unmapped address is refused)
function mapped(sim, a) {
  try { sim.read(a >>> 0, 1); return true; } catch { return false; }
}

// the packed frame (A-RAWFRAME-1), made once per geometry
let cached = null;
export function pattern(G) {
  const key = `${G.bits}:${G.stride}:${G.width}:${G.height}`;
  if (cached?.key === key) return cached.data;
  if (G.bits !== 12 || G.stride % 2 !== 0 || G.width > G.stride) throw new RangeError(`S-RAWFRAME: no packing for ${G.bits} bits, stride ${G.stride}, width ${G.width}`);
  const row = G.stride * 3 / 2, data = new Uint8Array(row * G.height);
  for (let y = 0; y < G.height; y++) {
    const B = Math.round(4095 * y / (G.height - 1)), o = y * row;
    for (let x = 0; x < G.width; x += 2) {
      const p0 = y & 1 ? 2048 : Math.round(4095 * x / (G.width - 1)), p1 = y & 1 ? B : 2048;
      const q = o + x * 3 / 2;
      data[q] = p0 & 0xFF; data[q + 1] = p0 >> 8 | (p1 & 0xF) << 4; data[q + 2] = p1 >> 4;
    }
  }
  cached = { key, data };
  return data;
}
// one pixel of a packed frame (for checks)
export function pixel(data, G, x, y) {
  const q = y * G.stride * 3 / 2 + (x & ~1) * 3 / 2;
  return x & 1 ? data[q + 1] >> 4 | data[q + 2] << 4 : data[q] | (data[q + 1] & 0xF) << 8;
}

// S-RAWFRAME on a shot {id}: TAKE's Bayer handle and MM's address natively, MM's block from the handle's pool, the
// pattern written. Returns {handle, address, size, block, base, geometry}; throws where the buffer is missing or the
// frame does not fit MM's block
export function rawFrame(lab, shot, G) {
  const sim = lab.sim, e0 = lab.kernel.errors.length;
  const handle = lab.call(G.bayer, { d0: shot.id }, null, null, 2000000).d0 & 0xFFFF;
  const address = lab.call(G.mm_addr, { d0: handle }, null, null, 2000000).d0 >>> 0;
  if (!handle || !address || lab.kernel.errors.length !== e0) throw new Error(`S-RAWFRAME: the shot ${shot.id}'s Bayer handle 0x${handle.toString(16)}, MM's address ${h8(address)} (error logs: ${lab.kernel.errors.slice(e0).map(([c]) => h8(c)).join(' ') || 'none'})`);
  const pool = sim.u32(G.banks + 8 * (handle >>> 8) + 4) >>> 0, method = pool ? sim.u32(sim.u32(pool) + 8) >>> 0 : 0;
  if (!pool || method !== G.pool_addr) throw new Error(`S-RAWFRAME: the Bayer handle 0x${handle.toString(16)}'s pool ${h8(pool)} has the address method ${h8(method)}, not bank 0's class's ${h8(G.pool_addr)}`);
  const n = handle & 0xFF, count = sim.read(pool + POOL_COUNT, 2), block = sim.u32(pool + POOL_BLOCK) >>> 0, base = sim.u32(pool + POOL_BASE) >>> 0;
  if (n > u16(count, 0) || address !== (base + block * (n - 1)) >>> 0) throw new Error(`S-RAWFRAME: MM's address ${h8(address)} of the handle 0x${handle.toString(16)} is not block ${n} of its pool's first region (base ${h8(base)}, block 0x${block.toString(16)}, ${u16(count, 0)} blocks)`);
  const data = pattern(G);
  if (!mapped(sim, address) || !mapped(sim, address + data.length - 1)) throw new Error(`S-RAWFRAME: MM's block ${h8(address)}..${h8(address + data.length)} of the handle 0x${handle.toString(16)} lies outside the lab's DRAM`);
  if (data.length > block) throw new Error(`S-RAWFRAME: the frame's ${data.length} bytes do not fit MM's block of 0x${block.toString(16)}`);
  sim.write(address, data);
  return { handle, address, size: data.length, block, base, geometry: { bits: G.bits, stride: G.stride, width: G.width, height: G.height, crop: G.crop } };
}
