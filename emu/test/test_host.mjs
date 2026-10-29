// Gate G-host: the node host of the player over real HTTP, each case a fresh
// bin/play.mjs process: the queue under load (one WAIT:1500, then 20 main-dial sends from a synchronous client while it
// runs: 8 ran, 12 dropped; 200 touch moves during one step: 1 sample), the status answered within 100 ms during a
// WAIT:10000 (about 2.5 s here), the main thread's t_wall and the worker's wall() on one clock (latency_ms against the client's round trip),
// SIGTERM, SIGINT, SIGHUP and /api/quit (exit 0, the stopped line, session.json), a second signal (exit 130, no
// session.json), long polls and a ?sync=1 waiter answered at the stop, the status a stop publishes (seq, phase and
// fields, after a signal and after /api/quit: 3d, J5), and the 2 ms order wait of a non-blocking
// next_input on the host's queue (PortQueue) against none on the headless one, --debug-api's SIGUSR2 lab kill (the
// error status without the lab's fields, then Restart: fix2); the HTTP front (fix1: a refused POST answered before its
// body, a ?sync=1 timeout that is not a number refused, the request's error on stderr for a failed pagetest write, a
// busy --port's message); an --out with '..' in the stopped line (fix2); the Card panel's routes (GET /api/session,
// /api/card, /api/card/file, /api/card/image: the card the firmware formatted, a picture's file and its PNG, the card
// out of the slot and back, none of the reads logged).
//   node emu/test/test_host.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { MessageChannel, Worker } from 'node:worker_threads';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.dirname(EMU);
const TMP = path.join(process.env.HOME, '.cache/om-emu-tmp/test-host-' + process.pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAY = path.join(EMU, 'bin/play.mjs');
const STOPPED = 'play: stopped; session log ';                 // the stopped line's start (host/playcli.mjs)

// One play.mjs child: the URL from its first lines, a urllib-like client (a connection per request).
export async function startPlay(tag, args, { env = process.env } = {}) {
  const out = path.join(TMP, tag);
  fs.rmSync(out, { recursive: true, force: true });
  const p = spawn(process.execPath, [PLAY, '--no-browser', '--debug-api', '--out', out, '--a15', 'off', ...args],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env });
  const lines = [], errs = [];
  let buf = '';
  p.stderr.on('data', (d) => errs.push(String(d)));
  const m = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${tag}: no URL in 60 s`)), 60000);
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
      const u = lines.map((l) => /(http:\/\/127\.0\.0\.1:(\d+))\/\?t=(\S+)/.exec(l)).find(Boolean);
      if (u) { clearTimeout(t); resolve(u); }
    });
    p.on('exit', (c) => reject(new Error(`${tag}: exited ${c} before its URL: ${errs.join('').slice(-800)}`)));
  });
  const exit = new Promise((r) => p.on('exit', (code, sig) => r(code ?? sig)));
  const pl = { p, out, lines, errs, exit, base: m[1], port: Number(m[2]), token: m[3] };
  pl.req = (method, pth, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(pl.base + pth, { method, agent: false, headers: { 'X-Token': pl.token, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}), ...headers } },
      (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  pl.json = async (method, pth, body) => JSON.parse((await pl.req(method, pth, body)).body);
  pl.status = () => pl.json('GET', '/api/status?after=0');
  pl.input = async (body) => (await pl.json('POST', '/api/input?sync=1', body)).result;
  pl.send = async (body) => (await pl.json('POST', '/api/input', body)).seq;
  pl.waitPhase = async (pred, s = 120) => {
    const t0 = performance.now();
    for (;;) {
      const st = await pl.status();
      if (pred(st)) return st;
      if (performance.now() - t0 > s * 1000) throw new Error(`${tag}: phase wait timed out (${st.phase})`);
      await sleep(100);
    }
  };
  pl.close = async () => {
    if (p.exitCode === null && p.signalCode === null) { try { await pl.req('POST', '/api/quit', {}); } catch { /* gone */ } }
    const t = setTimeout(() => p.kill('SIGKILL'), 15000);
    const rc = await exit;
    clearTimeout(t);
    return rc;
  };
  await pl.waitPhase((s) => !['starting', 'replaying'].includes(s.phase));
  return pl;
}

async function pl8b(bad) {
  const pl = await startPlay('pl8b', ['--idle', 'off']);
  try {
    await pl.send({ type: 'token', token: 'WAIT:1500' });
    for (let i = 0; i < 20; i++) await pl.send({ type: 'dial', id: 'main', detents: 1 });
    await sleep(200);
    await pl.input({ type: 'token', token: 'WAIT:1' });
    let lg = (await pl.json('GET', '/api/log')).inputs;
    const ran = lg.filter((e) => e.input.type === 'dial').length, dropped = (await pl.status()).dropped['dial main'] ?? 0;
    if (ran !== 8 || dropped !== 12) bad.push(`queue under load: 20 queued detents: ${ran} ran, ${dropped} dropped (want 8, 12)`);
    await pl.input({ type: 'touch', action: 'down', x: 300, y: 200 });
    await pl.send({ type: 'token', token: 'WAIT:1500' });
    for (let i = 0; i < 200; i++) await pl.send({ type: 'touch', action: 'move', x: 300 + (i % 50), y: 200 });
    await pl.input({ type: 'touch', action: 'up', x: 349, y: 200 });
    lg = (await pl.json('GET', '/api/log')).inputs;
    const moves = lg.filter((e) => e.input.type === 'touch' && e.input.action === 'move').length;
    if (moves !== 1) bad.push(`queue under load: 200 touch moves during one step: ${moves} samples (want 1)`);
    return `queue under load: ${ran} ran, ${dropped} dropped; ${moves} move sample`;
  } finally { await pl.close(); }
}

async function busyStatus(bad) {
  const pl = await startPlay('busy', ['--idle', 'off']);
  const notes = [];
  try {
    // the clock: an input's latency_ms (worker wall() at its end - main t_wall on arrival) inside the client's round trip
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await pl.input({ type: 'token', token: 'GET:1881' });
      const rtt = performance.now() - t0, lat = (await pl.status()).last.latency_ms;
      if (!(lat >= 0 && lat <= rtt + 5)) bad.push(`clock: latency_ms ${lat} outside 0 .. the round trip ${rtt.toFixed(1)} ms + 5`);
      notes.push(`latency ${lat} ms, round trip ${rtt.toFixed(1)} ms`);
    }
    const t0 = performance.now();
    const w = pl.input({ type: 'token', token: 'WAIT:10000' });
    await sleep(300);
    const ts = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const st = await pl.status();
      ts.push(performance.now() - t);
      if (st.phase !== 'busy') notes.push(`phase ${st.phase}`);
      await sleep(50);
    }
    const res = await w;
    const wall = performance.now() - t0;
    if (Math.max(...ts) > 100) bad.push(`status during a WAIT:10000: answered in ${ts.map((x) => x.toFixed(1)).join(', ')} ms (max 100)`);
    if (!res || res.error) bad.push(`WAIT:10000: ${JSON.stringify(res)?.slice(0, 200)}`);
    notes.push(`status during WAIT:10000 (${(wall / 1000).toFixed(2)} s wall): ${ts.map((x) => x.toFixed(1)).join(', ')} ms`);
    return notes.join('; ');
  } finally { await pl.close(); }
}

async function stops(bad) {
  const notes = [];
  for (const how of ['SIGTERM', 'SIGINT', 'SIGHUP', 'quit']) {
    const pl = await startPlay(`stop-${how}`, ['--idle', 'wall']);
    // a long poll and a ?sync=1 waiter in flight at the stop: both answered (the waiter's input is queued behind a
    // WAIT the loop runs when the stop comes: after a signal it never runs, result null; /api/quit queues its control
    // behind it, so it runs first and answers its record)
    const st0 = await pl.status();
    const poll = pl.json('GET', `/api/status?after=${st0.seq + 1000}`).catch((e) => ({ err: e.message }));
    const fpoll = pl.req('GET', '/api/frame?after=999999').catch((e) => ({ err: e.message }));
    await pl.send({ type: 'token', token: 'WAIT:1500' });
    const sync = pl.json('POST', '/api/input?sync=1&timeout=600', { type: 'token', token: 'GET:1881' }).catch((e) => ({ err: e.message }));
    await sleep(150);
    const t0 = performance.now();
    if (how === 'quit') await pl.req('POST', '/api/quit', {}); else pl.p.kill(how);
    const timer = setTimeout(() => pl.p.kill('SIGKILL'), 10000);
    const rc = await pl.exit;
    clearTimeout(timer);
    const dt = (performance.now() - t0) / 1000;
    const [ps, fs_, sy] = await Promise.all([poll, fpoll, sync]);
    const log = fs.existsSync(path.join(pl.out, 'session.json'));
    const stopped = pl.lines.some((l) => l === `${STOPPED}${path.join(pl.out, 'session.json')}`);
    if (rc !== 0 || !log || !stopped || dt > 10) bad.push(`${how}: exit ${rc} after ${dt.toFixed(1)} s, session.json ${log}, stopped line ${stopped}; stderr ${pl.errs.join('').slice(-300)}`);
    // a signal leaves stop clear until main's finally (the 'stopped' status answers the poll); the quit control sets
    // stop in the loop and publishes a status, which answers the poll
    if (how !== 'quit' ? ps.phase !== 'stopped' : typeof ps.phase !== 'string') bad.push(`${how}: the status long poll answered ${JSON.stringify(ps).slice(0, 120)}`);
    if (fs_.status !== 204) bad.push(`${how}: the frame long poll answered ${fs_.status ?? JSON.stringify(fs_)}, not 204`);
    if (!('result' in sy) || (how === 'quit' ? sy.result?.record?.get?.id !== 1881 : sy.result !== null)) bad.push(`${how}: the ?sync=1 waiter answered ${JSON.stringify(sy).slice(0, 160)}`);
    notes.push(`${how} ${dt.toFixed(2)} s`);
  }
  // a second signal: exit 130 at once, no session.json
  // (two signals sent back to back can merge in the kernel: the second follows 500 ms later, while a WAIT runs. The
  // first is sent once the status says the WAIT runs (phase busy): sent 100 ms after the input it could come before
  // the loop took the WAIT, so the loop stopped before it and exited 0 ahead of the second signal, as the coverage
  // gate's runs at load 5 (part A) and 15 (part B) saw)
  const pl = await startPlay('stop-twice', ['--idle', 'wall']);
  await pl.send({ type: 'token', token: 'WAIT:10000' });
  for (let k = 0; k < 400 && (await pl.status()).phase !== 'busy'; k++) await sleep(25);
  pl.p.kill('SIGTERM');
  await sleep(500);
  pl.p.kill('SIGTERM');
  const timer = setTimeout(() => pl.p.kill('SIGKILL'), 10000);
  const rc = await pl.exit;
  clearTimeout(timer);
  const log = fs.existsSync(path.join(pl.out, 'session.json'));
  if (rc !== 130 || log) bad.push(`two SIGTERMs: exit ${rc}, session.json ${log} (want 130, none)`);
  notes.push(`second signal: exit ${rc}`);
  return notes.join(', ');
}

// The status a stop publishes (J5): an --idle off session publishes nothing while it waits, so a long poll in flight at
// the stop answers the stop's own status. After a signal that is main()'s 'stopped' status: the last status with phase
// 'stopped' and seq + 1, every other field and the key order kept. After /api/quit it is the quit control's status:
// seq + 1, phase and every other field as before (the 'stopped' status follows, after the poll has its answer).
async function stoppedSeq(bad) {
  const notes = [];
  for (const how of ['SIGTERM', 'quit']) {
    const pl = await startPlay(`stopped-${how}`, ['--idle', 'off']);
    await pl.input({ type: 'token', token: 'GET:1881' });
    const st = await pl.status();
    await sleep(300);
    const st2 = await pl.status();
    if (st2.seq !== st.seq) bad.push(`${how}: an --idle off session published status ${st2.seq} while waiting after ${st.seq}`);
    const poll = pl.json('GET', `/api/status?after=${st.seq + 1000}`).catch((e) => ({ err: e.message }));
    await sleep(100);
    if (how === 'quit') await pl.req('POST', '/api/quit', {}); else pl.p.kill(how);
    const timer = setTimeout(() => pl.p.kill('SIGKILL'), 10000);
    const rc = await pl.exit;
    clearTimeout(timer);
    const ps = await poll;
    const want = { ...st, phase: how === 'quit' ? st.phase : 'stopped', seq: st.seq + 1 };
    if (rc !== 0 || JSON.stringify(ps) !== JSON.stringify(want)) {
      const diff = [...new Set([...Object.keys(want), ...Object.keys(ps)])].filter((k) => JSON.stringify(want[k]) !== JSON.stringify(ps[k]));
      bad.push(`${how}: exit ${rc}; the poll in flight answered seq ${ps.seq} phase ${ps.phase} (want seq ${want.seq} phase ${want.phase})${diff.length ? `, fields differ: ${diff.join(', ')}` : ', key order differs'}`);
    }
    notes.push(`${how}: seq ${st.seq} -> ${ps.seq} ${ps.phase}`);
  }
  return notes.join(', ');
}

// next_input(block=False) with an input that overtook its page's order: the host's PortQueue waits
// q.get(timeout=0.002), the headless ArrayQueue returns at once.
async function orderWait(bad) {
  const P = await import('../src/lab/player.mjs');
  const { PortQueue, newFlags } = await import('../host/portqueue.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const a = { ...PLAYER_PARSER, no_browser: true, idle: 'off', out: '<out>', no_wait_on_error: false };
  const inp = { type: 'key', id: 'menu', action: 'down', client: 'p', cseq: 2, seq: 1, t_wall: 0 };
  const time = (q) => {
    const pl = new P.Player(a, { wallClock: () => performance.now() / 1000, queue: q });
    pl.held.push(inp);
    const t0 = performance.now();
    const r = pl.next_input(false);
    return [r, performance.now() - t0];
  };
  const ch = new MessageChannel();
  const [r1, dt1] = time(new PortQueue(ch.port2, newFlags(), (m) => m));
  const [r2, dt2] = time(new P.ArrayQueue());
  ch.port1.close(); ch.port2.close();
  if (r1 !== null || !(dt1 >= 2 && dt1 < 20)) bad.push(`order wait (PortQueue): ${r1 === null ? 'null' : 'an input'} after ${dt1.toFixed(2)} ms (want null after 2 ms)`);
  if (r2 !== null || dt2 >= 2) bad.push(`order wait (ArrayQueue): ${r2 === null ? 'null' : 'an input'} after ${dt2.toFixed(2)} ms (want null at once)`);
  return `order wait ${dt1.toFixed(2)} ms (host), ${dt2.toFixed(3)} ms (headless)`;
}

// --debug-api: SIGUSR2 kills the lab from outside (a simulated lab crash): the error status, which
// has status_error and none of the lab's fields; then Restart (fix2) brings a new lab up: no error, phase running with
// the lab's fields again.
async function labKill(bad) {
  const pl = await startPlay('labkill', ['--idle', 'wall']);
  try {
    pl.p.kill('SIGUSR2');
    const st = await pl.waitPhase((s) => s.phase === 'error', 30);
    if (!String(st.error?.message).startsWith('RuntimeError: lab killed from outside (SIGUSR2)')) bad.push(`SIGUSR2: error ${JSON.stringify(st.error).slice(0, 200)}`);
    if (st.status_error !== 'lab killed from outside (SIGUSR2)' || 'gui' in st) bad.push(`SIGUSR2: the dead lab's status has status_error ${JSON.stringify(st.status_error)} and gui ${JSON.stringify(st.gui)} (want the error and no gui)`);
    const r = await pl.input({ type: 'control', op: 'restart' });
    const st2 = await pl.status();
    if (r?.error !== null || st2.phase !== 'running' || st2.gui !== '0x0108' || 'status_error' in st2) bad.push(`SIGUSR2 then Restart: result error ${JSON.stringify(r?.error)}, phase ${st2.phase}, gui ${st2.gui}`);
    return `SIGUSR2: ${st.error.message}; Restart: ${st2.phase} ${st2.gui}`;
  } finally { await pl.close(); }
}

// fix1: the HTTP front. A POST refused by its headers (no token) is answered 403 before its body is read (here a
// declared 300 MB body, 16 bytes of it sent); ?sync=1&timeout=inf is refused with 400, nothing queued; /api/pagetest's
// failed write (out removed) drops the connection with the request's error on stderr; rc 0 at the end (handler errors
// do not set it).
function rawRequest(port, text, ms = 3000) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    let got = '', done = false;
    const end = (why) => { if (!done) { done = true; clearTimeout(t); sock.destroy(); resolve({ got, why }); } };
    const t = setTimeout(() => end('timeout'), ms);
    sock.on('data', (d) => { got += d; });
    sock.on('end', () => end('closed'));
    sock.on('close', () => end('closed'));
    sock.on('error', (e) => end(e.code));
    sock.write(text);
  });
}
async function httpFront(bad) {
  const pl = await startPlay('front', ['--idle', 'off']);
  const notes = [];
  let rc;
  try {
    const t0 = performance.now();
    const r = await rawRequest(pl.port, `POST /api/input HTTP/1.1\r\nHost: 127.0.0.1:${pl.port}\r\nContent-Length: 314572800\r\n\r\n{"type": "key", `);
    const ms = performance.now() - t0;
    if (!r.got.startsWith('HTTP/1.1 403 ') || !r.got.includes('{"error":"token"}') || r.why !== 'closed') bad.push(`a refused POST with a 300 MB body pending: ${JSON.stringify(r.got.slice(0, 60))}, ${r.why} after ${ms.toFixed(0)} ms (want 403 and the connection closed)`);
    notes.push(`403 before the body in ${ms.toFixed(0)} ms`);
    {
      const n0 = (await pl.json('GET', '/api/log')).inputs.length;
      const r = await pl.req('POST', '/api/input?sync=1&timeout=inf', { type: 'dial', id: 'main', detents: 1 });
      await pl.input({ type: 'token', token: 'WAIT:1' });
      const n1 = (await pl.json('GET', '/api/log')).inputs.length;
      if (r.status !== 400 || String(r.body) !== '{"error":"timeout"}' || n1 !== n0 + 1) bad.push(`?sync=1&timeout=inf: ${r.status} ${String(r.body).slice(0, 80)}, ${n1 - n0} inputs logged (want 400 timeout, 1)`);
    }
    // fix2: the header tap (host/server.mjs) reads Host, X-Token and Origin from the request's own bytes: a header
    // block in two writes with X-Token's trailing space (403 token), after an empty line, and a chunked POST
    // (the tap stops for that connection; node answers it) followed by a request on a new connection
    const twoWrites = await new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: pl.port });
      let got = '';
      sock.on('data', (d) => { got += d; });
      sock.on('close', () => resolve(got));
      sock.write(`GET /api/screens HTTP/1.1\r\nHost: 127.0.0.1:${pl.port}\r\n`);
      setTimeout(() => sock.write(`X-Token: ${pl.token} \r\nConnection: close\r\n\r\n`), 100);
    });
    if (!twoWrites.startsWith('HTTP/1.1 403 ') || !twoWrites.includes('{"error":"token"}')) bad.push(`a header block in two writes with 'X-Token: <token> ': ${JSON.stringify(twoWrites.slice(0, 80))} (want 403 token)`);
    const crlf = await rawRequest(pl.port, `\r\nGET /api/screens HTTP/1.1\r\nHost: 127.0.0.1:${pl.port}\r\nX-Token: ${pl.token}\r\nConnection: close\r\n\r\n`);
    if (!crlf.got.startsWith('HTTP/1.1 ')) bad.push(`a request after an empty line: ${JSON.stringify(crlf.got.slice(0, 60))}`);
    const chunked = await new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: pl.port });
      let got = '';
      sock.on('data', (d) => { got += d; });
      sock.on('close', () => resolve(got));
      sock.on('error', () => resolve(got));
      sock.write(`POST /api/input HTTP/1.1\r\nHost: 127.0.0.1:${pl.port}\r\nX-Token: ${pl.token}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`);
      setTimeout(() => sock.write('2\r\n{}\r\n0\r\n\r\n'), 100);
    });
    const after = await pl.req('GET', '/api/screens');
    if (!chunked.startsWith('HTTP/1.1 ') || after.status !== 200) bad.push(`a chunked POST: ${JSON.stringify(chunked.slice(0, 60))}, then GET ${after.status}`);
    fs.rmSync(pl.out, { recursive: true, force: true });
    let err = null;
    try { await pl.req('POST', '/api/pagetest', { ok: true }); } catch (e) { err = e; }
    const want = `RuntimeError: ENOENT: no such file or directory, open '${path.join(pl.out, 'pagetest.json')}'`;
    if (err?.code !== 'ECONNRESET' || !pl.errs.join('').split('\n').includes(want)) bad.push(`/api/pagetest with out removed: ${err ? err.code : 'answered'}, stderr ${pl.errs.join('').slice(-300)}`);
    notes.push('timeout=inf, pagetest write');
  } finally { rc = await pl.close(); }
  if (rc !== 0) bad.push(`front: exit ${rc} (want 0, handler errors do not change it)`);
  return notes.join('; ');
}
// The Card panel's routes over HTTP (src/lab/playapi.mjs, the lab worker's env.cardView, the main thread's decoder and
// PNG): the session's options; the card the firmware formatted at the start (FAT32 'OM SYSTEM'); after S2 the
// picture's file listed, its bytes a JPEG, its picture a PNG; a missing file 404; the card out of the slot read as it
// is (the file still there), then back in and mounted again; none of the reads in the session log
async function cardRoutes(bad) {
  const pl = await startPlay('card', ['--idle', 'off']);
  const notes = [];
  try {
    const sess = await pl.json('GET', '/api/session');
    if (sess.host !== 'node' || sess.hdmi !== 'off' || sess.card_image !== true || sess.card_size !== null || !['native', 'stand-in'].includes(sess.lens)) bad.push(`GET /api/session: ${JSON.stringify(sess)}`);
    const c0 = await pl.req('GET', '/api/card'), d0 = JSON.parse(c0.body);
    if (c0.status !== 200 || d0.volume?.type !== 'FAT32' || d0.volume?.label !== 'OM SYSTEM' || d0.slot?.present !== true || d0.slot?.mounted !== true) bad.push(`GET /api/card at the start: ${c0.status} ${String(c0.body).slice(0, 300)}`);
    const log0 = (await pl.json('GET', '/api/log')).inputs.length;
    for (const inp of [{ type: 'token', token: 'WAIT:100' }, { type: 'key', id: 's1', action: 'down' }, { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' },
      { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }]) await pl.input(inp);
    const FILE = 'DCIM/100OMSYS/P1010001.JPG';
    const d1 = JSON.parse((await pl.req('GET', '/api/card')).body), e = d1.files?.find((f) => f.path === FILE);
    if (!e || !(e.size > 0)) bad.push(`GET /api/card after S2: no ${FILE} in ${JSON.stringify(d1.files?.map((f) => f.path))}`);
    const q = encodeURIComponent(FILE);
    const f = await pl.req('GET', `/api/card/file?path=${q}`);
    if (f.status !== 200 || f.headers['content-type'] !== 'image/jpeg' || f.body.length !== e?.size || f.body[0] !== 0xff || f.body[1] !== 0xd8) bad.push(`GET /api/card/file: ${f.status} ${f.headers['content-type']} ${f.body.length} bytes`);
    const im = await pl.req('GET', `/api/card/image?path=${q}&max=96`);
    if (im.status !== 200 || im.headers['content-type'] !== 'image/png' || !im.body.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')) || !/^\d+x\d+$/.test(im.headers['x-image-size'] ?? '')) bad.push(`GET /api/card/image: ${im.status} ${im.headers['content-type']} ${im.headers['x-image-size']}`);
    const nf = await pl.req('GET', '/api/card/file?path=NOPE.JPG');
    if (nf.status !== 404) bad.push(`GET /api/card/file of a missing file: ${nf.status} ${String(nf.body).slice(0, 200)}`);
    const out = await pl.input({ type: 'card', action: 'remove' });
    const d2 = JSON.parse((await pl.req('GET', '/api/card')).body);
    const back = await pl.input({ type: 'card', action: 'insert' });
    const d3 = JSON.parse((await pl.req('GET', '/api/card')).body);
    if (out?.error || d2.slot?.present !== false || !d2.files?.some((x) => x.path === FILE) || back?.error || d3.slot?.present !== true || d3.slot?.mounted !== true) {
      bad.push(`the card out and back: remove ${JSON.stringify(out?.error)}, read out ${JSON.stringify(d2.slot)} with ${d2.files?.length} files, insert ${JSON.stringify(back?.error)}, read in ${JSON.stringify(d3.slot)}`);
    }
    const logged = (await pl.json('GET', '/api/log')).inputs.slice(log0).map((x) => x.input.type);
    if (logged.includes('cardfiles') || logged.filter((t) => t === 'card').length !== 2) bad.push(`the session log after the card reads: ${JSON.stringify(logged)}`);
    notes.push(`card routes: ${FILE} ${e?.size} bytes, picture ${im.headers['x-image-size']}`);
    return notes.join('; ');
  } finally { await pl.close(); }
}
// fix2: an --out with '..': the session goes to <out>/y and the stopped line names that session.json
async function dotdot(bad) {
  const out = `${TMP}/dotdot/x/../y`;
  const pl = await startPlay('dotdot', ['--idle', 'off', '--out', out]);
  const rc = await pl.close();
  const want = `${STOPPED}${path.join(TMP, 'dotdot/y/session.json')}`;
  if (rc !== 0 || pl.lines.at(-1) !== want || !fs.existsSync(path.join(TMP, 'dotdot/y/session.json'))) bad.push(`--out x/../y: rc ${rc}, last line ${JSON.stringify(pl.lines.at(-1))} (want ${JSON.stringify(want)})`);
  return 'out with ..';
}
// A busy --port: rc 1, the listen error on the last stderr line
async function busyPort(bad) {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const p = spawn(process.execPath, [PLAY, '--no-browser', '--port', String(port), '--out', path.join(TMP, 'port')], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(String(d)));
    p.stderr.on('data', (d) => err.push(String(d)));
    const rc = await new Promise((r) => p.on('exit', (c) => r(c)));
    const last = err.join('').trimEnd().split('\n').at(-1);
    if (rc !== 1 || out.join('') !== '' || last !== `play.mjs: cannot listen on 127.0.0.1:${port}: listen EADDRINUSE: address already in use 127.0.0.1:${port}`) bad.push(`busy --port: rc ${rc}, stdout ${JSON.stringify(out.join('').slice(0, 80))}, last stderr line ${JSON.stringify(last)}`);
    return `busy port: ${last}`;
  } finally { srv.close(); }
}

export async function hostTests({ only = null } = {}) {
  const bad = [], notes = [];
  const cases = { order: orderWait, pl8b, busy: busyStatus, stops, stopped: stoppedSeq, labkill: labKill, front: httpFront, port: busyPort, dotdot, card: cardRoutes };
  let checks = 0;
  try {
    for (const [name, f] of Object.entries(cases)) {
      if (only && !only.includes(name)) continue;
      checks++;
      const n0 = bad.length;
      try { notes.push(await f(bad)); } catch (e) { bad.push(`${name}: ${e.stack ?? e}`); }
      if (bad.length > n0) bad.splice(n0, 0, `[${name}]`);
    }
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2);
  const r = await hostTests({ only: only.length ? only : null });
  r.notes.forEach((x) => console.log('  ', x));
  console.log(`host (G-host): ${r.checks - r.bad.filter((x) => x.startsWith('[')).length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
