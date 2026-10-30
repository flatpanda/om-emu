// The browser player's node-side gates:
// - B2: src/util/sha256.mjs against node's crypto: randomized chunked updates (strings with non-ASCII and astral
//   characters, byte arrays), copy() mid-stream, the empty input, every length around the 55/56/64-byte padding
//   boundaries, a 64 MiB buffer;
// - B4: web/frame.mjs's converter over all 2^24 words against the digest pinned from emu (YCC_SHA256), and
//   src/lab/playapi.mjs on a node Player (hostApiTests): the browser host's refusal of unported tokens, ?sync=1
//   timeouts, the logged input;
// - B6's page inputs (PAGE_B6_INPUTS, webgate's keys, touch and mode dial) on a node Player: a new frame and the GUI
//   state after each key and touch, the dial's position and name after its groups, so a sequence the page check would
//   fail on fails here without Chrome (pageInputsTests);
// - playui.mjs's rows against play.mjs's CONTROLS on every shared field;
// - B3's driver unit: web/driver.mjs with an injected scheduler (no spin while the lab is ahead, an immediate wake on
//   input, a kick ending a wait, 20 ms otherwise, an order deadline);
// - the hosts' failure paths: the router's request bodies (readBody), a refused unported token with the session running
//   on, ?sync=1 timeouts past setTimeout's limit and ones it refuses, web/page.mjs's polls once the session has stopped (they must reject, not resolve
//   at once forever), and web/worker.mjs hosted in a node worker thread (test/workershim.mjs): a file that is no .BIN
//   and a container that is not E143 refused with the boot offered again, and with $OM_BIN / $OM_FW_DIR the E143
//   .BIN booted, an unported token refused, the card the firmware formatted read through GET /api/card and the
//   session's options through GET /api/session, a ?sync=1 request answered when the session quits;
// - the Card panel and the session options without firmware (cardTests): base64, the card's reader
//   (web/cardfiles.mjs) on a FAT16 volume built here, the router's /api/session and card routes on a headless Player,
//   the node server's PNG of a picture, web/page.mjs's binary answers, the browser's S-NVRAM host (web/nvram.mjs).
//   node emu/test/test_web.mjs [--no-api]   (--no-api: skip the Player sessions of B4 and B6's page inputs, about 15 s)
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
import zlib from 'node:zlib';
import { SdCard, SECTOR } from '../src/lab/sdcard.mjs';
import { jpegOfFrame } from '../src/lab/jpeg.mjs';
import { bytesBase64, base64Bytes } from '../src/util/bytes.mjs';
import { CARD_VIEW, cardList, cardFile, jpegRgba } from '../web/cardfiles.mjs';
import { browserNvram } from '../web/nvram.mjs';
import { pngRgba } from '../host/server.mjs';
import { buildExfat } from './test_storage.mjs';

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

// B6's page inputs (bin/webgate.mjs): the Player inputs web/index.html sends for webgate's keys and touch, in order,
// grouped by the page check that waits for each group; webgate requires the page's sent inputs to be these. gui: the
// state the group must end in. OK comes before the mode dial, which it had to until the lab ran the store's module init
// (H-STOREINIT, 2026-10-30): before, once the dial had left P, setting 820 read 0 with most other settings and the camera
// application's OK path skipped (0x5106675d..66: 0x51052dc8 is 1 when 820 is 0), so no frame followed (X;
// docs/om1-input-spec.md section 2, "The mode change"); the order is kept, so the page's inputs stay as they were. The
// touch is on the shooting screen's touch-mode icon, which the camera application, forwarding the touch itself with the
// native lens, turns to its next mode (X); at (90, 30), the wireless icon, it opens Wi-Fi Connection (X), so the touch
// is no longer there (docs/hle-gaps.md 4.4.2). mode_dial: the positions the group moves the dial; mode_dial_at and
// mode_label: the position it ends at and that position's name (the mouse group: the dial's arrows at their centres,
// then E143's P on its ring, position 8: src/fw/facts.mjs MODE_DIAL_E143).
const KEY = (id) => [{ type: 'key', id, action: 'down' }, { type: 'key', id, action: 'up' }];
export const PAGE_B6_INPUTS = [
  { what: 'key KeyM', inputs: KEY('menu'), gui: '0x0b02' },
  { what: 'key ArrowDown', inputs: KEY('down'), gui: '0x0b02' },
  { what: 'key KeyM', inputs: KEY('menu'), gui: '0x0108' },
  { what: 'touch (35, 465)', inputs: [{ type: 'touch', action: 'down', x: 35, y: 465 }, { type: 'touch', action: 'up', x: 35, y: 465 }], gui: '0x0108' },
  { what: 'key Enter', inputs: KEY('ok'), gui: '0x0403' },
  { what: 'PageUp twice quickly', inputs: [{ type: 'switch', id: 'mode_dial', step: 1 }, { type: 'switch', id: 'mode_dial', step: 1 }], mode_dial: 2 },
  { what: 'mode dial by mouse: next, previous, P', inputs: [{ type: 'switch', id: 'mode_dial', step: 1 }, { type: 'switch', id: 'mode_dial', step: -1 },
    { type: 'switch', id: 'mode_dial', value: 8 }], mode_dial_at: 8, mode_label: 'P' },
];
// B6 without Chrome: PAGE_B6_INPUTS on a node Player as webgate's node side runs them (idle off, one input at a time).
// Each key and touch group must publish a new frame and end in its GUI state; a dial group must leave the dial where
// it says (mode_dial, or mode_dial_at with that position's name).
export async function pageInputsTests() {
  const bad = [];
  const rom = new Uint8Array(fs.readFileSync(E + '00000000.OE.0100.bin')), resBlock = new Uint8Array(fs.readFileSync(E + '02000000.OE.0101.bin'));
  const a = { ...PLAYER_PARSER, no_browser: true, out: '<out>', no_wait_on_error: false, idle: 'off' };
  const pl = new Player(a, { rom, resBlock, createHash: nodeHash, wallClock: () => performance.now() / 1000 });
  const api = new PlayApi(pl, { tables: Tables.of(rom), frameRgba: rgbaOf });
  try { pl.open_session(); } catch (e) { if (!(e instanceof LabError)) throw e; pl.set_phase('error', pl.describe(e)); }
  try {
    for (const g of PAGE_B6_INPUTS) {
      const seq0 = pl.frame_seq, dial0 = pl.session?.mode_index;
      for (const b of g.inputs) {
        api.handle({ method: 'POST', path: '/api/input', headers: {}, body: JSON.stringify(b) });
        while (pl.q.length || pl.held.length) { try { pl.tick(); } catch (e) { if (!(e instanceof LabError)) throw e; pl.fail(e); } }
      }
      pl.publish_status();
      const s = pl.status_doc;
      if (s.phase !== 'running') { bad.push(`page inputs ${g.what}: phase ${s.phase} ${JSON.stringify(s.error)?.slice(0, 300)}`); break; }
      if (g.gui && (s.frame_seq <= seq0 || s.gui !== g.gui)) bad.push(`page inputs ${g.what}: frame_seq ${seq0} -> ${s.frame_seq}, GUI ${s.gui} ${s.gui_name} (want a new frame, GUI ${g.gui})`);
      const n = s.mode_dial_positions.length;
      if (g.mode_dial !== undefined && s.mode_dial !== (dial0 + g.mode_dial) % n) bad.push(`page inputs ${g.what}: mode dial ${dial0} -> ${s.mode_dial}`);
      if (g.mode_dial_at !== undefined && (s.mode_dial !== g.mode_dial_at || s.mode_dial_positions[s.mode_dial].label !== g.mode_label)) {
        bad.push(`page inputs ${g.what}: mode dial ${dial0} -> ${s.mode_dial} ${JSON.stringify(s.mode_dial_positions[s.mode_dial])}, want ${g.mode_dial_at} ${g.mode_label}`);
      }
    }
  } finally {
    if (pl.session !== null) pl.close_session();
    pl.set_stop();
  }
  return { checks: PAGE_B6_INPUTS.length, bad };
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

// ---- the Card panel and the session options without firmware
// A FAT16 volume on an SD card, built here for the Card panel's reader: an MBR whose one partition starts at LBA 64,
// 8192 sectors of one cluster each (8095 clusters: FAT16 by the specification's count), the files
// DCIM/100OMSYS/P1010001.JPG and 'My Pic 1.jpg' (a long name) in the root, both the JPEG of a 32 x 16 frame of four
// flat 16 x 8 tiles (src/lab/jpeg.mjs jpegOfFrame: each block its mean, so a tile decodes to its own values).
const TILE = (tx, ty) => [40 + 60 * tx + 100 * ty, 90 + 50 * tx, 160 - 40 * ty];      // Y, Cb, Cr
function cardFrame() {
  const w = 32, h = 16, rows = [];
  for (let y = 0; y < h; y++) {
    const r = new Uint8Array(2 * w);
    for (let x = 0; x < w; x++) { const [Y, Cb, Cr] = TILE(x >> 4, y >> 3); r[2 * x] = Y; r[2 * x + 1] = x & 1 ? Cr : Cb; }
    rows.push(r);
  }
  return [w, h, rows];
}
export function fat16Card() {
  const START = 64, TOTAL = 8192, RESERVED = 1, FATS = 2, FAT_SECTORS = 32, ROOT_ENTRIES = 512;
  const vol = new Uint8Array(TOTAL * SECTOR), mbr = new Uint8Array(SECTOR);
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  const put16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >> 8 & 255; };
  const put32 = (b, o, v) => { for (let i = 0; i < 4; i++) b[o + i] = v >>> (8 * i) & 255; };
  mbr[446 + 4] = 6; put32(mbr, 446 + 8, START); put32(mbr, 446 + 12, TOTAL); mbr[510] = 0x55; mbr[511] = 0xaa;
  vol.set([0xeb, 0x3c, 0x90], 0); vol.set(ascii('TESTFAT '), 3);
  put16(vol, 11, SECTOR); vol[13] = 1; put16(vol, 14, RESERVED); vol[16] = FATS; put16(vol, 17, ROOT_ENTRIES); put16(vol, 19, TOTAL);
  vol[21] = 0xf8; put16(vol, 22, FAT_SECTORS); vol[38] = 0x29; put32(vol, 39, 2026); vol.set(ascii('CARDTEST   '), 43); vol.set(ascii('FAT16   '), 54);
  vol[510] = 0x55; vol[511] = 0xaa;
  const ROOT = RESERVED + FATS * FAT_SECTORS, DATA = ROOT + ROOT_ENTRIES * 32 / SECTOR;      // sectors 65 and 97
  const fat = (c, v) => { for (let k = 0; k < FATS; k++) put16(vol, (RESERVED + k * FAT_SECTORS) * SECTOR + 2 * c, v); };
  const at = (c) => (DATA + c - 2) * SECTOR;                                                // a cluster's first byte
  const DATE = (2026 - 1980) << 9 | 10 << 5 | 28, TIME = 12 << 11 | 34 << 5 | 28;          // 2026-10-28 12:34:56
  const entry = (o, name, attr, cluster, size) => {
    vol.set(ascii(name), o); vol[o + 11] = attr; put16(vol, o + 22, TIME); put16(vol, o + 24, DATE); put16(vol, o + 26, cluster); put32(vol, o + 28, size);
  };
  const jpeg = jpegOfFrame(cardFrame());
  let next = 5;
  const file = (o, name) => {                     // the JPEG in a chain of clusters from next
    const n = Math.ceil(jpeg.length / SECTOR), first = next;
    for (let i = 0; i < n; i++) { fat(first + i, i + 1 < n ? first + i + 1 : 0xffff); vol.set(jpeg.subarray(i * SECTOR, (i + 1) * SECTOR), at(first + i)); }
    next += n;
    entry(o, name, 0x20, first, jpeg.length);
  };
  fat(0, 0xfff8); fat(1, 0xffff);
  const root = ROOT * SECTOR;
  entry(root, 'DCIM       ', 0x10, 2, 0); fat(2, 0xffff);
  // 'My Pic 1.jpg' as one long-name entry (its 12 characters and the terminator fill the entry's 13), then its short one
  const lfn = root + 32, chars = [...'My Pic 1.jpg'].map((c) => c.charCodeAt(0)).concat([0]);
  vol[lfn] = 0x41; vol[lfn + 11] = 0x0f;
  chars.forEach((c, i) => put16(vol, lfn + (i < 5 ? 1 + 2 * i : i < 11 ? 14 + 2 * (i - 5) : 28 + 2 * (i - 11)), c));
  file(root + 64, 'MYPIC1~1JPG');
  entry(at(2), '.          ', 0x10, 2, 0); entry(at(2) + 32, '..         ', 0x10, 0, 0); entry(at(2) + 64, '100OMSYS   ', 0x10, 4, 0); fat(4, 0xffff);
  entry(at(4), '.          ', 0x10, 4, 0); entry(at(4) + 32, '..         ', 0x10, 2, 0);
  file(at(4) + 64, 'P1010001JPG');
  const card = new SdCard();
  card.writeSector(0, mbr);
  for (let s = 0; s < TOTAL; s++) { const b = vol.subarray(s * SECTOR, (s + 1) * SECTOR); if (b.some((v) => v)) card.writeSector(START + s, b); }
  return { card, jpeg };
}

// The Card panel's parts and the session options, without firmware: base64 (src/util/bytes.mjs); the card's reader
// (web/cardfiles.mjs: the listing, a file, a refused volume and path on FAT16, the same on an exFAT volume
// test/test_storage.mjs builds, with its contiguous directory, a valid data length short of the size and the free count
// from the allocation bitmap, and a broken boot checksum refused; the JPEG drawn as RGBA at full size and scaled down); the router's /api/session and card routes on a headless Player (no session: the card stays readable) with
// their refusals (no reader, no decoder, bad paths and sizes) and the PNG the node server answers (host/server.mjs
// pngRgba, inflated here); the card reads outside the session log; web/page.mjs's bytes() and blob(); the browser's
// S-NVRAM host (web/nvram.mjs: the document host/nvram.mjs keeps, writes one at a time, a failed write reported).
export async function cardTests() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // base64
  for (let n = 0; n < 12; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 31) & 255), t = bytesBase64(b);
    ok(t === Buffer.from(b).toString('base64') && same(base64Bytes(t), b), `base64 of ${n} bytes: ${t}`);
  }
  ok(same(base64Bytes(bytesBase64(Uint8Array.from({ length: 256 }, (_, i) => i))), Uint8Array.from({ length: 256 }, (_, i) => i)), 'base64 round trip of every byte');
  for (const t of ['abc', 'ab=c', '====', 'A===', 'QQ=A', 'Q Q=']) ok(base64Bytes(t) === null, `base64Bytes(${JSON.stringify(t)}) refused`);
  // the reader
  const { card, jpeg } = fat16Card(), read = (lba, n) => card.read(lba, n);
  const reads0 = card.reads;
  const list = cardList(read);
  const want = [['DCIM', true], ['DCIM/100OMSYS', true], ['DCIM/100OMSYS/P1010001.JPG', false], ['My Pic 1.jpg', false]];
  ok(JSON.stringify(list.files?.map((f) => [f.path, f.dir])) === JSON.stringify(want), `cardList files: ${JSON.stringify(list.files?.map((f) => f.path))}`);
  ok(list.volume?.type === 'FAT16' && list.volume.label === 'CARDTEST' && list.volume.start === 64 && list.volume.cluster_bytes === 512 && list.volume.free_bytes === null && list.truncated === false,
    `cardList volume: ${JSON.stringify(list.volume)}`);
  const f1 = list.files?.[2];
  ok(f1?.size === jpeg.length && f1.mtime === '2026-10-28 12:34:56', `cardList file entry: ${JSON.stringify(f1)}`);
  ok(card.reads === reads0, `the reader counts no card reads (SdCard.read): ${card.reads - reads0}`);
  const got = cardFile(read, 'DCIM/100OMSYS/P1010001.JPG');
  ok(got.name === 'P1010001.JPG' && got.size === jpeg.length && same(base64Bytes(got.base64), jpeg), `cardFile: ${JSON.stringify({ ...got, base64: got.base64?.length })}`);
  ok(/no such file/.test(cardFile(read, 'NOPE.JPG').error) && /a directory/.test(cardFile(read, 'DCIM').error), 'cardFile refuses a missing file and a directory');
  const blank = new SdCard();
  ok(/boot signature/.test(cardList((lba, n) => blank.read(lba, n)).error ?? ''), `a blank card: ${JSON.stringify(cardList((lba, n) => blank.read(lba, n)))}`);
  // an exFAT volume (refs/volume.mjs picks refs/exfat.mjs): 992 one-sector clusters, 8 of them allocated
  const ex = buildExfat(), exList = cardList(ex.read);
  const exWant = [['DCIM', true], ['DCIM/P1010001.JPG', false], ['A Long Picture Name.jpg', false]];
  ok(JSON.stringify(exList.files?.map((f) => [f.path, f.dir])) === JSON.stringify(exWant) && exList.files[1].size === 1000 && exList.files[2].size === 700 && exList.files[2].mtime === '2026-10-28 12:34:10',
    `cardList on exFAT: ${JSON.stringify(exList.files ?? exList)}`);
  ok(JSON.stringify(exList.volume) === JSON.stringify({ type: 'exFAT', label: 'TEST', start: 64, clusters: 992, cluster_bytes: 512, free_bytes: 984 * 512 }) && exList.truncated === false,
    `cardList exFAT volume: ${JSON.stringify(exList.volume)}`);
  const exPic = cardFile(ex.read, 'dcim/p1010001.jpg'), exLong = cardFile(ex.read, 'A Long Picture Name.jpg');
  const longWant = Uint8Array.from({ length: 700 }, (_, i) => (i < 600 ? ex.long[i] : 0));
  ok(exPic.name === 'P1010001.JPG' && same(base64Bytes(exPic.base64), ex.pic) && same(base64Bytes(exLong.base64 ?? ''), longWant),
    `cardFile on exFAT: ${exPic.error ?? exPic.name} ${exPic.size}; the long name's bytes past its valid data length read as zeros: ${exLong.error ?? exLong.size}`);
  ex.disk[ex.sec(11)] ^= 1;                    // the boot checksum's first byte
  ok(/boot checksum/.test(cardList(ex.read).error ?? ''), `an exFAT volume whose boot checksum does not hold is refused with the reason: ${JSON.stringify(cardList(ex.read))}`);
  // the picture: every pixel its tile's colour (ycc_to_rgb), at full size and scaled to 8 x 4
  const tileRgb = (x, y, w, h) => { const [Y, Cb, Cr] = TILE(Math.floor(x * 32 / w) >> 4, Math.floor(y * 16 / h) >> 3); return yccToRgb(Y | Cb << 8 | Cr << 16); };
  for (const [max, w, h] of [[0, 32, 16], [8, 8, 4], [64, 32, 16]]) {
    const img = jpegRgba(jpeg, max);
    let worst = 0;
    if (img.rgba) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = tileRgb(x + 0.5, y + 0.5, w, h), o = 4 * (y * w + x);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(img.rgba[o + k] - c[k]));
      if (img.rgba[o + 3] !== 255) worst = 999;
    }
    ok(img.w === w && img.h === h && img.width === 32 && img.height === 16 && img.rgba?.length === 4 * w * h && worst === 0, `jpegRgba max ${max}: ${img.w} x ${img.h} of ${img.width} x ${img.height}, worst difference ${worst}`);
  }
  ok(/SOI/.test(jpegRgba(new Uint8Array(16)).error ?? ''), 'jpegRgba refuses bytes that are no JPEG');
  // the router on a headless Player: no session, the card readable; nothing logged
  const mkPlayer = (env) => new Player({ ...PLAYER_PARSER, no_browser: true, debug_api: false, idle: 'off', a15: 'off', out: '<out>', no_wait_on_error: false },
    { rom: null, resBlock: null, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {}, file: 'kept.omsd' }, ...env });
  const pl = mkPlayer({ cardView: CARD_VIEW });
  const api = new PlayApi(pl, { tables: null, frameRgba: () => null, cardImage: jpegRgba, session: { host: 'test', lens: 'stand-in' } });
  const get = async (a, p) => {
    const r = a.handle({ method: 'GET', path: p, headers: {} });
    while (a.player.q.length || a.player.held.length) a.player.tick();
    const res = await r;
    const h = new Map(res.headers.map(([k, v]) => [k.toLowerCase(), v]));
    return { status: res.status, type: h.get('content-type'), h, body: res.body, doc: () => JSON.parse(new TextDecoder().decode(res.body)) };
  };
  const s = await get(api, '/api/session');
  ok(JSON.stringify(s.doc()) === JSON.stringify({ host: 'test', lens: 'stand-in', nvram: null, card: null, card_size: null, hdmi: 'off', debug_api: false, card_image: true }), `GET /api/session: ${JSON.stringify(s.doc())}`);
  const c = await get(api, '/api/card'), cd = c.doc();
  ok(c.status === 200 && JSON.stringify(cd.slot) === JSON.stringify({ present: true, mounted: false, session: false, file: 'kept.omsd', kind: 'SDHC', sectors: 16777216 }) && cd.files?.length === 4 && cd.volume?.type === 'FAT16',
    `GET /api/card: ${c.status} ${JSON.stringify(cd).slice(0, 300)}`);
  const f = await get(api, '/api/card/file?path=DCIM%2F100OMSYS%2FP1010001.JPG');
  ok(f.status === 200 && f.type === 'image/jpeg' && same(f.body, jpeg) && f.h.get('content-disposition') === 'attachment; filename="P1010001.JPG"', `GET /api/card/file: ${f.status} ${f.type} ${f.body.length} bytes, ${f.h.get('content-disposition')}`);
  const lf = await get(api, '/api/card/file?path=My%20Pic%201.jpg');
  ok(lf.status === 200 && same(lf.body, jpeg) && lf.h.get('content-disposition') === 'attachment; filename="My Pic 1.jpg"', `GET /api/card/file of a long name: ${lf.status}`);
  const nf = await get(api, '/api/card/file?path=NOPE.JPG');
  ok(nf.status === 404 && /no such file/.test(nf.doc().error) && nf.doc().slot?.present === true, `a missing file: ${nf.status} ${JSON.stringify(nf.doc())}`);
  for (const [p, want] of [['/api/card/file', 'path'], ['/api/card/file?path=%E0%A4%A', 'path'], ['/api/card/image?path=a.jpg&max=5000', 'max'], ['/api/card/image?path=a.jpg&max=x', 'max'],
    ['/api/card?timeout=x', 'timeout']]) {
    const r = await get(api, p);
    ok(r.status === 400 && r.doc().error === want, `${p}: ${r.status} ${JSON.stringify(r.doc())} (want 400 ${want})`);
  }
  const im = await get(api, '/api/card/image?path=DCIM%2F100OMSYS%2FP1010001.JPG&max=8');
  ok(im.status === 200 && im.type === 'application/octet-stream' && im.h.get('x-image-width') === '8' && im.h.get('x-image-height') === '4' && im.h.get('x-image-size') === '32x16' &&
    same(im.body, jpegRgba(jpeg, 8).rgba), `GET /api/card/image (RGBA): ${im.status} ${im.type} ${im.h.get('x-image-width')} x ${im.h.get('x-image-height')}`);
  const pngApi = new PlayApi(pl, { tables: null, cardImage: jpegRgba, imagePng: pngRgba });
  const pg = await get(pngApi, '/api/card/image?path=DCIM%2F100OMSYS%2FP1010001.JPG&max=8');
  {
    const b = Buffer.from(pg.body), ihdr = b.indexOf('IHDR'), idat = b.indexOf('IDAT'), len = idat >= 4 ? b.readUInt32BE(idat - 4) : 0;
    const rows = idat >= 0 ? zlib.inflateSync(b.subarray(idat + 4, idat + 4 + len)) : Buffer.alloc(0), rgba = jpegRgba(jpeg, 8).rgba;
    let match = rows.length === 4 * (1 + 3 * 8);
    for (let y = 0; match && y < 4; y++) for (let x = 0; x < 8; x++) for (let k = 0; k < 3; k++) if (rows[y * 25 + 1 + 3 * x + k] !== rgba[4 * (y * 8 + x) + k]) match = false;
    ok(pg.status === 200 && pg.type === 'image/png' && b.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')) && b.readUInt32BE(ihdr + 4) === 8 && b.readUInt32BE(ihdr + 8) === 4 && match,
      `GET /api/card/image (PNG, host/server.mjs pngRgba): ${pg.status} ${pg.type}, rows ${match ? 'equal to' : 'not'} the RGBA`);
  }
  const ni = await get(new PlayApi(pl, { tables: null }), '/api/card/image?path=DCIM%2F100OMSYS%2FP1010001.JPG');
  ok(ni.status === 501 && ni.doc().error === 'image', `/api/card/image without a decoder: ${ni.status}`);
  const nj = await get(api, '/api/card/image?path=DCIM');
  ok(nj.status === 404 && /a directory/.test(nj.doc().error), `/api/card/image of a directory: ${nj.status} ${JSON.stringify(nj.doc())}`);
  card.remove();
  const out = (await get(api, '/api/card')).doc();
  card.insert();
  ok(out.slot?.present === false && out.files?.length === 4, `the card out of the slot is read as it is: ${JSON.stringify(out.slot)}, ${out.files?.length} files`);
  ok(pl.log.length === 0 && pl.input_seq === 8, `card reads stay out of the session log: ${pl.log.length} entries after ${pl.input_seq} inputs (want 0 after 8; a refused request queues none)`);
  const noView = new PlayApi(mkPlayer({}), { tables: null });
  const nv = await get(noView, '/api/card');
  ok(nv.status === 409 && /reads no card files/.test(nv.doc().error), `a host without a reader: ${nv.status} ${JSON.stringify(nv.doc())}`);
  const op = mkPlayer({ cardView: CARD_VIEW });
  op.submit({ type: 'cardfiles', op: 'erase' });
  op.tick();
  const opRes = op.pop_result(1);
  ok(/op "erase" \(list, read\)/.test(opRes?.error ?? '') && opRes.card === undefined && opRes.dropped === false, `an unknown cardfiles op: ${JSON.stringify(opRes)}`);
  // web/page.mjs: a binary answer's bytes and blob
  const PPb = new PagePlayer();
  PPb.worker = { postMessage() {} };
  const pr = PPb.api('/api/card/file?path=x');
  PPb.message({ type: 'res', id: 1, status: 200, headers: [['Content-Type', 'image/jpeg']], body: jpeg });
  const rb = await pr, blob = await rb.blob();
  ok(same(await rb.bytes(), jpeg) && blob.size === jpeg.length && blob.type === 'image/jpeg', `page.mjs bytes() and blob(): ${blob.size} bytes, ${blob.type}`);
  // web/nvram.mjs: the document host/nvram.mjs keeps; writes one at a time, the last one holding every save
  const texts = [];
  let fails = 0, errors = 0;
  const nvram = browserNvram(null, (t) => new Promise((resolve, reject) => setTimeout(() => (fails-- > 0 ? reject(new Error('quota')) : (texts.push(t), resolve())), 5)), () => { errors++; });
  const settle = async () => { for (let p; (p = nvram.pending()) !== null;) await p; };
  ok(nvram.load() === null, 'S-NVRAM in the browser: nothing kept at first');
  const M = Uint8Array.from({ length: 300 }, (_, i) => i & 255), E = Uint8Array.of(1, 2, 3);
  nvram.save('M', M); nvram.save('E', E); nvram.saveScpu({ 0: 168 }); nvram.saveScpuMemory({ clock_offset: -60, clock_status: 1, words: { 2: 7 } });
  await settle();
  const last = JSON.parse(texts.at(-1) ?? 'null'), back = nvram.load();
  ok(texts.length === 2 && last?.version === 1 && same(base64Bytes(last.M), M) && same(base64Bytes(last.E), E) && last.scpu?.[0] === 168 && last.clock_offset === -60 && last.scpu_words?.[2] === 7,
    `S-NVRAM writes: ${texts.length} (want 2: the one the first save started, then one for the saves during it), the last ${texts.at(-1)?.slice(0, 120)}`);
  ok(same(back.M, M) && same(back.E, E) && back.clock_status === 1 && back.scpu_words[2] === 7, `S-NVRAM load: ${JSON.stringify({ ...back, M: back.M?.length, E: back.E?.length })}`);
  fails = 1;
  nvram.save('E', Uint8Array.of(9));
  await settle();
  nvram.save('E', Uint8Array.of(8));
  await settle();
  ok(errors === 1 && same(base64Bytes(JSON.parse(texts.at(-1)).E), Uint8Array.of(8)), `S-NVRAM: a failed write reported (${errors}) and the next save written`);
  const kept = browserNvram({ version: 1, M: bytesBase64(M), clock_offset: 5 }, async () => {}, () => {});
  ok(same(kept.load().M, M) && kept.load().E === null && kept.load().clock_offset === 5 && kept.load().scpu === null, 'S-NVRAM: a kept document loads as host/nvram.mjs loads its file');
  return { checks, bad };
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
        // the Card panel's routes in the Worker: the card the firmware formatted at the start (FAT32), read with
        // refs/fat.mjs (web/cardfiles.mjs as env.cardView); the session's options as the Worker hosts them
        checks++;
        const cardDoc = await req(12, 'GET', '/api/card');
        const sess = await req(13, 'GET', '/api/session');
        if (cardDoc?.status !== 200 || cardDoc.doc.volume?.type !== 'FAT32' || cardDoc.doc.error !== undefined || cardDoc.doc.slot?.present !== true || cardDoc.doc.slot?.session !== true ||
          sess?.status !== 200 || sess.doc.host !== 'browser' || sess.doc.lens !== 'native' || sess.doc.nvram !== null || sess.doc.card_size !== null || sess.doc.card_image !== true ||
          cardDoc.doc.slot?.kind !== 'SDHC') {
          bad.push(`worker: GET /api/card ${JSON.stringify(cardDoc)?.slice(0, 300)}, GET /api/session ${JSON.stringify(sess)?.slice(0, 200)}`);
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
  const s = shaTests(), y = yccTests(), c = controlsTests(), d = await driverTests(), j = bodyTests(), rb = await resultBoxTests(), p = await pageTests(), cd = await cardTests(), w = await workerTests();
  console.log(`sha256 (B2): ${s.checks - s.bad.length}/${s.checks} (${s.mbps} MB/s); ycc_to_rgb (B4): ${y.checks - y.bad.length}/${y.checks}; playui rows: ${c.checks - c.bad.length}/${c.checks}; driver (B3): ${d.checks - d.bad.length}/${d.checks}; ` +
    `request bodies: ${j.checks - j.bad.length}/${j.checks}; wait_result: ${rb.checks - rb.bad.length}/${rb.checks}; page after stop: ${p.checks - p.bad.length}/${p.checks}; card panel and session options: ${cd.checks - cd.bad.length}/${cd.checks}; ` +
    `worker host: ${w.checks - w.bad.length}/${w.checks}${w.skipped.length ? ` (${w.skipped.length} SKIPPED)` : ''}`);
  const all = [...s.bad, ...y.bad, ...c.bad, ...d.bad, ...j.bad, ...rb.bad, ...p.bad, ...cd.bad, ...w.bad];
  if (!process.argv.includes('--no-api')) {
    const a = await hostApiTests(), pi = await pageInputsTests();
    console.log(`node host on a Player (B4): ${a.checks - a.bad.length}/${a.checks}; B6's page inputs on a Player: ${pi.checks - pi.bad.length}/${pi.checks}`);
    all.push(...a.bad, ...pi.bad);
  }
  all.slice(0, 40).forEach((x) => console.log('  ', x));
  process.exit(all.length ? 1 : 0);
}
