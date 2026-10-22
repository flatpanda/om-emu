// The play tests' player client (Play, TerminalPlay, nav_run, png_rgb), on node: bin/play.mjs as a
// child process driven over HTTP only. Async throughout (node has no synchronous
// HTTP client); node:http with agent false, a connection per request, JSON both ways. Its failures are LabErrors
// (RuntimeError, URLError, TimeoutError, AssertionError), which a test reports as 'name: message'.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { REPO } from './env.mjs';
import { LabError, RuntimeError, ValueError, AssertionError } from '../../src/lab/errors.mjs';
import { show } from '../../src/util/show.mjs';

export const OUT = process.env.OM_CHECK_OUT ? path.resolve(process.env.OM_CHECK_OUT) : path.join(REPO, 'emu/out/checks/js/manual');
export const PLAY = path.join(REPO, 'emu/bin/play.mjs');
export const NAV = path.join(REPO, 'emu/bin/nav.mjs');
export const RCWRAP = path.join(REPO, 'emu/checks/lib/rcwrap.mjs');
export class URLError extends LabError {}
export class TimeoutError extends LabError {}
export const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
export const monotonic = () => Number(process.hrtime.bigint()) / 1e9;          // monotonic seconds
// remove a directory tree, if it is there
export const rmtree = (p) => fs.rmSync(p, { recursive: true, force: true });
const cutCp = (s, n) => { const cs = [...s]; return cs.length > n ? cs.slice(0, n).join('') : s; };

// One HTTP request: [status, headers (lower-case names), body bytes], an error status too; a connection failure
// raises URLError, a socket timeout TimeoutError.
export function request(base, method, p, { headers = {}, data = null, timeout = 600 } = {}) {
  const u = new URL(base + p);
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (data !== null) h['Content-Length'] = String(data.length);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve([res.statusCode, res.headers, new Uint8Array(Buffer.concat(chunks))]));
      res.on('error', (e) => reject(new URLError(String(e.message))));
    });
    req.setTimeout(timeout * 1000, () => req.destroy(new TimeoutError('timed out')));
    req.on('error', (e) => reject(e instanceof LabError ? e : new URLError(`<urlopen error ${e.code === 'ECONNREFUSED' ? '[Errno 111] Connection refused' : e.message}>`)));
    if (data !== null) req.write(data);
    req.end();
  });
}
const text = (b) => Buffer.from(b).toString('utf8');

// A child's exit status: the code, or minus the signal number.
const SIGNUM = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGUSR2: 12, SIGTERM: 15, SIGABRT: 6, SIGSEGV: 11 };
function rcOf(code, signal) { return code !== null ? code : signal ? -(SIGNUM[signal] ?? 0) : null; }

// play.mjs as a subprocess; inputs over HTTP. Play.open(tag, args, {wait, env}) starts one;
// withPlay(tag, args, fn) runs fn with it and closes it in finally.
export class Play {
  static async open(tag, args = [], opts = {}) {
    const pl = new this(tag, opts);
    await pl.init(args, opts);
    return pl;
  }
  constructor(tag, { env = null } = {}) {
    this.env = env;
    this.tag = tag;
    this.out = path.join(OUT, tag);
    this.lines = [];
  }
  async init(args, { wait = true } = {}) {
    rmtree(this.out);
    fs.mkdirSync(this.out, { recursive: true });
    // the camera application's start sets up the live view (CTRL3 0x41), which composites only under A15's guard
    if (!args.includes('--a15')) args = ['--a15', 'auto', ...args];
    const cmd = [process.execPath, PLAY, '--no-browser', '--debug-api', '--out', this.out, ...args];
    this.start(cmd);
    const url = await this.awaitUrl(60);
    if (url === null) {
      await this.kill();
      throw new RuntimeError(`${this.tag}: play printed no URL: ${show(this.lines.slice(-10))}`);
    }
    [this.base, this.port, this.token] = [url[1], Number(url[2]), url[3]];
    if (wait) await this.wait_phase((s) => !['starting', 'replaying'].includes(s.phase), 300);
  }
  start(cmd) {
    this.p = spawn(cmd[0], cmd.slice(1), { cwd: REPO, env: this.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.attach([this.p.stdout, this.p.stderr]);
    this.trackExit();
  }
  trackExit() {
    this.rc = undefined;
    this.exited = new Promise((resolve) => this.p.on('exit', (code, signal) => { this.rc = rcOf(code, signal); resolve(this.rc); }));
    this.p.on('error', () => {});
  }
  attach(streams) {
    this.waiters = [];
    for (const s of streams) {
      let part = '';
      s.setEncoding('utf8');
      s.on('data', (d) => {
        part += d;
        const ls = part.split('\n');
        part = ls.pop();
        for (const l of ls) { this.lines.push(l.replace(/\s+$/, '')); for (const w of this.waiters) w(); }
      });
      s.on('error', () => {});
      s.on('end', () => { if (part) this.lines.push(part.replace(/\s+$/, '')); part = ''; for (const w of this.waiters) w(); this.ended = (this.ended ?? 0) + 1; });
    }
  }
  // The first stdout line with the URL, within t seconds (null: none, or the output ended).
  awaitUrl(t) {
    const re = /(http:\/\/127\.0\.0\.1:(\d+))\/\?t=(\S+)/;
    return new Promise((resolve) => {
      let i = 0, done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); this.waiters = this.waiters.filter((w) => w !== look); resolve(v); };
      const look = () => {
        for (; i < this.lines.length; i++) { const m = re.exec(this.lines[i]); if (m) return finish(m); }
        if (this.streamsEnded()) finish(null);
      };
      const timer = setTimeout(() => finish(null), t * 1000);
      this.waiters.push(look);
      look();
    });
  }
  streamsEnded() { return (this.ended ?? 0) >= 2; }
  alive() { return this.rc === undefined; }
  async req(method, p, body = null, headers = null, timeout = 600) {
    const h = { 'X-Token': this.token, 'Content-Type': 'application/json', ...(headers ?? {}) };
    const data = body !== null ? Buffer.from(JSON.stringify(body)) : method === 'POST' ? Buffer.alloc(0) : null;
    return request(this.base, method, p, { headers: h, data, timeout });
  }
  async get(p) {
    const [code, , body] = await this.req('GET', p);
    if (code !== 200) throw new RuntimeError(`GET ${p}: ${code} ${show(body.slice(0, 200))}`);
    return JSON.parse(text(body));
  }
  status() { return this.get('/api/status?after=0'); }
  async wait_phase(pred, timeout) {
    const t0 = monotonic();
    while (monotonic() - t0 < timeout) {
      const s = await this.status();
      if (pred(s)) return s;
      await sleep(0.1);
    }
    const ph = (await this.status()).phase;
    throw new RuntimeError(`${this.tag}: phase wait timed out: ${typeof ph === 'string' ? ph : show(ph)}`);
  }
  // An input's ?sync=1 result; its error is a RuntimeError unless allowError.
  async input(body, allowError = false) {
    const [code, , raw] = await this.req('POST', '/api/input?sync=1', body);
    if (code !== 200) throw new RuntimeError(`${this.tag}: input ${show(body)}: HTTP ${code}`);
    const res = JSON.parse(text(raw)).result;
    if (res === null || res === undefined) throw new RuntimeError(`${this.tag}: input ${show(body)}: no result`);
    if (res.error && !allowError) throw new RuntimeError(`${this.tag}: input ${show(body)}: ${cutCp(res.error, 600)}`);
    return res;
  }
  async send(body) {
    const [, , raw] = await this.req('POST', '/api/input', body);
    return JSON.parse(text(raw)).seq;
  }
  token_(tok, allowError = false) { return this.input({ type: 'token', token: tok }, allowError); }
  async key(cid, action = 'click') {
    if (action === 'click') {
      await this.input({ type: 'key', id: cid, action: 'down' });
      return this.input({ type: 'key', id: cid, action: 'up' });
    }
    return this.input({ type: 'key', id: cid, action });
  }
  async frame() {
    const [code, h, body] = await this.req('GET', '/api/frame?after=0');
    if (code !== 200) throw new RuntimeError(`frame: ${code}`);
    return [body, h];
  }
  async log() { return (await this.get('/api/log')).inputs; }
  async quit() {
    try { await this.req('POST', '/api/quit', {}, null, 10); } catch (e) {
      if (!(e instanceof URLError || e instanceof TimeoutError)) throw e;   // a body cut by the exit is URLError here
    }
  }
  async kill() {
    if (this.alive()) {
      try { this.p.kill('SIGKILL'); } catch { /* gone */ }
      await this.exited;
    }
  }
  // The return code, or null after timeout seconds.
  async wait(timeout) {
    if (!this.alive()) return this.rc;
    let timer;
    const t = new Promise((r) => { timer = setTimeout(() => r(undefined), timeout * 1000); });
    const rc = await Promise.race([this.exited, t]);
    clearTimeout(timer);
    return rc === undefined ? null : rc;
  }
  async close(timeout = 15) {
    if (this.alive()) {
      await this.quit();
      if ((await this.wait(timeout)) === null) await this.kill();
    }
    return this.rc;
  }
  signal(sig) { this.p.kill(sig); }
  get pid() { return this.p.pid; }
}

// fn(pl) on a new Play, closed after it
export async function withPlay(tag, args, fn, opts = {}) {
  const pl = await Play.open(tag, args, opts);
  try { return await fn(pl); } finally { await pl.close(); }
}

// play.mjs in a terminal of its own (TerminalPlay): `script` gives it a pty as its
// controlling terminal (sh -c as the session leader), rcwrap.mjs (SIGHUP ignored) runs play.mjs in the terminal's
// foreground process group and writes its exit status (and pid) to RCFILE. hang_up() kills script, which closes the
// pty's master side: the kernel sends SIGHUP to the session leader, which exits, and then to the foreground group, as
// closing a terminal window does.
export class TerminalPlay extends Play {
  start(cmd) {
    this.rcfile = path.join(this.out, '.rcwrap');
    // not `exec`: the shell stays the session leader, takes the hang-up's SIGHUP and exits, and the kernel then sends
    // SIGHUP to the terminal's foreground process group (rcwrap, which ignores it, and play.mjs): with rcwrap as
    // the session leader the hang-up reaches only rcwrap (X). '; true' keeps sh from exec'ing it.
    const inner = [process.execPath, RCWRAP, this.rcfile, ...cmd].map(shq).join(' ') + '; true';
    // util-linux script runs `$SHELL -c inner`; BSD script (macOS) runs its command words, so sh -c is named there.
    // BSD script refuses a socket (node's 'pipe', and macOS FIFOs) as stdin, so it gets /dev/null: its EOF reaches the
    // pty as ^D, which nothing in the terminal reads (play.mjs takes no terminal input).
    const bsd = process.platform !== 'linux';
    const argv = bsd ? ['-qeF', '/dev/null', '/bin/sh', '-c', inner] : ['-qfec', inner, '/dev/null'];
    const stdin = bsd ? 'ignore' : 'pipe';
    this.p = spawn('script', argv, { cwd: REPO, env: { ...(this.env ?? process.env), SHELL: '/bin/sh' }, stdio: [stdin, 'pipe', 'pipe'] });
    this.attach([this.p.stdout, this.p.stderr]);
    this.p.stdin?.on('error', () => {});
    this.trackExit();
    this.serverRc = undefined;
  }
  // the play.mjs process inside the terminal (rcwrap writes its pid first)
  async serverPid(timeout = 10) {
    const t0 = monotonic();
    for (;;) {
      try { const m = /^pid (\d+)$/m.exec(fs.readFileSync(this.rcfile, 'utf8')); if (m) return Number(m[1]); } catch { /* not yet */ }
      if (monotonic() - t0 > timeout) return null;
      await sleep(0.02);
    }
  }
  async hang_up() {
    await sleep(0.3);
    try { this.p.kill('SIGKILL'); } catch { /* gone */ }
  }
  // the server's exit status from rcwrap, within timeout seconds (null: none)
  async serverWait(timeout) {
    const t0 = monotonic();
    for (;;) {
      try { const m = /^rc (-?\d+)$/m.exec(fs.readFileSync(this.rcfile, 'utf8')); if (m) return Number(m[1]); } catch { /* not yet */ }
      if (monotonic() - t0 > timeout) return null;
      await sleep(0.02);
    }
  }
}
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

// nav.mjs --time --png each --out OUT/nav-<tag> --tag tag ARGS SCRIPT: its session.json
export function nav_run(tag, script, ...args) {
  const out = path.join(OUT, `nav-${tag}`);
  rmtree(out);
  const cmd = [NAV, '--time', '--png', 'each', '--out', out, '--tag', tag, ...args, script];
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code) reject(new RuntimeError(`nav ${tag}: ${err.slice(-800)}`));
      else resolve(JSON.parse(fs.readFileSync(path.join(out, 'session.json'), 'utf8')));
    });
  });
}

// RGB rows of a PNG with filter type 0 on every row: [w, h, rgb bytes]
export function png_rgb(data) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (!sig.every((b, i) => data[i] === b)) throw new AssertionError('');
  let pos = 8, w = null, h = null;
  const idat = [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  while (pos < data.length) {
    const n = dv.getUint32(pos);
    const kind = String.fromCharCode(...data.subarray(pos + 4, pos + 8));
    const body = data.subarray(pos + 8, pos + 8 + n);
    if (kind === 'IHDR') { w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12); } else if (kind === 'IDAT') idat.push(body);
    pos += 12 + n;
  }
  const raw = new Uint8Array(zlib.inflateSync(Buffer.concat(idat)));
  const stride = 3 * w + 1;
  for (let r = 0; r < h; r++) if (raw[r * stride]) throw new ValueError('PNG row filter != 0');
  const rgb = new Uint8Array(3 * w * h);
  for (let r = 0; r < h; r++) rgb.set(raw.subarray(r * stride + 1, (r + 1) * stride), r * 3 * w);
  return [w, h, rgb];
}

// the children of pid (any command: the "no child process" rule) and whether pid is
// alive, on any POSIX host (checks/lib/procs.mjs)
export { children, alive } from './procs.mjs';
