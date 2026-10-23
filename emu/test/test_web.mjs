// The browser player's node-side gates:
// - B2: src/util/sha256.mjs against node's crypto: randomized chunked updates (strings with non-ASCII and astral
//   characters, byte arrays), copy() mid-stream, the empty input, every length around the 55/56/64-byte padding
//   boundaries, a 64 MiB buffer;
// - B4: web/frame.mjs's converter over all 2^24 words against the digest pinned from emu (YCC_SHA256), and
//   src/lab/playapi.mjs on a node Player (hostApiTests): the browser host's refusal of unported tokens, ?sync=1
//   timeouts, the logged input;
// - playui.mjs's rows against play.mjs's CONTROLS on every shared field;
// - B3's driver unit: web/driver.mjs with an injected scheduler (no spin while the lab is ahead, an immediate wake on
//   input, a kick ending a wait, 20 ms otherwise, an order deadline);
// - the hosts' failure paths: the router's request bodies (readBody), a refused unported token with the session running
//   on, ?sync=1 timeouts past setTimeout's limit and ones it refuses, web/page.mjs's polls once the session has stopped (they must reject, not resolve
//   at once forever), and web/worker.mjs hosted in a node worker thread (test/workershim.mjs): a file that is no .BIN
//   and a container that is not E143 refused with the boot offered again, and with $OM_BIN / $OM_FW_DIR the E143
//   .BIN booted, an unported token refused, a ?sync=1 request answered when the session quits.
//   node emu/test/test_web.mjs [--no-api]   (--no-api: skip the Player session of B4, about 10 s)
// Writes its temporary files under emu/out/test-web/.
import fs from 'node:fs';
import path from 'node:path';
import { createHash as nodeHash } from 'node:crypto';
import { createHash } from '../src/util/sha256.mjs';
import { rgbaOf, yccToRgb } from '../web/frame.mjs';
import { Driver, IDLE_WAIT_MS } from '../web/driver.mjs';
import { CONTROL_ROWS } from '../src/lab/playui.mjs';
import { CONTROLS, Tables } from '../src/lab/play.mjs';
import { PlayApi, readBody } from '../src/lab/playapi.mjs';
import { Player, ResultBox } from '../src/lab/player.mjs';
import { PlayerProxy } from '../host/proxy.mjs';
import { newFlags, F_STOP } from '../host/portqueue.mjs';
import { PLAYER_PARSER } from '../scenarios/session_replay.mjs';
import { LabError } from '../src/lab/errors.mjs';
import { PagePlayer } from '../web/page.mjs';
import { fwPaths, synthBlock } from './test_unpack.mjs';
import { Worker as NodeWorker } from 'node:worker_threads';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const OUT = path.join(REPO, 'emu/out/test-web');
const E = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk');

export function shaTests() {
  const bad = [];
  let checks = 0, seed = 7;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const same = (what, a, b) => { checks++; if (a !== b) bad.push(`sha256 ${what}: ${b} != node ${a}`); };
  for (let t = 0; t < 2000; t++) {
    const a = nodeHash('sha256'), b = createHash('sha256');
    const parts = rnd(7);
    for (let k = 0; k < parts; k++) {
      if (rnd(3) === 0) {
        const s = Array.from({ length: rnd(150) }, () => String.fromCodePoint([rnd(128), 0xe9, 0x4e2d, 0x1f600, 0xd800][rnd(5)])).join('');
        a.update(s); b.update(s);
      } else {
        const u = new Uint8Array(rnd(300));
        for (let i = 0; i < u.length; i++) u[i] = rnd(256);
        a.update(u); b.update(u);
      }
      if (rnd(4) === 0) same(`copy at case ${t}`, a.copy().digest('hex'), b.copy().digest('hex'));
    }
    same(`case ${t}`, a.digest('hex'), b.digest('hex'));
  }
  same('empty', nodeHash('sha256').digest('hex'), createHash('sha256').digest('hex'));
  // copy() mid-stream: the copy and the original go on independently (both updated after the copy)
  for (let t = 0; t < 50; t++) {
    const u = new Uint8Array(rnd(200) + 1).map(() => rnd(256)), v = new Uint8Array(rnd(200)).map(() => rnd(256)), w = new Uint8Array(rnd(200)).map(() => rnd(256));
    const a = nodeHash('sha256').update(u), b = createHash('sha256').update(u);
    const ac = a.copy(), bc = b.copy();
    a.update(v); b.update(v); ac.update(w); bc.update(w);
    same(`copy then both updated, case ${t} (original)`, a.digest('hex'), b.digest('hex'));
    same(`copy then both updated, case ${t} (copy)`, ac.digest('hex'), bc.digest('hex'));
  }
  for (let n = 50; n <= 130; n++) {
    const u = new Uint8Array(n).map((_, i) => (i * 7 + n) & 255);
    same(`length ${n}`, nodeHash('sha256').update(u).digest('hex'), createHash('sha256').update(u).digest('hex'));
    const h = createHash('sha256');
    for (let i = 0; i < n; i++) h.update(u.subarray(i, i + 1));
    same(`length ${n} byte by byte`, nodeHash('sha256').update(u).digest('hex'), h.digest('hex'));
  }
  const raw = createHash('sha256').update('abc').digest();
  checks++;
  if (!(raw instanceof Uint8Array) || Buffer.from(raw).toString('hex') !== nodeHash('sha256').update('abc').digest('hex')) bad.push('sha256 digest() bytes');
  const big = new Uint8Array(64 << 20);
  for (let i = 0; i < big.length; i += 4093) big[i] = i >>> 12;
  const t0 = performance.now(), x = createHash('sha256').update(big).digest('hex'), ms = performance.now() - t0;
  same('64 MiB', nodeHash('sha256').update(big).digest('hex'), x);
  return { checks, bad, mbps: Math.round(64 / (ms / 1000)) };
}

// The sha256 of ycc_to_rgb's RGB bytes over every 24-bit word, pinned from emu (the converter's regression: it changes
// only with the frame converter, in the commit that changes it).
const YCC_SHA256 = 'dfc987165e3317b10b60f78763bc1c19d411f9da058647871ff011610fe5fb1c';
export function yccTests() {
  const bad = [];
  const h = createHash('sha256'), step = 1 << 16, raw = new Uint8Array(4 * step), w32 = new Uint32Array(raw.buffer), rgb = new Uint8Array(3 * step);
  for (let base = 0; base < 1 << 24; base += step) {
    for (let i = 0; i < step; i++) w32[i] = base + i;
    const rgba = rgbaOf(step, 1, raw);
    for (let i = 0; i < step; i++) { rgb[3 * i] = rgba[4 * i]; rgb[3 * i + 1] = rgba[4 * i + 1]; rgb[3 * i + 2] = rgba[4 * i + 2]; }
    h.update(rgb);
  }
  const got = h.digest('hex');
  if (got !== YCC_SHA256) bad.push(`ycc_to_rgb over 2^24 words: ${got.slice(0, 16)} != pinned ${YCC_SHA256.slice(0, 16)}`);
  return { checks: 1, bad };
}

export function controlsTests() {
  const bad = [];
  const keys = ['id', 'name', 'kind', 'uiin', 'gui', 'inject', 'js_ev', 'dial', 'status', 'reason'];
  if (CONTROL_ROWS.length !== CONTROLS.length) bad.push(`playui ${CONTROL_ROWS.length} rows, play.mjs ${CONTROLS.length}`);
  CONTROL_ROWS.forEach((r, i) => {
    const c = CONTROLS[i];
    for (const k of keys) {
      const a = JSON.stringify(r[k] ?? null), b = JSON.stringify(c?.[k] ?? null);
      if (a !== b) bad.push(`control ${i} ${r.id} ${k}: playui ${a} != play.mjs ${b}`);
    }
  });
  return { checks: CONTROL_ROWS.length, bad };
}

// B4: a node Player through the router (src/lab/playapi.mjs), its session opened, then the host checks
// (hostSession) and the quit.
export async function hostApiTests() {
  const bad = [];
  const rom = new Uint8Array(fs.readFileSync(E + '00000000.OE.0100.bin')), resBlock = new Uint8Array(fs.readFileSync(E + '02000000.OE.0101.bin'));
  // A15 on: the camera application's start sets up the live view (CTRL3 0x41), which composites only with A15
  const a = { ...PLAYER_PARSER, no_browser: true, debug_api: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: false };
  let api = null;
  const pl = new Player(a, { rom, resBlock, createHash: nodeHash, wallClock: () => performance.now() / 1000,
    onStatus: () => api?.notify(), onFrame: (w, h, raw, meta) => { api.onFrame(w, h, raw, meta); api.notify(); } });
  api = new PlayApi(pl, { tables: Tables.of(rom), frameRgba: rgbaOf, timeScale: 0.001 });
  try { pl.open_session(); } catch (e) { if (!(e instanceof LabError)) throw e; pl.set_phase('error', pl.describe(e)); }
  const drain = () => { while (!pl.stopping() && (pl.q.length || pl.held.length)) { try { pl.tick(); } catch (e) { if (!(e instanceof LabError)) throw e; pl.fail(e); } } };
  let checks = 1;
  try {
    checks += await hostSession(pl, api, drain, bad);
    const r = api.handle({ method: 'POST', path: '/api/quit', headers: {}, body: undefined });
    api.notify();
    drain();
    api.notify();
    const q = await r;
    if (q.status !== 200) bad.push(`POST /api/quit: status ${q.status}`);
  } finally {
    if (pl.session !== null) pl.close_session();
    pl.set_stop();
  }
  return { checks, bad };
}

// On the B4 session before its quit: the browser host's refusal of unported tokens (env.refuseUnported), and ?sync=1
// waits past setTimeout's limit. Returns the number of checks.
async function hostSession(pl, api, drain, bad) {
  let n = 0;
  // the router's answer as [promise] (an array, so that returning it from an async function does not wait for it)
  const post = (p, body, run = true) => { const r = api.handle({ method: 'POST', path: p, headers: {}, body: JSON.stringify(body) }); if (run) drain(); return [Promise.resolve(r)]; };
  const answer = async (r) => JSON.parse(new TextDecoder().decode((await r).body));
  const result = async (p, body) => (await answer(post(p, body)[0])).result;
  pl.env.refuseUnported = true;
  try {
    // WINDOWS needs env.deflate (zlib), which this host, like the Worker, does not give: refused before anything ran
    for (const tok of ['WINDOWS', 'WINDOWS:800']) {
      n++;
      const res = await result('/api/token?sync=1', { token: tok });
      if (!res || !String(res.error).startsWith('Unported: ') || res.record !== null || pl.phase !== 'running' || pl.session === null) bad.push(`host: token ${tok} with refuseUnported: ${JSON.stringify(res)?.slice(0, 200)}, phase ${pl.phase}`);
    }
    for (const tok of ['STORE', 'INTC']) {     // ported: their records
      n++;
      const res = await result('/api/token?sync=1', { token: tok });
      if (!res || res.error !== null || !res.record) bad.push(`host: ${tok} after the refused tokens: ${JSON.stringify(res)?.slice(0, 200)}`);
    }
  } finally { pl.env.refuseUnported = false; }
  // ?sync=1 past 2^31 - 1 ms (and a timeout past 2^63 ns): still waiting after 50 ms, answered once the input ran
  const pending = (p, ms) => Promise.race([p.then(() => 'answered'), new Promise((r) => setTimeout(() => r('pending'), ms))]);
  for (const t of ['3000000', '9223372036.854776']) {
    n++;
    const [r] = post(`/api/input?sync=1&timeout=${t}`, { type: 'dial', id: 'main', detents: 1 }, false);
    const st = await pending(r, 50);
    drain(); api.notify();
    const res = (await answer(r)).result;
    if (st !== 'pending' || !res || !res.record) bad.push(`host: ?sync=1&timeout=${t}: ${st} after 50 ms, result ${JSON.stringify(res)?.slice(0, 120)}`);
  }
  // the logged input is the body as sent, without seq and t_wall
  n++;
  {
    const text = '{"type": "dial", "id": "main", "detents": 1, "note": "\u007f"}';
    const r = api.handle({ method: 'POST', path: '/api/input?sync=1', headers: {}, body: text });
    drain(); api.notify();
    await r;
    const got = JSON.stringify(pl.log.at(-1)?.input ?? null);
    if (got !== JSON.stringify(JSON.parse(text))) bad.push(`host: logged input ${got}`);
  }
  // a timeout that is not a finite decimal number: 400, the input not queued
  for (const t of ['inf', 'nan', '-inf', '1e400', 'x', '']) {
    n++;
    const before = pl.input_seq;
    const r = await post(`/api/input?sync=1&timeout=${t}`, { type: 'dial', id: 'main', detents: 1 }, false)[0];
    const doc = await answer(Promise.resolve(r));
    if (r.status !== 400 || doc.error !== 'timeout' || pl.input_seq !== before) bad.push(`host: ?sync=1&timeout=${t}: ${r.status} ${JSON.stringify(doc)}, inputs queued ${pl.input_seq - before}`);
  }
  // 0 or less: null at once (the input still runs)
  for (const t of ['-1', '0.01']) {
    n++;
    const [r] = post(`/api/input?sync=1&timeout=${t}`, { type: 'dial', id: 'main', detents: -1 }, false);
    const st = await pending(r, 1000);
    const early = (await answer(r)).result;
    drain(); api.notify();
    if (st !== 'answered' || early !== null) bad.push(`host: ?sync=1&timeout=${t} not drained: ${st}, result ${JSON.stringify(early)?.slice(0, 120)} (want null)`);
  }
  return n;
}

// The router's request bodies (readBody): UTF-8 JSON, a leading byte order mark skipped, an empty body {}; a body that
// is not UTF-8 or not JSON is undefined (400 {error: 'json'}).
export function bodyTests() {
  const bad = [];
  const b = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));
  const cases = [
    ['a string', '{"type": "key", "id": "ok"}', '{"type":"key","id":"ok"}'], ['an empty string', '', '{}'],
    ['bytes', b('7b2274223a2022c3a9227d'), '{"t":"\u00e9"}'], ['a byte order mark', b('efbbbf7b7d'), '{}'], ['no bytes', b(''), '{}'],
    ['bytes not UTF-8', b('7b2274223a2022ff227d'), undefined], ['UTF-16', b('7b007d00'), undefined], ['NaN', '{"a": NaN}', undefined],
    ['a trailing comma', '[1,]', undefined], ['two documents', '{} {}', undefined],
  ];
  for (const [what, body, want] of cases) {
    const got = JSON.stringify(readBody(body));
    if (got !== want) bad.push(`readBody ${what}: ${got} != ${want}`);
  }
  const o = readBody('{"__proto__": {"x": 1}}');
  if (Object.getPrototypeOf(o) !== Object.prototype || !Object.hasOwn(o, '__proto__')) bad.push('readBody: __proto__ set the prototype');
  return { checks: cases.length + 1, bad };
}

// fix2: wait_result's waiters (ResultBox) wake only at a notify (notifyAll): a stop alone wakes
// nobody, so a waiter whose input finishes before the next status gets its record (not null); one whose input has not
// finished gets null at the next notify after the stop.
export async function resultBoxTests() {
  const bad = [];
  const state = (p) => Promise.race([p.then((r) => ['answered', r]), new Promise((r) => setTimeout(() => r(['pending', null]), 30))]);
  // the node host's main-thread view (host/proxy.mjs): the loop's own stop (a quit control: its 'stop' message, in
  // the Player's order), then the loop's messages
  const proxy = new PlayerProxy({}, newFlags(), null);
  const a = proxy.wait_result(1, 10), b = proxy.wait_result(2, 10);
  proxy.onMessage({ type: 'stop' });                    // the loop stopped: no notify
  const s0 = await state(a);
  if (s0[0] !== 'pending') bad.push(`wait_result: answered at the stop (${JSON.stringify(s0)}), want a wait for the next notify`);
  proxy.onMessage({ type: 'result', seq: 1, text: '{"record": "r1"}' });    // input 1 finishes: a notify
  const [s1, s2] = [await state(a), await state(b)];
  if (s1[0] !== 'answered' || s1[1]?.record !== 'r1') bad.push(`wait_result: input 1 finished after the stop: ${JSON.stringify(s1)} (want its record)`);
  if (s2[0] !== 'answered' || s2[1] !== null) bad.push(`wait_result: input 2 at that notify: ${JSON.stringify(s2)} (want null, stopped)`);
  // 3d: the quit control's own ?sync=1 waiter: its 'stop', then its status (a notify), then its result: the record
  // (gate 2's v-api), and a long poll's view of the stop comes with that result
  const proxy3 = new PlayerProxy({}, newFlags(), null);
  const c3 = proxy3.wait_result(3, 10);
  proxy3.onMessage({ type: 'stop' });
  proxy3.onMessage({ type: 'status', seq: 9, text: '{"phase": "running"}' });
  const s7 = [await state(c3), proxy3.stop];
  proxy3.onMessage({ type: 'result', seq: 3, text: '{"record": "quit"}' });
  const s8 = [await state(c3), proxy3.stop];
  if (s7[0][0] !== 'pending' || s7[1] || s8[0][0] !== 'answered' || s8[0][1]?.record !== 'quit' || !s8[1]) bad.push(`wait_result: the quit control's own waiter: ${JSON.stringify([s7, s8])} (want pending and no stop at its status, then its record and the stop)`);
  // 3d: the worker's shared stop word is set before its earlier messages arrive; the waiters follow the message order,
  // so a notify from an earlier message (a status) leaves a waiter whose result is still in flight waiting
  const proxy2 = new PlayerProxy({}, newFlags(), null);
  const c2 = proxy2.wait_result(1, 10);
  Atomics.store(proxy2.flags, F_STOP, 1);               // the loop ran input 1 and then a quit control
  proxy2.onMessage({ type: 'status', seq: 7, text: '{"phase": "running"}' });       // published before input 1's answer
  const s5 = await state(c2);
  proxy2.onMessage({ type: 'result', seq: 1, text: '{"record": "r1"}' });
  proxy2.onMessage({ type: 'stop' });
  const s6 = await state(c2);
  if (s5[0] !== 'pending' || s6[0] !== 'answered' || s6[1]?.record !== 'r1') bad.push(`wait_result: the shared stop word before the result's message: ${JSON.stringify([s5, s6])} (want pending, then the record)`);
  // the headless Player's box (the browser's Worker) the same way
  let stop = false;
  const box = new ResultBox(() => stop);
  const c = box.wait(3, 10);
  stop = true;
  const s3 = await state(c);
  box.notifyAll();
  const s4 = await state(c);
  if (s3[0] !== 'pending' || s4[0] !== 'answered' || s4[1] !== null) bad.push(`ResultBox: ${JSON.stringify([s3, s4])} (pending until a notify, then null)`);
  // fix2 (3d): the browser's Worker (PlayApi on the Player itself): a ?sync=1 quit control answers its record, as
  // the node host does, and its stop reaches the other waiters with that result (the status the control
  // publishes before it wakes nobody to a stop); the host's own stop (set_stop()) takes effect at once
  const hp = new Player({ ...PLAYER_PARSER, no_browser: true, debug_api: false, idle: 'off', a15: 'off', out: '<out>', no_wait_on_error: false },
    { rom: null, resBlock: null, wallClock: () => performance.now() / 1000 });
  const hapi = new PlayApi(hp, { tables: null, frameRgba: () => null });
  const other = hp.wait_result(99, 10);
  const statusSeen = [];
  hp.env.onStatus = () => statusSeen.push([hp.box.stopped(), hp.stop]);
  const qr = hapi.handle({ method: 'POST', path: '/api/input?sync=1', headers: {}, body: JSON.stringify({ type: 'control', op: 'quit' }) });
  hp.control(hp.q.get_nowait());                         // what tick() runs for the queued control
  const qa = JSON.parse(new TextDecoder().decode((await qr).body));
  const so = await state(other);
  if (qa.result?.record?.token !== 'quit' || qa.result?.error !== null || JSON.stringify(statusSeen) !== '[[false,true]]' || so[0] !== 'answered' || so[1] !== null || !hp.stopping())
    bad.push(`Player: a ?sync=1 quit control: ${JSON.stringify([qa, statusSeen, so])} (want its record; at its status the waiters see no stop, then null for the others)`);
  const hp2 = new Player({ ...PLAYER_PARSER, no_browser: true, debug_api: false, idle: 'off', a15: 'off', out: '<out>', no_wait_on_error: false },
    { rom: null, resBlock: null, wallClock: () => performance.now() / 1000 });
  const w2 = hp2.wait_result(1, 10);
  hp2.set_stop();
  hp2.notify();
  const s9 = await state(w2);
  if (s9[0] !== 'answered' || s9[1] !== null) bad.push(`Player: the host's own stop: ${JSON.stringify(s9)} (null at its notify)`);
  // web/page.mjs: /api/quit is one queued request to the Worker; no {type: 'quit'} after it (that stops the loop before
  // the inputs queued ahead of the quit run, the pre-3d order)
  const PPq = new PagePlayer();
  const posted = [];
  PPq.worker = { postMessage(m) { posted.push(m.type); } };
  const pq = PPq.api('/api/quit', {});
  PPq.message({ type: 'res', id: 1, status: 200, headers: [['Content-Type', 'application/json']], body: new TextEncoder().encode('{"ok": true}') });
  await pq;
  await new Promise((r) => setTimeout(r, 10));
  if (JSON.stringify(posted) !== '["req"]') bad.push(`page /api/quit: posted ${JSON.stringify(posted)} (only the request)`);
  return { checks: 9, bad };
}

// web/page.mjs once the Worker's loop has stopped: the 'stopped' status once, then every status and frame poll
// rejects (index.html's loops end through gone()); an index.html-like loop must let a timer run.
export async function pageTests() {
  const bad = [];
  const PP = new PagePlayer();
  PP.worker = { postMessage() {} };
  PP.message({ type: 'status', doc: { seq: 6, phase: 'running' } });
  PP.message({ type: 'frame', seq: 3, device: 'tft', lab_ns: 1, sha16: 'x', w: 1, h: 1, rgba: new Uint8Array(4), t_post: 0 });
  PP.message({ type: 'status', doc: { seq: 7, phase: 'stopped' } });
  PP.message({ type: 'stopped' });
  const outcome = (p) => p.then((r) => `${r.status}`, (e) => `rejected: ${e.message}`);
  const got = [await outcome(PP.api('/api/status?after=6')), await outcome(PP.api('/api/status?after=7')), await outcome(PP.api('/api/frame?after=0')), await outcome(PP.api('/api/frame?after=3'))];
  const want = ['200', 'rejected: /api/status: the session has stopped', '200', 'rejected: /api/frame: the session has stopped'];
  if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`page after stop: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  // index.html's statusLoop and gone() (500 ms per failure, stopped after the fourth): the 50 ms timer must fire
  let fired = false, polls = 0, failures = 0, stopped = false, seq = 0;
  setTimeout(() => { fired = true; }, 50);
  const t0 = performance.now();
  while (!stopped && polls < 100000) {
    polls++;
    try { const r = await PP.api('/api/status?after=' + seq); seq = (await r.json()).seq; failures = 0; } catch { if (++failures > 3) stopped = true; else await new Promise((r) => setTimeout(r, 20)); }
  }
  if (!stopped || !fired || polls > 10) bad.push(`page after stop: the status loop ran ${polls} polls in ${Math.round(performance.now() - t0)} ms, stopped ${stopped}, timer ${fired ? 'fired' : 'never fired'}`);
  // a boot failure wakes a waiter on the boot (index.html init)
  const PP2 = new PagePlayer();
  const w = PP2.waitFor(() => PP2.status || PP2.bootFailed, 5000);
  PP2.message({ type: 'boot-failed', message: 'x' });
  const early = await Promise.race([w.then(() => 'woken'), new Promise((r) => setTimeout(() => r('still waiting'), 100))]);
  if (early !== 'woken' || PP2.bootFailed?.message !== 'x') bad.push(`page boot-failed: ${early}`);
  // a frame's device and lab time reach the page's headers (index.html sets the EVF layout from X-Device; finding 25)
  const PP4 = new PagePlayer();
  PP4.message({ type: 'status', doc: { seq: 1, phase: 'running' } });
  PP4.message({ type: 'frame', seq: 2, device: 'evf', lab_ns: 1234567, sha16: 'y', w: 1, h: 1, rgba: new Uint8Array(4), t_post: 0 });
  const fh = await PP4.api('/api/frame?after=0').then((r) => `${r.status} ${r.headers.get('X-Device')} ${r.headers.get('X-Lab-Ns')} ${r.headers.get('X-Frame-Seq')}`, (e) => `rejected: ${e.message}`);
  if (fh !== '200 evf 1234567 2') bad.push(`page frame headers: ${fh}`);
  return { checks: 4, bad };
}

// web/worker.mjs in a node worker thread (test/workershim.mjs): {checks, bad, skipped}
export async function workerTests() {
  const bad = [], skipped = [];
  let checks = 0;
  const w = new NodeWorker(new URL('./workershim.mjs', import.meta.url));
  const seen = [];
  let wake = null;
  let lastFrame = null;
  w.on('message', (m) => { if (m.type === 'frame') lastFrame = { device: m.device, lab_ns: m.lab_ns, seq: m.seq }; else if (m.type !== 'log') seen.push(m); if (wake) wake(); });
  w.on('error', (e) => { seen.push({ type: 'thread-error', message: String(e?.stack ?? e) }); if (wake) wake(); });
  const until = async (pred, ms) => {
    const end = performance.now() + ms;
    for (;;) {
      const x = seen.find(pred);
      if (x) return x;
      if (performance.now() > end) return null;
      await new Promise((r) => { wake = r; setTimeout(r, 50); });
    }
  };
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(OUT, 'worker-'));
  try {
    const junk = path.join(tmp, 'junk.BIN');
    fs.writeFileSync(junk, Buffer.alloc(4096, 0x5a));
    let seed = 9;
    const body = (n) => Uint8Array.from({ length: n }, () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; });
    const other = path.join(tmp, 'OTHER.BIN');
    fs.writeFileSync(other, Buffer.concat([synthBlock('OE', 0x0100, body(4096)), synthBlock('OE', 0x0101, body(2048))]));
    for (const [what, file, want] of [['no .BIN', junk, 'no OE block with flags 0x0100'], ['not E143', other, 'OLY_E_143_1900_0000_0000.BIN'], ['no .BIN again', junk, 'no OE block']]) {
      checks++;
      const n0 = seen.length;
      w.postMessage({ type: 'boot', binPath: file, cache: false, args: { idle: 'off' } });
      const f = await until((m, i) => i >= n0 && m.type === 'boot-failed', 20000);
      if (!f || !f.message.includes(want)) bad.push(`worker boot (${what}): ${f ? f.message : 'no boot-failed'}; seen ${JSON.stringify(seen.slice(n0).map((m) => m.type))}`);
    }
    checks++;
    const n0 = seen.length;
    w.postMessage({ type: 'req', id: 1, method: 'GET', path: '/api/controls', t_page: 0 });
    const r503 = await until((m, i) => i >= n0 && m.type === 'res' && m.id === 1, 5000);
    if (!r503 || r503.status !== 503) bad.push(`worker: a request before any session: ${r503 ? r503.status : 'no answer'}`);
    const { bin } = fwPaths();
    if (!bin || !fs.existsSync(bin)) skipped.push(`worker with E143: ${bin ?? 'set OM_BIN or OM_FW_DIR'} not found`);
    else {
      checks++;
      w.postMessage({ type: 'boot', binPath: bin, cache: false, args: { idle: 'off', debug_api: true } });
      const up = await until((m) => m.type === 'status' && m.doc.phase === 'running', 120000);
      if (!up) bad.push(`worker: the E143 .BIN did not reach running: ${JSON.stringify(seen.filter((m) => m.type !== 'status').slice(-3)).slice(0, 400)}`);
      else {
        const req = async (id, method, p, body) => {
          const k = seen.length;
          w.postMessage({ type: 'req', id, method, path: p, body: body === undefined ? undefined : JSON.stringify(body), t_page: 0 });
          const m = await until((x, i) => i >= k && x.type === 'res' && x.id === id, 120000);
          return m ? { status: m.status, doc: JSON.parse(new TextDecoder().decode(m.body)) } : null;
        };
        checks++;
        const win = await req(2, 'POST', '/api/token?sync=1', { token: 'WINDOWS' });
        if (!win || win.status !== 200 || !String(win.doc.result?.error).startsWith('Unported: ')) bad.push(`worker: WINDOWS token: ${JSON.stringify(win)?.slice(0, 300)}`);
        checks++;
        const store = await req(5, 'POST', '/api/token?sync=1', { token: 'STORE' });
        if (!store || store.status !== 200 || store.doc.result?.error !== null || !store.doc.result?.record) bad.push(`worker: STORE token: ${JSON.stringify(store)?.slice(0, 300)}`);
        // the frame message's device and lab time, and the input's t_wall taken from t_page (0 here, so the latency
        // the status reports is the whole epoch; verify round 1 finding 25)
        checks++;
        const st6 = await req(6, 'GET', '/api/status?after=0');
        const fr = lastFrame;
        if (!st6 || st6.status !== 200 || !(st6.doc.last?.latency_ms > 1e12) || st6.doc.last?.input?.token !== 'STORE') bad.push(`worker: t_page as the input's t_wall: last ${JSON.stringify(st6?.doc?.last)?.slice(0, 200)}`);
        if (!fr || fr.device !== 'tft' || !(fr.lab_ns > 0) || !(fr.seq >= 1 && fr.seq <= st6?.doc?.frame_seq)) bad.push(`worker: frame message ${JSON.stringify(fr)} against the status's frame_seq ${st6?.doc?.frame_seq}`);
        checks++;
        const inf = await req(3, 'POST', '/api/input?sync=1', { type: 'dial', id: 'main', detents: 'x' });
        if (!inf || inf.status !== 200 || !String(inf.doc.result?.error).includes('is not an integer')) bad.push(`worker: a refused dial: ${JSON.stringify(inf)?.slice(0, 300)}`);
        // the live debug route on the Worker's queue (src/debug/live.mjs): halt, a dial held meanwhile, no breakpoints
        // (the queue does not block), resume, the dial then run
        checks++;
        const dh = await req(7, 'POST', '/api/debug', { id: 'h', op: 'halt' });
        w.postMessage({ type: 'req', id: 8, method: 'POST', path: '/api/input?sync=1', body: JSON.stringify({ type: 'dial', id: 'main', detents: 1 }), t_page: 0 });
        const db = await req(9, 'POST', '/api/debug', { op: 'break', pcs: ['0x50000000'] });
        const ds = await req(10, 'POST', '/api/debug', { op: 'state' });
        const early = seen.some((x) => x.type === 'res' && x.id === 8);
        const dr = await req(11, 'POST', '/api/debug', { op: 'resume' });
        const dial = await until((x) => x.type === 'res' && x.id === 8, 60000);
        if (dh?.doc?.stop !== 'halt' || dh.doc.id !== 'h' || !/does not block/.test(db?.doc?.error?.message ?? '') || ds?.doc?.state !== 'halted' || early || dr?.doc?.state !== 'running' || !dial || dial.status !== 200) {
          bad.push(`worker: the debug route: halt ${JSON.stringify(dh?.doc)?.slice(0, 120)}, break ${JSON.stringify(db?.doc)?.slice(0, 160)}, state ${ds?.doc?.state}, the dial answered while halted ${early}, resume ${dr?.doc?.state}, the held dial ${dial ? dial.status : 'unanswered'}`);
        }
        // a ?sync=1 request in flight when the session quits is answered (result null or the record), then 'stopped'
        checks++;
        const k = seen.length;
        w.postMessage({ type: 'req', id: 4, method: 'POST', path: '/api/input?sync=1&timeout=600', body: JSON.stringify({ type: 'token', token: 'WAIT:500' }), t_page: 0 });
        w.postMessage({ type: 'req', id: 5, method: 'POST', path: '/api/quit', body: '{}', t_page: 0 });
        const a4 = await until((x, i) => i >= k && x.type === 'res' && x.id === 4, 60000);
        const st = await until((x, i) => i >= k && x.type === 'stopped', 60000);
        if (!a4 || a4.status !== 200 || !st) bad.push(`worker: quit with a ?sync=1 request in flight: answer ${a4 ? a4.status : 'none'}, stopped ${!!st}`);
      }
    }
    const errs = seen.filter((m) => m.type === 'thread-error');
    if (errs.length) bad.push(`worker thread: ${errs[0].message.slice(0, 400)}`);
  } finally {
    await w.terminate();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { checks, bad, skipped };
}

// B3: the driver with an injected scheduler and a stub Player.
export async function driverTests() {
  const bad = [];
  let checks = 0;
  const eq = (what, got, want) => { checks++; if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`driver ${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`); };
  let t = 100;
  const timers = [];
  const sched = { now: () => t, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimer: (id) => { timers[id].cleared = true; },
    macrotask: (fn) => fn() };
  let lab = 0;
  const pl = { q: [], held: [], session: { lab: { lab_time: () => lab } }, idle: 'wall', l_a: 0, w_a: 100, client_next: new Map(), client_wait: new Map(),
    stop: false, wall: () => t, stopping() { return this.stop; } };
  const d = new Driver(pl, sched);
  lab = 30000000;                            // 30 ms ahead of the wall clock
  eq('lab ahead: wait until the target passes (ms)', Math.round(d.delay()), 20);
  lab = 5000000;
  eq('lab 5 ms ahead', d.delay(), 5.5);
  lab = 0; t = 100.01;
  eq('lab behind: immediate', d.delay(), 0);
  pl.q.push({ type: 'key' }); lab = 99e9;
  eq('input queued: immediate', d.delay(), 0);
  pl.q.length = 0; pl.idle = 'off';
  eq('idle off, nothing queued', d.delay(), IDLE_WAIT_MS);
  pl.held.push({ client: 'pg', cseq: 3 }); pl.client_next.set('pg', 2); pl.client_wait.set('pg\u00002', ['pg', 2, t + 0.005]);
  eq('held back by its order: until the deadline', Math.round(d.delay()), 5);
  pl.held.length = 0;
  // a wait ended by a kick, then one by its timer
  const w1 = d.wake();
  eq('a timer is set', timers.length, 1);
  d.kick();
  eq('kick ends the wait', await w1, 'kick');
  eq('kick cleared the timer', timers[0].cleared, true);
  const w2 = d.wake();
  timers[1].fn();
  eq('timer ends the wait', await w2, 'timer');
  // run(): a Player that stops after 5 ticks, lab always ahead: 5 timer waits, no spin
  let ticks = 0;
  const pl2 = { ...pl, idle: 'wall', open_session() {}, close_session() {}, write_log() {}, tick() { if (++ticks === 5) this.stop = true; }, stop: false };
  lab = 99e9;
  const d2 = new Driver(pl2, { ...sched, setTimer: (fn, ms) => { setTimeout(fn, 0); return 0; } });
  await d2.run();
  eq('run: ticks', ticks, 5);
  eq('run: waits (no spin while ahead)', d2.waits, { immediate: 1, timer: 4, kicked: 0, timedOut: 4 });
  // run(): a host error in a tick (Unported, HostStopped) fails the session and the loop goes on (restart recovers);
  // a bug still ends it
  const { Unported, HostStopped } = await import('../src/machine.mjs');
  for (const [what, err, survives] of [['Unported', new Unported('x'), true], ['HostStopped', new HostStopped('cont', new Error('y')), true], ['a bug', new TypeError('z'), false]]) {
    let n = 0;
    const failed = [];
    const pl3 = { ...pl, open_session() {}, close_session() {}, write_log() {}, fail(e) { failed.push(e.name); }, stop: false,
      tick() { if (++n === 1) throw err; if (n === 3) this.stop = true; } };
    let threw = null;
    try { await new Driver(pl3, { ...sched, setTimer: (fn) => { setTimeout(fn, 0); return 0; } }).run(); } catch (e) { threw = e.name; }
    eq(`run: ${what} in a tick`, { failed, threw, ticks: n }, survives ? { failed: [err.name], threw: null, ticks: 3 } : { failed: [], threw: err.name, ticks: 1 });
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = shaTests(), y = yccTests(), c = controlsTests(), d = await driverTests(), j = bodyTests(), rb = await resultBoxTests(), p = await pageTests(), w = await workerTests();
  console.log(`sha256 (B2): ${s.checks - s.bad.length}/${s.checks} (${s.mbps} MB/s); ycc_to_rgb (B4): ${y.checks - y.bad.length}/${y.checks}; playui rows: ${c.checks - c.bad.length}/${c.checks}; driver (B3): ${d.checks - d.bad.length}/${d.checks}; ` +
    `request bodies: ${j.checks - j.bad.length}/${j.checks}; wait_result: ${rb.checks - rb.bad.length}/${rb.checks}; page after stop: ${p.checks - p.bad.length}/${p.checks}; worker host: ${w.checks - w.bad.length}/${w.checks}${w.skipped.length ? ` (${w.skipped.length} SKIPPED)` : ''}`);
  const all = [...s.bad, ...y.bad, ...c.bad, ...d.bad, ...j.bad, ...rb.bad, ...p.bad, ...w.bad];
  if (!process.argv.includes('--no-api')) {
    const a = await hostApiTests();
    console.log(`node host on a Player (B4): ${a.checks - a.bad.length}/${a.checks}`);
    all.push(...a.bad);
  }
  all.slice(0, 40).forEach((x) => console.log('  ', x));
  process.exit(all.length ? 1 : 0);
}
