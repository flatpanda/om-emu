#!/usr/bin/env node
// Gates B5-B7 of the browser player in headless Chrome, driven over the DevTools protocol with node's built-in
// WebSocket (no npm packages), and B2's runner half in node. On the lab model only (src/fw/model.mjs LAB_MODEL, E143):
// the scenario inputs it replays were recorded on E143, and the pages it opens take the default model.
//   node emu/bin/webgate.mjs [--bin FILE] [--chrome PATH] [--calls DIR] [--png DIR] [--rounds N] [--skip-page] [--quick | --page-only] [--keep]
// --quick: only node's and the Worker's shoot-tft from the file (the negative controls' short run); --page-only: only
// B6 and B7 (with node's run of the page's inputs).
// --bin: the firmware .BIN (default $OM_BIN, else $OM_FW_DIR/<the model's .BIN>); missing: exit 2.
// --chrome: the Chrome (or Chromium) executable (default: the first of CHROME_PATHS that exists); missing: exit 2.
// --calls: the directory of the replayed scenarios' inputs (default emu/scenarios/calls; osd's are generated when it
// holds none, bin/run.mjs osdDoc).
// --png: where the page's screenshots go (shooting screen, menu, Super Control Panel); default emu/out/web/png.
// --rounds N: timing rounds of Chrome against node, alternating (default 1).
// What runs:
// - node (B2): web/runner.mjs with the pure sha256 (src/util/sha256.mjs) on the blocks unpacked from the .BIN by
//   src/fw/olyfw.mjs (the resource block cut to its prefix): stage0, shoot-tft, shoot-tft in 1 M slices, play-perf
//   from its inputs and the play workload without them (its digest must be 33b134deb36a03ef); traces to
//   out/web/node/, compared by bin/run.mjs's comparator with the same scenarios run by bin/run.mjs in this process (the
//   lab path the node tools take: node's crypto, the image and resource block files).
// - Chrome (B5): the same jobs in web/worker.mjs (web/gate.html), first with the .BIN handed to the file input
//   (DOM.setFileInputFiles) on a fresh profile (the unpack path; the first job fills the OPFS cache), then from the
//   OPFS cache; every trace must be byte-identical to node's, and identical to bin/run.mjs's.
// - Chrome (B6): web/index.html?idle=off with the .BIN through its file input: four keys (Input.dispatchKeyEvent), one
//   touch (Input.dispatchMouseEvent) and two quick PageUps, as test/test_web.mjs PAGE_B6_INPUTS lists them (the page
//   must send those inputs; the regular gate runs them on a node Player); after each key and the touch, the result is
//   ok, the frame seq advanced, the GUI is in the listed state, and the canvas read back equals the RGBA node computes
//   for the composite whose sha16 the Player published; the page's session log equals node's run of the inputs the
//   page sent (wall fields removed); screenshots. Then a paced page from the cache
//   (idle wall): 10 lab seconds, the real-time ratio. Then the page's life cycle (B6b): files the Worker refuses, then
//   E143 with the debug API (tokens), the Card, HDMI and session options panel (the card read with refs/fat.mjs, Take
//   out and Put in, the HDMI control without the port), the EVF layout (LV to the EVF and back: the screen's class evf
//   and the canvas size follow the frames' device) and Quit.
// - B7: every network request of the page and its Workers (Network domain, auto-attached Worker sessions) is a GET to
//   the gate's own origin with no body.
// Firmware-derived output stays under emu/out/web/. Chrome runs in its own process group with a temporary profile
// in a fresh ~/.cache/om-emu-tmp/webgate-* directory, killed and removed when the gate ends (exit, SIGINT, SIGTERM, SIGHUP).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { createHash } from '../src/util/sha256.mjs';
import { labFirmware } from '../src/fw/labfw.mjs';
import { MODEL, MODEL_INFO, LAB_MODEL, ON_LAB_MODEL } from '../src/fw/model.mjs';
import { runScenario, playWorkload } from '../web/runner.mjs';
import { rgbaOf } from '../web/frame.mjs';
import { Player } from '../src/lab/player.mjs';
import { PlayApi } from '../src/lab/playapi.mjs';
import { Tables } from '../src/lab/play.mjs';
import { PLAYER_PARSER, WORKLOAD_DIGEST } from '../scenarios/session_replay.mjs';
import { LabError } from '../src/lab/errors.mjs';
import { fileReader } from '../test/test_unpack.mjs';
import { PAGE_B6_INPUTS } from '../test/test_web.mjs';
import { firstDivergence, runScenarios, osdDoc, loadImage, loadBlock, CALLS_DIR } from './run.mjs';
import { dump as dumpTrace } from '../src/trace/tracer.mjs';
import { createHash as nodeHash } from 'node:crypto';
import { asTracer } from '../checks/lib/tracecmp.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.dirname(EMU);
const STAGE0 = ['kernel-1', 'kernel-5b', 'kernel-5c', 'kernel-6', 'kernel-7', 'kernel-7b', 'osd'];
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
// absolute: Chrome's DOM.setFileInputFiles does not resolve a relative path against the gate's directory (seen on macOS:
// the page then finds no OE block in the file)
const absolute = (p) => (p ? path.resolve(p) : null);
const BIN = absolute(opt('--bin', process.env.OM_BIN || (process.env.OM_FW_DIR ? path.join(process.env.OM_FW_DIR, MODEL_INFO.bin) : null)));
const REF = path.resolve(opt('--calls', CALLS_DIR));
const OUT = path.join(EMU, 'out/web');
const PNG = path.resolve(opt('--png', path.join(OUT, 'png')));
const ROUNDS = Number(opt('--rounds', '1'));
const QUICK = argv.includes('--quick'), PAGE_ONLY = argv.includes('--page-only');
const TMP_ROOT = path.join(os.homedir(), '.cache/om-emu-tmp');     // Chrome's profile: a webgate-* directory of its own
// the usual places of Chrome and Chromium on Linux and macOS
const CHROME_PATHS = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const CHROME = opt('--chrome', CHROME_PATHS.find((p) => fs.existsSync(p)) ?? null);
const load = () => os.loadavg()[0].toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const fail = (x) => { problems.push(x); console.log(`FAIL ${x}`); };
const log = (x) => console.log(x);

if (!ON_LAB_MODEL) { console.error(`webgate: the gate runs on ${LAB_MODEL} only (OM_EMU_MODEL is ${MODEL})`); process.exit(2); }
if (!BIN || !fs.existsSync(BIN)) { console.error(`webgate: no firmware .BIN (${BIN ?? 'set --bin, OM_BIN or OM_FW_DIR'})`); process.exit(2); }
if (!CHROME || !fs.existsSync(CHROME)) { console.error(`webgate: no Chrome (${CHROME ?? `set --chrome; none of ${CHROME_PATHS.join(', ')}`})`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PNG, { recursive: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });
const OSD = QUICK || PAGE_ONLY ? null : await osdDoc(REF);
const calls = (n) => (n === 'osd' ? OSD : JSON.parse(fs.readFileSync(path.join(REF, `${n}.calls.json`), 'utf8')));
// each named session's trace in dir against bin/run.mjs's trace of it, run in this process (its comparator over the
// dumped documents)
const LAB = {};
const labDoc = async (n) => {
  if (!LAB[n]) {
    const scenario = n.split('#')[0], { sessions, rc } = await runScenarios([scenario], { rom: loadImage(), resBlock: loadBlock(), trace: true, calls: REF });
    for (const x of sessions) LAB[x.name] = JSON.parse(JSON.stringify(dumpTrace(x.tracer, nodeHash, { source: scenario, rc, env: {}, stdout: [] })));
  }
  return LAB[n];
};
const compare = async (dir, names) => {
  const lines = [];
  let ok = true;
  for (const n of names) {
    const ref = await labDoc(n);
    const js = JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8'));
    const d = firstDivergence(ref, asTracer(js));
    if (d) { lines.push(`${n}: DIVERGES at ${d.stream} index ${d.index}`); ok = false; } else lines.push(`${n}: identical (${js.events.length} events)`);
  }
  return { ok, text: lines.join('\n') + '\n' };
};
const writeTraces = (dir, out) => { fs.mkdirSync(dir, { recursive: true }); for (const s of out.sessions) fs.writeFileSync(path.join(dir, `${s.name}.json`), s.trace); };

// ---- the blocks, unpacked in node as the Worker unpacks them
const r = fileReader(BIN);
const fw = await labFirmware(r.read, r.size, createHash);
r.close();
const rom = fw.rom, prefix = fw.res;
log(`firmware ${BIN}: rom ${rom.length} bytes, resource prefix ${prefix.length} of ${fw.res_full}, both ${MODEL}'s; load ${load()}`);

// ---- node (B2, and B5's other side)
const JOBS = [
  { key: 'shoot-tft', name: 'shoot-tft', callsName: 'shoot-tft' },
  { key: 'shoot-tft-1M', name: 'shoot-tft', callsName: 'shoot-tft', slice: 1000000 },
  { key: 'play-perf', name: 'play-perf', callsName: 'play-perf' },
  { key: 'workload', name: 'play-perf-workload' },
].filter((j) => !QUICK || j.key === 'shoot-tft');
const nodeRun = (j) => {
  const t0 = performance.now(), env = { rom, resBlock: prefix, createHash, ...(j.slice ? { slice: j.slice } : {}) };
  const out = j.name === 'play-perf-workload' ? playWorkload(env) : runScenario(j.name, env, j.callsName ? calls(j.callsName) : null);
  return { out, ms: Math.round(performance.now() - t0), load: load() };
};
const nodeRes = {};
if (!PAGE_ONLY) {
  const dir = path.join(OUT, 'node');
  fs.rmSync(dir, { recursive: true, force: true });
  if (!QUICK) for (const n of STAGE0) writeTraces(dir, runScenario(n, { rom, resBlock: prefix, createHash }, n === 'osd' ? calls('osd') : null));
  for (const j of JOBS) {
    nodeRes[j.key] = nodeRun(j);
    if (j.name !== 'play-perf-workload' && !j.slice) writeTraces(dir, nodeRes[j.key].out);
    log(`node ${j.key}: ${nodeRes[j.key].ms} ms (load ${nodeRes[j.key].load})${j.name === 'play-perf-workload' ? ` digest ${nodeRes[j.key].out.digest}` : ''}`);
  }
  if (!QUICK && nodeRes.workload.out.digest !== WORKLOAD_DIGEST) fail(`node workload digest ${nodeRes.workload.out.digest}`);
  const c = await compare(dir, QUICK ? ['shoot-tft'] : [...STAGE0, 'shoot-tft', 'play-perf']);
  log(`node runner with the pure sha256 against bin/run.mjs (B2): ${c.ok ? 'identical' : 'DIFFERENT'}\n${c.text.trim().split('\n').map((x) => '  ' + x).join('\n')}`);
  if (!c.ok) fail('B2: trace comparison on the node runner');
}

// ---- the static server: emu/ (not out/), and the calls files of --calls on a test-only route for 127.0.0.1
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const served = [];
const server = http.createServer((q, s) => {
  const url = new URL(q.url, 'http://x');
  served.push([q.method, url.pathname]);
  const deny = (code) => { s.writeHead(code, { 'Cache-Control': 'no-store' }); s.end(); };
  if (q.method !== 'GET') return deny(405);
  let file = null;
  if (url.pathname.startsWith('/test/calls/')) {
    if (q.socket.remoteAddress !== '127.0.0.1' && q.socket.remoteAddress !== '::ffff:127.0.0.1') return deny(403);
    file = path.join(REF, path.basename(url.pathname));
  } else {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return deny(400); }   // a malformed escape
    file = path.normalize(path.join(EMU, p));
    if (!file.startsWith(EMU + '/') || file.startsWith(path.join(EMU, 'out') + '/') || path.basename(file).startsWith('.')) return deny(403);
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return deny(404);
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(s);
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
{ // the server answers a malformed percent escape with 400 (and goes on)
  const code = await new Promise((res) => http.get(`${ORIGIN}/web/%E0%A4%A`, (r) => { r.resume(); res(r.statusCode); }).on('error', (e) => res(e.code)));
  if (code !== 400) fail(`static server: a malformed escape answered ${code}`);
  served.length = 0;
}

// ---- Chrome
const TMP = fs.mkdtempSync(path.join(TMP_ROOT, 'webgate-')), PROF = path.join(TMP, 'chrome');
fs.mkdirSync(PROF);
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${PROF}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--window-size=1400,1300', 'about:blank'],
{ detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr = (chromeErr + d).slice(-20000); });
let closed = false;
const cleanup = () => {
  if (closed) return;
  closed = true;
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* gone */ }
  server.close();
  if (!argv.includes('--keep')) fs.rmSync(TMP, { recursive: true, force: true });
};
// Chrome runs in its own process group (detached), which a signal to the gate does not reach: every way the gate
// ends kills it. Node exits on SIGTERM and SIGHUP without 'exit' unless they are handled.
process.on('exit', cleanup);
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => { cleanup(); process.exit(code); });
let wsUrl = null;
for (let i = 0; i < 400 && !wsUrl; i++) {
  try { const [p, w] = fs.readFileSync(path.join(PROF, 'DevToolsActivePort'), 'utf8').split('\n'); if (w) wsUrl = `ws://127.0.0.1:${p}${w}`; } catch { /* not yet */ }
  if (!wsUrl) await sleep(50);
}
if (!wsUrl) { console.error(`webgate: Chrome did not start: ${chromeErr.slice(0, 2000)}`); process.exit(2); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map(), listeners = new Set();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
  else for (const l of listeners) l(msg);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const version = await send('Browser.getVersion');
log(`Chrome ${version.product}, origin ${ORIGIN}`);

// RSS of Chrome's process group, sampled while a phase runs: the KiB of each process whose group is Chrome's, from
// /proc where there is one (Linux), else from ps(1) (macOS; run asynchronously so the gate's event loop keeps going)
function procGroupKb() {
  const kbs = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'), f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      if (+f[2] !== chrome.pid) continue;
      kbs.push(+(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${d}/status`, 'utf8'))?.[1] ?? 0));
    } catch { /* exited */ }
  }
  return kbs;
}
const psGroupKb = () => new Promise((res) => execFile('ps', ['-A', '-o', 'pgid=,rss='], (e, out) => res(e ? [] : out.split('\n')
  .map((l) => l.trim().split(/\s+/)).filter(([g]) => +g === chrome.pid).map(([, kb]) => +kb))));
const groupKb = fs.existsSync('/proc/self/stat') ? async () => procGroupKb() : psGroupKb;
async function groupRss() {
  const kbs = await groupKb();
  return { total_MiB: Math.round(kbs.reduce((a, b) => a + b, 0) / 1024), max_proc_MiB: Math.round(Math.max(0, ...kbs) / 1024) };
}
async function sampled(fn) {
  let peak = { total_MiB: 0, max_proc_MiB: 0 }, busy = false;
  const t = setInterval(async () => {
    if (busy) return;                    // the previous sample still running
    busy = true;
    try { const x = await groupRss(); if (x.total_MiB > peak.total_MiB) peak = x; } finally { busy = false; }
  }, 100);
  try { const value = await fn(); return { value, peak }; } finally { clearInterval(t); }
}

// A page target with its Workers auto-attached; every network request recorded (B7), console errors kept. ready: an
// expression that holds once the page can be driven, awaited after the load event (the player page's module goes on
// past it: its top-level await of the model import delays the file input's listener and window.__playPage).
const requests = [], consoleLines = [];
async function openPage(url, ready = null) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const sessions = new Set([sessionId]);
  const onMsg = async (m) => {
    if (m.method === 'Target.attachedToTarget' && sessions.has(m.sessionId)) {
      const ws2 = m.params.sessionId;
      sessions.add(ws2);
      try {
        await send('Network.enable', {}, ws2);
        await send('Runtime.enable', {}, ws2);
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, ws2);
      } finally { await send('Runtime.runIfWaitingForDebugger', {}, ws2).catch(() => {}); }
    }
    if (!sessions.has(m.sessionId)) return;
    if (m.method === 'Network.requestWillBeSent') requests.push({ url: m.params.request.url, method: m.params.request.method, post: !!m.params.request.hasPostData, target: m.sessionId === sessionId ? 'page' : 'worker' });
    if (m.method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails).slice(0, 800));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleLines.push(`${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 800)}`);
  };
  listeners.add(onMsg);
  await S('Network.enable');
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const loaded = new Promise((res) => { const l = (m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) { listeners.delete(l); res(); } }; listeners.add(l); });
  await S('Page.navigate', { url });
  await loaded;
  const ev = async (expr, timeout = 600000) => {
    const x = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (x.exceptionDetails) throw new Error(`evaluate ${expr.slice(0, 80)}: ${JSON.stringify(x.exceptionDetails).slice(0, 1500)}`);
    return x.result.value;
  };
  if (ready !== null) {
    const end = performance.now() + 60000;
    while (!await ev(ready)) {
      if (performance.now() > end) throw new Error(`webgate: ${url}: not ready within 60 s (${ready})`);
      await sleep(50);
    }
  }
  const setFile = async (selector, file = BIN) => {
    const { root } = await S('DOM.getDocument');
    const { nodeId } = await S('DOM.querySelector', { nodeId: root.nodeId, selector });
    await S('DOM.setFileInputFiles', { nodeId, files: [file] });
  };
  // an evaluate that gives up after ms (a page whose main thread never yields does not answer at all): null then
  const evWithin = (expr, ms) => Promise.race([ev(expr, ms), sleep(ms).then(() => null)]);
  const close = async () => { listeners.delete(onMsg); await send('Target.closeTarget', { targetId }); };
  return { S, ev, evWithin, setFile, close, sessionId };
}

// ---- B5: the runner in the Worker, from the file (fresh profile), then from the OPFS cache
const chromeRes = {};
for (const [round, useFile] of PAGE_ONLY ? [] : QUICK ? [['file', true]] : [['file', true], ['cache', false]]) {
  const page = await openPage(`${ORIGIN}/web/gate.html`);
  if (useFile) await page.setFile('#fwfile');
  for (const j of QUICK ? JOBS : [...JOBS, { key: 'lz4', name: 'lz4' }]) {
    const job = { name: j.name, ...(j.slice ? { slice: j.slice } : {}), ...(j.callsName ? { callsName: j.callsName } : {}), useFile, cache: useFile && j.key === 'shoot-tft' };
    const l0 = load();
    const t0 = performance.now();
    let res;
    try { res = await sampled(() => page.ev(`gateRun(${JSON.stringify(job)})`)); } catch (e) { fail(`B5 ${round} ${j.key}: ${e.message.slice(0, 1500)}`); continue; }
    const m = res.value, wall = Math.round(performance.now() - t0);
    chromeRes[`${round}:${j.key}`] = { ...m, wall, load: l0, rss: res.peak };
    let verdict = '';
    if (j.key === 'lz4') verdict = `LZ4 decode of the two blobs ${m.out.ms} ms (${m.out.sizes.join(', ')} bytes)`;
    else if (j.name === 'play-perf-workload') {
      verdict = `digest ${m.out.digest}`;
      if (m.out.digest !== WORKLOAD_DIGEST) fail(`B5 ${round} workload digest ${m.out.digest}`);
    } else {
      const n = nodeRes[j.key].out.sessions;
      const same = m.out.sessions.length === n.length && m.out.sessions.every((s, i) => s.name === n[i].name && s.trace === n[i].trace);
      if (!same) fail(`B5 ${round} ${j.key}: the Worker's trace differs from node's`);
      const dir = path.join(OUT, `chrome-${round}${j.slice ? '-sliced' : ''}`);
      writeTraces(dir, m.out);
      const c = await compare(dir, m.out.sessions.map((s) => s.name));
      if (!c.ok) fail(`B5 ${round} ${j.key}: trace comparison\n${c.text}`);
      verdict = `trace ${same ? 'byte-identical to node' : 'DIFFERENT from node'}; bin/run.mjs ${c.ok ? 'identical' : 'DIFFERENT'}${j.slice ? `; ${m.slices} slices` : ''}`;
    }
    log(`chrome ${round} ${j.key}: ${verdict}; firmware from ${m.from} ${JSON.stringify(m.T)} ms; job ${m.ms} ms, wall ${wall} ms (load ${l0}); RSS peak: Chrome ${res.peak.total_MiB} MiB, largest process ${res.peak.max_proc_MiB} MiB`);
  }
  await page.close();
}

// ---- timing rounds, alternating (shoot-tft and the workload)
for (let k = 1; k < ROUNDS; k++) {
  const page = await openPage(`${ORIGIN}/web/gate.html`);
  for (const j of [JOBS[0], JOBS[3]]) {
    const l0 = load();
    const c = await page.ev(`gateRun(${JSON.stringify({ name: j.name, ...(j.callsName ? { callsName: j.callsName } : {}), useFile: false, cache: false })})`);
    const nr = nodeRun(j);
    log(`round ${k + 1} ${j.key}: chrome ${c.ms} ms (load ${l0}), node ${nr.ms} ms (load ${nr.load})${j.name === 'play-perf-workload' ? `; phases chrome ${c.out.phase_sum} s node ${nr.out.phase_sum} s, startup ${c.out.startup} / ${nr.out.startup} s` : ''}`);
  }
  await page.close();
}

// ---- B6: the page
function nodeSession(sent) {
  // node's run of the inputs the page sent, one at a time, as the Worker took them (idle off), and every frame's RGBA
  const a = { ...PLAYER_PARSER, no_browser: true, out: '<out>', no_wait_on_error: false, idle: 'off' };
  const rgbaSha = new Map();
  const pl = new Player(a, { rom, resBlock: prefix, createHash, wallClock: () => performance.now() / 1000,
    onFrame: (w, h, raw, meta) => { rgbaSha.set(meta.sha16, createHash('sha256').update(rgbaOf(w, h, raw)).digest('hex').slice(0, 16)); } });
  const api = new PlayApi(pl, { tables: Tables.of(rom), frameRgba: rgbaOf });
  try { pl.open_session(); } catch (e) { if (!(e instanceof LabError)) throw e; pl.set_phase('error', pl.describe(e)); }
  for (const b of sent) {
    api.handle({ method: 'POST', path: '/api/input', headers: {}, body: JSON.stringify(b) });
    while (pl.q.length || pl.held.length) { try { pl.tick(); } catch (e) { if (!(e instanceof LabError)) throw e; pl.fail(e); } }
  }
  const out = { log: pl.log, rgbaSha };
  if (pl.session) pl.close_session();
  return out;
}
const PAGE_READY = '!!window.__playPage';         // web/index.html sets it last, after its listeners
const unwall = (entries) => JSON.stringify(entries.map((e) => { const x = { ...e }; if (x.record) { x.record = { ...x.record }; delete x.record.seconds; } return x; }));
if (!argv.includes('--skip-page') && !QUICK) {
  const page = await openPage(`${ORIGIN}/web/index.html?idle=off`, PAGE_READY);
  const t0 = performance.now();
  await page.setFile('#fwfile');
  const settled = `(() => { const p = window.__playPage, s = p.status, d = p.drawn; return !!(s && d && s.phase === 'running' && s.queue === 0 && d.seq === s.frame_seq); })()`;
  const until = async (expr, ms = 120000) => { const end = performance.now() + ms; while (performance.now() < end) { if (await page.ev(expr)) return true; await sleep(100); } return false; };
  if (!await until(settled)) fail('B6: the page did not reach a running session with its first frame drawn');
  log(`page (idle off): session up with its first frame ${Math.round(performance.now() - t0)} ms after the file was set (load ${load()})`);
  const shot = async (name) => { const { data } = await page.S('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(PNG, `${name}.png`), Buffer.from(data, 'base64')); };
  const state = () => page.ev(`(() => { const p = window.__playPage, s = p.status; return { drawn: p.drawn, canvas: p.canvasSha16(), frame_seq: s.frame_seq, gui: s.gui, gui_name: s.gui_name, last: s.last && s.last.input, error: s.input_error, results: window.__player.frame && window.__player.frame.rgba_sha16 }; })()`);
  const checks = [];
  checks.push({ what: 'power on', ...(await state()) });
  await shot('page-shooting');
  await page.ev('document.activeElement && document.activeElement.blur(), true');
  // each check's inputs and the GUI state it ends in: test/test_web.mjs PAGE_B6_INPUTS, which pageInputsTests runs
  // on a node Player in the regular gate (the sent inputs must be these, below)
  const plan = PAGE_B6_INPUTS.values();
  const planned = (what) => { const g = plan.next().value; if (g?.what !== what) fail(`B6 ${what}: PAGE_B6_INPUTS has ${g?.what} here`); return g ?? {}; };
  const key = async (code, key, vk) => {
    const { gui } = planned(`key ${code}`);
    const before = await state();
    await page.S('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
    await sleep(120);
    await page.S('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
    const ok = await until(`(() => { const s = window.__playPage.status; return !!(s && s.last && s.last.input && s.last.input.id && s.last.input.action === 'up' && s.frame_seq > ${before.frame_seq} && s.gui === ${JSON.stringify(gui)}) && ${settled}; })()`, 60000);
    const after = await state();
    checks.push({ what: `key ${code}`, ok, before_seq: before.frame_seq, ...after });
    if (!ok) fail(`B6 key ${code}: no result with a new frame and GUI ${gui} (frame_seq ${before.frame_seq} -> ${after.frame_seq}, GUI ${after.gui} ${after.gui_name})`);
  };
  await key('KeyM', 'm', 77);
  await sleep(300);
  await shot('page-menu');
  await key('ArrowDown', 'ArrowDown', 40);
  await key('KeyM', 'm', 77);
  // one touch on the shooting screen's monitor (900 x 600 composite coordinates 90, 30, as in the inputs scenario), as the
  // page's pointer handlers read it
  {
    const { gui } = planned('touch (90, 30)');
    const before = await state();
    const rect = await page.ev(`(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const x = rect.x + 90 / 900 * rect.w, y = rect.y + 30 / 600 * rect.h;
    await page.S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await page.S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(150);
    await page.S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    const ok = await until(`(() => { const s = window.__playPage.status; return !!(s && s.last && s.last.input && s.last.input.type === 'touch' && s.last.input.action === 'up' && s.frame_seq > ${before.frame_seq} && s.gui === ${JSON.stringify(gui)}) && ${settled}; })()`, 60000);
    const after = await state();
    checks.push({ what: 'touch (90, 30)', ok, before_seq: before.frame_seq, ...after });
    if (!ok) fail(`B6 touch: no result with a new frame and GUI ${gui} (frame_seq ${before.frame_seq} -> ${after.frame_seq}, GUI ${after.gui} ${after.gui_name})`);
  }
  await shot('page-touch');
  // OK on the shooting screen opens the Super Control Panel; before the mode dial moves: after a dial change the
  // camera application skips OK (PAGE_B6_INPUTS has the evidence)
  await key('Enter', 'Enter', 13);
  await shot('page-scp');
  // two inputs sent before the first is taken (the page's selftest's "PageUp twice quickly"): both must arrive
  {
    const { mode_dial: steps } = planned('PageUp twice quickly');
    const m0 = await page.ev('window.__playPage.status.mode_dial || 0');
    for (let i = 0; i < 2; i++) {
      await page.S('Input.dispatchKeyEvent', { type: 'keyDown', code: 'PageUp', key: 'PageUp', windowsVirtualKeyCode: 33 });
      await page.S('Input.dispatchKeyEvent', { type: 'keyUp', code: 'PageUp', key: 'PageUp', windowsVirtualKeyCode: 33 });
    }
    const ok = await until(`(() => { const s = window.__playPage.status; return !!(s && s.mode_dial === ${(m0 + steps) % 10}) && ${settled}; })()`, 60000);
    const after = await state();
    checks.push({ what: 'PageUp twice quickly', ok, ...after });
    if (!ok) fail(`B6 two quick inputs: mode dial ${m0} -> ${await page.ev('window.__playPage.status.mode_dial')}, want ${(m0 + steps) % 10}`);
  }
  if (!plan.next().done) fail('B6: PAGE_B6_INPUTS has checks the page did not run');
  const sent = await page.ev('window.__player.sent');
  const bare = (x) => JSON.stringify(x.map(({ client, cseq, t_client, ...b }) => b));
  if (bare(sent) !== JSON.stringify(PAGE_B6_INPUTS.flatMap((g) => g.inputs))) fail(`B6: the page sent ${bare(sent)}, not PAGE_B6_INPUTS's inputs`);
  const pageLog = await page.ev(`(async () => (await window.__player.api('/api/log')).json())()`);
  const frameStats = await page.ev('window.__player.frameStats');
  const ns = nodeSession(sent);
  const logSame = unwall(pageLog.inputs) === unwall(ns.log);
  if (!logSame) fail(`B6: the page's session log (${pageLog.inputs.length} entries) differs from node's run of the same ${sent.length} inputs (${ns.log.length} entries)`);
  for (const c of checks) {
    const want = ns.rgbaSha.get(c.drawn?.sha16);
    c.node_rgba = want ?? null;
    if (!want) fail(`B6 ${c.what}: node published no composite ${c.drawn?.sha16}`);
    else if (want !== c.canvas) fail(`B6 ${c.what}: the canvas ${c.canvas} != node's RGBA ${want} of composite ${c.drawn.sha16}`);
  }
  for (const c of checks) log(`page ${c.what}: frame ${c.drawn?.seq} ${c.drawn?.sha16} GUI ${c.gui} ${c.gui_name}; canvas ${c.canvas} ${c.canvas === c.node_rgba ? '==' : '!='} node ${c.node_rgba}`);
  log(`page session log: ${pageLog.inputs.length} entries, ${logSame ? 'equal to' : 'DIFFERENT from'} node's run of the ${sent.length} inputs the page sent`);
  const conv = frameStats.map((x) => x.conv_ms).sort((a, b) => a - b), tr = frameStats.map((x) => x.transit_ms).sort((a, b) => a - b);
  const med = (xs) => (xs.length ? +xs[xs.length >> 1].toFixed(2) : null);
  log(`frames: ${frameStats.length}; RGBA conversion median ${med(conv)} ms (max ${conv.length ? conv[conv.length - 1].toFixed(2) : '-'}), Worker post to page receive median ${med(tr)} ms (load ${load()})`);
  fs.writeFileSync(path.join(OUT, 'page-checks.json'), JSON.stringify({ checks, sent, frameStats }, null, 1));
  await page.close();

  // the paced page (idle wall) from the OPFS cache: the real-time ratio over 10 lab seconds
  const paced = await openPage(`${ORIGIN}/web/index.html?cache=1`, PAGE_READY);
  const res = await sampled(async () => {
    const until2 = async (expr, ms) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await paced.ev(expr); if (v) return v; await sleep(100); } return null; };
    const first = await until2(`(() => { const s = window.__playPage.status; return s && s.phase === 'running' && s.lab_ns != null ? { lab: s.lab_ns, t: performance.timeOrigin + performance.now() } : null; })()`, 120000);
    if (!first) { fail('B6 paced: no running session'); return null; }
    const lab0 = first.lab, t0w = first.t;
    const last = await until2(`(() => { const s = window.__playPage.status; return s && s.lab_ns >= ${lab0} + 10e9 ? { lab: s.lab_ns, t: performance.timeOrigin + performance.now(), pace: s.pace, dropped: s.dropped, frame_seq: s.frame_seq } : null; })()`, 120000);
    if (!last) { fail('B6 paced: 10 lab seconds did not pass in 120 s'); return null; }
    return { lab_s: (last.lab - lab0) / 1e9, wall_s: (last.t - t0w) / 1000, pace: last.pace, dropped: last.dropped, frames: last.frame_seq };
  });
  if (res.value) log(`paced page (idle wall): ${res.value.lab_s.toFixed(2)} lab s in ${res.value.wall_s.toFixed(2)} wall s, ratio ${(res.value.lab_s / res.value.wall_s).toFixed(3)}; status pace ${res.value.pace}; dropped ${JSON.stringify(res.value.dropped)}; ${res.value.frames} frames; RSS peak Chrome ${res.peak.total_MiB} MiB, largest process ${res.peak.max_proc_MiB} MiB (load ${load()})`);
  const { data } = await paced.S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(PNG, 'page-paced.png'), Buffer.from(data, 'base64'));
  await paced.close();

  // B6b, the page's life cycle: a file that is no .BIN, then another firmware's .BIN (refused as not the model's), each
  // offering the file input again; then E143 with --debug-api: the WINDOWS token (no zlib in the Worker) answered as a
  // refused input with the session running on, then STORE and INTC answered with their records; then Quit:
  // the page must keep answering (its poll loops end).
  const life = await openPage(`${ORIGIN}/web/index.html?idle=off&debug_api=1`, PAGE_READY);
  const until3 = async (expr, ms = 120000) => { const end = performance.now() + ms; while (performance.now() < end) { const v = await life.ev(expr); if (v) return v; await sleep(100); } return null; };
  const offered = `(() => { const t = document.getElementById('fwstatus').textContent; return !document.getElementById('fwfile').disabled && t.startsWith('could not start') ? t : null; })()`;
  const junk = path.join(OUT, 'junk.BIN');
  fs.writeFileSync(junk, Buffer.alloc(4096, 0x5a));
  await life.setFile('#fwfile', junk);
  const m1 = await until3(offered, 30000);
  if (!m1) fail('B6b: a file that is no .BIN did not offer the file input again');
  else log(`page life cycle: no .BIN -> ${m1}`);
  const other = absolute(opt('--other-bin', process.env.OM_FW_DIR ? path.join(process.env.OM_FW_DIR, 'OLY_E_146_1300_0000_0000.BIN') : null));
  if (other && fs.existsSync(other)) {
    await life.ev(`document.getElementById('fwstatus').textContent = '', true`);
    await life.setFile('#fwfile', other);
    const m2 = await until3(offered, 60000);
    if (!m2 || !m2.includes(MODEL_INFO.bin)) fail(`B6b: ${path.basename(other)} was not refused as not ${MODEL}'s (${m2})`);
    else log(`page life cycle: ${path.basename(other)} -> ${m2}`);
    const cached = await life.ev(`(async () => { const m = await new Promise((r) => { const w = window.__player; const f = w.onEvent; w.onEvent = (e) => { f(e); if (e.type === 'progress' && e.stage === 'cache') { w.onEvent = f; r(e.manifest); } }; w.worker.postMessage({ type: 'cache-info' }); }); return m ? m.rom.sha256 : null; })()`);
    if (cached !== null && cached !== MODEL_INFO.rom_sha256) fail(`B6b: the OPFS cache holds a main code block ${cached} after ${path.basename(other)}`);
  } else log(`page life cycle: no other firmware .BIN (${other ?? 'set --other-bin or OM_FW_DIR'}): its refusal is not checked here (test_unpack.mjs checks a synthetic one)`);
  await life.setFile('#fwfile');
  if (!await until3(`(() => { const s = window.__playPage.status; return !!(s && s.phase === 'running' && window.__playPage.drawn); })()`)) fail('B6b: the .BIN after two refused files did not start a session');
  const token = (t) => life.ev(`(async () => { const r = await window.__player.api('/api/token?sync=1', { token: '${t}' }); return { status: r.status, body: await r.json(), phase: window.__playPage.status.phase }; })()`, 120000);
  const win = await token('WINDOWS');
  if (win.status !== 200 || !String(win.body.result?.error ?? '').startsWith('Unported: ') || win.body.result?.record !== null) fail(`B6b: WINDOWS token answered ${JSON.stringify(win).slice(0, 300)}`);
  const store = await token('STORE');
  if (store.status !== 200 || !store.body.result?.record || store.body.result.error) fail(`B6b: STORE after WINDOWS answered ${JSON.stringify(store).slice(0, 300)}`);
  const intc = await token('INTC');
  if (intc.status !== 200 || !intc.body.result?.record || intc.body.result.error) fail(`B6b: INTC after STORE answered ${JSON.stringify(intc).slice(0, 300)}`);
  log(`page life cycle: WINDOWS -> ${win.status} ${String(win.body.result?.error).slice(0, 90)}; STORE after it -> record ${store.body.result?.record?.token ?? null}; INTC -> record ${intc.body.result?.record?.token ?? null}, phase ${intc.phase}`);
  // the Card, HDMI and session options panel: the card the firmware formatted at the start, read in the Worker with
  // refs/fat.mjs and shown; the panel's Take out and Put in (S-MEDIA), each followed by a read; the HDMI control
  // without the port (no ?hdmi=on): disabled, with the reason
  const cardDoc = await life.ev(`(async () => { const r = await window.__player.api('/api/card'); return { status: r.status, doc: await r.json() }; })()`, 120000);
  if (cardDoc.status !== 200 || cardDoc.doc.volume?.type !== 'FAT32' || cardDoc.doc.slot?.present !== true) fail(`B6b: GET /api/card answered ${JSON.stringify(cardDoc).slice(0, 300)}`);
  await life.ev(`document.getElementById('cardpanel').open = true, true`);
  const cardText = (want) => until3(`(() => { const t = document.getElementById('card-state').textContent; return t.includes('FAT32') && ${want} ? t : null; })()`, 120000);
  const shown = await cardText(`t.startsWith('in the slot, mounted') && !document.getElementById('card-remove').disabled`);
  if (!shown) fail('B6b: the Card panel did not show the card in the slot, mounted, with its FAT32 volume');
  await life.ev(`document.getElementById('card-remove').click(), true`);
  const out = await cardText(`t.startsWith('out of the slot') && (window.__playPage.status.stand_ins || []).includes('S-MEDIA') && !document.getElementById('card-insert').disabled`);
  if (!out) fail('B6b: Take out did not leave the card out of the slot (S-MEDIA) with its volume still read');
  await life.ev(`document.getElementById('card-insert').click(), true`);
  const back = await cardText(`t.startsWith('in the slot, mounted')`);
  if (!back) fail('B6b: Put in did not bring the card back, mounted by the firmware');
  const hdmi = await life.ev(`(() => ({ plug: document.getElementById('hdmi-plug').disabled, unplug: document.getElementById('hdmi-unplug').disabled, text: document.getElementById('hdmi-state').textContent }))()`);
  if (!hdmi.plug || !hdmi.unplug || !hdmi.text.startsWith('no HDMI port')) fail(`B6b: the HDMI control without the port: ${JSON.stringify(hdmi)}`);
  log(`page life cycle: Card panel ${shown ?? '-'} -> out: ${out ?? '-'} -> back: ${back ?? '-'}; HDMI: ${hdmi.text}`);
  // the EVF layout: LV (V) switches to the EVF and back; the screen takes the class evf with the first frame drawn
  // from the EVF (its X-Device), at the EVF composite's size, and drops it with the first frame from the TFT
  const layout = `(() => { const p = window.__playPage, s = p.status, d = p.drawn, c = document.getElementById('cv'); return s && d && s.phase === 'running' && s.queue === 0 && d.seq === s.frame_seq ? { device: s.device, drawn: d.device, evf: document.getElementById('screen').classList.contains('evf'), w: c.width, h: c.height } : null; })()`;
  await life.ev('document.activeElement && document.activeElement.blur(), true');
  const lv = async (want) => {
    await life.S('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyV', key: 'v', windowsVirtualKeyCode: 86 });
    await sleep(120);
    await life.S('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyV', key: 'v', windowsVirtualKeyCode: 86 });
    return until3(`(() => { const x = ${layout}; return x && x.device === '${want}' && x.drawn === '${want}' ? x : null; })()`, 60000);
  };
  const toEvf = await lv('evf'), toTft = await lv('tft');
  if (!toEvf || !toEvf.evf || toEvf.w !== 1600 || toEvf.h !== 1200) fail(`B6b: the EVF layout after LV: ${JSON.stringify(toEvf)} (want the class evf on a 1600 x 1200 frame from the EVF)`);
  if (!toTft || toTft.evf || toTft.w !== 900 || toTft.h !== 600) fail(`B6b: the TFT layout after LV again: ${JSON.stringify(toTft)} (want no class evf on a 900 x 600 frame from the TFT)`);
  log(`page life cycle: LV -> ${JSON.stringify(toEvf)}; LV -> ${JSON.stringify(toTft)}`);
  await life.ev(`document.getElementById('quit').click(), true`);
  const answers = [];
  for (let i = 0; i < 6; i++) { await sleep(500); answers.push(await life.evWithin(`(() => ({ phase: window.__playPage.status.phase, ovl: document.getElementById('ovl').textContent }))()`, 5000)); }
  if (answers.some((x) => x === null)) fail(`B6b: the page stopped answering after Quit (${answers.map((x) => (x ? 'ok' : 'no answer')).join(', ')})`);
  else if (!answers[answers.length - 1].ovl.includes('session has ended')) fail(`B6b: after Quit the overlay says ${JSON.stringify(answers[answers.length - 1])}`);
  else log(`page life cycle: Quit -> phase ${answers[answers.length - 1].phase}, the page answered 6 times in 3 s, overlay '${answers[answers.length - 1].ovl}'`);
  await life.close();
}

// ---- B7
const foreign = requests.filter((q) => !q.url.startsWith(ORIGIN + '/') || q.method !== 'GET' || q.post);
log(`network (B7): ${requests.length} requests (${requests.filter((q) => q.target === 'worker').length} from Workers), ${foreign.length} not a body-less GET to ${ORIGIN}; server saw ${served.length} requests, methods ${[...new Set(served.map((x) => x[0]))].join(',')}`);
for (const q of foreign) fail(`B7: ${q.method} ${q.url}${q.post ? ' with a body' : ''} (${q.target})`);
if (served.some((x) => x[0] !== 'GET')) fail('B7: the server saw a request other than GET');
if (consoleLines.length) log(`console: ${consoleLines.slice(0, 10).join('\n  ')}`);
ws.close();
cleanup();
log(problems.length ? `FAILED (${problems.length})` : 'all passed');
process.exit(problems.length ? 1 : 0);
