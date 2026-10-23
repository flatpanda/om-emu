// The play tool on node: its command line, the HTTP server and the PlayerProxy
// on the main thread, Player.run in the lab worker (host/labworker.mjs), the URL line, the signals, the browser, and the
// stop: the 'stopped' status, every waiter answered, the server closed, the stopped line. A switch of the model (POST
// /api/model, src/lab/playapi.mjs) stops the session the same way and then re-executes this process on the chosen
// model (process.execve: the main thread's tables and the worker's lab are bound to the model fixed at import,
// src/fw/model.mjs), on the same port and with the same token (OM_EMU_PLAY_TOKEN), so the page reloads at its URL.
// Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Worker, MessageChannel } from 'node:worker_threads';
import { REPO, loadImage, exitFor } from '../checks/lib/env.mjs';
import { parseArgs } from '../checks/lib/args.mjs';
import { RuntimeError } from '../src/lab/errors.mjs';
import { MODEL } from '../src/fw/model.mjs';
import { MODELS } from '../src/fw/models.mjs';
import { Tables } from '../src/lab/play.mjs';
import { PlayApi } from '../src/lab/playapi.mjs';
import { newFlags } from './portqueue.mjs';
import { PlayerProxy, wallClock } from './proxy.mjs';
import { createPlayServer, pngCache } from './server.mjs';
import { installSignals, installLabKill } from './signals.mjs';
import { installMemProbe } from './memprobe.mjs';
import { stackOf } from '../checks/lib/errors.mjs';
import { provision } from './firmware.mjs';
import { blocksPresent } from './blobs.mjs';

export const PROG = 'play.mjs';
export const PAGE = path.join(REPO, 'emu/web/play.html');
export const OUT = path.join(REPO, 'emu/out/play', MODEL);
// The options, in the order session.json's args keep
export const ACTIONS = [
  { opt: '--lang', type: 'str', default: 'en' },
  { opt: '--device', type: 'str', choices: ['tft', 'evf'], default: 'tft' },
  { opt: '--evf-layout', type: 'flag', default: false },
  { opt: '--a15', type: 'str', bare: 'on', choices: ['auto', 'off', 'on'], default: 'auto' },
  { opt: '--start', type: 'str', choices: ['shooting', 'menu', 'none'], default: 'shooting' },
  { opt: '--tab', type: 'str', default: '7,1,1' },
  { opt: '--idle', type: 'str', choices: ['wall', 'off'], default: 'wall' },
  { opt: '--touch', type: 'str', choices: ['gui', 'driver', 'off'], default: 'gui' },
  { opt: '--us-clock', type: 'str', choices: ['lab', 'reads'], default: 'lab' },
  { opt: '--hdmi', type: 'str', choices: ['off', 'on'], default: 'off' },
  { opt: '--no-bgdraw', type: 'flag', default: false },
  { opt: '--compose', type: 'str', choices: ['boundary', 'next'], default: 'boundary' },
  { opt: '--port', type: 'int', default: 0 },
  { opt: '--no-browser', type: 'flag', default: false },
  { opt: '--out', type: 'path', default: null },
  { opt: '--replay', type: 'path', default: null },
  { opt: '--debug-api', type: 'flag', default: false },
  { opt: '--x-mutant', type: 'str', default: null },
  { opt: '--x-trim-keep', type: 'int', default: null },
];
// The parsed options: every option's key in ACTIONS' order, then no_wait_on_error.
export function parsePlayArgs(argv) {
  const r = parseArgs(PROG, argv, ACTIONS);
  if ((r.x_mutant || r.x_trim_keep) && !r.debug_api) r.error('--x-mutant and --x-trim-keep need --debug-api');
  const a = {};
  for (const x of ACTIONS) {
    const k = x.opt.slice(2).replaceAll('-', '_');
    a[k] = r[k];
  }
  a.no_wait_on_error = false;
  if (a.replay) a.idle = 'off';
  return a;
}
const strftime = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
// After the terminal hung up, writes to stdout and stderr fail with EIO; they are dropped.
function quietStdio() {
  for (const s of [process.stdout, process.stderr]) s.on('error', () => {});
}
function say(line) {
  try { process.stdout.write(line + '\n'); } catch { /* EIO: the terminal is gone */ }
}
// An error nothing caught: its stack and notes (stackOf). text: that, or the lab worker's crash message's.
function report(text) {
  try { process.stderr.write(`${text}\n`); } catch { /* gone */ }
}

export async function main(argv) {
  let a;
  try { a = parsePlayArgs(argv); } catch (e) { return exitFor(PROG, e); }
  const fw = await provision(PROG);     // the model's firmware on first use; nothing printed when it is there
  if (fw) return fw;
  quietStdio();
  if (a.evf_layout) say('play: --evf-layout is a no-op since M10B (an EVF start and every switch draw the EVF layout)');
  const out = a.out ?? path.join(OUT, strftime(new Date()));
  fs.mkdirSync(out, { recursive: true });
  const token = process.env.OM_EMU_PLAY_TOKEN || crypto.randomBytes(16).toString('base64url');    // a switch's: the page's
  delete process.env.OM_EMU_PLAY_TOKEN;                // before the lab worker copies process.env
  const flags = newFlags();
  const { port1, port2 } = new MessageChannel();
  const proxy = new PlayerProxy(a, flags, port1, { wall: wallClock });
  const holder = { port: 0 };
  const check = { token, get port() { return holder.port; }, noHost: a.x_mutant === 'no-host-check' };
  const rom = loadImage();
  let switchTo = null, trying = null;
  // POST /api/model: a reason to refuse, or null (the switch is taken: playapi queues the quit). A switch never
  // downloads or unpacks (the page has no view of the terminal's progress), and starts a new session in the chosen
  // model's default out directory, so --out (its session.json would be overwritten) and --replay (the log is the old
  // model's) refuse it. A model the lab does not load on is refused before this session stops (labLoads).
  const onSwitch = async (code) => {
    if (switchTo || trying) return `already switching to ${switchTo ?? trying}`;
    if (a.out !== null || a.replay !== null) return `a session with ${a.out !== null ? '--out' : '--replay'} cannot switch: start ${PROG} --model ${code}`;
    if (!blocksPresent(MODELS[code])) return `no firmware for ${code} (${MODELS[code].name}): run node emu/bin/fetch-fw.mjs --model ${code}`;
    trying = code;
    const why = await labLoads(code);
    trying = null;
    if (why) return why;
    switchTo = code;
    return null;
  };
  const api = new PlayApi(proxy, { tables: Tables.of(rom), framePng: pngCache(), check, page: new Uint8Array(fs.readFileSync(PAGE)),
    onPagetest: (body) => {            // <out>/pagetest.json: a write that fails is the request's error (host/server.mjs)
      try { fs.writeFileSync(path.join(out, 'pagetest.json'), JSON.stringify(body)); } catch (e) { throw new RuntimeError(e.message); }
    },
    ...(typeof process.execve === 'function' ? { onSwitch } : {}) });       // execve: POSIX only
  proxy.api = api;
  let bug = null;
  const srv = createPlayServer(api, { onBug: (e) => { bug ??= e; } });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(a.port, '127.0.0.1', resolve); }).catch((e) => {
    report(`${PROG}: cannot listen on 127.0.0.1:${a.port}: ${e.message}`);
    process.exit(1);
  });
  holder.port = srv.address().port;
  const url = `http://127.0.0.1:${holder.port}/?t=${token}`;
  say(`play: ${url}`);
  say('Ctrl+C to quit');
  let worker = null, second = false;
  const probe = installMemProbe();            // OM_HOST_MEM: the main isolate's memory (host/memprobe.mjs)
  const finish = (rc, { log = true } = {}) => {
    clearInterval(probe);                     // null (no OM_HOST_MEM): a no-op
    proxy.stopped();
    srv.close();
    srv.closeIdleConnections();
    setTimeout(() => srv.closeAllConnections(), 1000).unref();
    port1.close();
    if (rc === 0 && log) say(`play: stopped; session log ${path.join(out, 'session.json')}`);
    process.exitCode = rc;
  };
  installSignals(flags, () => {        // a second signal: exit 130, no session.json
    if (second) return;
    second = true;
    worker?.terminate();
    finish(130, { log: false });
  });
  if (a.debug_api) installLabKill(flags);
  if (!a.no_browser) {             // the platform's opener
    const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    try {
      const c = spawn(cmd, args, { stdio: 'ignore', detached: true });
      c.on('error', () => {});
      c.unref();
    } catch { /* no opener: the URL line is printed */ }
  }
  // a 16 MB stack (node's default is 4 MB): headroom for a request body that nests deeply, should a message of the lab
  // show part of it
  worker = new Worker(new URL('./labworker.mjs', import.meta.url), { workerData: { args: a, flags, port: port2, out, argv }, transferList: [port2],
    resourceLimits: { stackSizeMb: 16 } });
  worker.on('message', (m) => proxy.onMessage(m));
  const ended = await new Promise((resolve) => {
    worker.on('error', (e) => resolve({ type: 'crash', stack: stackOf(e) }));
    worker.on('exit', () => resolve(proxy.ended ?? { type: 'crash', stack: 'Error: the lab worker exited without a result' }));
  });
  if (second) return 130;
  if (bug) report(stackOf(bug));
  if (ended.type === 'crash') {
    report(ended.stack);
    finish(1);
    return 1;
  }
  finish(bug ? 1 : 0);
  if (switchTo && !bug) await restart(srv, argv, switchTo, holder.port, token);
  return process.exitCode;
}

// Whether the lab loads on a model: a child node imports this module and the worker's Player there as bin/play.mjs
// does (host/modelarg.mjs importLab), so a model that throws at import (src/fw/board.mjs: a board fact its family
// lacks) is refused while this session runs instead of killing the re-executed server. null, or the child's refusal.
function labLoads(code) {
  const src = `import { importLab } from ${JSON.stringify(new URL('./modelarg.mjs', import.meta.url).href)};` +
    ['./playcli.mjs', '../src/lab/player.mjs'].map((u) => `await importLab(${JSON.stringify(PROG)}, ${JSON.stringify(new URL(u, import.meta.url).href)});`).join('');
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', src], { env: { ...process.env, OM_EMU_MODEL: code }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => resolve(`${code}: ${e.message}`));
    c.on('close', (rc) => resolve(rc === 0 ? null : err.trim().split('\n').pop().replace(`${PROG}: `, '') || `${code}: the lab's import exited ${rc}`));
  });
}

// The switch: once the server is closed and stdout flushed, this process becomes the same tool on the chosen model,
// with the user's options (argv without --model: the last --model and --port win) on the same port.
async function restart(srv, argv, code, port, token) {
  const closed = new Promise((resolve) => srv.once('close', resolve));     // finish() closed the listener just now
  srv.closeAllConnections();
  await closed;
  say(`play: switching to ${code} (${MODELS[code].name})`);
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.execve(process.execPath, [process.execPath, ...process.execArgv, process.argv[1], ...argv, '--model', code, '--port', String(port), '--no-browser'],
    { ...process.env, OM_EMU_PLAY_TOKEN: token });
}
