// S-A53ISC (src/lab/a53isc.mjs) against exchanges recorded live in the QEMU oracle (tools/a53-oracle run-isc.sh with
// iscpeer.mjs rec=: the A53's own Linux on a patched QEMU, an MN-side peer playing CPU 1; docs/a53-spec.md 9.1, 10).
// Each case feeds the MN's recorded message to the service and compares what it sends with what the A53 sent:
// sccore's start-complete and kind-3 reply; isc_socket's socket, bind, listen, accept, recv, send, close, getsockerr
// and setsockerr records byte for byte; isc_cgi's GET and POST exchange field by field (the A53 also sends stack bytes
// and its own user address, which the MN does not read), the info block it writes and the reply it assembles. Then
// the refusals: unobserved ports, kinds and ops throw, a thirteenth concurrent socket op is dropped as the A53 drops
// it, a CGI message out of order throws.
//   node emu/test/test_a53isc.mjs
import { A53Isc, PORT, PENDING, SLOTS, CGI_INFO, POOL_MN } from '../src/lab/a53isc.mjs';

const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h, n = h.length / 2) => { const b = new Uint8Array(n); for (let i = 0; i < h.length / 2; i++) b[i] = parseInt(h.substr(2 * i, 2), 16); return b; };
const u32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
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
  for (const op of ['socket', 'bind', 'listen', 'accept', 'send', 'recv', 'close']) {
    net[op] = (...a) => { net.calls.push([op, ...a]); return net.queue.length ? net.queue.shift() : PENDING; };
  }
  const svc = new A53Isc({ send: (node, port, b) => out.push({ node, port, b: Uint8Array.from(b) }), mem: { read, write }, net, pool });
  return { svc, out, net, pool, read, write };
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
    ok(throws(() => svc.receive(3, unhex('03000000', 64))) && throws(() => svc.receive(3, unhex('0c000000', 64))), 'connect and select (not observed live) throw');
    ok(throws(() => svc.receive(3, unhex('01000000', 32))), 'a port-3 record that is not 64 bytes throws');
    ok(throws(() => svc.receive(9, unhex('00', 8))), 'a port with no service throws');
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
    ok(throws(() => svc.cgiRequest({ method: 'POST', uri: '/x.cgi', body: 'x'.repeat(0x3001) }, null)), 'a body over one chunk (not observed live) throws');
    ok(throws(() => svc.cgiRequest({ method: 'PUT', uri: '/x.cgi' }, null)), 'a method other than GET and POST throws');
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = a53iscUnits();
  console.log(`S-A53ISC: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
