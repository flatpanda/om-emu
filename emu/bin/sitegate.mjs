#!/usr/bin/env node
// The published site's gate: bin/site.mjs builds the tree .github/workflows/pages.yml publishes, a plain static server
// serves it under a sub-path (/om-emu/, as https://<user>.github.io/om-emu/; GitHub Pages' content types, no custom
// headers: no COOP/COEP, nothing but files), and headless Chrome (driven over the DevTools protocol, as
// bin/webgate.mjs drives it) checks:
// - the landing page (emu/index.html) at the prefix, its player link resolving under the prefix;
// - the player opened by that link: the firmware help names the model's .BIN and the download command; the .BIN chosen
//   through the file input; the session running on the shooting screen (GUI 0x0108) with a frame drawn;
// - a second player page (idle off) started by dropping the .BIN on the page (Input.dispatchDragEvent);
// - every request of the pages and their Workers is a body-less GET under the prefix, the server answered each with 200
//   (a 301 for the prefix without its slash), and no page or Worker threw.
// On the lab model only (src/fw/model.mjs LAB_MODEL). Screenshots go to emu/out/web/site/.
//   node emu/bin/sitegate.mjs [--bin FILE] [--chrome PATH] [--prefix /om-emu/] [--keep]
// --bin: the firmware .BIN (default $OM_BIN, else $OM_FW_DIR/<the model's .BIN>); missing: exit 2. --chrome: as
// webgate's (missing: exit 2). --keep: keep the built tree and Chrome's profile (their directory is printed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { MODEL, MODEL_INFO, LAB_MODEL, ON_LAB_MODEL } from '../src/fw/model.mjs';
import { buildSite } from './site.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BIN = (() => { const b = opt('--bin', process.env.OM_BIN || (process.env.OM_FW_DIR ? path.join(process.env.OM_FW_DIR, MODEL_INFO.bin) : null)); return b ? path.resolve(b) : null; })();
const PREFIX = opt('--prefix', '/om-emu/');
const CHROME_PATHS = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const CHROME = opt('--chrome', CHROME_PATHS.find((p) => fs.existsSync(p)) ?? null);
const PNG = path.join(EMU, 'out/web/site');
const TMP_ROOT = path.join(os.homedir(), '.cache/om-emu-tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const fail = (x) => { problems.push(x); console.log(`FAIL ${x}`); };
const log = (x) => console.log(x);

if (!ON_LAB_MODEL) { console.error(`sitegate: the gate runs on ${LAB_MODEL} only (OM_EMU_MODEL is ${MODEL})`); process.exit(2); }
if (!/^\/[\w.-]+\/$/.test(PREFIX)) { console.error(`sitegate: --prefix must look like /name/ (${PREFIX})`); process.exit(2); }
if (!BIN || !fs.existsSync(BIN)) { console.error(`sitegate: no firmware .BIN (${BIN ?? 'set --bin, OM_BIN or OM_FW_DIR'})`); process.exit(2); }
if (!CHROME || !fs.existsSync(CHROME)) { console.error(`sitegate: no Chrome (${CHROME ?? `set --chrome; none of ${CHROME_PATHS.join(', ')}`})`); process.exit(2); }
fs.mkdirSync(PNG, { recursive: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(TMP_ROOT, 'sitegate-')), SITE = path.join(TMP, 'site'), PROF = path.join(TMP, 'chrome');
fs.mkdirSync(PROF);
const built = buildSite(SITE);
log(`site: ${built.files} files, ${(built.bytes / 2 ** 20).toFixed(2)} MiB (bin/site.mjs), served under ${PREFIX}`);

// ---- the static server: the tree under PREFIX, as GitHub Pages serves a project site (index.html for a directory, a
// 301 to add a directory's slash, its content types by extension), no other route and no other header
const PAGES_TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const served = [];
const server = http.createServer((q, s) => {
  const url = new URL(q.url, 'http://x');
  const answer = (code, headers = {}) => { served.push([q.method, url.pathname, code]); s.writeHead(code, headers); };
  if (q.method !== 'GET' && q.method !== 'HEAD') { answer(405); return s.end(); }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { answer(400); return s.end(); }
  if (p === PREFIX.slice(0, -1)) { answer(301, { Location: PREFIX }); return s.end(); }
  if (!p.startsWith(PREFIX)) { answer(404); return s.end(); }
  let file = path.normalize(path.join(SITE, p.slice(PREFIX.length)));
  if (file !== SITE && !file.startsWith(SITE + path.sep)) { answer(404); return s.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { answer(301, { Location: p + '/' }); return s.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { answer(404); return s.end(); }
  answer(200, { 'Content-Type': PAGES_TYPES[path.extname(file)] ?? 'application/octet-stream' });
  if (q.method === 'HEAD') return s.end();
  fs.createReadStream(file).pipe(s);
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const ORIGIN = `http://127.0.0.1:${server.address().port}`, BASE = ORIGIN + PREFIX;

// ---- Chrome, as webgate starts it (own process group, fresh profile, killed and removed at the end)
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
  if (argv.includes('--keep')) console.log(`kept ${TMP}`); else fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', cleanup);
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => { cleanup(); process.exit(code); });
let wsUrl = null;
for (let i = 0; i < 400 && !wsUrl; i++) {
  try { const [p, w] = fs.readFileSync(path.join(PROF, 'DevToolsActivePort'), 'utf8').split('\n'); if (w) wsUrl = `ws://127.0.0.1:${p}${w}`; } catch { /* not yet */ }
  if (!wsUrl) await sleep(50);
}
if (!wsUrl) { console.error(`sitegate: Chrome did not start: ${chromeErr.slice(0, 2000)}`); process.exit(2); }
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
log(`Chrome ${(await send('Browser.getVersion')).product}, site ${BASE}`);

// A page target with its Workers auto-attached, every request and exception recorded
const requests = [], thrown = [];
async function openPage(url) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const sessions = new Set([sessionId]);
  listeners.add(async (m) => {
    if (m.method === 'Target.attachedToTarget' && sessions.has(m.sessionId)) {
      const w = m.params.sessionId;
      sessions.add(w);
      try {
        await send('Network.enable', {}, w);
        await send('Runtime.enable', {}, w);
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, w);
      } finally { await send('Runtime.runIfWaitingForDebugger', {}, w).catch(() => {}); }
    }
    if (!sessions.has(m.sessionId)) return;
    if (m.method === 'Network.requestWillBeSent') requests.push({ url: m.params.request.url, method: m.params.request.method, post: !!m.params.request.hasPostData });
    if (m.method === 'Runtime.exceptionThrown') thrown.push(JSON.stringify(m.params.exceptionDetails).slice(0, 800));
  });
  await S('Network.enable');
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await S('Page.navigate', { url });
  const ev = async (expr, timeout = 600000) => {
    const x = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (x.exceptionDetails) throw new Error(`evaluate ${expr.slice(0, 80)}: ${JSON.stringify(x.exceptionDetails).slice(0, 1500)}`);
    return x.result.value;
  };
  // the value of expr once it is truthy (a navigation in between answers with an error: tried again), or null
  const until = async (expr, ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      try { const v = await ev(expr, 10000); if (v) return v; } catch { /* the page is navigating */ }
      await sleep(100);
    }
    return null;
  };
  const shot = async (name) => { const { data } = await S('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(PNG, `${name}.png`), Buffer.from(data, 'base64')); };
  return { S, ev, until, shot, close: () => send('Target.closeTarget', { targetId }) };
}
const READY = `!!window.__playPage && document.readyState === 'complete'`;
const SHOOTING = `(() => { const p = window.__playPage, s = p && p.status, d = p && p.drawn; return s && d && s.phase === 'running' && s.gui === '0x0108' && d.seq >= 1 ? { gui: s.gui, gui_name: s.gui_name, seq: d.seq, lab_s: s.lab_ns / 1e9, fwstatus: document.getElementById('fwstatus').textContent } : null; })()`;

// ---- the landing page, then the player through its link, the .BIN through the file input
const page = await openPage(BASE.slice(0, -1));          // the prefix without its slash: the server's 301 adds it
const landing = await page.until(`document.readyState === 'complete' && location.href === ${JSON.stringify(BASE)} && document.getElementById('player') ? { title: document.title, href: document.getElementById('player').href } : null`, 30000);
if (!landing) fail(`the landing page did not load at ${BASE}`);
else if (landing.href !== BASE + 'web/index.html') fail(`the landing page's player link is ${landing.href}, not under ${BASE}`);
else log(`landing: '${landing.title}' at ${BASE}, player link ${landing.href}`);
await page.shot('landing');
await page.ev(`document.getElementById('player').click(), true`);
if (!await page.until(`location.pathname === ${JSON.stringify(PREFIX + 'web/index.html')} && ${READY}`, 60000)) fail('the player did not load from the landing page\'s link');
const help = await page.ev(`({ name: document.getElementById('fwname').textContent, cmd: document.getElementById('fwcmd').textContent, open: document.getElementById('fwhelp').open })`);
if (help.name !== MODEL_INFO.bin || !help.cmd.includes(`OLY${MODEL}000000000`) || !help.cmd.includes('https://fw01.om-digitalsolutions.net/') || !help.open) fail(`the firmware help: ${JSON.stringify(help).slice(0, 400)}`);
else log(`firmware help: ${help.name}, a ${help.cmd.length}-character command for OLY${MODEL}000000000, open with no cached firmware`);
await page.shot('player-help');
{
  const { root } = await page.S('DOM.getDocument');
  const { nodeId } = await page.S('DOM.querySelector', { nodeId: root.nodeId, selector: '#fwfile' });
  const t0 = performance.now();
  await page.S('DOM.setFileInputFiles', { nodeId, files: [BIN] });
  const st = await page.until(SHOOTING, 300000);
  if (!st) fail(`the player under ${PREFIX} did not reach the shooting screen (GUI 0x0108) from the file input: ${JSON.stringify(await page.ev(`(() => { const p = window.__playPage; return { status: p.status && { phase: p.status.phase, gui: p.status.gui, error: p.status.error }, fw: document.getElementById('fwstatus').textContent }; })()`)).slice(0, 600)}`);
  else log(`player (idle wall) from the file input: shooting screen ${st.gui} ${st.gui_name}, frame ${st.seq}, lab ${st.lab_s.toFixed(2)} s, ${Math.round(performance.now() - t0)} ms after the file was set; ${st.fwstatus}`);
  await page.shot('player-shooting');
}
await page.close();

// ---- a second player page started by a drop (the OPFS cache from the first is not used: a dropped file is unpacked)
const drop = await openPage(BASE + 'web/index.html?idle=off');
if (!await drop.until(READY, 60000)) fail('the player page (idle off) did not get ready');
else {
  const t0 = performance.now();
  const at = { x: 600, y: 400 }, data = { items: [], files: [BIN], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await drop.S('Input.dispatchDragEvent', { type, ...at, data });
  const st = await drop.until(SHOOTING, 300000);
  if (!st) fail(`the dropped .BIN did not start the player to the shooting screen: ${await drop.ev(`document.getElementById('fwstatus').textContent`)}`);
  else log(`player (idle off) from a drop: shooting screen ${st.gui} ${st.gui_name}, frame ${st.seq}, ${Math.round(performance.now() - t0)} ms after the drop; ${st.fwstatus}`);
  await drop.shot('player-drop');
}
await drop.close();

// ---- the network: GETs under the prefix only, all answered
const foreign = requests.filter((q) => !q.url.startsWith(BASE.slice(0, -1)) || q.method !== 'GET' || q.post);
for (const q of foreign) fail(`request ${q.method} ${q.url}${q.post ? ' with a body' : ''}`);
const unanswered = served.filter(([, p, code]) => !(code === 200 || (code === 301 && p === PREFIX.slice(0, -1))));
for (const [m, p, code] of unanswered) fail(`the server answered ${m} ${p} with ${code}`);
log(`network: ${requests.length} requests from the pages and Workers, ${foreign.length} not a body-less GET under ${PREFIX}; the server answered ${served.length}, ${unanswered.length} not 200 (or the prefix's 301)`);
for (const t of thrown) fail(`exception: ${t}`);
ws.close();
cleanup();
log(problems.length ? `FAILED (${problems.length})` : 'all passed');
process.exit(problems.length ? 1 : 0);
