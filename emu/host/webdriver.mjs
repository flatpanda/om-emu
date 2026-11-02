// A W3C WebDriver (classic, HTTP) client for bin/browsergate.mjs, with node's built-in fetch (no npm packages), and
// the two browsers it starts through their own drivers: Firefox through geckodriver (headless), and WebKit as
// WebKitGTK's MiniBrowser through WebKitWebDriver, on an X server of its own (Xvfb) when the host has no display.
// Each driver and Xvfb runs in its own process group, killed by close(), and every group still running when node exits
// (a gate that ends early, a signal it handles by exiting) is killed then; profiles and logs go under the caller's
// directory. Node-only (host/). The commands are the spec's (https://www.w3.org/TR/webdriver2/): a
// command that answers {value: {error}} throws a WebDriverError with the driver's error code and message.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const which = (names) => {
  for (const n of names) {
    if (n.includes('/')) { if (fs.existsSync(n)) return n; continue; }
    for (const d of (process.env.PATH ?? '').split(':')) if (d && fs.existsSync(path.join(d, n))) return path.join(d, n);
  }
  return null;
};
// WebKitGTK's MiniBrowser with these feature switches (MiniBrowser --features=help lists them). It takes the
// automation session only with --automation, which the driver does not add (without it the new session never answers).
const webkit = (features) => ({
  driver: ['WebKitWebDriver'], binary: ['/usr/lib/webkitgtk-6.0/MiniBrowser', '/usr/libexec/webkitgtk-6.0/MiniBrowser', '/usr/lib/x86_64-linux-gnu/webkitgtk-6.0/MiniBrowser', '/usr/lib/aarch64-linux-gnu/webkitgtk-6.0/MiniBrowser'],
  args: (port) => [`--port=${port}`],
  caps: (binary, { dir, extraArgs }) => ({ 'webkitgtk:browserOptions': { binary, args: ['--automation', '--enable-write-console-messages-to-stdout=true',
    ...(features.length ? [`--features=${features.join(',')}`] : []), ...extraArgs] } }),
  display: true,
});
// The browsers: the driver and browser executables looked for (the first found), and the session's capabilities.
export const BROWSERS = {
  firefox: {
    driver: ['geckodriver'], binary: ['firefox', '/usr/lib/firefox/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox'],
    args: (port, dir) => ['--port', String(port), '--profile-root', dir],
    caps: (binary, { width, height, extraArgs }) => ({ browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', `--width=${width}`, `--height=${height}`, ...extraArgs] } }),
    display: false,
  },
  // WebKit as WebKitGTK ships it: the Storage API off, so no navigator.storage and no OPFS
  webkit: webkit([]),
  // WebKit with the Storage API, OPFS and its sync access handles switched on, as Safari ships them (WebKitGTK 2.54:
  // in an automation session getDirectory rejects, and outside one createSyncAccessHandle is not supported)
  'webkit-storage': webkit(['+StorageAPI', '+StorageAPIEstimate', '+FileSystem', '+AccessHandle']),
};

export class WebDriverError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

// the process groups started and not yet killed
const GROUPS = new Set();
const killGroup = (pid) => { GROUPS.delete(pid); try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };
process.on('exit', () => { for (const pid of [...GROUPS].reverse()) killGroup(pid); });

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

// Xvfb on a display it picks (-displayfd), for a browser that needs an X server where the host has none.
async function xvfb(width, height, dir) {
  const bin = which(['Xvfb']);
  if (!bin) throw new Error('webkit needs an X server: no $DISPLAY and no Xvfb on the PATH');
  const p = spawn(bin, ['-displayfd', '3', '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp'],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'], cwd: dir });
  GROUPS.add(p.pid);
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  const display = await new Promise((res, rej) => {
    let out = '';
    const t = setTimeout(() => rej(new Error(`Xvfb did not start: ${err}`)), 15000);
    p.stdio[3].on('data', (d) => { out += d; if (out.includes('\n')) { clearTimeout(t); res(':' + out.trim()); } });
    p.once('exit', (c) => { clearTimeout(t); rej(new Error(`Xvfb exited (${c}): ${err}`)); });
  });
  return { pid: p.pid, display };
}

// Start a browser's driver and open one session. opts: {driver, binary (paths, else BROWSERS' search), dir (profiles,
// logs), width, height}. Returns a Session; close() ends it and kills what was started.
export async function startBrowser(name, opts) {
  const B = BROWSERS[name];
  if (!B) throw new Error(`unknown browser ${name} (${Object.keys(BROWSERS).join(', ')})`);
  const driver = opts.driver ?? which(B.driver), binary = opts.binary ?? which(B.binary);
  if (!driver) throw new Error(`${name}: no driver (${B.driver.join(', ')} on the PATH; or --driver)`);
  if (!binary) throw new Error(`${name}: no browser (${B.binary.join(', ')}; or --binary)`);
  const { width = 1400, height = 1300, dir } = opts;
  const pids = [];
  const env = { ...process.env };
  if (B.display && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    const x = await xvfb(width, height, dir);
    pids.push(x.pid);
    Object.assign(env, { DISPLAY: x.display, GDK_BACKEND: 'x11' });
  }
  const port = await freePort();
  const log = fs.openSync(path.join(dir, `${name}-driver.log`), 'a');
  const d = spawn(driver, B.args(port, dir), { detached: true, stdio: ['ignore', log, log], env, cwd: dir });
  pids.push(d.pid);
  GROUPS.add(d.pid);
  const kill = () => { for (const pid of pids.reverse()) killGroup(pid); pids.length = 0; };
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      try { ready = !!(await (await fetch(base + '/status')).json()).value?.ready; } catch { /* not listening yet */ }
      if (!ready) await sleep(50);
    }
    if (!ready) throw new Error(`${name}: ${driver} did not answer on port ${port} (log ${path.join(dir, `${name}-driver.log`)})`);
    const s = await call(base, 'POST', '/session', { capabilities: { alwaysMatch: B.caps(binary, { width, height, dir, extraArgs: opts.extraArgs ?? [] }) } });
    const session = new Session(base, s.sessionId, s.capabilities, kill);
    // the window's size (MiniBrowser opens at 1024 x 768 whatever the X screen's size)
    await session.cmd('POST', '/window/rect', { width, height });
    return session;
  } catch (e) { kill(); throw e; }
}

async function call(base, method, p, body) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let doc;
  try { doc = JSON.parse(text); } catch { throw new WebDriverError('unknown error', `${method} ${p}: HTTP ${r.status} ${text.slice(0, 300)}`); }
  const v = doc.value;
  // an error comes with a status of 400 or more (W3C WebDriver, 6.6); a script's own result may hold an 'error' key
  if (!r.ok && v && typeof v === 'object' && v.error) throw new WebDriverError(v.error, `${method} ${p}: ${v.message}`);
  return v;
}

export class Session {
  constructor(base, id, capabilities, kill) { this.base = base; this.id = id; this.capabilities = capabilities; this.kill = kill; }
  cmd(method, p, body) { return call(this.base, method, `/session/${this.id}${p}`, body); }
  get version() { return `${this.capabilities.browserName} ${this.capabilities.browserVersion}`; }
  timeouts(t) { return this.cmd('POST', '/timeouts', t); }
  navigate(url) { return this.cmd('POST', '/url', { url }); }
  // script: a function body (arguments[0..]); async: the body's last argument is the callback
  exec(script, args = []) { return this.cmd('POST', '/execute/sync', { script, args }); }
  execAsync(script, args = []) { return this.cmd('POST', '/execute/async', { script, args }); }
  async find(css) { return (await this.cmd('POST', '/element', { using: 'css selector', value: css }))[ELEMENT]; }
  click(el) { return this.cmd('POST', `/element/${el}/click`, {}); }
  sendKeys(el, text) { return this.cmd('POST', `/element/${el}/value`, { text }); }
  rect(el) { return this.cmd('GET', `/element/${el}/rect`); }
  async screenshot(file) { fs.writeFileSync(file, Buffer.from(await this.cmd('GET', '/screenshot'), 'base64')); }
  actions(actions) { return this.cmd('POST', '/actions', { actions }); }
  releaseActions() { return this.cmd('DELETE', '/actions'); }
  // a key pressed and released (a WebDriver key value: one character, or a code point of the spec's table)
  async key(value, holdMs = 100) {
    await this.actions([{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value }, { type: 'pause', duration: holdMs }, { type: 'keyUp', value }] }]);
  }
  // a mouse press at (x, y) in CSS pixels from the element's top left corner
  // (the element is scrolled to the viewport's centre first, as a user would: actions do not scroll, and WebKitWebDriver
  // sends a target outside the viewport to its edge where the spec, and geckodriver, refuse it)
  async press(el, x, y, holdMs = 300) {
    await this.exec('arguments[0].scrollIntoView({ block: "center", inline: "center" });', [{ [ELEMENT]: el }]);
    const r = await this.rect(el);
    const at = { type: 'pointerMove', duration: 0, origin: { [ELEMENT]: el }, x: Math.round(x - r.width / 2), y: Math.round(y - r.height / 2) };
    await this.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
      actions: [at, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: holdMs }, { type: 'pointerUp', button: 0 }] }]);
  }
  // the value of a page expression once it is truthy (polled every 100 ms; an error, as a navigation's, is tried
  // again), or null after ms
  async until(expr, ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      try { const v = await this.exec(`return (${expr});`); if (v) return v; } catch { /* the page is navigating */ }
      await sleep(100);
    }
    return null;
  }
  async close() {
    try { await this.cmd('DELETE', ''); } catch { /* the browser is gone */ }
    this.kill();
  }
}
// the spec's key table: U+E006 is Enter on the main keyboard (code Enter), U+E007 the keypad's (code NumpadEnter)
export const KEYS = { ArrowDown: '\uE015', Enter: '\uE006' };
