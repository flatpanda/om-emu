// S-A53ISC (src/lab/a53isc.mjs) against exchanges recorded live in the QEMU oracle (tools/a53-oracle run-isc.sh with
// iscpeer.mjs rec=: the A53's own Linux on a patched QEMU, an MN-side peer playing CPU 1; docs/a53-spec.md 9.1, 10).
// Each case feeds the MN's recorded message to the service and compares what it sends with what the A53 sent:
// sccore's start-complete and kind-3 reply; isc_socket's socket, bind, listen, accept, recv, send, close, getsockerr
// and setsockerr records byte for byte; isc_cgi's GET and POST exchange field by field (the A53 also sends stack bytes
// and its own user address, which the MN does not read), the info block it writes and the reply it assembles. Then
// the refusals: unobserved ports, kinds and ops throw, a thirteenth concurrent socket op is dropped as the A53 drops
// it, a CGI message out of order throws.
//   node emu/test/test_a53isc.mjs
import {
  A53Isc, PORT, NODE_CPU0, NODE_CPU1, SOCK, PENDING, SLOTS,
  CGI_INFO, CGI_CHUNK, CGI_REPLY, CGI_DATA, POOL_MN, HHHR_REQ, HHHR_REP,
} from '../src/lab/a53isc.mjs';

const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h, n = h.length / 2) => { const b = new Uint8Array(n); for (let i = 0; i < h.length / 2; i++) b[i] = parseInt(h.substr(2 * i, 2), 16); return b; };
const u32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const i32 = (b, o) => new DataView(b.buffer, b.byteOffset).getInt32(o, true);
const put32 = (b, o, v) => new DataView(b.buffer, b.byteOffset).setUint32(o, v >>> 0, true);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const latin1 = (b) => String.fromCharCode(...b);

// The recorded messages (trailing zero bytes trimmed; n is the length on the wire). From rec-socket.json /
// rec-cgi.json of the 2026-11-08 oracle runs.
const REC = {
  start: { p: 27, n: 4, h: '01' },
  kind3: [{ p: 26, n: 8, h: '0300000040' }, { p: 27, n: 4, h: '40' }],
  sock: [
    ['010000000001000000000000000000000200000001', '0100000000010000000000000100000002000000010000000000000005'],
    ['020000000101000000000000000000000500000002001fa300000000000000000000000010',
      '020000000101000000000000010000000500000002001fa300000000000000000000000010'],
    ['040000000201000000000000000000000500000001', '040000000201000000000000010000000500000001'],
    ['05000000030100000000000000000000050000000000000000000000000000000000000010',
      '0500000003010000000000000100000005000000020087ae7f00000100000000000000001000000006'],
    ['08000000040100000000000000000000060000000020fe6301', '08000000040100000000000001000000060000000020fe63010000000000000001'],
    ['06000000560100000000000000000000060000000030fe6344', '06000000560100000000000001000000060000000030fe63440000000000000044'],
    ['0b00000057010000000000000000000006', '0b00000057010000000000000100000006'],
    ['0b00000058010000000000000000000005', '0b00000058010000000000000100000005'],
    ['0f0000005901', '0f000000590100000000000001'],
    ['100000005a01', '100000005a0100000000000001'],
  ],
  // the GET of /get_commandlist.cgi?a=1: A53 p12, MN p16, A53 p11, MN p13, MN p12, A53 p16, MN p11, A53 p13
  cgi: {
    inquire: '02007af7004000002e4e3df6000000000a000000f13c90f7', note: '02007af7004000000020fea302',
    ack: '02007af7004000000020fea302000000009091f7',
  },
};
const SOCK_RESULTS = [5, 0, 0, { fd: 6, addr: unhex('020087ae7f000001', 16), len: 16 }, unhex('47'), 0x44, 0, 0];

function harness() {
  const out = [], mem = new Map();
  const read = (a, n) => Uint8Array.from({ length: n }, (_, i) => mem.get(a + i) ?? 0);
  const write = (a, b) => b.forEach((x, i) => mem.set(a + i, x));
  const pool = { freed: [], alloc: (size) => ({ block: 2, size, addr: POOL_MN + 0x2000 }), free(h) { this.freed.push(h); } };
  const net = { calls: [], queue: [] };
  for (const op of ['socket', 'bind', 'connect', 'listen', 'accept', 'send', 'sendto', 'recv', 'shutdown', 'close', 'getsockopt', 'setsockopt']) {
    net[op] = (...a) => { net.calls.push([op, ...a]); return net.queue.length ? net.queue.shift() : PENDING; };
  }
  const hhhr = { calls: [], queue: [] };
  const hhhrFn = (req) => { hhhr.calls.push(Uint8Array.from(req)); return hhhr.queue.length ? hhhr.queue.shift() : new Uint8Array(HHHR_REP); };
  const svc = new A53Isc({ send: (node, port, b) => out.push({ node, port, b: Uint8Array.from(b) }), mem: { read, write }, net, pool, hhhr: hhhrFn });
  return { svc, out, net, pool, hhhr, read, write };
}

export function a53iscUnits() {
  const t = tester(), { ok } = t;

  { // sccore
    const { svc, out } = harness();
    svc.start();
    ok(out.length === 1 && out[0].node === 1 && out[0].port === REC.start.p && hex(out[0].b) === hex(unhex(REC.start.h, 4)), 'the port-27 start-complete {01 00 00 00} to node 1, as recorded');
    svc.receive(26, unhex(REC.kind3[0].h, 8));
    ok(out.length === 2 && out[1].port === 27 && hex(out[1].b) === hex(unhex(REC.kind3[1].h, 4)), 'a kind-3 request for 0x40 bytes is answered {40 00 00 00} on port 27, as recorded');
    svc.receive(26, unhex('01', 8));
    ok(out.length === 2, 'kind 1 (the Wi-Fi script) sends nothing, as recorded');
    ok(throws(() => svc.receive(26, unhex('02', 8))), 'kind 2 (not observed live) throws');
    ok(throws(() => svc.receive(26, unhex('03', 4))), 'a port-26 request that is not 8 bytes throws');
  }

  { // isc_socket, the recorded server sequence
    const { svc, out, net, write, read } = harness();
    write(0x63fe3000, Uint8Array.from('HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nhello from the MN peer\n', (c) => c.charCodeAt(0)));
    let bad = 0;
    REC.sock.forEach(([req, rep], i) => {
      net.queue = i < SOCK_RESULTS.length ? [SOCK_RESULTS[i]] : [];
      const before = out.length;
      svc.receive(3, unhex(req, 64));
      const got = out[before];
      if (!(out.length === before + 1 && got.node === 1 && got.port === 4 && hex(got.b) === hex(unhex(rep, 64)))) { bad++; t.bad.push(`socket record ${i}: ${got ? hex(got.b) : 'no reply'} != ${hex(unhex(rep, 64))}`); }
    });
    ok(bad === 0, `the ${REC.sock.length} recorded socket replies, byte for byte`);
    ok(latin1(read(0x63fe2000, 1)) === 'G', 'recv wrote the byte into the MN buffer the record names');
    const sendCall = net.calls.find((c) => c[0] === 'send');
    ok(sendCall && sendCall[1] === 6 && sendCall[2].length === 0x44 && latin1(sendCall[2]).startsWith('HTTP/1.0 200 OK'), 'send took its 0x44 bytes from the MN buffer at +0x14');
    const bindCall = net.calls.find((c) => c[0] === 'bind');
    ok(bindCall && hex(bindCall[2]) === '02001fa3000000000000000000000000' && bindCall[3] === 16, 'bind passed the record\'s sockaddr (0.0.0.0:8099) and length');
  }

  { // a pending accept, other ops meanwhile, the 12 slots, the refusals
    const { svc, out, net } = harness();
    svc.receive(3, unhex('0500000001', 64));
    ok(out.length === 0, 'an accept with no client yet sends nothing');
    net.queue = [0];
    svc.receive(3, unhex('0b00000002', 64));
    ok(out.length === 1 && u32(out[0].b, 4) === 2, 'another op meanwhile is answered first (request id 2)');
    const slot = svc.slots.findIndex((s) => s && s.op === 5);
    svc.finish(slot, { fd: 9, addr: unhex('0200abcd0a000001', 16), len: 16 });
    ok(out.length === 2 && u32(out[1].b, 4) === 1 && u32(out[1].b, 0x28) === 9 && out[1].b[0xc] === 1, 'the accept completes later with its own request id, the fd at +0x28');
    for (let i = 0; i < SLOTS; i++) svc.receive(3, unhex('0500000010', 64));
    svc.receive(3, unhex('0b00000011', 64));
    ok(out.length === 2 && svc.dropped === 1, 'with 12 ops in flight a thirteenth is dropped, no reply');
    ok(throws(() => svc.receive(3, unhex('09000000', 64))) && throws(() => svc.receive(3, unhex('0c000000', 64))), 'recvfrom and select (undocumented layouts) throw');
    ok(throws(() => svc.receive(3, unhex('01000000', 32))), 'a port-3 record that is not 64 bytes throws');
    ok(throws(() => svc.receive(9, unhex('00', 8))), 'a port with no service throws');
  }

  { // isc_socket: D-evidenced ops (connect, sendto, shutdown, getsockopt, setsockopt)
    const { svc, out, net, write, read } = harness();
    const rec64 = (op, id) => { const r = new Uint8Array(64); put32(r, 0, op); put32(r, 4, id); return r; };
    const sa = unhex('02000050c0a80001', 16); // AF_INET 192.168.0.1:80

    // connect (op 3): +0x10 fd, +0x14 sockaddr[16], +0x24 len -> +0x28 ret
    const cReq = rec64(SOCK.connect, 0x201);
    put32(cReq, 0x10, 7); cReq.set(sa, 0x14); put32(cReq, 0x24, 16);
    net.queue = [0];
    svc.receive(3, cReq);
    const cCall = net.calls.at(-1), cRep = out.at(-1);
    ok(cCall[0] === 'connect' && cCall[1] === 7 && hex(cCall[2]) === hex(sa) && cCall[3] === 16, 'connect forwards fd, sockaddr[16], len');
    ok(cRep.port === 4 && u32(cRep.b, 4) === 0x201 && cRep.b[0xc] === 1 && i32(cRep.b, 0x28) === 0, 'connect writes ret 0 at +0x28');
    // connect pending + error return (-1)
    svc.receive(3, cReq);
    const cSlot = svc.slots.findIndex((s) => s && s.op === SOCK.connect);
    svc.finish(cSlot, -1);
    ok(i32(out.at(-1).b, 0x28) === -1, 'connect error return (-1) written at +0x28');

    // sendto (op 7): +0x10 fd, +0x14 MN buf, +0x18 len, +0x1c flags, +0x20 sockaddr[16], +0x30 addrlen -> +0x34 ret
    write(0x63fe4000, Uint8Array.from('ping', (c) => c.charCodeAt(0)));
    const stReq = rec64(SOCK.sendto, 0x202);
    put32(stReq, 0x10, 8); put32(stReq, 0x14, 0x63fe4000); put32(stReq, 0x18, 4); put32(stReq, 0x1c, 0x40);
    stReq.set(sa, 0x20); put32(stReq, 0x30, 16);
    net.queue = [4];
    svc.receive(3, stReq);
    const stCall = net.calls.at(-1), stRep = out.at(-1);
    ok(stCall[0] === 'sendto' && stCall[1] === 8 && latin1(stCall[2]) === 'ping' && stCall[3] === 0x40 && hex(stCall[4]) === hex(sa) && stCall[5] === 16,
      'sendto reads MN buf and forwards fd, data, flags, sockaddr, addrlen');
    ok(stRep.port === 4 && u32(stRep.b, 4) === 0x202 && stRep.b[0xc] === 1 && i32(stRep.b, 0x34) === 4, 'sendto writes ret at +0x34');
    net.queue = [-1];
    svc.receive(3, stReq);
    ok(i32(out.at(-1).b, 0x34) === -1, 'sendto error return (-1) written at +0x34');

    // shutdown (op 10): +0x10 fd, +0x14 how -> +0x18 ret
    const shReq = rec64(SOCK.shutdown, 0x203);
    put32(shReq, 0x10, 7); put32(shReq, 0x14, 2);
    net.queue = [0];
    svc.receive(3, shReq);
    const shCall = net.calls.at(-1), shRep = out.at(-1);
    ok(shCall[0] === 'shutdown' && shCall[1] === 7 && shCall[2] === 2 && i32(shRep.b, 0x18) === 0 && shRep.b[0xc] === 1,
      'shutdown forwards fd, how and writes ret at +0x18');
    net.queue = [-1];
    svc.receive(3, shReq);
    ok(i32(out.at(-1).b, 0x18) === -1, 'shutdown error return (-1) written at +0x18');

    // setsockopt (op 14): +0x10 fd, +0x14 level, +0x18 name, +0x1c MN buf, +0x20 len -> +0x24 ret
    write(0x63fe4100, unhex('01000000'));
    const ssReq = rec64(SOCK.setsockopt, 0x204);
    put32(ssReq, 0x10, 7); put32(ssReq, 0x14, 1); put32(ssReq, 0x18, 2); put32(ssReq, 0x1c, 0x63fe4100); put32(ssReq, 0x20, 4);
    net.queue = [0];
    svc.receive(3, ssReq);
    const ssCall = net.calls.at(-1), ssRep = out.at(-1);
    ok(ssCall[0] === 'setsockopt' && ssCall[1] === 7 && ssCall[2] === 1 && ssCall[3] === 2 && hex(ssCall[4]) === '01000000',
      'setsockopt reads MN buf and forwards fd, level, name, optval');
    ok(u32(ssRep.b, 4) === 0x204 && ssRep.b[0xc] === 1 && i32(ssRep.b, 0x24) === 0, 'setsockopt writes ret at +0x24');
    net.queue = [-1];
    svc.receive(3, ssReq);
    ok(i32(out.at(-1).b, 0x24) === -1, 'setsockopt error return (-1) written at +0x24');

    // getsockopt (op 13): +0x10 fd, +0x14 level, +0x18 name, +0x1c MN buf, +0x20 len -> +0x20 len, +0x24 ret
    const gsReq = rec64(SOCK.getsockopt, 0x205);
    put32(gsReq, 0x10, 7); put32(gsReq, 0x14, 1); put32(gsReq, 0x18, 4); put32(gsReq, 0x1c, 0x63fe4200); put32(gsReq, 0x20, 8);
    net.queue = [unhex('05000000')];
    svc.receive(3, gsReq);
    const gsCall = net.calls.at(-1), gsRep = out.at(-1);
    ok(gsCall[0] === 'getsockopt' && gsCall[1] === 7 && gsCall[2] === 1 && gsCall[3] === 4 && gsCall[4] === 8,
      'getsockopt forwards fd, level, name, len');
    ok(hex(read(0x63fe4200, 4)) === '05000000' && u32(gsRep.b, 0x20) === 4 && i32(gsRep.b, 0x24) === 0,
      'getsockopt writes optval to MN buf, updates +0x20 len, and writes 0 at +0x24');
    net.queue = [-1];
    svc.receive(3, gsReq);
    ok(i32(out.at(-1).b, 0x24) === -1, 'getsockopt error return (-1) written at +0x24');
    net.queue = [new Uint8Array(9)];
    ok(throws(() => svc.receive(3, gsReq)), 'getsockopt returning more bytes than requested len throws');

    // memory-required ops throw without mem
    const noMem = new A53Isc({ send: () => {}, net });
    ok(throws(() => noMem.receive(3, stReq)) && throws(() => noMem.receive(3, ssReq)) && throws(() => noMem.receive(3, gsReq)),
      'sendto, setsockopt and getsockopt throw without memory');
  }

  { // isc_cgi: the recorded GET
    const { svc, out, write, read, pool } = harness();
    let res = null;
    svc.cgiRequest({ method: 'GET', uri: '/get_commandlist.cgi?a=1', remote: '127.0.0.1' }, (r) => { res = r; });
    const rec = (h, n) => unhex(h, n);
    const inq = out[0], A = rec(REC.cgi.inquire, 32);
    ok(inq.port === 12 && inq.b.length === 32 && hex(inq.b.subarray(0, 2)) === hex(A.subarray(0, 2)) && u32(inq.b, 4) === u32(A, 4) && u32(inq.b, 0x18) === 0,
      'the inquiry on port 12: block 2, size 0x4000, +0x18 0, as recorded (the A53\'s other bytes are stack)');
    svc.receive(16, rec(REC.cgi.inquire, 32));            // the MN's accept: the record back, +0x18 0
    const info = read(POOL_MN + 0x2000, CGI_INFO), note = out[1];
    ok(u32(info, 0) === 1 && u32(info, 4) === 0 && u32(info, 0xc) === 1 && latin1(info.subarray(0x14, 0x14 + u32(info, 0x10))) === '/get_commandlist.cgi?a=1' && latin1(info.subarray(0x3414, 0x341d)) === '127.0.0.1',
      'the info block in the buffer: kind 1, no body, GET, the URI, REMOTE_ADDR, as the MN read it live');
    const N = rec(REC.cgi.note, 16);
    ok(note.port === 11 && note.b.length === 16 && hex(note.b.subarray(0, 2)) === hex(N.subarray(0, 2)) && hex(note.b.subarray(4, 16)) === hex(N.subarray(4, 16)),
      'port 11: the handle\'s first 16 bytes with +8 the A53 physical address 0x2_a3fe2000, as recorded');
    svc.receive(13, new Uint8Array(32));
    ok(out.length === 2, 'the MN\'s acceptance on port 13 is not answered');
    const body = 'Content-Type: text/plain\r\n\r\nMN peer answered /get_commandlist.cgi?a=1\n';
    const R = new Uint8Array(0x10 + body.length);
    new DataView(R.buffer).setUint32(4, body.length, true); new DataView(R.buffer).setUint32(8, body.length, true);
    R.set(Uint8Array.from(body, (c) => c.charCodeAt(0)), 0x10);
    write(POOL_MN + 0x2000, R);
    svc.receive(12, rec(REC.cgi.inquire, 32));
    const ack = out[2], K = rec(REC.cgi.ack, 32);
    ok(ack.port === 16 && hex(ack.b.subarray(0, 2)) === hex(K.subarray(0, 2)) && hex(ack.b.subarray(4, 16)) === hex(K.subarray(4, 16)) && u32(ack.b, 0x18) === 0,
      'the reply chunk\'s port-16 ack: block, size, +8 the physical address, +0x18 0, as recorded (+0x10 is the A53\'s user address)');
    ok(res === null, 'no result before the chunk\'s port-11 notice');
    svc.receive(11, rec(REC.cgi.inquire, 16));
    ok(out[3].port === 13 && hex(out[3].b) === hex(new Uint8Array(32)), 'port 13 {0, 0}, as recorded');
    ok(res && res.slot === 0 && latin1(res.data) === body && pool.freed.length === 1, 'the request completes with the chunk\'s data and slot, the buffer freed');
    ok(throws(() => svc.receive(11, new Uint8Array(16))), 'a CGI message with no request in flight throws');
  }

  { // isc_cgi: the recorded POST's info block, chunks, order
    const { svc, out, write, read } = harness();
    let res = null;
    svc.cgiRequest({ method: 'POST', uri: '/set_utctimediff.cgi', body: 'k=v&x=yz', remote: '127.0.0.1' }, (r) => { res = r; });
    ok(throws(() => svc.receive(13, new Uint8Array(32))), 'a port-13 message while the inquiry waits for port 16 throws');
    svc.receive(16, out[0].b);
    const info = read(POOL_MN + 0x2000, CGI_INFO);
    ok(u32(info, 0) === 1 && u32(info, 4) === 8 && u32(info, 8) === 8 && u32(info, 0xc) === 2 && latin1(info.subarray(0x414, 0x41c)) === 'k=v&x=yz',
      'the POST info block: kind 1, content length 8, chunk 8, method 2, the body at +0x414, as the MN read it live');
    svc.receive(13, new Uint8Array(32));
    const two = (s, total) => { const R = new Uint8Array(0x10 + s.length), v = new DataView(R.buffer); v.setUint32(4, total, true); v.setUint32(8, s.length, true); v.setUint32(12, 3, true); R.set(Uint8Array.from(s, (c) => c.charCodeAt(0)), 0x10); return R; };
    write(POOL_MN + 0x2000, two('abc', 6)); svc.receive(12, out[0].b); svc.receive(11, out[0].b.subarray(0, 16));
    ok(res === null, 'a first chunk short of the total does not finish');
    write(POOL_MN + 0x2000, two('def', 6)); svc.receive(12, out[0].b); svc.receive(11, out[0].b.subarray(0, 16));
    ok(res && latin1(res.data) === 'abcdef' && res.slot === 3, 'the chunks are joined up to the total');
    ok(throws(() => svc.cgiRequest({ method: 'PUT', uri: '/x.cgi' }, null)), 'a method other than GET and POST throws');
  }

  { // isc_cgi: multi-chunk POST (3 chunks) and multi-chunk reply (3 chunks)
    const { svc, out, write, read, pool } = harness();
    const totalReq = CGI_CHUNK * 2 + 17;
    const reqBody = Uint8Array.from({ length: totalReq }, (_, i) => (i * 37 + 11) & 0xff);
    let res = null;
    svc.cgiRequest({ method: 'POST', uri: '/upload.cgi?n=3', body: reqBody, remote: '10.0.0.2', log: 'oi' }, (r) => { res = r; });

    // Chunk 1: kind 1, URI present, first 0x3000 bytes
    const inq1 = out.at(-1);
    ok(inq1.port === PORT.CGI_HANDLE && inq1.b.length === 32, 'multi-chunk POST chunk 1 sends p12 inquiry');
    svc.receive(PORT.CGI_ACK, inq1.b);
    const info1 = read(POOL_MN + 0x2000, CGI_INFO);
    ok(u32(info1, 0) === 1 && u32(info1, 4) === totalReq && u32(info1, 8) === CGI_CHUNK && u32(info1, 0xc) === 2,
      'chunk 1 info: kind 1, total content length, chunk 0x3000, POST');
    ok(latin1(info1.subarray(0x14, 0x14 + u32(info1, 0x10))) === '/upload.cgi?n=3', 'chunk 1 carries URI');
    ok(info1[0x414] === reqBody[0] && info1[0x414 + CGI_CHUNK - 1] === reqBody[CGI_CHUNK - 1], 'chunk 1 carries bytes [0..0x3000)');
    ok(out.at(-1).port === PORT.CGI_DATA && out.at(-1).b.length === 16, 'chunk 1 sends p11 notice');
    svc.receive(PORT.CGI_RESULT, new Uint8Array(32));

    // Chunk 2: kind 2, no URI, next 0x3000 bytes
    const inq2 = out.at(-1);
    ok(inq2.port === PORT.CGI_HANDLE && inq2.b.length === 32, 'after chunk 1 p13, sends p12 inquiry for chunk 2');
    svc.receive(PORT.CGI_ACK, inq2.b);
    const info2 = read(POOL_MN + 0x2000, CGI_INFO);
    ok(u32(info2, 0) === 2 && u32(info2, 4) === totalReq && u32(info2, 8) === CGI_CHUNK && u32(info2, 0xc) === 2 && u32(info2, 0x10) === 0,
      'chunk 2 info: kind 2, total content length, chunk 0x3000, POST, uriLen 0');
    ok(info2[0x414] === reqBody[CGI_CHUNK] && info2[0x414 + CGI_CHUNK - 1] === reqBody[CGI_CHUNK * 2 - 1], 'chunk 2 carries bytes [0x3000..0x6000)');
    svc.receive(PORT.CGI_RESULT, new Uint8Array(32));

    // Chunk 3: kind 2, final 17 bytes
    const inq3 = out.at(-1);
    ok(inq3.port === PORT.CGI_HANDLE, 'after chunk 2 p13, sends p12 inquiry for chunk 3');
    svc.receive(PORT.CGI_ACK, inq3.b);
    const info3 = read(POOL_MN + 0x2000, CGI_INFO);
    ok(u32(info3, 0) === 2 && u32(info3, 4) === totalReq && u32(info3, 8) === 17 && u32(info3, 0x10) === 0,
      'chunk 3 info: kind 2, total content length, chunk 17, uriLen 0');
    let bodyMatch = true;
    for (let i = 0; i < 17; i++) if (info3[0x414 + i] !== reqBody[CGI_CHUNK * 2 + i]) bodyMatch = false;
    ok(bodyMatch, 'chunk 3 carries final 17 bytes verbatim');
    const beforeFinalTaken = out.length;
    svc.receive(PORT.CGI_RESULT, new Uint8Array(32));
    ok(out.length === beforeFinalTaken, 'after final request chunk p13, no further p12 inquiry is sent');

    // Multi-chunk reply: 3 chunks (2 full 0x3070 chunks + 23-byte tail)
    const maxReply = CGI_REPLY - CGI_DATA;
    const totalRep = maxReply * 2 + 23;
    const repData = Uint8Array.from({ length: totalRep }, (_, i) => (i * 19 + 5) & 0xff);
    const sendReplyChunk = (slice) => {
      const R = new Uint8Array(CGI_DATA + slice.length);
      put32(R, 4, totalRep); put32(R, 8, slice.length); put32(R, 0xc, 5);
      R.set(slice, CGI_DATA);
      write(POOL_MN + 0x2000, R);
      svc.receive(PORT.CGI_HANDLE, inq1.b);
      ok(out.at(-1).port === PORT.CGI_ACK && u32(out.at(-1).b, 0x18) === 0, 'reply chunk acked on p16 with +0x18 0');
      svc.receive(PORT.CGI_DATA, inq1.b.subarray(0, 16));
      ok(out.at(-1).port === PORT.CGI_RESULT && u32(out.at(-1).b, 4) === 0, 'reply chunk completed on p13 with +4 0');
    };
    sendReplyChunk(repData.subarray(0, maxReply));
    ok(res === null, 'not done after reply chunk 1 of 3');
    sendReplyChunk(repData.subarray(maxReply, maxReply * 2));
    ok(res === null, 'not done after reply chunk 2 of 3');
    sendReplyChunk(repData.subarray(maxReply * 2));
    ok(res && res.slot === 5 && res.data.length === totalRep && pool.freed.length === 1, '3-chunk reply completes with full length, slot 5, buffer freed');
    let repMatch = true;
    for (let i = 0; i < totalRep; i++) if (res.data[i] !== repData[i]) repMatch = false;
    ok(repMatch, '3-chunk reply bytes reassembled verbatim');
  }

  { // isc_cgi: error on chunk ack / chunk result frees buffer and advances queue
    const { svc, out, pool } = harness();
    svc.cgiRequest({ method: 'POST', uri: '/a.cgi', body: 'a'.repeat(CGI_CHUNK + 5) }, null);
    svc.cgiRequest({ method: 'GET', uri: '/b.cgi' }, null);
    // Accept chunk 1, then refuse chunk 2's p16 inquiry ack
    svc.receive(PORT.CGI_ACK, out[0].b);
    svc.receive(PORT.CGI_RESULT, new Uint8Array(32));
    const inq2 = out.at(-1);
    const badAck = Uint8Array.from(inq2.b); put32(badAck, 0x18, 1);
    ok(throws(() => svc.receive(PORT.CGI_ACK, badAck)), 'non-zero p16 ack on chunk 2 throws');
    ok(pool.freed.length === 1 && out.at(-1).port === PORT.CGI_HANDLE, 'refused p16 frees buffer and starts queued request');

    // Accept queued GET's inquiry, then refuse its p13 result
    svc.receive(PORT.CGI_ACK, out.at(-1).b);
    const badRes = new Uint8Array(32); put32(badRes, 4, 1);
    ok(throws(() => svc.receive(PORT.CGI_RESULT, badRes)), 'non-zero p13 result throws');
    ok(pool.freed.length === 2 && svc.cgi === null, 'refused p13 frees buffer and clears in-flight CGI');
  }

  { // hhhr (ports 30/31 -> node 0; docs/a53-spec.md §9, hhhr.dis 0x133a0 D, run-isc.sh X)
    const { svc, out, hhhr } = harness();
    ok(PORT.HHHR_REQ === 30 && PORT.HHHR_REP === 31 && NODE_CPU0 === 0 && NODE_CPU1 === 1 && HHHR_REQ === 48 && HHHR_REP === 112,
      'hhhr port, node and length constants match docs/a53-spec.md §9');

    // Live-evidenced 48-byte all-zero request (count 0) -> 112-byte reply on port 31 to node 0
    const zeroReq = new Uint8Array(HHHR_REQ);
    svc.receive(PORT.HHHR_REQ, zeroReq);
    ok(hhhr.calls.length === 1 && hhhr.calls[0].length === HHHR_REQ && hex(hhhr.calls[0]) === hex(zeroReq),
      'port-30 count-0 request forwards 48 bytes to hhhr back end');
    ok(out.length === 1 && out[0].node === NODE_CPU0 && out[0].port === PORT.HHHR_REP && out[0].b.length === HHHR_REP,
      'hhhr replies 112 bytes on port 31 to node 0 (CPU 0)');

    // Non-zero 48-byte request and custom 112-byte reply forwarded verbatim
    const req = Uint8Array.from({ length: HHHR_REQ }, (_, i) => (i * 7 + 3) & 0xff);
    const rep = Uint8Array.from({ length: HHHR_REP }, (_, i) => (i * 13 + 1) & 0xff);
    hhhr.queue.push(rep);
    svc.receive(PORT.HHHR_REQ, req);
    ok(hhhr.calls.length === 2 && hex(hhhr.calls[1]) === hex(req), 'port-30 payload forwarded verbatim');
    ok(out.length === 2 && out[1].node === NODE_CPU0 && out[1].port === PORT.HHHR_REP && hex(out[1].b) === hex(rep),
      'hhhr 112-byte reply forwarded verbatim to node 0 port 31');

    // Refusal cases: wrong request length, missing back end, wrong reply length/type
    ok(throws(() => svc.receive(PORT.HHHR_REQ, new Uint8Array(47))) && throws(() => svc.receive(PORT.HHHR_REQ, new Uint8Array(49))),
      'a port-30 request that is not 48 bytes throws');
    const noHhhr = new A53Isc({ send: () => {} });
    ok(throws(() => noHhhr.receive(PORT.HHHR_REQ, zeroReq)), 'port-30 request without hhhr back end throws');
    hhhr.queue.push(new Uint8Array(111));
    ok(throws(() => svc.receive(PORT.HHHR_REQ, zeroReq)), 'hhhr reply shorter than 112 bytes throws');
    hhhr.queue.push(new Uint8Array(113));
    ok(throws(() => svc.receive(PORT.HHHR_REQ, zeroReq)), 'hhhr reply longer than 112 bytes throws');
    hhhr.queue.push(null);
    ok(throws(() => svc.receive(PORT.HHHR_REQ, zeroReq)), 'non-Uint8Array hhhr reply throws');

    // Unverified daemon ports in docs/a53-spec.md §9 remain refused
    const unverifiedPorts = [1, 6, 14, 15, 20, 24, 25, 28, 32, 47, 49];
    ok(unverifiedPorts.every((p) => throws(() => svc.receive(p, new Uint8Array(8)))),
      'unverified daemon ports (isc_file, isc_olnet, blebridge, wifi_*, dbgterm, isc_test, sccore 14/32) throw');
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = a53iscUnits();
  console.log(`S-A53ISC: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
