// The strict mode's data-cache model (src/lab/strict.mjs, --strict cache; off by default). The lab maps the cached
// DRAM view (0x60000000) and the uncached view (0xA0000000) onto the same bytes and has no cache (emu/FIDELITY-NOTES.md
// 4.1), so code that mixes the two views without the cache maintenance the camera needs runs clean in the lab. This
// model keeps, beside the lab's memory, what CPU 0's data cache would hold (A-DCACHE: write-back, write-allocate,
// set-associative, LRU, 16-byte lines; 8 KiB in 2 ways by default) and reports the accesses where the camera would
// see other bytes than the lab. It changes nothing the program reads: the run goes on with the lab's memory.
//   cache-stale-read      a load through the cached view hits a line whose copy differs from memory where a CPU store
//                         through the uncached view changed memory since the line's fill: the camera reads the
//                         line's old bytes
//   cache-lost-write      a dirty line leaves the cache (an eviction, or the flush K-CFLUSH answers) over bytes a CPU
//                         store through the uncached view changed since the fill: the camera's write-back undoes them
//   cache-uncached-stale  a load through the uncached view of bytes a cached store changed that are still only in
//                         the cache: the camera reads the bytes from before that store
// Only CPU stores through the uncached view mark bytes as changed behind the cache: the lab's own writes (stand-ins,
// DMA, the debugger) stand for hardware and firmware the lab does not run, whose maintenance it cannot see, so a line
// they changed is taken up again quietly at its next cached load. K-CFLUSH (the kernel's whole-cache flush, src/lab/
// menu.mjs) writes back and invalidates every line; maintenance of a range through the cache's control registers is
// not modelled (none is read yet), so such a sequence shows as a finding.
export const DCACHE_LINE = 16;
export const DCACHE_DEFAULT = { kib: 8, ways: 2 };    // A-DCACHE

const CACHED_LO = 0x60000000, CACHED_HI = 0x80000000, UNCACHED_LO = 0xA0000000, UNCACHED_HI = 0xC0000000;

export class DataCache {
  // report(kind, a, w, dir, v, where): one finding (strict.mjs StrictLog.report's shape)
  constructor({ kib = DCACHE_DEFAULT.kib, ways = DCACHE_DEFAULT.ways, report = () => {} } = {}) {
    const lines = (kib * 1024) / DCACHE_LINE, sets = lines / ways;
    if (!Number.isInteger(ways) || ways < 1 || !Number.isInteger(sets) || sets < 1) throw new Error(`strict cache: ${kib} KiB in ${ways} ways is not a whole number of sets`);
    this.kib = kib; this.ways = ways; this.sets = sets; this.report = report;
    this.tag = new Int32Array(lines).fill(-1);          // the line's memory offset >> 4 per slot
    this.dirty = new Uint16Array(lines);                // byte mask: cached stores not written back
    this.behind = new Uint16Array(lines);               // byte mask: CPU uncached stores since the fill
    this.data = new Uint8Array(lines * DCACHE_LINE);    // what the cache holds
    this.base = new Uint8Array(lines * DCACHE_LINE);    // memory's bytes at the fill
    this.age = new Float64Array(lines);
    this.clock = 0;
    this.counts = { fills: 0, evictions: 0, flushes: 0 };
    this.U8 = null; this.dramOff = 0;
  }
  // the lab's memory (src/core/mem.mjs setStrict): U8 and the offset of the cached view's first byte
  attach(U8, dramOff) { this.U8 = U8; this.dramOff = dramOff; this.tag.fill(-1); this.dirty.fill(0); this.behind.fill(0); }
  static cached(a) { return a >= CACHED_LO && a < CACHED_HI; }
  static uncached(a) { return a >= UNCACHED_LO && a < UNCACHED_HI; }
  _find(l) {
    const s0 = (l % this.sets) * this.ways;
    for (let i = s0; i < s0 + this.ways; i++) if (this.tag[i] === l) return i;
    return -1;
  }
  _fill(l) {
    const s0 = (l % this.sets) * this.ways;
    let v = s0;
    for (let i = s0; i < s0 + this.ways; i++) { if (this.tag[i] === -1) { v = i; break; } if (this.age[i] < this.age[v]) v = i; }
    if (this.tag[v] !== -1) { this.counts.evictions++; this._writeBack(v, 'an eviction'); }
    const m = l * DCACHE_LINE;
    this.tag[v] = l; this.dirty[v] = 0; this.behind[v] = 0; this.counts.fills++;
    this.data.set(this.U8.subarray(m, m + DCACHE_LINE), v * DCACHE_LINE);
    this.base.set(this.U8.subarray(m, m + DCACHE_LINE), v * DCACHE_LINE);
    return v;
  }
  // a dirty line leaving the cache: its dirty bytes overwrite memory, which a CPU uncached store changed under them
  _writeBack(slot, why) {
    const d = this.dirty[slot] & this.behind[slot];
    if (d === 0) return;
    const s = slot * DCACHE_LINE, m = this.tag[slot] * DCACHE_LINE;
    for (let b = 0; b < DCACHE_LINE; b++) {
      if ((d & (1 << b)) && this.U8[m + b] !== this.data[s + b]) {
        this.report('cache-lost-write', (CACHED_LO + m + b - this.dramOff) >>> 0, 1, 'w', this.data[s + b], `written back at ${why} over an uncached store's byte (memory 0x${this.U8[m + b].toString(16).padStart(2, '0')})`);
        return;
      }
    }
  }
  // before a CPU load of RAM: a its address, o its memory offset, w its size. A misaligned access has faulted before
  // this (src/core/mem.mjs), so an access is aligned to its size and k + w <= 16: it never crosses a line
  ld(a, o, w) {
    const l = o >>> 4, k = o & 15;
    if (DataCache.cached(a)) {
      let slot = this._find(l);
      if (slot < 0) slot = this._fill(l);
      else {
        const s = slot * DCACHE_LINE, m = l * DCACHE_LINE;
        for (let b = k; b < k + w; b++) {
          if ((this.behind[slot] & (1 << b)) && this.data[s + b] !== this.U8[m + b]) { this.report('cache-stale-read', a, w, 'r', this.U8[m + b], `the line holds 0x${this.data[s + b].toString(16).padStart(2, '0')} from before an uncached store`); break; }
        }
        // the lab goes on with memory's bytes: the line's clean bytes taken up again, so one change reports once
        for (let b = 0; b < DCACHE_LINE; b++) if (!(this.dirty[slot] & (1 << b))) { this.data[s + b] = this.U8[m + b]; this.base[s + b] = this.U8[m + b]; }
        this.behind[slot] &= this.dirty[slot];
      }
      this.age[slot] = ++this.clock;
    } else if (DataCache.uncached(a)) {
      const slot = this._find(l);
      if (slot >= 0 && this.dirty[slot] !== 0) {
        const s = slot * DCACHE_LINE;
        // the lab has no cache, so U8 already holds the cached store's byte; the camera's memory still holds base, the
        // byte at the fill. They differ only when the store changed the byte (a store of the same value reads the same)
        for (let b = k; b < k + w; b++) {
          if ((this.dirty[slot] & (1 << b)) && this.base[s + b] !== this.U8[l * DCACHE_LINE + b]) { this.report('cache-uncached-stale', a, w, 'r', this.U8[l * DCACHE_LINE + b], `a cached store's byte not written back (memory still 0x${this.base[s + b].toString(16).padStart(2, '0')})`); break; }
        }
      }
    }
  }
  // before a CPU store to RAM (v the value, w bytes little-endian); aligned as ld's, within one line
  st(a, o, w, v) {
    const l = o >>> 4, k = o & 15;
    if (DataCache.cached(a)) {
      let slot = this._find(l);
      if (slot < 0) slot = this._fill(l);                  // write-allocate: the line comes in with memory's bytes
      const s = slot * DCACHE_LINE;
      for (let b = 0; b < w; b++) { this.data[s + k + b] = (v >>> (8 * b)) & 0xff; this.dirty[slot] |= 1 << (k + b); }
      this.age[slot] = ++this.clock;
    } else if (DataCache.uncached(a)) {
      const slot = this._find(l);
      if (slot >= 0) for (let b = 0; b < w; b++) this.behind[slot] |= 1 << (k + b);
    }
  }
  // K-CFLUSH: every line written back and invalidated
  flush() {
    this.counts.flushes++;
    for (let i = 0; i < this.tag.length; i++) if (this.tag[i] !== -1) { this._writeBack(i, 'the flush'); this.tag[i] = -1; this.dirty[i] = 0; this.behind[i] = 0; }
  }
}
