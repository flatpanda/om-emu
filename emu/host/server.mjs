// The node host's HTTP front: node:http on 127.0.0.1, every request answered by the shared
// router (src/lab/playapi.mjs PlayApi) on the main thread, and the PNG frames (filter 0 rows, zlib level
// 1, RGB by src/lab/display.mjs ycc_to_rgb), cached by composite sha (PNG_CACHE), and the card pictures' PNGs
// (pngRgba). What node's own HTTP parser answers
// before the router (a malformed request line or header) and the environment headers (Server, Date, Connection /
// Keep-Alive) are declared differences. Node-only (host/).
import http from 'node:http';
import zlib from 'node:zlib';
import { ycc_to_rgb } from '../src/lab/display.mjs';
import { PNG_CACHE } from '../src/lab/player.mjs';
import { LabError } from '../src/lab/errors.mjs';
import { stackOf } from '../checks/lib/errors.mjs';

function chunk(kind, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
// The PNG of the composite's raw little-endian words (png_raw). Another deflate implementation may give a different
// stream for the same rows, so frames are compared by their decoded pixels.
export function pngRaw(w, h, raw) {
  const words = new Uint32Array(raw.buffer, raw.byteOffset, w * h);
  const rows = Buffer.alloc(h * (3 * w + 1));
  const cache = new Map();
  for (let y = 0, o = 0; y < h; y++) {
    rows[o++] = 0;
    for (let x = 0; x < w; x++) {
      const wd = words[y * w + x] & 0xFFFFFF;
      let c = cache.get(wd);
      if (c === undefined) { c = ycc_to_rgb(wd); cache.set(wd, c); }
      rows[o++] = c[0]; rows[o++] = c[1]; rows[o++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}
// The PNG (RGB, filter 0 rows, zlib level 1) of RGBA bytes, alpha dropped: a card picture the router decoded
// (src/lab/playapi.mjs /api/card/image, web/cardfiles.mjs jpegRgba)
export function pngRgba(w, h, rgba) {
  if (rgba.length !== 4 * w * h) throw new Error(`pngRgba: ${rgba.length} bytes for ${w}x${h}`);
  const rows = Buffer.alloc(h * (3 * w + 1));
  for (let y = 0, o = 0, i = 0; y < h; y++) {
    rows[o++] = 0;
    for (let x = 0; x < w; x++, i += 4) { rows[o++] = rgba[i]; rows[o++] = rgba[i + 1]; rows[o++] = rgba[i + 2]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}
// PERF2's cache: the last PNG_CACHE PNGs by (width, height, sha16), oldest first.
export function pngCache() {
  const pngs = new Map();
  return (w, h, raw, sha) => {
    const k = `${w}x${h}:${sha}`;
    let png = pngs.get(k);
    if (png !== undefined) pngs.delete(k); else png = pngRaw(w, h, raw);
    pngs.set(k, png);
    while (pngs.size > PNG_CACHE) pngs.delete(pngs.keys().next().value);
    return png;
  };
}

// The server: every request through api.handle({method, path (as the request line has it), headers (the first of each
// name), body}). A POST's Host, token and Origin are checked on its headers before its body is read (a refused body is
// never read, and since what follows it on the connection is not a request, the connection is closed after the 403);
// the body is Content-Length bytes (none without the header); a LabError the handler raises (from the router, such as
// a failed /api/pagetest write) is reported on stderr with its stack (handleError), the request unanswered and its
// connection closed, the server running on (rc unchanged). Any other error is a bug of the server (onBug: the host
// exits 1).
// The checks compare Host, X-Token and Origin exactly as the client sent them, trailing spaces and tabs included (only
// the leading ones and the line end go). llhttp drops trailing white space, from rawHeaders too, so a value with it
// would pass the checks. The server therefore reads each request's header block from the connection's own bytes (a
// 'data' listener beside node's parser, which then reads the same chunks), in request order: the first value of each
// header name. Framing follows Content-Length; a request with Transfer-Encoding (node frames it) ends the tap for its
// connection, and those requests keep node's values: that framing difference is declared with node's other parser
// differences.
const TAP = Symbol('header tap');
function tapHeads(socket) {
  const q = [];
  let buf = Buffer.alloc(0), skip = 0, dead = false;
  socket.prependListener('data', (d) => {         // before node's parser, which emits the request on this chunk
    if (dead) return;
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    for (;;) {
      if (skip) { const k = Math.min(skip, buf.length); buf = buf.subarray(k); skip -= k; if (skip) return; }
      while (buf.length >= 2 && buf[0] === 0x0d && buf[1] === 0x0a) buf = buf.subarray(2);      // llhttp skips empty lines
      const e = buf.indexOf('\r\n\r\n');
      if (e < 0) return;
      const lines = buf.subarray(0, e).toString('latin1').split('\r\n');
      buf = buf.subarray(e + 4);
      const h = new Map();
      for (const l of lines.slice(1)) {
        const c = l.indexOf(':');
        if (c < 0) continue;
        const n = l.slice(0, c).toLowerCase();
        if (!h.has(n)) h.set(n, l.slice(c + 1).replace(/^[ \t]+/, ''));
      }
      q.push(h);
      if (h.has('transfer-encoding')) { dead = true; return; }
      skip = Number.parseInt(h.get('content-length') ?? '0', 10) || 0;
    }
  });
  return q;
}
export function createPlayServer(api, { onBug } = {}) {
  const srv = http.createServer({ requireHostHeader: false, requestTimeout: 0, headersTimeout: 0, keepAliveTimeout: 0, joinDuplicateHeaders: false },
    (req, res) => {
      const headers = {};
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const n = req.rawHeaders[i];
        if (!Object.keys(headers).some((k) => k.toLowerCase() === n.toLowerCase())) headers[n] = req.rawHeaders[i + 1];
      }
      const raw = req.socket[TAP]?.shift();          // this request's header block as sent (tapHeads)
      if (raw) for (const k of Object.keys(headers)) if (['host', 'x-token', 'origin'].includes(k.toLowerCase()) && raw.has(k.toLowerCase())) headers[k] = raw.get(k.toLowerCase());
      const answer = (r) => {
        res.writeHead(r.status, r.headers.flat());
        res.end(r.body);
      };
      const failed = (e) => {
        if (e instanceof LabError) handleError(e, req.socket);
        else onBug?.(e);
        res.destroy();
      };
      const refused = api.refused({ method: req.method, path: req.url, headers });
      if (refused) {
        res.writeHead(refused.status, refused.headers.flat());
        res.end(refused.body, () => { if (!req.complete) req.socket.destroy(); });
        return;
      }
      const sized = Object.keys(headers).some((k) => k.toLowerCase() === 'content-length');
      const chunks = [];
      req.on('data', (c) => { if (sized) chunks.push(c); });
      req.on('end', async () => {
        let r;
        try {
          r = await api.handle({ method: req.method, path: req.url, headers, body: new Uint8Array(Buffer.concat(chunks)) });
        } catch (e) { failed(e); return; }
        answer(r);
      });
    });
  srv.on('connection', (socket) => { socket[TAP] = tapHeads(socket); });
  srv.timeout = 0;
  return srv;
}
// A request's error: the client's address, then the error's stack and notes.
export function handleError(e, socket) {
  try { process.stderr.write(`play: the request from ${socket?.remoteAddress ?? '127.0.0.1'}:${socket?.remotePort ?? 0} failed\n${stackOf(e)}\n`); } catch { /* the terminal is gone */ }
}
