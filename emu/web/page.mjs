// The page side of the browser player: starts web/worker.mjs, hands it the firmware File (from the file input; the
// bytes stay in this browser) and answers the page's API calls the way the play server (bin/play.mjs) does, over
// postMessage. api(path, body) replaces play.html's fetch-based api(): it returns a Response-like object ({ok, status,
// headers: {get}, json(), text()}, plus `frame` = {w, h, rgba} for a 200 /api/frame). The status and frame long polls
// (GET /api/status?after=N, /api/frame?after=N, 25 s) and GET /api/log are answered here from what the Worker pushed
// (every published status, the newest frame, the session-log entries), so they never wait for a busy Worker, as
// the node host's HTTP front never waits for the Player; every other request goes to the Worker's router
// (src/lab/playapi.mjs) with the page's send time (t_page), which becomes the input's t_wall. Once the Worker's loop
// has stopped, a poll answers what is still new (the 'stopped' status, a last frame) and then rejects, as play.html's
// fetch fails once the server is gone, so the page's poll loops end through their error path instead of resolving at
// once forever.
import { createHash } from '../src/util/sha256.mjs';

const dec = new TextDecoder();
const now = () => (performance.timeOrigin + performance.now()) / 1000;

function response(status, headers, body, frame = null) {
  const h = new Map(headers.map(([k, v]) => [k.toLowerCase(), v]));
  const text = () => (body instanceof Uint8Array ? dec.decode(body) : String(body ?? ''));
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, frame,
    text: async () => text(), json: async () => JSON.parse(text()) };
}
const jsonRes = (status, doc) => response(status, [['Content-Type', 'application/json']], new TextEncoder().encode(JSON.stringify(doc)));

export class PagePlayer {
  constructor(workerUrl = new URL('./worker.mjs' + (typeof location !== 'undefined' ? location.search : ''), import.meta.url)) {
    this.workerUrl = workerUrl;
    this.worker = null;
    this.status = null;          // the newest status document
    this.frame = null;           // {seq, device, lab_ns, sha16, w, h, rgba, rgba_sha16}
    this.log = [];               // the session log as the Player keeps it in memory
    this.waiters = [];           // [pred, resolve, timer]
    this.pending = new Map();    // req id -> resolve
    this.nextId = 1;
    this.stopped = false;
    this.bootFailed = null;      // {type: 'boot-failed', message}: the Worker's boot ended before the Player started
    this.events = [];            // progress and error messages (the page's status line, the gate)
    this.frameStats = [];        // per frame: the Worker's RGBA conversion and the post-to-receive time, ms
    this.sent = [];              // the bodies of the POSTs to /api/input, in send order (the gate replays them in node)
    this.onEvent = null;
  }
  start() {
    this.worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker.onmessage = (e) => this.message(e.data);
    this.worker.onerror = (e) => this.message({ type: 'error', message: `worker: ${e.message}` });
  }
  boot(file, args) {
    if (!this.worker) this.start();
    this.bootFailed = null;
    this.worker.postMessage({ type: 'boot', file: file ?? undefined, args });
  }
  message(m) {
    if (m.type === 'status') { this.status = m.doc; this.wakeAll(); return; }
    if (m.type === 'frame') {
      this.frame = m;
      this.frameStats.push({ seq: m.seq, conv_ms: m.conv_ms, transit_ms: (now() - m.t_post) * 1000 });
      if (this.frameStats.length > 1000) this.frameStats.shift();
      this.wakeAll();
      return;
    }
    if (m.type === 'log') {
      for (const e of m.entries) {                // Player.log_input: past 20,000 entries the first 1,000 go
        this.log.push(e);
        if (this.log.length > 20000) this.log.splice(0, 1000);
      }
      return;
    }
    if (m.type === 'res') { const r = this.pending.get(m.id); this.pending.delete(m.id); if (r) r(response(m.status, m.headers, m.body)); return; }
    if (m.type === 'stopped') { this.stopped = true; this.wakeAll(); }
    if (m.type === 'boot-failed') { this.bootFailed = m; this.wakeAll(); }
    this.events.push(m);
    if (this.onEvent) this.onEvent(m);
  }
  wakeAll() {
    const keep = [];
    for (const x of this.waiters) { if (x[0]()) { clearTimeout(x[2]); x[1](); } else keep.push(x); }
    this.waiters = keep;
  }
  waitFor(pred, ms) {
    if (pred()) return Promise.resolve();
    return new Promise((resolve) => {
      const x = [pred, resolve, null];
      x[2] = setTimeout(() => { this.waiters = this.waiters.filter((y) => y !== x); resolve(); }, ms);
      this.waiters.push(x);
    });
  }
  ackFrame(seq) { this.worker?.postMessage({ type: 'frame-ack', seq }); }
  // play.html's api(path, body): GET without a body, POST with one.
  async api(path, body) {
    const [p, q] = path.split('?');
    const args = new URLSearchParams(q ?? '');
    if (body === undefined && (p === '/api/status' || p === '/api/frame')) {
      const after = Number(args.get('after') || 0);
      if (!Number.isInteger(after)) return jsonRes(400, { error: 'after' });
      if (p === '/api/status') {
        await this.waitFor(() => (this.status && this.status.seq > after) || this.stopped, 25000);
        if (!this.status) return jsonRes(503, { error: 'no session yet' });
        if (this.stopped && this.status.seq <= after) throw new Error(`${p}: the session has stopped`);
        return jsonRes(200, this.status);
      }
      await this.waitFor(() => (this.frame && this.frame.seq > after) || this.stopped, 25000);
      const f = this.frame;
      if (this.stopped && (!f || f.seq <= after)) throw new Error(`${p}: the session has stopped`);
      if (!f || f.seq <= after) return response(204, [['X-Frame-Seq', String(f ? f.seq : 0)]], '');
      return response(200, [['X-Frame-Seq', String(f.seq)], ['X-Device', f.device], ['X-Lab-Ns', String(f.lab_ns)], ['X-Frame-Sha', f.sha16]], '', { w: f.w, h: f.h, rgba: f.rgba });
    }
    if (body === undefined && p === '/api/log') return jsonRes(200, { inputs: this.log });
    if (!this.worker) throw new Error(`${path}: no Worker`);
    if (p === '/api/input' && body !== undefined) this.sent.push(body);
    const id = this.nextId++;
    const res = new Promise((resolve) => this.pending.set(id, resolve));
    this.worker.postMessage({ type: 'req', id, method: body === undefined ? 'GET' : 'POST', path, body: body === undefined ? undefined : JSON.stringify(body), t_page: now() });
    return res;
  }
  // sha256 (16 hex digits) of RGBA bytes (the gate's canvas check)
  static sha16(bytes) { return createHash('sha256').update(bytes).digest('hex').slice(0, 16); }
}
