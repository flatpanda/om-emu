// The browser player's Worker (a module Worker): the same session code as node, the Player paced against the host
// clock, and the play API over postMessage. The protocol (shared with the node host's server, which hosts this code in a
// worker thread):
//   page -> worker  {type: 'boot', file?, args?}            the .BIN as a File (never uploaded), or the OPFS cache;
//                                                            args: the page's options (playerArgs), and the env
//                                                            opt-ins lens: 'native' and nvram: true (S-NVRAM in OPFS)
//                   {type: 'clear-nvram'}                    forget S-NVRAM's kept document (progress nvram-cleared)
//                   {type: 'req', id, method, path, body, t_page}   an API request (src/lab/playapi.mjs); t_page: the
//                                                            page's send time in seconds (timeOrigin + now), the t_wall
//                                                            of an input it submits
//                   {type: 'frame-ack', seq}                 the page drew frame seq: the next one may be sent
//                   {type: 'clear-cache'}, {type: 'quit'}   quit: the loop stops after its tick, as a signal stops
//                                                            bin/play.mjs (/api/quit is a queued control instead: 3d)
//                   {type: 'gate', job, file?}               bin/webgate.mjs only: run web/runner.mjs (no Player)
//   worker -> page  {type: 'progress', stage, ...}, {type: 'error', message, stack}  (stage nvram-error: a kept
//                                                            settings write failed, the session runs on)
//                   {type: 'status', doc}                    every published status (status_doc)
//                   {type: 'frame', seq, device, lab_ns, sha16, w, h, rgba, rgba_sha16}   the newest frame, its RGBA
//                                                            buffer transferred; one in flight until acknowledged
//                   {type: 'log', entries}                   the session-log entries as the Player flushes them
//                   {type: 'res', id, status, headers, body}  the answer to a req
//                   {type: 'boot-failed', message}           the boot ended before the Player started (the wrong
//                                                            file, an empty or damaged cache): boot may be sent again
//                   {type: 'stopped'}                        the loop ended (the session closed, the log written)
// Inputs that arrive during a tick wait in the event loop, as they wait in the node host's queue; every outbound event
// is posted from inside the tick, and a busy Worker's postMessage is delivered at once, so the page sees status and
// frames while a long input runs (the page answers the status and frame long polls from what was pushed).
import { labFirmware } from '../src/fw/labfw.mjs';
import { MODEL_INFO } from '../src/fw/model.mjs';
import { createHash } from '../src/util/sha256.mjs';
import { Player } from '../src/lab/player.mjs';
import { Tables } from '../src/lab/play.mjs';
import { PlayApi } from '../src/lab/playapi.mjs';
import { PLAYER_PARSER } from '../scenarios/session_replay.mjs';
import { Driver } from './driver.mjs';
import { rgbaOf } from './frame.mjs';
import * as OPFS from './opfs.mjs';
import { runScenario, playWorkload } from './runner.mjs';
import { blobs } from '../src/lab/resources.mjs';
import { CARD_VIEW, jpegRgba } from './cardfiles.mjs';
import { browserNvram } from './nvram.mjs';

const wallClock = () => (performance.timeOrigin + performance.now()) / 1000;
const post = (m, transfer = []) => postMessage(m, transfer);
let player = null, api = null, driver = null, frameOut = null, framePending = false, booting = false;

// The two blocks: from the File (walk, descramble, verify every checksum, check the main code block is the model's,
// cut the resource block to its prefix, check it, cache both) or from the OPFS cache (verified against its manifest,
// which must name the model's digests). T: timings in ms.
async function firmware(file, { cache = true } = {}) {
  const T = {};
  let t = performance.now();
  const lap = (k) => { const n = performance.now(); T[k] = Math.round(n - t); t = n; };
  if (file) {
    const read = async (off, len) => new Uint8Array(await file.slice(off, off + len).arrayBuffer());
    post({ type: 'progress', stage: 'unpack', name: file.name, size: file.size });
    const fw = await labFirmware(read, file.size, createHash, { onBlock: (flags, ms) => post({ type: 'progress', stage: 'block', flags, ms: Math.round(ms) }) });
    lap('unpack');
    let manifest = null;
    if (cache) {
      manifest = await OPFS.store(fw.rom, fw.res, { bin: { name: file.name, size: file.size, lastModified: file.lastModified }, res_full: fw.res_full }, createHash,
        { rom: fw.rom_sha256, res: fw.res_sha256 });
      lap('opfs_write');
    }
    return { rom: fw.rom, res: fw.res, from: 'file', manifest, T };
  }
  const c = await OPFS.load(createHash);
  lap('opfs_read');
  if (!c) throw new Error(`no firmware: choose the camera's .BIN file (${MODEL_INFO.bin}); it is read here and never uploaded`);
  return { rom: c.rom, res: c.res, from: 'cache', manifest: c.manifest, T };
}

// The page's query string as play.mjs's command line (the options that move the lab; --no-browser, no --out).
function playerArgs(q = {}) {
  const a = { ...PLAYER_PARSER, no_browser: true, out: '<out>', no_wait_on_error: false };
  for (const k of ['lang', 'device', 'a15', 'start', 'tab', 'idle', 'touch', 'us_clock', 'compose', 'hdmi']) if (typeof q[k] === 'string') a[k] = q[k];
  for (const k of ['no_bgdraw', 'debug_api']) if (q[k] !== undefined) a[k] = !!q[k];
  if (q.x_trim_keep !== undefined) a.x_trim_keep = q.x_trim_keep;
  return a;
}

function sendFrame() {
  const f = frameOut;
  if (!f || framePending) return;
  frameOut = null;
  framePending = true;
  const t0 = performance.now();
  const rgba = rgbaOf(f.w, f.h, f.raw);
  const conv_ms = performance.now() - t0;
  post({ type: 'frame', ...f.meta, w: f.w, h: f.h, rgba, rgba_sha16: createHash('sha256').update(rgba).digest('hex').slice(0, 16), conv_ms, t_post: wallClock() }, [rgba.buffer]);
}

async function boot(msg) {
  if (booting || player) throw new Error(`boot: the Player is already ${player ? 'running (a restart is a new Worker)' : 'starting'}`);
  booting = true;
  let a;
  try {
    const fw = await firmware(msg.file ?? null, { cache: msg.cache !== false });
    post({ type: 'progress', stage: 'firmware', from: fw.from, rom: fw.rom.length, res: fw.res.length, manifest: fw.manifest, T: fw.T });
    a = playerArgs(msg.args);
    // the opt-ins the lab takes in its env (the page's lens=native and nvram=1): the lens natively (src/lab/play.mjs
    // lens_native), the camera's state kept in this browser (S-NVRAM, web/nvram.mjs)
    const lens = msg.args?.lens === 'native';
    const nvram = msg.args?.nvram ? browserNvram(await OPFS.loadNvram(), OPFS.storeNvram,
      (e) => post({ type: 'progress', stage: 'nvram-error', message: String(e?.message ?? e) }), `this browser (OPFS ${OPFS.NVRAM_DIR})`) : null;
    const env = {
      rom: fw.rom, resBlock: fw.res, createHash, wallClock, asyncHost: true, refuseUnported: true,
      cardView: CARD_VIEW,                // the Card panel's reads of the card's files (web/cardfiles.mjs)
      ...(lens ? { lens: 'native' } : {}), ...(nvram ? { nvram } : {}),
      onStatus: (doc) => { post({ type: 'status', doc }); api?.notify(); },
      onFrame: (w, h, raw, meta) => {
        api.onFrame(w, h, raw, meta);
        frameOut = { w, h, raw: api.raw.raw, meta };
        sendFrame();
        api.notify();
      },
      logSink: (name, text) => { if (name === 'session.jsonl') post({ type: 'log', entries: text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) }); },
    };
    player = new Player(a, env);
    api = new PlayApi(player, { tables: Tables.of(fw.rom), frameRgba: (w, h, raw) => rgbaOf(w, h, raw), onSubmit: () => driver?.kick(),
      cardImage: jpegRgba, session: { host: 'browser', lens: lens ? 'native' : 'stand-in', nvram: nvram ? nvram.file : null, card: null } });
    driver = new Driver(player);
  } catch (err) {                       // nothing started: the page may boot again (another file, the cache)
    player = api = driver = null;
    post({ type: 'boot-failed', message: String(err?.message ?? err) });
    throw err;
  } finally { booting = false; }
  post({ type: 'progress', stage: 'session', args: a });
  try {
    await driver.run();
  } finally {
    // as main()'s finally does: stop (every ?sync=1 waiter answers, with result null when its input never ran, also
    // after a loop that ended on a bug) and the status says 'stopped'
    player.set_stop();
    player.notify();                    // main()'s cv.notify_all()
    player.phase = 'stopped';
    player.status_seq += 1;
    player.status_doc = { ...player.status_doc, phase: 'stopped', seq: player.status_seq };
    post({ type: 'status', doc: player.status_doc });
    api.notify();
    post({ type: 'stopped' });
  }
}

async function request(msg) {
  const pl = player;
  if (!pl) { post({ type: 'res', id: msg.id, status: 503, headers: [], body: new TextEncoder().encode(JSON.stringify({ error: 'no session yet' })) }); return; }
  // the input's t_wall is the page's send time: the Player reads its wall clock in submit
  const wall = pl.wall;
  if (typeof msg.t_page === 'number') pl.wall = () => msg.t_page;
  let res;
  try { res = api.handle({ method: msg.method, path: msg.path, headers: msg.headers ?? {}, body: msg.body }); } finally { pl.wall = wall; }
  api.notify();
  driver.kick();
  res = await res;
  post({ type: 'res', id: msg.id, status: res.status, headers: res.headers, body: res.body }, [res.body.buffer]);
}

async function gate(msg) {
  const fw = await firmware(msg.file ?? null, { cache: msg.cache !== false });
  const job = msg.job, t0 = performance.now();
  let slices = 0;
  const env = { rom: fw.rom, resBlock: fw.res, createHash, ...(job.slice ? { slice: job.slice, onSlice: () => { slices++; } } : {}) };
  let out;
  if (job.name === 'play-perf-workload') out = playWorkload(env);
  else if (job.name === 'lz4') {                  // the LZ4 decode of the two resource blobs (resources.blobs), timed
    const t = performance.now(), b = blobs(fw.res);
    out = { ms: Math.round(performance.now() - t), sizes: b.map(([, d]) => d.length) };
  } else out = runScenario(job.name, env, job.calls ?? null);
  post({ type: 'gate-result', from: fw.from, T: fw.T, slices, ms: Math.round(performance.now() - t0), out,
    rom_sha16: createHash('sha256').update(fw.rom).digest('hex').slice(0, 16), res_len: fw.res.length });
}

onmessage = (e) => {
  const msg = e.data;
  const fail = (err) => post({ type: 'error', message: String(err?.message ?? err), stack: String(err?.stack ?? '') });
  try {
    if (msg.type === 'boot') boot(msg).catch(fail);
    else if (msg.type === 'req') request(msg).catch(fail);
    else if (msg.type === 'frame-ack') { if (msg.seq !== undefined) framePending = false; sendFrame(); }
    else if (msg.type === 'gate') gate(msg).catch(fail);
    else if (msg.type === 'clear-cache') OPFS.clear().then(() => post({ type: 'progress', stage: 'cache-cleared' }), fail);
    else if (msg.type === 'cache-info') OPFS.info().then((m) => post({ type: 'progress', stage: 'cache', manifest: m }), fail);
    else if (msg.type === 'clear-nvram') OPFS.clearNvram().then(() => post({ type: 'progress', stage: 'nvram-cleared' }), fail);
    else if (msg.type === 'quit') { if (player) { player.set_stop(); driver.kick(); } }
    else fail(new Error(`worker: message type ${msg.type}`));
  } catch (err) { fail(err); }
};
