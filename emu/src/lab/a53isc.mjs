// S-A53ISC (not wired): the Cortex-A53's half of ISC node 4 as a JS service, for the records whose replies were
// observed live in the QEMU oracle (tools/a53-oracle; docs/a53-spec.md 9, 9.1 and 10; docs/hle-gaps.md 4.11). It
// answers what CPU 1 sends to node 4 as the A53's daemons do, and plays isc_cgi's client role for an HTTP request
// the lab injects. Nothing in a session builds it yet: CPU 1 is a stand-in, so there is no MN side to talk to
// (ROADMAP item 7). The transport (FIFOs, doorbells, the hardware lock) is not here; the caller hands in each
// MN -> node 4 message and takes each reply through send().
//
//   new A53Isc({ send, mem, net, pool })
//     send(node, port, bytes)   a node-4 -> MN message (Uint8Array)
//     mem.read(addr, n) / mem.write(addr, bytes)   the MN's view of memory (the shared pool at 0x63fe0000 and the
//                               socket buffers the MN names)
//     net                       the socket back end (below); pool  { alloc(size) -> { block, size, addr }, free(h) }
//                               for isc_cgi's 16 KiB buffer, addr the MN's view of the block (the memblock allocator
//                               itself is the caller's: its policy is not checked against the A53's here)
//   start()                     sccore's start-complete
//   receive(port, bytes)        one MN -> node 4 message
//   cgiRequest(req, done)       an HTTP request as isc_cgi relays it; done({ slot, data }) when the MN's reply is in
//
// Evidence (X: tools/a53-oracle run-isc.sh with iscpeer.mjs's scenarios, the recorded exchanges in
// test/test_a53isc.mjs; D: the daemons' armhf code at the offsets given). What the A53 does that is not listed here
// throws: an unknown port, sccore's kind 2, the socket ops not exercised live (connect, sendto, recvfrom, shutdown,
// select, getsockopt, setsockopt) and a CGI body over one chunk.

export const PORT = {
  SOCK_REQ: 3, SOCK_REP: 4, CGI_DATA: 11, CGI_HANDLE: 12, CGI_RESULT: 13, CGI_ACK: 16, PWR_REQ: 26, PWR_REP: 27,
};
export const NODE_CPU1 = 1;
// The pool's two views (D, iscdrv.ko .data config_isc_mem_addr; isc_socket 0x12b3c maps an MN address as
// (addr & 0x3fffffff) | 0x2_80000000): the MN's 0x63fe0000 and the A53's 0x2_a3fe0000, the same bytes.
export const POOL_MN = 0x63fe0000, POOL_A53_LO = 0xa3fe0000, POOL_A53_HI = 2, POOL_SIZE = 0x20000;

// sccore (D: its port-26 thread; X: run-isc.sh). A 4-byte start-complete {1, 0, 0, 0} on port 27 at its start, and
// for a port-26 request (8 bytes, byte 0 the kind): kind 1 runs the Wi-Fi script with no reply; kind 3 forks a child
// that mallocs the u32 at +4 and replies that u32 on port 27.
export const PWR = { WIFI_START: 1, WIFI_STOP: 2, SURVIVAL: 3 };

// isc_socket (D: receive loop 0x10e48, dispatch 0x11068, handlers 0x111a8..0x12a6c; names from its strings). A
// 64-byte record on port 3, the same record back on port 4 with the result written in place: +0 u32 op, +4..+0xb
// the MN's request id (echoed, X), +0xc the A53's slot-busy byte (it copies the request into one of 12 slots and
// sets it to 1, 0x10f64, so every reply carries 1 there; X), then per op (all u32 unless said):
//   1 socket    +0x10 domain, +0x14 type, +0x18 protocol           -> +0x1c fd                       (X)
//   2 bind      +0x10 fd, +0x14 sockaddr[16], +0x24 length         -> +0x28                          (X)
//   4 listen    +0x10 fd, +0x14 backlog                            -> +0x18                          (X)
//   5 accept    +0x10 fd, +0x24 length in                          -> +0x14 sockaddr[16], +0x24 length, +0x28 fd (X)
//   6 send      +0x10 fd, +0x14 MN buffer, +0x18 length, +0x1c flags -> +0x20: the length once all is sent, in
//               chunks of at most 128 KiB (0x130d4), or the failing send's return                     (X; D)
//   8 recv      +0x10 fd, +0x14 MN buffer, +0x18 length, +0x1c flags -> +0x20: it loops until the whole length
//               has come (0x11c2c), so the result is the length, or less at end of stream, or the failing
//               recv's return                                                                         (X; D)
//  11 close     +0x10 fd                                           -> +0x14                          (X)
//  15 getsockerr  "NOT SUPPORTED": +0x10 the errno of the op's own new thread, 0                      (X 0; D)
//  16 setsockerr  "NOT SUPPORTED": the record comes back unchanged but for +0xc                       (X)
// A request that finds all 12 slots busy is dropped with no reply (0x10f1c, D). The MN's buffers are its own
// addresses; the A53 reaches them through /dev/mem (D), here mem.read / mem.write.
export const SOCK = {
  socket: 1, bind: 2, listen: 4, accept: 5, send: 6, recv: 8, close: 11, getsockerr: 15, setsockerr: 16,
};
const SOCK_UNVERIFIED = {
  3: 'connect', 7: 'sendto', 9: 'recvfrom', 10: 'shutdown', 12: 'select', 13: 'getsockopt', 14: 'setsockopt',
};
export const SLOTS = 12;
// What a back-end call returns when its answer comes later (a blocking accept or recv): the back end calls
// finish(token, value) then; token is the call's last argument.
export const PENDING = Symbol('pending');

// isc_cgi (D: 0x10e30..0x11914 and the MN's 0x517dc330..0x517dc7d1; X: run-isc.sh scenario=cgi with wget GET and
// POST). Per request isc_cgi ISC_alloc_mem's 16 KiB and:
//   node 4 -> p12  {handle[24], +0x18 0}        handle: +0 u16 block, +4 u32 size (the rest: stack bytes, X)
//   MN     -> p16  32 B, +0x18 0 accepted        (MN 0x517dc3a3; isc_cgi reads only +0x18, 0x10fa8)
//   node 4 writes the info block (CGI_INFO bytes) into the buffer, then
//   node 4 -> p11  the handle's first 16 bytes   +8 u64 the buffer's A53 physical address after attach (X)
//   MN     -> p13  32 B, +4 0 accepted           (isc_cgi 0x11538)
//   per reply chunk until their lengths reach the total:
//   MN     -> p12  {handle[24], +0x18 0}         (MN 0x517dc330; the MN has written the chunk into the buffer)
//   node 4 -> p16  the record, +8 u64 the A53 physical address, +0x10 its own user address, +0x18 0 ok / 1 an
//                  error (0x10ff4); the MN reads only +0x18 (0x517dc389, D), so +0x10 is 0 here
//   MN     -> p11  16 B                          (MN 0x517dc718)
//   node 4 reads the chunk: +4 u32 total, +8 u32 chunk length, +0xc u32 slot, +0x10 data (CGI_REPLY bytes in all)
//   node 4 -> p13  {+0 0, +4 0 ok / 1 a short FastCGI write}  (0x11844)
// The info block (0x1119c): +0 1 for the first chunk (with the URI) / 2 for a later one, +4 content length, +8 chunk
// length, +0xc method (1 GET, 2 POST), +0x10 URI length (at most 0x3ff), +0x14 URI, +0x414 body (at most 0x3000),
// +0x3414 REMOTE_ADDR[16], +0x3424 the log name[32] (from isc_olnet's shared memory; empty in the oracle).
export const CGI_BUF = 0x4000, CGI_INFO = 0x3444, CGI_REPLY = 0x3080, CGI_CHUNK = 0x3000, CGI_DATA = 0x10;
export const CGI_METHOD = { GET: 1, POST: 2 };

const u32 = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true);
const i32 = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(o, true);
const put32 = (b, o, v) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(o, v >>> 0, true);
const ascii = (s) => Uint8Array.from(s, (c) => {
  const x = c.charCodeAt(0);
  if (x > 0xff) throw new Error(`A53 ISC: non-latin1 ${s}`);
  return x;
});
const fail = (what) => { throw new Error(`A53 ISC: ${what}`); };

export class A53Isc {
  constructor({ send, mem = null, net = null, pool = null }) {
    this.send = send; this.mem = mem; this.net = net; this.pool = pool;
    this.slots = new Array(SLOTS).fill(null);   // in-flight socket records
    this.dropped = 0;
    this.cgi = null; this.cgiQueue = [];
  }

  start() { this.send(NODE_CPU1, PORT.PWR_REP, Uint8Array.of(1, 0, 0, 0)); }

  receive(port, data) {
    const d = Uint8Array.from(data);
    if (port === PORT.PWR_REQ) return this.power(d);
    if (port === PORT.SOCK_REQ) return this.sock(d);
    if ([PORT.CGI_HANDLE, PORT.CGI_ACK, PORT.CGI_DATA, PORT.CGI_RESULT].includes(port)) return this.cgiStep(port, d);
    fail(`no service on port ${port}`);
  }

  power(d) {
    if (d.length !== 8) fail(`port-26 request of ${d.length} bytes`);
    if (d[0] === PWR.WIFI_START) return;          // the script runs; no reply (X)
    if (d[0] === PWR.SURVIVAL) {
      const r = new Uint8Array(4); put32(r, 0, u32(d, 4));
      return this.send(NODE_CPU1, PORT.PWR_REP, r);
    }
    fail(`port-26 kind ${d[0]} (not observed live)`);
  }

  // --- isc_socket -------------------------------------------------------------------------------------------------
  sock(d) {
    if (d.length !== 64) fail(`port-3 record of ${d.length} bytes`);
    const op = u32(d, 0);
    if (SOCK_UNVERIFIED[op]) fail(`socket op ${op} (${SOCK_UNVERIFIED[op]}) not observed live`);
    if (!Object.values(SOCK).includes(op)) fail(`socket op ${op}`);
    const slot = this.slots.indexOf(null);
    if (slot < 0) { this.dropped++; return; }    // all slots busy: no reply (D)
    const r = Uint8Array.from(d); r[0xc] = 1;
    this.slots[slot] = { op, r };
    if (op === SOCK.getsockerr) { put32(r, 0x10, 0); return this.reply(slot); }
    if (op === SOCK.setsockerr) return this.reply(slot);
    if (!this.net) fail(`socket op ${op} without a back end`);
    const fd = i32(r, 0x10);
    let v;
    switch (op) {
      case SOCK.socket: v = this.net.socket(i32(r, 0x10), i32(r, 0x14), i32(r, 0x18), slot); break;
      case SOCK.bind: v = this.net.bind(fd, r.slice(0x14, 0x24), i32(r, 0x24), slot); break;
      case SOCK.listen: v = this.net.listen(fd, i32(r, 0x14), slot); break;
      case SOCK.accept: v = this.net.accept(fd, i32(r, 0x24), slot); break;
      case SOCK.send: {
        const n = i32(r, 0x18);
        if (!this.mem) fail('send without memory');
        v = this.net.send(fd, this.mem.read(u32(r, 0x14), n), i32(r, 0x1c), slot);
        break;
      }
      case SOCK.recv: v = this.net.recv(fd, i32(r, 0x18), i32(r, 0x1c), slot); break;
      case SOCK.close: v = this.net.close(fd, slot); break;
    }
    if (v !== PENDING) this.finish(slot, v);
  }

  // A socket op's result: an integer, accept's { fd, addr, len } or recv's bytes.
  finish(slot, v) {
    const s = this.slots[slot];
    if (!s) fail(`no socket op in flight in slot ${slot}`);
    const { op, r } = s;
    const int = (o) => { if (!Number.isInteger(v)) fail(`socket op ${op}: result ${v}`); put32(r, o, v); };
    switch (op) {
      case SOCK.socket: int(0x1c); break;
      case SOCK.bind: int(0x28); break;
      case SOCK.listen: int(0x18); break;
      case SOCK.close: int(0x14); break;
      case SOCK.send: int(0x20); break;
      case SOCK.accept:
        if (Number.isInteger(v)) put32(r, 0x28, v);
        else { r.set(v.addr.subarray(0, 16), 0x14); put32(r, 0x24, v.len); put32(r, 0x28, v.fd); }
        break;
      case SOCK.recv:
        if (Number.isInteger(v)) put32(r, 0x20, v);
        else {
          if (v.length > i32(r, 0x18)) fail(`recv returned ${v.length} of ${i32(r, 0x18)}`);
          this.mem.write(u32(r, 0x14), v); put32(r, 0x20, v.length);
        }
        break;
      default: fail(`socket op ${op} has no result`);
    }
    this.reply(slot);
  }

  reply(slot) {
    const { r } = this.slots[slot];
    this.slots[slot] = null;
    this.send(NODE_CPU1, PORT.SOCK_REP, r);
  }

  // --- isc_cgi ------------------------------------------------------------------------------------------------------
  cgiRequest(req, done) {
    this.cgiQueue.push({ req, done });
    if (!this.cgi) this.cgiNext();
  }

  cgiNext() {
    const job = this.cgiQueue.shift();
    if (!job) { this.cgi = null; return; }
    const { req } = job;
    const method = CGI_METHOD[req.method];
    if (!method) fail(`CGI method ${req.method}`);
    const body = req.body ? (typeof req.body === 'string' ? ascii(req.body) : Uint8Array.from(req.body)) : null;
    if (body && body.length > CGI_CHUNK) fail(`CGI body of ${body.length} bytes (over one chunk: not observed live)`);
    if (!this.pool || !this.mem) fail('CGI without a pool or memory');
    const h = this.pool.alloc(CGI_BUF);
    if (!h) fail('CGI: the pool has no 16 KiB');
    this.cgi = { ...job, method, body, h, state: 'ack', got: [], total: -1 };
    const rec = new Uint8Array(32); rec.set(this.handle(false));
    this.send(NODE_CPU1, PORT.CGI_HANDLE, rec);
  }

  // isc_cgi's 24-byte handle: +0 u16 block, +4 u32 size; after its attach +8 u64 the A53 physical address (and +0x10
  // its user address, 0 here).
  handle(attached) {
    const { h } = this.cgi, b = new Uint8Array(24), v = new DataView(b.buffer);
    v.setUint16(0, h.block, true); v.setUint32(4, h.size, true);
    if (attached) { v.setUint32(8, POOL_A53_LO + (h.addr - POOL_MN), true); v.setUint32(12, POOL_A53_HI, true); }
    return b;
  }

  info() {
    const { req, method, body } = this.cgi, b = new Uint8Array(CGI_INFO);
    const uri = ascii(req.uri).subarray(0, 0x3ff);
    put32(b, 0, 1);
    if (body) { put32(b, 4, body.length); put32(b, 8, body.length); b.set(body, 0x414); }
    put32(b, 0xc, method); put32(b, 0x10, uri.length); b.set(uri, 0x14);
    if (req.remote) b.set(ascii(req.remote).subarray(0, 16), 0x3414);
    if (req.log) b.set(ascii(req.log).subarray(0, 32), 0x3424);
    return b;
  }

  cgiStep(port, d) {
    const c = this.cgi;
    if (!c) fail(`CGI port ${port} with no request in flight`);
    const want = { ack: PORT.CGI_ACK, accepted: PORT.CGI_RESULT, chunk: PORT.CGI_HANDLE, data: PORT.CGI_DATA }[c.state];
    if (port !== want) fail(`CGI port ${port} in state ${c.state} (expected ${want})`);
    if (c.state === 'ack') {                       // the MN took the inquiry
      if (d.length !== 32 || u32(d, 0x18) !== 0) fail(`CGI inquiry refused: ${u32(d, 0x18)}`);
      this.mem.write(c.h.addr, this.info());
      c.state = 'accepted';
      return this.send(NODE_CPU1, PORT.CGI_DATA, this.handle(true).subarray(0, 16));
    }
    if (c.state === 'accepted') {                  // the MN accepted the request
      if (d.length !== 32 || u32(d, 4) !== 0) fail(`CGI request refused: ${u32(d, 4)}`);
      c.state = 'chunk';
      return;
    }
    if (c.state === 'chunk') {                     // a reply chunk is in the buffer
      if (d.length !== 32) fail(`CGI p12 of ${d.length} bytes`);
      if ((u32(d, 0) & 0xffff) !== c.h.block) fail(`CGI reply for block ${u32(d, 0) & 0xffff}, not ${c.h.block}`);
      const r = Uint8Array.from(d); r.set(this.handle(true).subarray(8, 24), 8); put32(r, 0x18, 0);
      c.state = 'data';
      return this.send(NODE_CPU1, PORT.CGI_ACK, r);
    }
    // state data: read the chunk, answer, and finish once the chunks reach the total
    if (d.length !== 16) fail(`CGI p11 of ${d.length} bytes`);
    const R = this.mem.read(c.h.addr, CGI_REPLY);
    const total = u32(R, 4), n = u32(R, 8);
    if (n > CGI_REPLY - CGI_DATA) fail(`CGI chunk of ${n} bytes`);
    c.total = total; c.slot = u32(R, 0xc); c.got.push(R.slice(CGI_DATA, CGI_DATA + n));
    this.send(NODE_CPU1, PORT.CGI_RESULT, new Uint8Array(32));
    const have = c.got.reduce((a, x) => a + x.length, 0);
    if (have < total) { c.state = 'chunk'; return; }
    const data = new Uint8Array(have); let o = 0;
    for (const x of c.got) { data.set(x, o); o += x.length; }
    this.pool.free(c.h);
    const { done } = c;
    this.cgiNext();
    if (done) done({ slot: c.slot, data });
  }
}
