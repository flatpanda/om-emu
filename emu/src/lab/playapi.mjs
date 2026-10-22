// The play HTTP API without HTTP: handle(req) answers one request,
// so the browser player's Worker (web/worker.mjs, over postMessage) and the node server (host/) (over HTTP) share one
// router. req = {method, path (with the query, as the request line has it), headers ({name: value}, any case), body (string or
// Uint8Array, POST)}; the answer is {status, headers: [[name, value], ...], body (Uint8Array)}, or a promise of it for
// the routes that wait (/api/status and /api/frame long polls, /api/input?sync=1). Answers are JSON.stringify's text;
// a request body is UTF-8 JSON (a leading byte order mark skipped), and a body that is not answers 400 {error: 'json'}.
// Numbers are JSON's: 10.0 and 10 are the same number, and an integer past 2^53 arrives rounded to a double.
// The player is the Player itself (the browser's Worker) or a host's proxy of it with the same fields (the node host's
// host/proxy.mjs: status_doc, log, frame, frame_seq, stop, submit, enqueue, wait_result, wall).
// Per-host behaviour:
// - /api/frame answers the composite as raw RGBA (opts.frameRgba(w, h, raw) -> Uint8Array; Content-Type
//   application/octet-stream, plus X-Frame-Width and X-Frame-Height) for the browser, which draws it into a canvas;
//   with opts.framePng(w, h, raw, sha16) -> PNG bytes (the node server) it answers image/png. The
//   204 case and X-Frame-Seq, X-Device, X-Lab-Ns and X-Frame-Sha are kept in both.
// - The Host, token and Origin checks run only with opts.check (the node server: {token, port, noHost}; noHost is the
//   no-host-check mutant); in the Worker there is no network, and the page is the only client.
// - A method other than GET and POST answers 405 {error: 'method'} (Allow: GET, POST); node's own HTTP parser answers
//   malformed requests before the router (declared).
// - GET / serves opts.page (bytes, with __POSTER__ replaced) when given, else 404.
// - /api/pagetest hands the body to opts.onPagetest instead of writing <out>/pagetest.json (an error it throws escapes
//   the handler).
// - /api/model: GET answers the run's model and the models
//   (src/fw/modeldoc.mjs modelDoc); POST {model} switches the host to another model: 400 for a code MODELS does not
//   have, the document again for the run's own, 501 when the host cannot switch (no opts.onSwitch: the browser's
//   Worker, whose page reloads with ?model= instead), 409 with the host's reason when it refuses (opts.onSwitch(code)
//   returns or resolves to one), else {model, switching: true}, and the session stops as /api/quit stops it (the host then starts the
//   chosen model's).
// The host calls notify() after every published status and frame and when the Player stops,
// and onFrame(w, h, raw, meta) from the Player's env.onFrame, which keeps the newest composite for /api/frame.
// Worker-safe.
import { controlsDoc, screensDoc } from './playui.mjs';
import { jsonType } from './player.mjs';
import { decimalInt, decimalNumber } from '../util/parse.mjs';
import { MODEL } from '../fw/model.mjs';
import { MODELS } from '../fw/models.mjs';
import { modelDoc } from '../fw/modeldoc.mjs';

const enc = new TextEncoder();
const utf8 = new TextDecoder('utf-8', { fatal: true });      // a leading byte order mark is skipped
// A request body's JSON value: bytes (the node server) as UTF-8, a string (the browser's Worker) as it is; an empty
// body is {}. undefined when the body is not UTF-8 or not JSON.
export function readBody(raw) {
  try {
    const text = typeof raw === 'string' ? raw : utf8.decode(raw);
    return JSON.parse(text || '{}');
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof TypeError) return undefined;     // TypeError: not UTF-8
    throw e;
  }
}
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array) && !(v instanceof Map);

// A request path split at its first '?', and its query as an object (later keys win, a bare key maps to '').
// Values are taken as they are (no percent-decoding).
export function parseQuery(p) {
  const i = p.indexOf('?');
  const path = i < 0 ? p : p.slice(0, i), q = i < 0 ? '' : p.slice(i + 1);
  const args = {};
  for (const x of q.split('&')) {
    if (!x) continue;
    const j = x.indexOf('=');
    if (j < 0) args[x] = ''; else args[x.slice(0, j)] = x.slice(j + 1);
  }
  return [path, args];
}
// The integer query argument k (absent or empty: 0), or null for one that is not a decimal integer.
function intArg(args, k) {
  const v = Object.hasOwn(args, k) ? args[k] : '';
  return v === '' ? 0 : decimalInt(v);
}

export class PlayApi {
  constructor(player, opts = {}) {
    this.player = player;
    this.opts = opts;
    this.tables = opts.tables;               // play.mjs Tables of the image (/api/controls)
    this.frameRgba = opts.frameRgba ?? null;
    this.waiters = [];                       // [predicate, resolve, timer]
    this.raw = null;                         // the newest composite: {w, h, raw (a copy), meta}
    this.timeScale = opts.timeScale ?? 1;    // the long polls' 25 s (a test shortens it)
    this._controls = null;
  }
  // ---- host hooks
  onFrame(w, h, raw, meta) { this.raw = { w, h, raw: raw.slice(), meta }; }
  notify() {
    const keep = [];
    for (const x of this.waiters) {
      if (x[0]()) { clearTimeout(x[2]); x[1](true); } else keep.push(x);
    }
    this.waiters = keep;
  }
  // A promise that resolves when pred() holds (checked at every notify) or after timeout s.
  waitFor(pred, timeout) {
    if (pred()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const x = [pred, resolve, null];
      x[2] = setTimeout(() => { this.waiters = this.waiters.filter((y) => y !== x); resolve(false); }, timeout * 1000 * this.timeScale);
      this.waiters.push(x);
    });
  }
  // ---- responses
  send(status, body, ctype = 'application/json', headers = []) {
    let b;
    if (body instanceof Uint8Array) b = body;
    else if (typeof body === 'string') b = enc.encode(body);
    else b = enc.encode(JSON.stringify(body));
    return { status, headers: [['Content-Type', ctype], ['Content-Length', String(b.length)], ['Cache-Control', 'no-store'], ...headers], body: b };
  }
  // The Host, token and Origin checks, only when opts.check = {token, port}: a 403 answer, or null.
  allowed(req, path, args, api = true) {
    const ck = this.opts.check;
    if (!ck) return null;
    const hd = (k) => { for (const [n, v] of Object.entries(req.headers ?? {})) if (n.toLowerCase() === k) return v; return null; };
    const host = hd('host') ?? '';
    if (!ck.noHost && host !== `127.0.0.1:${ck.port}` && host !== `localhost:${ck.port}`) return this.send(403, { error: 'host' });
    let token = hd('x-token');
    if (token === null && req.method === 'GET' && req.path.startsWith('/api/frame?')) token = Object.hasOwn(args, 't') ? args.t : null;
    if (api && token !== ck.token) return this.send(403, { error: 'token' });
    const origin = hd('origin');
    if (req.method === 'POST' && origin !== null && origin !== `http://127.0.0.1:${ck.port}` && origin !== `http://localhost:${ck.port}`) return this.send(403, { error: 'origin' });
    return null;
  }
  // The answer a POST gets before its body is read (a 403), or null: the node server asks this on the headers, so a
  // refused body is never read (req without body).
  refused(req) {
    if (req.method !== 'POST') return null;
    const [path, args] = parseQuery(req.path);
    return this.allowed(req, path, args);
  }
  handle(req) {
    const [path, args] = parseQuery(req.path);
    if (req.method === 'GET') return this.get(req, path, args);
    if (req.method === 'POST') return this.post(req, path, args);
    return this.send(405, { error: 'method' }, 'application/json', [['Allow', 'GET, POST']]);
  }
  get(req, path, args) {
    const pl = this.player;
    if (path === '/') {
      const no = this.allowed(req, path, args, false);
      if (no) return no;
      if (!this.opts.page) return this.send(404, { error: 'not found' });
      if ((this.opts.check?.token ?? null) !== null && args.t !== this.opts.check.token) return this.send(403, 'token', 'text/plain');
      const t = this.opts.check?.token ?? '';
      return this.send(200, enc.encode(new TextDecoder().decode(this.opts.page).replaceAll('__POSTER__', `/api/frame?after=0&t=${t}`)), 'text/html; charset=utf-8');
    }
    const no = this.allowed(req, path, args);
    if (no) return no;
    if (path === '/api/controls') return this.send(200, this._controls ??= controlsDoc(this.tables));
    if (path === '/api/screens') return this.send(200, screensDoc());
    if (path === '/api/status') {
      const after = intArg(args, 'after');
      if (after === null) return this.send(400, { error: 'after' });
      return this.waitFor(() => pl.status_seq > after || pl.stop, 25).then(() => this.send(200, pl.status_doc));
    }
    if (path === '/api/frame') {
      const after = intArg(args, 'after');
      if (after === null) return this.send(400, { error: 'after' });
      return this.waitFor(() => (pl.frame_seq > after && pl.frame) || pl.stop, 25).then(() => this.frameResponse(after));
    }
    if (path === '/api/log') return this.send(200, { inputs: [...pl.log] });
    if (path === '/api/model') return this.send(200, modelDoc(MODEL));
    return this.send(404, { error: 'not found' });
  }
  frameResponse(after) {
    const pl = this.player, fr = pl.frame, seq = pl.frame_seq;
    if (!fr || seq <= after) return this.send(204, new Uint8Array(0), 'text/plain', [['X-Frame-Seq', String(seq)]]);
    const [, dev, lab_ns, sha] = fr;
    const r = this.raw;
    if (!r || r.meta.seq !== seq || r.meta.sha16 !== sha) throw new Error(`playapi: frame ${seq} (${sha}) has no composite (the host did not pass env.onFrame to the router)`);
    if (this.opts.framePng) {
      return this.send(200, this.opts.framePng(r.w, r.h, r.raw, sha), 'image/png', [['X-Frame-Seq', String(seq)], ['X-Device', dev],
        ['X-Lab-Ns', String(lab_ns)], ['X-Frame-Sha', sha]]);
    }
    if (!this.frameRgba) throw new Error('playapi: no frameRgba converter');
    return this.send(200, this.frameRgba(r.w, r.h, r.raw), 'application/octet-stream', [['X-Frame-Seq', String(seq)], ['X-Device', dev],
      ['X-Lab-Ns', String(lab_ns)], ['X-Frame-Sha', sha], ['X-Frame-Width', String(r.w)], ['X-Frame-Height', String(r.h)]]);
  }
  post(req, path, args) {
    const pl = this.player;
    const no = this.allowed(req, path, args);
    if (no) return no;
    let body = readBody(req.body ?? '');
    if (body === undefined) return this.send(400, { error: 'json' });
    if (path === '/api/input' || path === '/api/token') {
      if (!isDict(body)) return this.send(400, { error: `an input is a JSON object, not ${jsonType(body)}` });
      // ?timeout=S: how long a ?sync=1 request waits for its result, in seconds (a decimal number; 0 or less: not at all)
      const timeout = Object.hasOwn(args, 'timeout') ? decimalNumber(args.timeout) : 300;
      if (timeout === null) return this.send(400, { error: 'timeout' });
      if (path === '/api/token') {
        if (!pl.a.debug_api) return this.send(403, { error: '--debug-api' });
        body = { type: 'token', token: Object.hasOwn(body, 'token') ? body.token : '' };
      }
      // a quit control stops the loop when it runs, in queue order
      const seq = pl.submit(body);
      this.opts.onSubmit?.(seq);
      if (args.sync === '1') return pl.wait_result(seq, timeout).then((res) => this.send(200, { seq, result: res }));
      return this.send(200, { seq });
    }
    if (path === '/api/pagetest') {
      if (!pl.a.debug_api) return this.send(403, { error: '--debug-api' });
      this.opts.onPagetest?.(body);
      return this.send(200, { ok: true });
    }
    if (path === '/api/quit') {
      this.quit();
      return this.send(200, { ok: true });
    }
    if (path === '/api/model') {
      const code = isDict(body) ? body.model : undefined;
      if (typeof code !== 'string' || !Object.hasOwn(MODELS, code)) return this.send(400, { error: 'model' });
      if (code === MODEL) return this.send(200, modelDoc(MODEL));
      if (!this.opts.onSwitch) return this.send(501, { error: 'switch' });
      return Promise.resolve(this.opts.onSwitch(code)).then((why) => {
        if (why) return this.send(409, { error: 'switch', reason: why });
        this.quit();
        return this.send(200, { model: code, switching: true });
      });
    }
    return this.send(404, { error: 'not found' });
  }
  // queued, no stop here: the loop always runs it, after the inputs before it
  quit() {
    const pl = this.player;
    pl.enqueue({ type: 'control', op: 'quit', seq: 0, t_wall: pl.wall() });     // queued as it is: seq 0, no input seq
    this.opts.onSubmit?.(0);
  }
}
