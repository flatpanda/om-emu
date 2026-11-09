// iscpeer.mjs: the MN half of the OM-1 A53's ISC transport, outside QEMU.
//
// This plays MN node(s) 0..3 against the A53 (node 4) over the ISC shared
// memory + control block + doorbells. It implements isc_start's control-block
// contract and isc_send / isc_receive's FIFO format exactly as decoded from the
// A53's iscdrv.ko (see tools/a53-oracle/README.md and docs/hle-gaps.md 4.11.1);
// the same encoding is what the MN firmware's own ISC library at 0x6034d018 /
// 0x50aa324b uses, so this peer is interchangeable with CPU 1's half.
//
// Two backends:
//   - "buf": an in-process ArrayBuffer (used by `selftest`), for verifying the
//     FIFO logic with no QEMU.
//   - "file": a memory-backend-file shared with a running QEMU guest, accessed
//     at offset (addr - RAM_BASE). The doorbell (raising the A53's receive IRQ)
//     is NOT something a plain shared file can do; see README "The wall".
//
// Evidence tags as in docs/: D read from code at the address shown; I inference;
// ? unknown. All offsets below are D from iscdrv.ko unless tagged otherwise.

import fs from 'node:fs';

// --- Configuration (D, iscdrv.ko .data + the MN table 0x6034d018) -------------
// .data: drv_lock_id=7, mem_size=0x20000, mem_addr[5]={0x63fe0000 x4,
// 0x2_a3fe0000}, channel_nr=0x30, cb_size=0x400, cb_addr=0x97f00c00.
export const CFG = {
  lockId: 7,
  memSize: 0x20000,                 // 128 KiB per node
  memAddr: [0x63fe0000n, 0x63fe0000n, 0x63fe0000n, 0x63fe0000n, 0x2a3fe0000n],
  channels: 0x30,                   // 48 ports
  cbSize: 0x400,                    // 1024 bytes
  cbAddr: 0x97f00c00n,
  lockBase: 0x97000000n,            // kernel isc_lock_init ioremap (D, scc_init area)
  banks: [0x99200000n, 0x99300000n, 0x99b00000n, 0x99b80000n], // irqcon banks (D, .rodata+0x110)
  nodeCount: 5,
};

// Control block (D, isc_start 0x2228): u16 magic @0, u8 node_count @2,
// u32 @4 the pool's metadata size, then one u16 FIFO offset per node @8. The
// +4 word is memblock_init's third argument (isc_start 0x2638), stored >> shift
// as the first block memblock_check accepts (0x3420: block >= it), so it is the
// size of the header blocks, not of the pool: with the pool size there (0x20000)
// every ISC_attach_mem failed -1 (X: dbgterm_server and isc_cgi). The MN builder
// 0x50aa63c5 returns exactly that size (header rounded up to blocks, D) and its
// caller 0x50aa6457 hands it on to the control-block writer 0x50aa5aac (that
// the writer stores it at +4 is I). The magic is
// 0x1000 | (sum of the config bytes & 0xff) (I: field set is my reading of the
// byte-sum chain at 0x23b8..0x2554; the data-plane below does not depend on it).
export function controlMagic(cfg = CFG) {
  let sum = 0;
  for (const a of cfg.memAddr) for (let i = 0n; i < 8n; i++) sum += Number((a >> (8n * i)) & 0xffn);
  for (const v of [cfg.memSize, cfg.cbSize, cfg.channels, cfg.lockId]) {
    let x = v >>> 0;
    for (let i = 0; i < 4; i++) { sum += x & 0xff; x >>>= 8; }
  }
  for (let i = 0n; i < 8n; i++) sum += Number((cfg.cbAddr >> (8n * i)) & 0xffn);
  return 0x1000 | (sum & 0xff);
}

// FIFO header (one per receiving node) (D, isc_start 0x25cc / isc_send 0x1c48 /
// isc_receive 0x14c8): u16 state @0, u16 size @2, u16 read @4, u16 write @6,
// u32 @8 the page frame of that node's view of the shared pool; data from @12.
// The +8 word is what isc_mem_paddr (0x2830) adds, << 12, to block << shift to
// find a pool buffer's physical address for ISC_attach_mem's mapping (D); left 0,
// every A53 attach mapped physical page 0 + block, outside the pool, so the CGI
// info block and its reply went nowhere (X). state 0x1000 = owner starting,
// 0x2000 = running, 0x3000 = refused-if-already (D). A message is {u8 port,
// u8 len}+payload, len <= 128, port < 48; free = (read - 1 - write) mod size.
const FIFO_HDR = 12, MSG_MAX = 128, STATE_RUN = 0x2000, STATE_START = 0x1000;

// A node's receive FIFO: a view over the shared memory at memAddr[node]+off.
export class Fifo {
  constructor(mem, base, size) { this.m = mem; this.base = base; this.size = size; }
  init(state = STATE_RUN) {
    this.m.setU16(this.base + 0, state);
    this.m.setU16(this.base + 2, this.size - FIFO_HDR);
    this.m.setU16(this.base + 4, 0);
    this.m.setU16(this.base + 6, 0);
  }
  get state() { return this.m.getU16(this.base + 0); }
  get cap() { return this.m.getU16(this.base + 2); }
  get rd() { return this.m.getU16(this.base + 4); }
  get wr() { return this.m.getU16(this.base + 6); }
  // isc_send: write {port,len}+payload at wr with wrap; advance wr.
  push(port, payload) {
    if (port >= CFG.channels) throw new Error(`port ${port} >= ${CFG.channels}`);
    if (payload.length > MSG_MAX) throw new Error(`len ${payload.length} > ${MSG_MAX}`);
    const need = payload.length + 2, cap = this.cap;
    let wr = this.wr, rd = this.rd;
    const used = (wr - rd + cap) % cap;
    if (cap - used - 1 < need) return -4;        // ISC_FIFO_FULL (isc_send 0x1ed0)
    const putB = (b) => { this.m.setU8(this.base + FIFO_HDR + wr, b); wr = (wr + 1) % cap; };
    putB(port); putB(payload.length);
    for (const b of payload) putB(b);
    this.m.setU16(this.base + 6, wr);
    return payload.length;
  }
  // isc_receive: read one message at rd; port 0xff is skipped by the driver.
  pop() {
    const cap = this.cap;
    let rd = this.rd; const wr = this.wr;
    if (rd === wr) return null;
    const getB = () => { const b = this.m.getU8(this.base + FIFO_HDR + rd); rd = (rd + 1) % cap; return b; };
    const port = getB(), len = getB();
    const data = Buffer.alloc(len);
    for (let i = 0; i < len; i++) data[i] = getB();
    this.m.setU16(this.base + 4, rd);
    return { port, data };
  }
}

// Memory backends -------------------------------------------------------------
class BufMem {               // flat buffer with an address->offset map (selftest)
  constructor(bytes) { this.b = Buffer.alloc(bytes); this.map = []; }
  region(addr, off, len) { this.map.push([BigInt(addr), off, len]); }
  _o(addr) {
    const a = BigInt(addr);
    for (const [base, off, len] of this.map) if (a >= base && a < base + BigInt(len)) return off + Number(a - base);
    throw new Error(`unmapped ${a.toString(16)}`);
  }
  getU8(a) { return this.b.readUInt8(this._o(a)); }
  setU8(a, v) { this.b.writeUInt8(v & 0xff, this._o(a)); }
  getU16(a) { return this.b.readUInt16LE(this._o(a)); }
  setU16(a, v) { this.b.writeUInt16LE(v & 0xffff, this._o(a)); }
  getU32(a) { return this.b.readUInt32LE(this._o(a)); }
  setU32(a, v) { this.b.writeUInt32LE(v >>> 0, this._o(a)); }
}
// memory-backend-file shared with QEMU; the address->file-offset map MUST match
// the om-isc device's backend layout (hw/misc/om-isc.c: O_LOCK/O_SCC/O_CB/O_MEM).
// The MN view (0x63fe0000) and the A53 view (0x2_a3fe0000) are the SAME shared
// pool, so both map to ONE region (O_MEM=0x10000): a buffer written through one
// window is then visible through the other (D, isc_socket.dis 0x12b3c maps an MN
// address into A53 space as (addr & 0x3fffffff) | 0x2_80000000).
class FileMem {
  constructor(path) {
    this.fd = fs.openSync(path, 'r+');
    this.map = [
      [0x97000000n, 0x00000, 0x200],    // lock
      [0x97f00b80n, 0x01000, 0x80],     // scc
      [0x97f00c00n, 0x02000, 0x400],    // control block
      [0x63fe0000n, 0x10000, 0x20000],  // shared pool, MN view
      [0x2a3fe0000n, 0x10000, 0x20000], // shared pool, A53 view (same region)
    ];
  }
  _o(a) {
    const x = BigInt(a);
    for (const [base, off, len] of this.map) if (x >= base && x < base + BigInt(len)) return off + Number(x - base);
    throw new Error(`unmapped ${x.toString(16)}`);
  }
  _rd(a, n) { const b = Buffer.alloc(n); fs.readSync(this.fd, b, 0, n, this._o(a)); return b; }
  _wr(a, b) { fs.writeSync(this.fd, b, 0, b.length, this._o(a)); }
  getU8(a) { return this._rd(a, 1)[0]; }
  setU8(a, v) { this._wr(a, Buffer.from([v & 0xff])); }
  getU16(a) { return this._rd(a, 2).readUInt16LE(0); }
  setU16(a, v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); this._wr(a, b); }
  getU32(a) { return this._rd(a, 4).readUInt32LE(0); }
  setU32(a, v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this._wr(a, b); }
}

// Per-node receive FIFO: the cb+8 array holds a u16 offset *relative to the
// control block* (D, isc_start 0x2588 `add x0, x21(cb), offset`), so the FIFOs
// live inside the cb window, past its 8+2*nodeCount-byte header. The big shared
// memory (0x63fe0000 / 0x2_a3fe0000) is only ISC_alloc_mem/attach_mem bulk pool.
const FIFO_OFF = [0x20, 0xe0, 0x1a0, 0x260, 0x320]; // within cb (len 0x400)
const FIFO_CAP = [0xc0, 0xc0, 0xc0, 0xc0, 0xc0];

// The ISC_alloc_mem pool --------------------------------------------------------
// The 128 KiB shared memory (base memAddr[0]) is a memblock allocator. Its header
// and free-list live at the pool base and are read by both ends: the A53's
// iscdrv `memblock_init` (0x34f8) only derives pointers from this header -- it
// does NOT build the free list -- so the MN side must write a valid pool image
// first, exactly as the MN library's builder does (0x50aa63c5 + the link helpers
// 0x50aa5a64 / 0x50aa5a71), or every A53 ISC_alloc_mem/attach fails (the bug this
// fixes). All offsets are D from those routines and from the allocator read side
// `memblock_alloc` 0x3558 / `findrun` 0x3250 / `memblock_check` 0x3420.
//
// Layout at the pool base (block size = 1<<shift):
//   +0  u16 shift            (12 -> 4 KiB blocks)
//   +2  u16 nblocks          (size>>shift; = 0x20 for 128 KiB)
//   +4  u16 head field       (builder writes ceil(nblocks/32)*4 here; state[4])
//   +8  link[nblocks], each {u16 lo(prev), u16 hi(next)} -- the free-run list,
//       a circular doubly-linked list whose sentinel is link[0]
//   +8 + nblocks*4            bitmap1 (ceil(nblocks/32)*4 bytes): allocated blocks
//   + bitmap1 + bm            bitmap2 (same size): single-block free-run markers
// A free run that starts at block i with length L is in the list at link[i]; its
// length is stored at link[i+1].lo and link[i+L-1].lo when L>1, else bitmap2
// bit i is set (D, findrun 0x3284..0x32ac, 3358). The first `meta` blocks that
// hold this header/link/bitmap area are reserved (not in the free list).
export class Memblock {
  constructor(mem, base, shift = 12) { this.m = mem; this.base = base; this.shift = shift; }
  get nblocks() { return this.m.getU16(this.base + 2); }
  _links() { return this.base + 8; }
  _link(i) { return this.base + 8 + i * 4; }   // {lo@+0, hi@+2}
  _lo(i) { return this.m.getU16(this._link(i)); }
  _hi(i) { return this.m.getU16(this._link(i) + 2); }
  _setLo(i, v) { this.m.setU16(this._link(i), v); }
  _setHi(i, v) { this.m.setU16(this._link(i) + 2, v); }
  _bm1() { return this.base + 8 + this.nblocks * 4; }
  _bm2() { return this._bm1() + (((this.nblocks + 31) >> 5) << 2); }
  _bmTest(bm, i) { return (this.m.getU32(bm + (i >> 5) * 4) >>> (i & 31)) & 1; }
  _bmSet(bm, i) { this.m.setU32(bm + (i >> 5) * 4, this.m.getU32(bm + (i >> 5) * 4) | (1 << (i & 31))); }
  _bmClr(bm, i) { this.m.setU32(bm + (i >> 5) * 4, this.m.getU32(bm + (i >> 5) * 4) & ~(1 << (i & 31))); }
  // The run length of the free run that starts at block i (D, findrun 0x3284).
  _runLen(i) { return this._bmTest(this._bm2(), i) ? 1 : this._lo(i + 1); }
  // Record a free run [start, start+len) in the list and its length markers.
  _markRun(start, len) {
    const bm2 = this._bm2();
    if (len === 1) { this._bmSet(bm2, start); }
    else {
      this._bmClr(bm2, start);
      this._setLo(start + 1, len);
      this._setLo(start + len - 1, len);
    }
  }
  _listInsert(i) {                       // insert block i after sentinel link[0]
    const next = this._hi(0);
    this._setLo(i, 0); this._setHi(i, next);
    this._setHi(0, i); this._setLo(next, i);
  }
  _listRemove(i) {
    const prev = this._lo(i), next = this._hi(i);
    this._setHi(prev, next); this._setLo(next, prev);
    this._setLo(i, i); this._setHi(i, i);
  }
  // Build a fresh, fully-free pool (literal of the MN builder 0x50aa63c5), with
  // the metadata blocks reserved and one free run over the rest.
  init(size) {
    const nblocks = size >> this.shift;
    const bm = ((nblocks + 31) >> 5) << 2;
    const hdr = bm + nblocks * 4 + 2 * bm + ((1 << this.shift) - 1) + 8;
    const meta = hdr >> this.shift;                       // reserved leading blocks
    for (let o = 0; o < (meta << this.shift); o += 4) this.m.setU32(this.base + o, 0);
    this.m.setU16(this.base + 0, this.shift);
    this.m.setU16(this.base + 2, nblocks);
    this.m.setU16(this.base + 4, bm);
    for (let i = 0; i < nblocks; i++) { this._setLo(i, i); this._setHi(i, i); } // self loops
    this._markRun(meta, nblocks - meta);
    this._listInsert(meta);
    return meta;
  }
  // findrun + split: first free run with length >= need; returns the block index
  // (D, memblock_alloc 0x3558). Returns -1 if none.
  _alloc(need) {
    for (let i = this._hi(0); i !== 0; i = this._hi(i)) {
      const len = this._runLen(i);
      if (len >= need) {
        this._listRemove(i);
        if (len > need) { const rest = i + need; this._markRun(rest, len - need); this._listInsert(rest); }
        for (let b = i; b < i + need; b++) this._bmSet(this._bm1(), b);
        return i;
      }
    }
    return -1;
  }
  // ISC_alloc_mem(size): returns {block, nblocks} or null. The A53 handle carries
  // the block index (0..nblocks) and byte size; the physical address is
  // poolbase + block*blocksize.
  alloc(size) {
    const need = (size + (1 << this.shift) - 1) >> this.shift;
    const b = this._alloc(need);
    return b < 0 ? null : { block: b, nblocks: need };
  }
  // ISC_free_mem: clear the allocated bits and return the run to the free list.
  // (No neighbour coalescing -- a dev-oracle simplification; the A53's own
  // memblock_free does coalesce, but the structures stay valid either way. I.)
  free(block, nblocks) {
    for (let b = block; b < block + nblocks; b++) this._bmClr(this._bm1(), b);
    this._markRun(block, nblocks);
    this._listInsert(block);
  }
}

// The MN peer: owns the control block and nodes 0..3; exchanges with node 4. ---
export class MnPeer {
  constructor(mem, cfg = CFG) {
    this.m = mem; this.cfg = cfg; this.rxFifo = {};
    this.poolBase = Number(cfg.memAddr[0]);               // MN view of the pool
    this.pool = new Memblock(mem, this.poolBase, 12);
  }
  // Publish the control block the A53's isc_start verifies, lay out each node's
  // receive FIFO, and initialise the ISC_alloc_mem pool so the A53's alloc/attach
  // succeed. MN nodes (0..3) come up RUN; node 4's state is left 0 for the A53's
  // isc_start to drive 0x1000->0x2000 (we only set its cap).
  initControlBlock() {
    const cb = Number(this.cfg.cbAddr);
    this.m.setU16(cb + 0, controlMagic(this.cfg));
    this.m.setU8(cb + 2, this.cfg.nodeCount);
    for (let n = 0; n < this.cfg.nodeCount; n++) {
      this.m.setU16(cb + 8 + 2 * n, FIFO_OFF[n]);     // offset relative to cb
      const f = new Fifo(this.m, cb + FIFO_OFF[n], FIFO_CAP[n]);
      this.rxFifo[n] = f;
      f.init(n === 4 ? 0 : STATE_RUN);
      this.m.setU32(cb + FIFO_OFF[n] + 8, Number(this.cfg.memAddr[n] >> 12n));
    }
    const meta = this.pool.init(this.cfg.memSize);
    this.m.setU32(cb + 4, meta << this.pool.shift);
  }
  // Send to a node: write into that node's RX FIFO, then ring its doorbell.
  send(dstNode, port, payload, doorbell) {
    const r = this.rxFifo[dstNode].push(port, Buffer.from(payload));
    if (r >= 0 && doorbell) doorbell(dstNode);
    return r;
  }
  recvOwn(selfNode = 1) { return this.rxFifo[selfNode].pop(); }

  // MN-side shared-memory API (the peer's half of ISC_alloc/attach/free). A
  // 24-byte ISC handle is {u16 block, u32 size, u64 phys, u64 user} (D, iscdrv
  // ioctl handle). The physical address both ends agree on is poolBase + block
  // * blocksize; the A53 sees the same bytes through its 0x2_a3fe0000 view.
  allocMem(size) {
    const a = this.pool.alloc(size);
    if (!a) return null;
    return { block: a.block, size, nblocks: a.nblocks, addr: this.poolBase + (a.block << this.pool.shift) };
  }
  attachMem(block, size) {                 // the MN's view of an A53-allocated buf
    return { block, size, addr: this.poolBase + (block << this.pool.shift) };
  }
  freeMem(h) { this.pool.free(h.block, h.nblocks ?? ((h.size + 0xfff) >> 12)); }
  // Read/write the bytes of a shared buffer (so the peer can fill a CGI reply or
  // read what the A53 wrote), by the handle's addr.
  bufWrite(h, off, buf) { for (let i = 0; i < buf.length; i++) this.m.setU8(h.addr + off + i, buf[i]); }
  bufRead(h, off, len) { const b = Buffer.alloc(len); for (let i = 0; i < len; i++) b[i] = this.m.getU8(h.addr + off + i); return b; }
}

// Socket op records (D, isc_socket: receive loop 0x10e48, dispatch 0x11068, one
// handler per op 0x111a8..0x12a6c). A fixed 64-byte record: +0 u32 op (1..16);
// +4..+0xb the MN's request id, echoed; the byte +0xc is the A53's own slot-busy
// flag (it copies the request into one of 12 slots and sets +0xc = 1, 0x10f64, so
// every reply carries 1 there; X); then per-op fields, the result written in place.
// Each request runs on its own thread, so replies may come out of order; with all
// 12 slots busy a request is dropped without a reply (0x10f1c).
export const SOCK_OPS = {
  socket: 1, bind: 2, connect: 3, listen: 4, accept: 5, send: 6, sendto: 7,
  recv: 8, recvfrom: 9, shutdown: 10, close: 11, select: 12, getsockopt: 13,
  setsockopt: 14, errno: 15, nop: 16,
};
// Build a 64-byte socket request. `fields` is a map of byteOffset -> value;
// numbers are written as u32 LE, Buffers copied verbatim.
export function sockRecord(op, fields = {}, tag = 0) {
  const r = Buffer.alloc(64);
  r.writeUInt32LE(op >>> 0, 0);
  r.writeUInt32LE(tag >>> 0, 4);           // +4..+0xb echoed back; a request id
  for (const [off, v] of Object.entries(fields)) {
    const o = Number(off);
    if (Buffer.isBuffer(v)) v.copy(r, o); else r.writeInt32LE(v | 0, o);
  }
  return r;
}
// Common socket requests (field offsets are D from the per-op handlers):
export const sockReq = {
  socket: (domain, type, proto, tag) => sockRecord(SOCK_OPS.socket, { 0x10: domain, 0x14: type, 0x18: proto }, tag),
  bind: (fd, sa, len, tag) => sockRecord(SOCK_OPS.bind, { 0x10: fd, 0x14: sa, 0x24: len }, tag),
  listen: (fd, backlog, tag) => sockRecord(SOCK_OPS.listen, { 0x10: fd, 0x14: backlog }, tag),
  accept: (fd, addrLen, tag) => sockRecord(SOCK_OPS.accept, { 0x10: fd, 0x24: addrLen }, tag),
  recv: (fd, mnBuf, len, flags, tag) => sockRecord(SOCK_OPS.recv, { 0x10: fd, 0x14: mnBuf, 0x18: len, 0x1c: flags }, tag),
  send: (fd, mnBuf, len, flags, tag) => sockRecord(SOCK_OPS.send, { 0x10: fd, 0x14: mnBuf, 0x18: len, 0x1c: flags }, tag),
  close: (fd, tag) => sockRecord(SOCK_OPS.close, { 0x10: fd }, tag),
  errno: (tag) => sockRecord(SOCK_OPS.errno, {}, tag),
  nop: (tag) => sockRecord(SOCK_OPS.nop, {}, tag),
};
// A sockaddr_in {u16 family=2, u16 port(be), u32 addr(be), 8 zero} for +0x14.
export function sockaddrIn(port, ip = '0.0.0.0') {
  const sa = Buffer.alloc(16);
  sa.writeUInt16LE(2, 0);                   // AF_INET
  sa.writeUInt16BE(port, 2);
  const [a, b, c, d] = ip.split('.').map(Number);
  sa[4] = a; sa[5] = b; sa[6] = c; sa[7] = d;
  return sa;
}

// The CGI relay (D, both ends; docs/a53-spec.md 9.1). The A53's isc_cgi is the
// client: per HTTP request it ISC_alloc_mem's a 16 KiB pool buffer (0x10e30), then
//   A53 -> p12  32 B {handle[24], +0x18 result 0}     inquire (0x10ea8)
//   MN  -> p16  32 B, +0x18 = 0 accepted               (MN 0x517dc3a3)
//   A53 writes the 0x3444-byte info block into the buffer, then
//   A53 -> p11  16 B = the handle's first 16 bytes     (0x114c8)
//   MN  -> p13  32 B, +4 = 0 accepted                  (MN 0x517dc626)
// and for the reply, in chunks until their lengths reach the total (0x11598):
//   MN  -> p12  32 B {handle[24], +0x18 0}             (MN 0x517dc330)
//   A53 -> p16  32 B, +0x18 = 0 ok / 1 error            (0x10ff4)
//   (the MN has written the chunk into the A53's buffer: +4 total, +8 chunk
//    length, +0xc slot, +0x10 data, at most 12416 bytes in all; MN 0x517dc636)
//   MN  -> p11  16 B {handle[16]}                      (MN 0x517dc718)
//   A53 -> p13  32 B {+0 0, +4 result: 0 ok}           (0x11844)
// The handle is the A53 library's 24-byte ISC_alloc_mem record: +0 u16 block,
// +4 u32 size, +0x10 the user address after attach (libisyscomm ISC_alloc_mem
// 0xa60 / ISC_attach_mem 0xbd4; iscdrv isc_alloc_mem 0x2868); the other bytes
// are not set by alloc (X: stack bytes on the wire).
export const CGI = { INFO: 0x3444, REPLY: 0x3080, DATA: 0x10, BUF: 0x4000 };
export function cgiInfo(buf) {             // parse the A53's info block
  const u32 = (o) => buf.readUInt32LE(o), str = (o, n) => buf.subarray(o, o + n).toString('latin1').replace(/\0.*$/s, '');
  const uriLen = u32(0x10);
  return {
    kind: u32(0), contentLength: u32(4), chunk: u32(8), method: u32(0xc),
    uri: buf.subarray(0x14, 0x14 + uriLen).toString('latin1'),
    body: buf.subarray(0x414, 0x414 + u32(8)), remote: str(0x3414, 16), log: str(0x3424, 32),
  };
}

const hx = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

// Live mode: drive a running QEMU om-isc device over the shared file + doorbell
// socket. Inits the control block + pool, then on every A53->MN doorbell drains
// nodes 0..3 and prints each message; optionally runs scripted sends or a stateful
// scenario. With rec=PATH every message is also written to a JSON log.
async function live(memPath, sockPath, opts = {}) {
  const net = await import('node:net');
  const mem = new FileMem(memPath);
  const peer = new MnPeer(mem);
  peer.initControlBlock();
  console.log(`[peer] control block published, magic 0x${controlMagic().toString(16)}; pool nblocks ${peer.pool.nblocks}`);

  const t0 = Date.now(), log = [];
  const sock = net.connect(sockPath);
  const ring = () => sock.write(Buffer.from([0]));
  const tx = (port, buf, why = '') => {
    const r = peer.send(4, port, buf, ring);
    log.push({ t: Date.now() - t0, dir: 'mn>a53', port, hex: buf.toString('hex') });
    console.log(`[peer] TX -> node 4 port ${port} [${hx(buf)}] ret ${r}${why ? '  ' + why : ''}`);
    return r;
  };
  const waiters = [];                       // {port, res}
  const inbox = [];
  const annotate = (port, d) => {
    if (port === 27 && d[0] === 1) return '  <<< port-27 start-complete';
    if (port === 4) return `  socket reply: op ${d.readUInt32LE(0)} +0xc=${d[0xc]}`;
    return '';
  };
  const drain = (why) => {
    for (let n = 0; n < 4; n++) {
      let m; while ((m = peer.rxFifo[n].pop())) {
        log.push({ t: Date.now() - t0, dir: 'a53>mn', node: n, port: m.port, hex: m.data.toString('hex') });
        console.log(`[peer] RX node ${n} port ${m.port} [${hx(m.data)}] (${why})${annotate(m.port, m.data)}`);
        const w = waiters.findIndex((x) => x.port === m.port);
        if (w >= 0) waiters.splice(w, 1)[0].res(m.data); else inbox.push(m);
      }
    }
  };
  const next = (port, ms = 30000) => {
    const i = inbox.findIndex((m) => m.port === port);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0].data);
    return new Promise((res, rej) => {
      const w = { port, res: (d) => { clearTimeout(w.t); res(d); } };
      w.t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`no port-${port} message in ${ms} ms`)); }, ms);
      waiters.push(w);
    });
  };
  sock.on('data', () => drain('doorbell'));
  sock.on('connect', () => console.log('[peer] doorbell socket connected'));
  sock.on('error', (e) => console.log('[peer] socket error', e.message));
  const poll = setInterval(() => drain('poll'), 200);  // fallback if a doorbell raced
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Scripted MN->A53 sends: opts.send = [{afterMs, node, port, bytes}]
  for (const s of opts.send || []) setTimeout(() => tx(s.port, Buffer.from(s.bytes)), s.afterMs);

  // Socket scenario: the MN as a TCP server through the A53 (ports 3/4): socket,
  // bind 0.0.0.0:PORT, listen, accept (a client inside the guest connects, e.g.
  // the console's wget), recv into an MN pool buffer, send a reply from another,
  // close both, then the errno (15) and nop (16) ops.
  // Start when the guest console (QEMU's captured stderr, opts.waitFile) shows
  // opts.waitFor -- e.g. a line the console shell prints once isc_socket runs --
  // or else after opts.afterMs.
  const ready = async () => {
    if (!opts.waitFile) return sleep(opts.afterMs || 16000);
    while (!(fs.existsSync(opts.waitFile) && fs.readFileSync(opts.waitFile, 'latin1').includes(opts.waitFor))) await sleep(250);
    console.log(`[peer] guest says ${opts.waitFor}`);
  };
  const sockScenario = async () => {
    await ready();
    const PORT = opts.port || 8099; let tag = 0x100;
    const call = async (rec, what) => {
      tx(3, rec, what);
      const d = await next(4, opts.acceptMs || 30000);
      return d;
    };
    const rin = peer.allocMem(4096), rout = peer.allocMem(4096);
    console.log(`[peer] MN buffers: recv @0x${rin.addr.toString(16)} send @0x${rout.addr.toString(16)}`);
    const fd = (await call(sockReq.socket(2, 1, 0, tag++), 'socket(AF_INET, SOCK_STREAM, 0)')).readInt32LE(0x1c);
    console.log(`[peer] socket -> ${fd}`);
    console.log(`[peer] bind -> ${(await call(sockReq.bind(fd, sockaddrIn(PORT), 16, tag++), `bind :${PORT}`)).readInt32LE(0x28)}`);
    console.log(`[peer] listen -> ${(await call(sockReq.listen(fd, 1, tag++), 'listen')).readInt32LE(0x18)}`);
    const acc = await call(sockReq.accept(fd, 16, tag++), 'accept');
    const cfd = acc.readInt32LE(0x28);
    console.log(`[peer] accept -> ${cfd}, peer ${acc.readUInt16LE(0x14)}:${acc.readUInt16BE(0x16)} ${[...acc.subarray(0x18, 0x1c)].join('.')} len ${acc.readInt32LE(0x24)}`);
    // isc_socket's recv loops until the whole length has arrived (or EOF / an
    // error; 0x11c2c), so an HTTP request of unknown size is read a byte at a time.
    let got = 0;
    for (;;) {
      const n = (await call(sockReq.recv(cfd, rin.addr + got, 1, 0, tag++), got ? '' : 'recv 1 byte (repeated)')).readInt32LE(0x20);
      if (n <= 0) break;
      got += n;
      if (peer.bufRead(rin, 0, got).toString('latin1').endsWith('\r\n\r\n')) break;
    }
    console.log(`[peer] recv -> ${got} bytes: ${JSON.stringify(peer.bufRead(rin, 0, got).toString('latin1'))}`);
    const body = Buffer.from('HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nhello from the MN peer\n');
    peer.bufWrite(rout, 0, body);
    console.log(`[peer] send -> ${(await call(sockReq.send(cfd, rout.addr, body.length, 0, tag++), 'send')).readInt32LE(0x20)}`);
    console.log(`[peer] close(client) -> ${(await call(sockReq.close(cfd, tag++), 'close')).readInt32LE(0x14)}`);
    console.log(`[peer] close(listener) -> ${(await call(sockReq.close(fd, tag++), 'close')).readInt32LE(0x14)}`);
    console.log(`[peer] errno -> ${(await call(sockReq.errno(tag++), 'errno')).readInt32LE(0x10)}`);
    await call(sockReq.nop(tag++), 'nop');
    console.log('[peer] socket scenario done');
  };

  // CGI scenario: the MN as the OI.Share CGI server for the A53's isc_cgi (ports
  // 11/12/13/16). Answers one request per inquiry with a small text body.
  const cgiScenario = async () => {
    for (;;) {
      const inq = await next(12, opts.runMs);
      const block = inq.readUInt16LE(0), size = inq.readUInt32LE(4);
      const h = peer.attachMem(block, size);
      const ack = Buffer.from(inq); ack.writeUInt32LE(0, 0x18);
      if (opts.cgiDelayMs) await sleep(opts.cgiDelayMs);
      tx(16, ack, `inquire accepted (block ${block}, size 0x${size.toString(16)})`);
      const note = await next(11);
      const info = cgiInfo(peer.bufRead(h, 0, CGI.INFO));
      console.log(`[peer] CGI request: ${JSON.stringify({ ...info, body: info.body.toString('latin1') })} (p11 [${hx(note)}])`);
      const res = Buffer.alloc(32); tx(13, res, 'request accepted');
      const data = Buffer.from(`Content-Type: text/plain\r\n\r\nMN peer answered ${info.uri}\n`);
      const R = Buffer.alloc(CGI.DATA + data.length);
      R.writeUInt32LE(data.length, 4); R.writeUInt32LE(data.length, 8); R.writeUInt32LE(0, 0xc);
      data.copy(R, CGI.DATA);
      peer.bufWrite(h, 0, R);
      const hd = Buffer.alloc(32); inq.copy(hd, 0, 0, 24);
      tx(12, hd, 'reply chunk ready');
      const a = await next(16);
      console.log(`[peer] A53 reply-ack +0x18=${a.readUInt32LE(0x18)}`);
      tx(11, inq.subarray(0, 16), 'reply notice');
      const ans = await next(13);
      console.log(`[peer] A53 answer +0=${ans.readUInt32LE(0)} +4=${ans.readUInt32LE(4)}`);
    }
  };

  const sc = opts.scenario === 'socket' ? sockScenario : opts.scenario === 'cgi' ? cgiScenario : null;
  if (sc) sc().catch((e) => console.log(`[peer] scenario stopped: ${e.message}`));

  await new Promise((res) => setTimeout(res, opts.runMs ?? 8000));
  clearInterval(poll); sock.destroy();
  if (opts.rec) fs.writeFileSync(opts.rec, JSON.stringify(log, null, 1));
  console.log('[peer] done');
}

// Self-test: round-trip a message through the exact FIFO/control-block format. -
function selftest() {
  const mem = new BufMem(0x300000);
  // Map the control block and the two FIFOs we use (node 1 = MN/CPU1, node 4 = A53).
  mem.region(Number(CFG.cbAddr), 0, CFG.cbSize);
  mem.region(Number(CFG.memAddr[1]), 0x10000, CFG.memSize);  // node 1 inbox
  mem.region(Number(CFG.memAddr[4]), 0x100000, CFG.memSize); // node 4 inbox (0x2_a3fe0000)
  const peer = new MnPeer(mem);
  peer.initControlBlock();

  let ok = true;
  const eq = (name, a, b) => { const p = JSON.stringify(a) === JSON.stringify(b); console.log(`  ${p ? 'ok  ' : 'FAIL'} ${name}`, p ? '' : `${JSON.stringify(a)} != ${JSON.stringify(b)}`); ok = ok && p; };

  // 1. control block magic matches the formula the A53 checks.
  eq('cb magic = 0x1000|(sum&0xff)', mem.getU16(Number(CFG.cbAddr)), controlMagic());
  eq('cb node count = 5', mem.getU8(Number(CFG.cbAddr) + 2), 5);

  // 2. A53's isc_start would set its own (node 4) FIFO to RUN; model that, then
  //    the MN sends a port-26 SYS_CA53_PWR_MNG request (8 bytes, byte0 = kind).
  peer.rxFifo[4].init(STATE_RUN);
  const req = Buffer.from([3, 0, 0, 0, 0x10, 0, 0, 0]); // kind 3 (spawn survival child), size 0x10
  peer.send(4, 26, req, null);
  const got = peer.rxFifo[4].pop();       // the A53 side reads its inbox
  eq('A53 receives port-26 request', { port: got.port, data: [...got.data] }, { port: 26, data: [...req] });

  // 3. The A53 replies the start-complete on port 27 (4 bytes {1,0,0,0}) to
  //    node 1; model the A53 pushing into node 1's inbox, MN reads it.
  const sc = Buffer.from([1, 0, 0, 0]);
  peer.rxFifo[1].push(27, sc);
  const rep = peer.recvOwn(1);
  eq('MN receives port-27 start-complete', { port: rep.port, data: [...rep.data] }, { port: 27, data: [...sc] });

  // 4. FIFO wrap: fill past the end and keep FIFO coherent.
  const f = peer.rxFifo[1]; f.init(STATE_RUN);
  let n = 0; while (f.push(4, Buffer.alloc(64, n & 0xff)) >= 0) n++;
  let m = 0; while (f.pop()) m++;
  eq('FIFO drains exactly what it accepted', m, n);
  eq('FIFO reports full before overrun', n > 0, true);

  // 5. The ISC_alloc_mem pool (the format the A53's memblock_alloc reads).
  const pb = peer.poolBase, pool = peer.pool;             // init'd by initControlBlock
  eq('pool shift = 12', mem.getU16(pb + 0), 12);
  eq('pool nblocks = 32', mem.getU16(pb + 2), 0x20);
  const h1 = peer.allocMem(16 * 1024);                    // CGIInit's request
  eq('alloc 16 KiB -> 4 blocks', h1 && h1.nblocks, 4);
  eq('alloc addr past the metadata block', h1.addr, pb + (1 << 12)); // block 1
  const h2 = peer.allocMem(4096);
  eq('second alloc -> next free block', h2.addr, pb + (5 << 12));     // block 5
  // the shared view: a byte the A53 would write in its buffer is seen by the MN.
  peer.bufWrite(h1, 0, Buffer.from('HTTP/1.0 200 OK'));
  eq('shared buffer round-trips', peer.bufRead(h1, 0, 4).toString(), 'HTTP');
  peer.freeMem(h2); peer.freeMem(h1);
  const h3 = peer.allocMem(16 * 1024);
  eq('alloc after free reuses block 1', h3.addr, pb + (1 << 12));

  console.log(ok ? '\nALL OK' : '\nFAILURES');
  process.exit(ok ? 0 : 1);
}

// CLI -------------------------------------------------------------------------
const cmd = process.argv[2];
if (cmd === 'selftest') selftest();
else if (cmd === 'magic') console.log('0x' + controlMagic().toString(16));
else if (cmd === 'live') {
  // live <memPath> <sockPath> [runMs] [send-spec | scenario=NAME | port=N | afterMs=N ...]
  // send-spec: afterMs:node:port:hexbytes  e.g. 1500:4:26:0300000010000000
  // scenario=socket drives a TCP server over ports 3/4 live (socket .. accept,
  // recv, send, close); scenario=cgi answers isc_cgi's requests (11/12/13/16);
  // rec=PATH writes every message to a JSON log; waitFile=PATH waitFor=TEXT
  // starts the scenario when the guest console log shows TEXT.
  const [memPath, sockPath, runMsS, ...rest] = process.argv.slice(3);
  const opts = { runMs: runMsS ? +runMsS : 8000, send: [] };
  for (const s of rest) {
    if (s.startsWith('scenario=')) opts.scenario = s.slice(9);
    else if (s.startsWith('port=')) opts.port = +s.slice(5);
    else if (s.startsWith('afterMs=')) opts.afterMs = +s.slice(8);
    else if (s.startsWith('rec=')) opts.rec = s.slice(4);
    else if (s.startsWith('waitFile=')) opts.waitFile = s.slice(9);
    else if (s.startsWith('waitFor=')) opts.waitFor = s.slice(8);
    else if (s.startsWith('cgiDelayMs=')) opts.cgiDelayMs = +s.slice(11);
    else { const [afterMs, node, port, hex] = s.split(':'); opts.send.push({ afterMs: +afterMs, node: +node, port: +port, bytes: hex.match(/../g).map((h) => parseInt(h, 16)) }); }
  }
  live(memPath, sockPath, opts);
} else {
  console.log('usage: node iscpeer.mjs selftest | magic | live <mem> <sock> [runMs] [afterMs:node:port:hex | scenario=socket|cgi port=N afterMs=N rec=PATH ...]');
}
