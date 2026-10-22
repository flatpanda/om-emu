// Guest memory of the OM-Emu machine: the board's address map (machine.mjs) (RAM, ROM, ROM
// devices, MMIO, the lab stub below 0x80000000..0x9FFFFFFF, unassigned elsewhere), with the access rules of the CPU's
// load/store (alignment fault 3, flash-view store fault 2, bus error fault 2) and of the debugger's access
// (reads go to the device with the debugger requester id, writes store into RAM, ROM and ROM devices and skip
// everything else).
//
// One machine per realm: the state is module-level and initMemory() replaces all of it. The ArrayBuffer itself is
// allocated once per realm, at the size of the largest machine (BUF_SIZE), and reused: initMemory() zeroes every
// 64 KiB physical page the previous machine may have written and resets every map, so a new machine starts from the same
// bytes as on a never-used buffer. A page counts as written (DIRTY) when a ROM-device window is allocated on it, on a
// debugger or DMA write into it, on a slow-path CPU store, and when a RAM page's fast CPU store path is enabled: a whole
// RAM page starts with its store entry WP off (-1) and the first CPU store to it takes the slow path, which marks the
// page and enables WP (same result: ramWrite is the fast path's store). Zeroing only those pages keeps never-touched
// pages uncommitted (a fill of the whole buffer commits all 432 MiB).

export class Fault {                 // a CPU fault, thrown inside an instruction
  constructor(code, addr) { this.code = code; this.addr = addr >>> 0; }
}
export const BUS = Object.freeze({ bus: true });   // thrown by a device handler: MEMTX_ERROR
export class Unported extends Error {              // a device path not ported (yet): host-side abort
  constructor(what) { super(`unported: ${what}`); this.name = 'Unported'; }
}
// An interrupt look emu cannot decide without a translation-block layout it does not model (interp.mjs refusals a-e).
// It is thrown at an instruction boundary, so unlike other host errors it leaves the machine runnable (machine.mjs).
export class TbUndecidable extends Unported {}

export const K_RAM = 1, K_ROM = 2, K_ROMD = 3, K_MMIO = 4;
export const LOW_OFF = 0, LOW_SIZE = 0x40000;
export const ROM_OFF = 0x40000, ROM_SIZE = 0x2000000;
export const DRAM_OFF = 0x2040000;

export let buf = null, U8 = null, U16 = null, I32 = null;
export let TOTAL = 0, DRAM_SIZE = 0;
export const RP = new Int32Array(65536), WP = new Int32Array(65536);   // 64 KiB page -> physical offset or -1
const WPL = new Int32Array(65536);                                      // RAM page -> its WP offset, enabled lazily
let DIRTY = null;                                                        // 64 KiB physical page possibly written
export function markDirty(o, len) { if (len > 0) for (let p = o >>> 16; p <= (o + len - 1) >>> 16; p++) DIRTY[p] = 1; }
let PAGES = new Array(65536).fill(null);                                // 64 KiB page -> regions overlapping it
export let CODEPG = null;                                                // 4 KiB physical page holds decoded code
let winNext = 0;
let stub = null;                                                         // the lab stub (src/dev/stub.mjs)
let smcHook = (o) => {};
export function setSmcHook(f) { smcHook = f; }
export const ctx = { pc: () => 0, insns: () => 0 };                      // current_cpu pc / insns for device logs
// ---- debug hooks (src/debug/, machine.mjs): off unless a debugger installs them, and tested only on slow paths.
// MT, the MMIO trace: MT(dir 0 read / 1 write, addr, value, size, region name, cpu 0 (the CPU) / -1 (the debugger), err).
// The memory_region_ops_read/write lines: a read after the device returned (a bus error with value
// 0), a write before the device takes it, only for regions accessed as I/O
// (devices, the lab stub, ROM-device writes; never RAM, ROM, ROM-device reads, unassigned memory or debugger writes).
let MT = null;
export function setMmioTrace(f) { MT = f; }
// Watchpoints, per CPU virtual address as GDB's (0x6xxxxxxx and its uncached alias 0xAxxxxxxx are separate
// ranges): a 64 KiB page holding a watched byte loses its RP/WP fast entries (WPG), so only slowLd/slowSt see it and
// check it (WON). Only CPU data accesses hit; debugger accesses, device-side accesses and code fetches never do. A
// 'stop' entry records the first hit in WHIT and calls WHOOK.stop() (the machine sets S.kick inside a continue); a
// 'log' entry calls WHOOK.log(record) and touches nothing else. Record: {id, kind, addr (the access), hit (the
// reported address: the watchpoint's start), size, dir 'r'/'w', value, pc, insns}.
let WON = false, WL = [];
const WPG = new Uint8Array(65536);
export let WHIT = null;
let WHOOK = { stop() {}, log() {} };
export function clearWatchHit() { WHIT = null; }
// list: [{id, lo, hi (exclusive), kind: 1 read, 2 write, 3 access, stop: bool}]
export function setWatchpoints(list, hooks = WHOOK) {
  for (let p = 0; p < 65536; p++) if (WPG[p] !== 0) { WPG[p] = 0; restorePage(p); }
  WL = list.map((r) => ({ id: r.id, lo: r.lo, hi: r.hi, kind: r.kind, stop: !!r.stop }));
  WON = WL.length > 0; WHOOK = hooks; WHIT = null;
  for (const r of WL) for (let p = Math.floor(r.lo / 65536); p <= Math.floor((r.hi - 1) / 65536) && p < 65536; p++) WPG[p] = 1;
  maskWatchedPages();
}
function maskWatchedPages() { if (WON) for (let p = 0; p < 65536; p++) if (WPG[p] !== 0) { RP[p] = -1; WP[p] = -1; } }
function restorePage(p) {             // addRegion's fast entries for a page (its RAM store entry stays lazy)
  RP[p] = -1; WP[p] = -1;
  const list = PAGES[p];
  if (list !== null) for (const r of list) if (r.base <= p * 0x10000 && r.end >= (p + 1) * 0x10000 && r.kind !== K_MMIO) RP[p] = r.off + (p * 0x10000 - r.base);
}
// The entries are checked last first: of overlapping watchpoints set in list order the last one set reports the hit.
function watchCheck(a, w, dir, v) {
  a >>>= 0;
  for (let i = WL.length - 1; i >= 0; i--) {
    const r = WL[i];
    if ((r.kind & (dir + 1)) !== 0 && a < r.hi && a + w > r.lo) {
      const rec = { id: r.id, kind: r.kind, addr: a, hit: r.lo, size: w, dir: dir ? 'w' : 'r', value: v >>> 0, pc: ctx.pc() >>> 0, insns: ctx.insns() };
      if (!r.stop) WHOOK.log(rec);
      else if (WHIT === null) { WHIT = rec; WHOOK.stop(); }
    }
  }
}
// The CPU's last I/O access (a device, the lab stub or a ROM device's write): the insns
// count and pc of the accessing instruction. An I/O access from an instruction that is not its TB's last ends the
// TB there, so the next instruction starts a TB either way (interp.mjs refusal c).
export const IO = { n: -1, pc: 0 };
function ioAccess() { IO.n = ctx.insns(); IO.pc = ctx.pc() | 0; }
// For a device on a region marked ram (the bus window, whose backed ranges are RAM): an access the device
// treats as I/O (an unbacked bus range) marks itself.
export function ioMark() { ioAccess(); }
// The CPU's stores into a 4 KiB page with decoded code, which may hit a running TB (precise SMC, interp.mjs refusal
// c): a ring of the last 32, the insns count of the storing instruction and the physical offset; CST.k counts every
// store recorded (CST.k > 32: the oldest are gone). The decode cache's own invalidation follows (smcHook).
export const CST = { n: new Float64Array(32), o: new Int32Array(32), k: 0 };
function cpuStore(o) {
  const j = CST.k++ & 31;
  CST.n[j] = ctx.insns(); CST.o[j] = o;
  smcHook(o);
}

const WIN_SPACE = 0x1000000;         // room for the ROM-device windows (VSC output 8 MiB, stub window 1 MiB, ...)
export const DRAM_MAX = 512 << 20;    // the largest machine's DRAM (src/fw/board.mjs dram_size)
export const BUF_SIZE = DRAM_OFF + DRAM_MAX + WIN_SPACE;

export function initMemory(dramBytes) {
  DRAM_SIZE = dramBytes;
  TOTAL = DRAM_OFF + dramBytes + WIN_SPACE;
  if (buf === null) {
    buf = new ArrayBuffer(BUF_SIZE);
    U8 = new Uint8Array(buf); U16 = new Uint16Array(buf); I32 = new Int32Array(buf);
    DIRTY = new Uint8Array(BUF_SIZE >>> 16);
  } else {
    for (let p = 0; p < DIRTY.length; p++) if (DIRTY[p] !== 0) { U8.fill(0, p << 16, (p + 1) << 16); DIRTY[p] = 0; }
  }
  RP.fill(-1); WP.fill(-1); WPL.fill(-1);
  PAGES = new Array(65536).fill(null);
  MT = null; WON = false; WL = []; WPG.fill(0); WHIT = null; WHOOK = { stop() {}, log() {} };
  CODEPG = new Uint8Array((TOTAL >>> 12) + 1);
  winNext = DRAM_OFF + dramBytes;
  stub = null;
  IO.n = -1; IO.pc = 0; CST.k = 0;
}
// Physical space for a ROM device's RAM (64 KiB aligned, so a window of whole pages maps for CPU reads).
export function allocWindow(size) {
  const off = winNext;
  winNext += (size + 0xffff) & ~0xffff;
  if (winNext > TOTAL) throw new Error('window space exhausted');
  markDirty(off, size);                 // device views write here at any time
  return off;
}
export function setStub(s) { stub = s; }

// A region: { base, size, kind, off (RAM-like: physical offset), dev (MMIO: read/write; ROMD: romdWrite) }.
export function addRegion(r) {
  r.base >>>= 0;
  r.end = r.base + r.size;
  for (let p = r.base >>> 16; p <= (r.end - 1) >>> 16; p++) {
    (PAGES[p] ||= []).push(r);
    const whole = r.base <= p * 0x10000 && r.end >= (p + 1) * 0x10000;
    if (whole && r.kind !== K_MMIO) {
      RP[p] = r.off + (p * 0x10000 - r.base);
      if (r.kind === K_RAM) WPL[p] = RP[p];           // enabled by the first CPU store (slowSt)
      if (WPG[p] !== 0) RP[p] = -1;                   // a watched page keeps its fast entries off (maskWatchedPages)
    }
  }
  return r;
}
// Re-point whole 64 KiB pages [base, base + size) (the bus window, A17): their regions and page-table
// entries go, then the given regions are added (a K_RAM alias of DRAM gets RP and, at its first CPU store, WP).
export function remapPages(base, size, regions) {
  for (let p = base >>> 16; p < (base + size) / 0x10000; p++) { PAGES[p] = null; RP[p] = -1; WP[p] = -1; WPL[p] = -1; }
  for (const r of regions) addRegion(r);
  maskWatchedPages();                                   // the remap's pages too: a watched page stays on the slow path
}
export function findRegion(a) {
  a >>>= 0;
  const list = PAGES[a >>> 16];
  if (list !== null) for (let i = 0; i < list.length; i++) { const r = list[i]; if (a >= r.base && a < r.end) return r; }
  return null;
}
const inStub = (a) => (a >>> 0) >= 0x80000000 && (a >>> 0) < 0xA0000000;

function ramRead(o, w) { return w === 4 ? I32[o >> 2] : w === 2 ? U16[o >> 1] : U8[o]; }
function ramWrite(o, v, w) {
  if (CODEPG[o >>> 12] !== 0) cpuStore(o);
  if (w === 4) I32[o >> 2] = v; else if (w === 2) U16[o >> 1] = v; else U8[o] = v;
}

// ---- CPU data access (load/store; bus fault) ----------------------------------------------------------------------
function slowLd(a, w) {
  const r = findRegion(a);
  if (r === null) {
    if (inStub(a) && stub !== null) {
      ioAccess();
      let v;
      try { v = stub.read(a >>> 0, w, false) | 0; } catch (e) { if (e === BUS) { if (MT !== null) MT(0, a >>> 0, 0, w, 'om1.lab-stub', 0, true); throw new Fault(2, a); } throw e; }
      if (MT !== null) MT(0, a >>> 0, v >>> 0, w, 'om1.lab-stub', 0, false);
      if (WON) watchCheck(a, w, 0, v);
      return v;
    }
    throw new Fault(2, a);
  }
  if (r.kind !== K_MMIO) {
    if (!WON) return ramRead(r.off + ((a >>> 0) - r.base), w);
    const v = ramRead(r.off + ((a >>> 0) - r.base), w);
    watchCheck(a, w, 0, v);
    return v;
  }
  // A region marked ram (the bus window's pages off bus DRAM) is RAM or unassigned memory: no I/O of its own
  // (the device marks an unassigned access itself) and no memory_region_ops trace line, read or bus error.
  const io = !r.ram;
  if (io) ioAccess();
  let v;
  try { v = r.dev.read(a >>> 0, w, false) | 0; } catch (e) { if (e === BUS) { if (MT !== null && io) MT(0, a >>> 0, 0, w, r.name, 0, true); throw new Fault(2, a); } throw e; }
  if (MT !== null && io) MT(0, a >>> 0, v >>> 0, w, r.name, 0, false);
  if (WON) watchCheck(a, w, 0, v);
  return v;
}
function slowSt(a, v, w) {
  if ((a >>> 0) >= 0x50000000 && (a >>> 0) < 0x52000000) throw new Fault(2, a);   // the flash view
  const r = findRegion(a);
  try {
    if (r === null) {
      if (inStub(a) && stub !== null) {
        ioAccess();
        const sv = w === 4 ? v >>> 0 : v & (w === 2 ? 0xffff : 0xff);
        if (MT !== null) MT(1, a >>> 0, sv, w, 'om1.lab-stub', 0, false);
        if (WON) watchCheck(a, w, 1, sv);
        stub.write(a >>> 0, sv, w, false);
        return;
      }
      throw new Fault(2, a);
    }
    if (r.kind === K_RAM) {
      const o = r.off + ((a >>> 0) - r.base), p = a >>> 16;
      DIRTY[o >>> 16] = 1;
      if (WPL[p] >= 0 && WPG[p] === 0) WP[p] = WPL[p];   // a whole RAM page, not watched: its fast store path from now on
      if (WON) watchCheck(a, w, 1, w === 4 ? v : v & (w === 2 ? 0xffff : 0xff));
      ramWrite(o, v, w);
      return;
    }
    const uv = w === 4 ? v >>> 0 : v & (w === 2 ? 0xffff : 0xff);
    if (r.kind === K_ROMD || r.kind === K_MMIO) {
      const io = !r.ram;                        // a region marked ram: no I/O of its own and no trace line (slowLd)
      if (io) ioAccess();
      if (MT !== null && io) MT(1, a >>> 0, uv, w, r.name, 0, false);
      if (WON) watchCheck(a, w, 1, uv);
      if (r.kind === K_ROMD) r.dev.romdWrite(a >>> 0, uv, w); else r.dev.write(a >>> 0, uv, w, false);
      return;
    }
    throw new Fault(2, a);                      // ROM outside the flash view: none in this map
  } catch (e) { if (e === BUS) throw new Fault(2, a); throw e; }
}
export function ld8(a) { const b = RP[a >>> 16]; return b >= 0 ? U8[b + (a & 0xffff)] : slowLd(a, 1) & 0xff; }
export function ld16(a) {
  if (a & 1) throw new Fault(3, a);
  const b = RP[a >>> 16]; return b >= 0 ? U16[(b + (a & 0xffff)) >> 1] : slowLd(a, 2) & 0xffff;
}
export function ld32(a) {
  if (a & 3) throw new Fault(3, a);
  const b = RP[a >>> 16]; return b >= 0 ? I32[(b + (a & 0xffff)) >> 2] : slowLd(a, 4);
}
export function st8(a, v) {
  const b = WP[a >>> 16];
  if (b < 0) return slowSt(a, v, 1);
  const o = b + (a & 0xffff); if (CODEPG[o >>> 12] !== 0) cpuStore(o); U8[o] = v;
}
export function st16(a, v) {
  if (a & 1) throw new Fault(3, a);
  const b = WP[a >>> 16];
  if (b < 0) return slowSt(a, v, 2);
  const o = b + (a & 0xffff); if (CODEPG[o >>> 12] !== 0) cpuStore(o); U16[o >> 1] = v;
}
export function st32(a, v) {
  if (a & 3) throw new Fault(3, a);
  const b = WP[a >>> 16];
  if (b < 0) return slowSt(a, v, 4);
  const o = b + (a & 0xffff); if (CODEPG[o >>> 12] !== 0) cpuStore(o); I32[o >> 2] = v;
}
// Code fetch: RAM, ROM or a ROM device's RAM; anything else is a bus fault (not counted). A device region
// with a fetch hook decides for itself (the bus window refuses a fetch from a live-view range: Unported).
export function codePhys(a) {
  const b = RP[a >>> 16];
  if (b >= 0) return b + (a & 0xffff);
  const r = findRegion(a);
  if (r !== null && r.kind !== K_MMIO) return r.off + ((a >>> 0) - r.base);
  if (r !== null && r.dev.fetch) return r.dev.fetch(a >>> 0);
  return -1;
}
export function cb(a) {
  const b = RP[a >>> 16];
  if (b >= 0) return U8[b + (a & 0xffff)];
  const o = codePhys(a);
  if (o < 0) return cbIo(a);
  return U8[o];
}
// A code byte that is not RAM-like. On the lab stub's range the CPU executes from MMIO: the TB is
// one-shot and one instruction (also when only its second page is MMIO), the
// translator reads every byte once, in order, through the device, and the helper reads op, the prefix byte and its
// operands again. Outside FETCH.io the fetch throws MmioFetch, so the interpreter runs that
// instruction as such (interp.mjs: no decode slot, step(true) with FETCH.io set); inside it each byte is a stub read
// (logged in the stub's ring; a denied one prints, then fault 2, not counted). A code fetch from another device's
// registers would execute their reads: not modelled (Unported). Anything else is fault 2.
export class MmioFetch { constructor(a) { this.addr = a >>> 0; } }
export const FETCH = { io: false };
function cbIo(a) {
  const r = findRegion(a);
  if (r === null && inStub(a) && stub !== null) {
    if (!FETCH.io) throw new MmioFetch(a);
    ioAccess();
    // the translator's and the helper's reads go through the device (io_readx): memory_region_ops_read lines, cpu 0
    let v;
    try { v = stub.read(a >>> 0, 1, false) & 0xff; } catch (e) { if (e === BUS) { if (MT !== null) MT(0, a >>> 0, 0, 1, 'om1.lab-stub', 0, true); throw new Fault(2, a); } throw e; }
    if (MT !== null) MT(0, a >>> 0, v, 1, 'om1.lab-stub', 0, false);
    return v;
  }
  if (r !== null && r.kind === K_MMIO && !r.dev.fetch) throw new Unported(`code fetch from the device registers of ${r.name} at 0x${(a >>> 0).toString(16).padStart(8, '0')} (executing their reads is not modelled)`);
  throw new Fault(2, a);
}

// ---- debugger access ('m' / 'M') ----------------------------------------------------------------------------------
// The access size for a device: at most 4 bytes, bounded by the address alignment, a power of two.
function accessSize(len, addr) {
  let max = 4;
  const align = addr & -addr;
  if (align !== 0 && align < max) max = align;
  if (len > max) len = max;
  return len >= 4 ? 4 : len >= 2 ? 2 : 1;
}
// Returns the bytes, or null where the debug stub answers E14 (a device or stub read error, unassigned memory).
export function dbgRead(a, n) {
  const out = new Uint8Array(n);
  let pos = a >>> 0, i = 0;
  while (i < n) {
    const r = findRegion(pos);
    if (r !== null && r.kind !== K_MMIO) {
      const len = Math.min(n - i, r.end - pos), o = r.off + (pos - r.base);
      out.set(U8.subarray(o, o + len), i);
      i += len; pos = (pos + len) >>> 0; continue;
    }
    let end = r !== null ? r.end : nextRegionStart(pos);
    const len0 = Math.min(n - i, end - pos);
    if (r !== null && r.dev.dbgRead) {           // a device with RAM behind it (the bus window): one bulk read
      const d = r.dev.dbgRead(pos, len0);
      if (d === null) return null;
      out.set(d, i);
      i += len0; pos = (pos + len0) >>> 0; continue;
    }
    let done = 0;
    while (done < len0) {
      const addr = (pos + done) >>> 0, l = accessSize(len0 - done, addr);
      let v;
      try {
        if (r !== null) v = r.dev.read(addr, l, true);
        else if (inStub(addr) && stub !== null) v = stub.read(addr, l, true);
        else return null;
      } catch (e) {
        if (e === BUS) { if (MT !== null) MT(0, addr, 0, l, r !== null ? r.name : 'om1.lab-stub', -1, true); return null; }
        throw e;
      }
      if (MT !== null) MT(0, addr, v >>> 0, l, r !== null ? r.name : 'om1.lab-stub', -1, false);
      for (let k = 0; k < l; k++) out[i + done + k] = (v >>> (8 * k)) & 0xff;
      done += l;
    }
    i += len0; pos = (pos + len0) >>> 0;
  }
  return out;
}
function nextRegionStart(a) {      // the first region base above a within its 64 KiB page (or the page end)
  let end = ((a >>> 16) + 1) * 0x10000;
  const list = PAGES[a >>> 16];
  if (list !== null) for (const r of list) if (r.base > a && r.base < end) end = r.base;
  return end;
}
// address_space_write_rom: RAM, ROM and ROM-device RAM are stored (code invalidated), anything else is skipped.
export function dbgWrite(a, bytes) {
  let pos = a >>> 0, i = 0;
  const n = bytes.length;
  while (i < n) {
    const r = findRegion(pos);
    if (r !== null && r.kind !== K_MMIO) {
      const len = Math.min(n - i, r.end - pos), o = r.off + (pos - r.base);
      U8.set(bytes.subarray(i, i + len), o);
      markDirty(o, len);
      invalidateRange(o, len);
      i += len; pos = (pos + len) >>> 0; continue;
    }
    const end = r !== null ? r.end : nextRegionStart(pos);
    const len = Math.min(n - i, end - pos);
    if (r !== null && r.dev.dbgWrite) r.dev.dbgWrite(pos, bytes.subarray(i, i + len));   // the bus window's RAM
    i += len; pos = (pos + len) >>> 0;
  }
}
export function invalidateRange(o, len) {
  for (let p = o >>> 12; p <= (o + len - 1) >>> 12; p++) {
    if (CODEPG[p] !== 0) {
      const lo = Math.max(o, p << 12), hi = Math.min(o + len, (p + 1) << 12);
      for (let c = lo & ~0xff; c < hi; c += 0x100) smcHook(c);
    }
  }
}
// Physical offset of a RAM-like address (debugger convenience for devices and the bus), or -1.
export function phys(a) { return codePhys(a); }

// ---- snapshot and restore (machine.mjs snapshot(); taken at a stop) -------------------------------------------------
// Memory: every 64 KiB physical page marked DIRTY is copied; restore copies those back, zeroes every page dirtied since
// (dirty now, absent from the snapshot) and sets DIRTY to the snapshot's set. The page tables (RP, WP, WPL, PAGES, a
// shallow copy: the region objects are shared), the code-page marks (CODEPG), the I/O and store records of the kick
// refusals (IO, CST) and the window allocator go with it. Watched pages keep their fast entries off after a restore.
export function memSnapshot() {
  const pages = [];
  for (let p = 0; p < DIRTY.length; p++) if (DIRTY[p] !== 0) pages.push(p);
  const data = new Uint8Array(pages.length << 16);
  pages.forEach((p, i) => data.set(U8.subarray(p << 16, (p + 1) << 16), i << 16));
  return { pages: Int32Array.from(pages), data, RP: RP.slice(), WP: WP.slice(), WPL: WPL.slice(), PAGES: PAGES.map((l) => l === null ? null : l.slice()),
    CODEPG: CODEPG.slice(), IO: { ...IO }, CST: { n: CST.n.slice(), o: CST.o.slice(), k: CST.k }, winNext, stub, TOTAL, DRAM_SIZE };
}
export function memRestore(s) {
  if (s.TOTAL !== TOTAL || s.DRAM_SIZE !== DRAM_SIZE) throw new Error('memRestore: a snapshot of another memory layout');
  const keep = new Uint8Array(DIRTY.length);
  s.pages.forEach((p, i) => { keep[p] = 1; U8.set(s.data.subarray(i << 16, (i + 1) << 16), p << 16); });
  for (let p = 0; p < DIRTY.length; p++) {
    if (DIRTY[p] !== 0 && keep[p] === 0) U8.fill(0, p << 16, (p + 1) << 16);
    DIRTY[p] = keep[p];
  }
  RP.set(s.RP); WP.set(s.WP); WPL.set(s.WPL);
  PAGES = s.PAGES.map((l) => l === null ? null : l.slice());
  CODEPG.set(s.CODEPG);
  IO.n = s.IO.n; IO.pc = s.IO.pc; CST.n.set(s.CST.n); CST.o.set(s.CST.o); CST.k = s.CST.k;
  winNext = s.winNext; stub = s.stub;
  maskWatchedPages();
}
export function memSnapshotBytes(s) { return s.data.length; }
