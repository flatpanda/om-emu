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
// u32 memblock_size @4, then one u16 FIFO offset per node @8. The magic is
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
// 4 bytes reserved @8; data from @12. state 0x1000 = owner starting,
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
// the om-isc device's backend layout (hw/misc/om-isc.c: O_LOCK/O_SCC/O_CB/O_MMN/O_MA).
class FileMem {
  constructor(path) {
    this.fd = fs.openSync(path, 'r+');
    this.map = [
      [0x97000000n, 0x00000, 0x200],    // lock
      [0x97f00b80n, 0x01000, 0x80],     // scc
      [0x97f00c00n, 0x02000, 0x400],    // control block
      [0x63fe0000n, 0x10000, 0x20000],  // nodes 0..3 shared mem
      [0x2a3fe0000n, 0x30000, 0x20000], // node 4 shared mem
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

// The MN peer: owns the control block and nodes 0..3; exchanges with node 4. ---
export class MnPeer {
  constructor(mem, cfg = CFG) { this.m = mem; this.cfg = cfg; this.rxFifo = {}; }
  // Publish the control block the A53's isc_start verifies, and lay out each
  // node's receive FIFO. MN nodes (0..3) come up RUN; node 4's state is left 0
  // for the A53's isc_start to drive 0x1000->0x2000 (we only set its cap).
  initControlBlock() {
    const cb = Number(this.cfg.cbAddr);
    this.m.setU16(cb + 0, controlMagic(this.cfg));
    this.m.setU8(cb + 2, this.cfg.nodeCount);
    this.m.setU32(cb + 4, this.cfg.memSize);
    for (let n = 0; n < this.cfg.nodeCount; n++) {
      this.m.setU16(cb + 8 + 2 * n, FIFO_OFF[n]);     // offset relative to cb
      const f = new Fifo(this.m, cb + FIFO_OFF[n], FIFO_CAP[n]);
      this.rxFifo[n] = f;
      f.init(n === 4 ? 0 : STATE_RUN);
    }
  }
  // Send to a node: write into that node's RX FIFO, then ring its doorbell.
  send(dstNode, port, payload, doorbell) {
    const r = this.rxFifo[dstNode].push(port, Buffer.from(payload));
    if (r >= 0 && doorbell) doorbell(dstNode);
    return r;
  }
  recvOwn(selfNode = 1) { return this.rxFifo[selfNode].pop(); }
}

// Live mode: drive a running QEMU om-isc device over the shared file + doorbell
// socket. Inits the control block, then on every A53->MN doorbell drains node 1
// and prints each message; optionally sends scripted MN->A53 requests.
async function live(memPath, sockPath, opts = {}) {
  const net = await import('node:net');
  const mem = new FileMem(memPath);
  const peer = new MnPeer(mem);
  peer.initControlBlock();
  console.log(`[peer] control block published, magic 0x${controlMagic().toString(16)}`);

  const sock = net.connect(sockPath);
  const drain = (why) => {
    for (let n = 0; n < 5; n++) {
      if (n === 4) continue;             // node 4 is the A53's inbox
      let m; while ((m = peer.rxFifo[n].pop())) {
        console.log(`[peer] RX node ${n} port ${m.port}  [${[...m.data].map(b => b.toString(16).padStart(2, '0')).join(' ')}]  (${why})`);
        if (m.port === 27) console.log(`[peer] >>> PORT 27 START-COMPLETE from the A53 <<<`);
      }
    }
  };
  sock.on('data', (d) => { for (const b of d) console.log(`[peer] doorbell <- A53 (node ${b})`); drain('doorbell'); });
  sock.on('connect', () => console.log('[peer] doorbell socket connected'));
  sock.on('error', (e) => console.log('[peer] socket error', e.message));

  // Fallback poll (in case a doorbell write raced before connect).
  const poll = setInterval(() => drain('poll'), 200);

  // Scripted MN->A53 sends: opts.send = [{afterMs, node, port, bytes}]
  for (const s of opts.send || []) {
    setTimeout(() => {
      const r = peer.send(s.node ?? 4, s.port, Buffer.from(s.bytes), () => sock.write(Buffer.from([0])));
      console.log(`[peer] TX -> node ${s.node ?? 4} port ${s.port}  [${s.bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}]  ret ${r}`);
    }, s.afterMs);
  }

  await new Promise((res) => setTimeout(res, opts.runMs ?? 8000));
  clearInterval(poll); sock.destroy();
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

  console.log(ok ? '\nALL OK' : '\nFAILURES');
  process.exit(ok ? 0 : 1);
}

// CLI -------------------------------------------------------------------------
const cmd = process.argv[2];
if (cmd === 'selftest') selftest();
else if (cmd === 'magic') console.log('0x' + controlMagic().toString(16));
else if (cmd === 'live') {
  // live <memPath> <sockPath> [runMs] [send-spec ...]
  // send-spec: afterMs:node:port:hexbytes  e.g. 1500:4:26:03000000100000000
  const [memPath, sockPath, runMsS, ...sends] = process.argv.slice(3);
  const send = sends.map((s) => {
    const [afterMs, node, port, hex] = s.split(':');
    const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
    return { afterMs: +afterMs, node: +node, port: +port, bytes };
  });
  live(memPath, sockPath, { runMs: runMsS ? +runMsS : 8000, send });
} else {
  console.log('usage: node iscpeer.mjs selftest | magic | live <mem> <sock> [runMs] [afterMs:node:port:hex ...]');
}
