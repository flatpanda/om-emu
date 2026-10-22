// The node host's lab thread: the play loop, Player.run, synchronous in a
// worker_threads Worker, its input queue a PortQueue (blocking q.get), stop and signalled in shared memory. Everything
// the Player publishes is serialized here as JSON text and posted to the
// main thread on one port in the Player's order: status, frame (the composite's bytes, transferred), result, log, logfix,
// logtrim, stop, then done or crash. The session log files are written here (session.jsonl appended per flush,
// session.json at the end). Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { workerData, parentPort } from 'node:worker_threads';
import { loadImage, loadBlock, createHash } from '../checks/lib/env.mjs';
import { Player } from '../src/lab/player.mjs';
import { PortQueue, F_KILL } from './portqueue.mjs';
import { stackOf } from '../checks/lib/errors.mjs';
import { installChildTrace, tracedPlay } from '../checks/lib/childtrace.mjs';
import { fileNvram } from './nvram.mjs';

const { args: a, flags, port, out, argv } = workerData;
const post = (m, transfer) => parentPort.postMessage(m, transfer);
export const wallClock = () => Number(process.hrtime.bigint()) / 1e9;    // monotonic seconds, one clock on every thread
// an input as the main thread posted it: its JSON text plus seq and t_wall
const decode = (m) => ({ ...JSON.parse(m.text), seq: m.seq, t_wall: m.t_wall });
const queue = new PortQueue(port, flags, decode);

function sink(name, text) {
  try {
    if (name === 'session.jsonl') fs.appendFileSync(path.join(out, name), text);
    else fs.writeFileSync(path.join(out, name), text);
  } catch { /* a failed write is dropped, as flush_log / write_log */ }
}
// OM_CHILD_TRACE (golden traces of child labs, checks/lib/childtrace.mjs): every lab of an --idle off or --replay session traced in this
// thread, written when the loop ends (argv: the server's own command line, from the main thread)
const trace = tracedPlay(argv) ? installChildTrace({ argv, install: false }) : null;
const env = {
  rom: loadImage(), resBlock: loadBlock(), createHash, ...(trace?.fields ?? {}),
  deflate: (b, level) => new Uint8Array(zlib.deflateSync(b, { level })),
  wallClock, queue, flags,
  readReplay: (p) => fs.readFileSync(p, 'utf8'),
  logSink: sink,
  labKills: () => Atomics.load(flags, F_KILL),
  onStatus: (doc) => post({ type: 'status', seq: doc.seq, text: JSON.stringify(doc) }),
  onFrame: (w, h, raw, meta) => { const b = raw.slice(); post({ type: 'frame', ...meta, w, h, raw: b }, [b.buffer]); },
  onResult: (seq, res) => post({ type: 'result', seq, text: JSON.stringify(res) }),
  onStop: () => post({ type: 'stop' }),
  onLogEntry: (e) => post({ type: 'log', idx: e.idx, text: JSON.stringify(e) }),
  onLogUpdate: (e) => post({ type: 'logfix', idx: e.idx, text: JSON.stringify(e) }),
  onLogTrim: (n) => post({ type: 'logtrim', n }),
  // OM_EMU_NVRAM=FILE: the camera keeps its settings and clock between sessions in FILE (menu.mjs S-NVRAM)
  ...(process.env.OM_EMU_NVRAM ? { nvram: fileNvram(process.env.OM_EMU_NVRAM) } : {}),
};
let pl = null;
try {
  pl = new Player(a, env);
  pl.run();
  post({ type: 'done', rc: 0 });
} catch (e) {
  // a failure nothing catches (a bug, an Unported path, a malformed --replay file) ends the loop; the host prints it
  // and exits 1
  post({ type: 'crash', stack: stackOf(e) });
} finally {
  trace?.finish();
}
