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
import { REPO, loadImage, exitFor, overlayPatches, patchedFirmware } from '../checks/lib/env.mjs';
import { PatchRefused, patchLine } from '../src/fw/patch.mjs';
import { startUnloaded, unloadedLine } from '../src/lab/patchaudit.mjs';
import { parseArgs } from '../checks/lib/args.mjs';
import { RuntimeError } from '../src/lab/errors.mjs';
import { MODEL, MODEL_INFO } from '../src/fw/model.mjs';
import { MODELS } from '../src/fw/models.mjs';
import { Tables } from '../src/lab/play.mjs';
import { replayPatchRefusal, replayNvramRecord } from '../src/lab/player.mjs';
import { nvramUnsupported } from '../src/lab/menu.mjs';
import { nvramChoice, fileNvram } from './nvram.mjs';
import { PlayApi } from '../src/lab/playapi.mjs';
import { newFlags } from './portqueue.mjs';
import { PlayerProxy, wallClock } from './proxy.mjs';
import { createPlayServer, pngCache, pngRgba } from './server.mjs';
import { jpegRgba } from '../web/cardfiles.mjs';
import { cardGiB, cardSectors } from '../src/lab/sdcard.mjs';
import { cardPut, CardFsError } from '../src/lab/cardfs.mjs';
import { fileCard } from './card.mjs';
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
  { opt: '--audio', type: 'str', choices: ['auto', 'off', 'on'], default: 'auto' },
  { opt: '--rotate', type: 'str', choices: ['off', 'on'], default: 'off' },
  { opt: '--take', type: 'str', choices: ['stand-in', 'probe'], default: 'stand-in' },
  { opt: '--cpu2', type: 'str', choices: ['stand-in', 'native'], default: 'stand-in' },
  { opt: '--creative-dial', type: 'int', default: null, metavar: 'K' },
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
// --patch FILE (repeatable): a patch overlay on the stock blocks (src/fw/patch.mjs), the lab's env rather than the
// Player's options (as OM_EMU_LENS and the others are), so it is not among session.json's args; the overlay's summary
// is its "patch" instead, and the status's.
const PATCH = { opt: '--patch', type: 'path', repeat: true, metavar: 'FILE' };
// --main FILE: a whole patched main code block (caduceus-om3's main.bin), the overlay that makes it from the stock
// block (checks/lib/env.mjs readMainFile), reported as --patch's; not with --patch, the env and session.json the same
const MAIN = { opt: '--main', type: 'path', metavar: 'FILE' };
// --nvram on|off|FILE: where the camera's non-volatile state is kept between sessions (S-NVRAM; host/nvram.mjs
// nvramChoice: on, the default, is the model's own file, ~/.om-emu/nvram-<model>.json, or with --patch or --main the
// patched build's own, ~/.om-emu/nvram-<model>-<its main block's sha256, 8 hex digits>.json; off a blank camera at each
// start), the lab's env too and not among session.json's args, whose nvram records what each session started from
const NVRAM = { opt: '--nvram', type: 'str', metavar: 'on|off|FILE' };
// --card-put DOS/PATH=LOCAL (repeatable): LOCAL's bytes written to the card at DOS/PATH before the first session's
// insertion mounts it (src/lab/cardfs.mjs withCardFiles, in the lab worker), on the card OM_EMU_CARD keeps, which must
// be one the firmware formatted (node emu/bin/card.mjs new); the lab's env too, not among session.json's args
const CARD_PUT = { opt: '--card-put', type: 'str', repeat: true, metavar: 'DOS/PATH=LOCAL' };
// --loaded auto|on|off: the loaded-ranges mode (S-STALERAM, src/lab/sim.mjs loadedRanges): the DRAM the boot does not
// load or is not shown to load holds a fill, and code run there stops the session; auto, the default, is on with
// --patch or --main on a body whose section loader the lab reads (E143, E146, E147), off otherwise. The lab's env too,
// not among session.json's args
const LOADED = { opt: '--loaded', type: 'str', choices: ['auto', 'on', 'off'], default: 'auto' };
// The parsed options: every option's key in ACTIONS' order, then no_wait_on_error; the --patch files, if any, as the
// non-enumerable patch, --main's file (null when not given) as the non-enumerable main, --nvram's value (null when
// not given) as the non-enumerable nvram, the --card-put items as the non-enumerable card_put ([] when none) and
// --loaded's as loaded.
export function parsePlayArgs(argv) {
  const r = parseArgs(PROG, argv, [...ACTIONS, PATCH, MAIN, NVRAM, CARD_PUT, LOADED]);
  if ((r.x_mutant || r.x_trim_keep) && !r.debug_api) r.error('--x-mutant and --x-trim-keep need --debug-api');
  if (r.main !== undefined && r.patch.length) r.error('--main and --patch exclude each other (--main is the whole change to the main code block)');
  const a = {};
  Object.defineProperty(a, 'patch', { value: r.patch });
  Object.defineProperty(a, 'main', { value: r.main ?? null });
  Object.defineProperty(a, 'nvram', { value: r.nvram ?? null });
  for (const item of r.card_put) if (!/^[^=]+=.+$/.test(item)) r.error(`--card-put ${item}: DOS/PATH=LOCAL`);
  Object.defineProperty(a, 'card_put', { value: r.card_put });
  Object.defineProperty(a, 'loaded', { value: r.loaded });
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
  // --patch (or --main): read, parsed and verified against the stock blocks here, before the server starts; the lab
  // worker applies the same patches (checked again) to its own blocks
  let patches = null, overlay = null;
  if (a.patch.length || a.main !== null) {
    try {
      patches = overlayPatches(a);
      overlay = patchedFirmware(patches);
    } catch (e) {
      if (!(e instanceof PatchRefused)) throw e;
      report(`${PROG}: ${a.main !== null ? '--main' : '--patch'} refused: ${e.message}`);
      return 1;
    }
  }
  // --replay of a session that ran on patched firmware (its session.json's patch) without --patch: refused here too,
  // before the server starts (src/lab/player.mjs replayPatchRefusal, which the Player applies again); a file that
  // cannot be read is the Player's to report
  let replayText = null;
  if (a.replay) {
    try { replayText = fs.readFileSync(a.replay, 'utf8'); } catch { /* the Player's read raises it */ }
  }
  if (a.replay && !patches) {
    const why = replayText === null ? null : replayPatchRefusal(a.replay, replayText, null);
    if (why !== null) {
      report(`${PROG}: ${why}`);
      return 1;
    }
  }
  // the camera's non-volatile state (S-NVRAM): kept by default in the model's file, --nvram / OM_EMU_NVRAM to choose,
  // checked here (a file of another model, or one that does not parse, is refused before the server starts); a
  // --replay's is its log's (the Player's: replayNvramRecord, in memory), never a file's
  // (patched firmware: the default file is the patched build's own, keyed by its main block's sha256)
  const nv = nvramChoice({ arg: a.nvram, env: process.env.OM_EMU_NVRAM || null, model: MODEL, unsupported: nvramUnsupported(),
    scpuNative: process.env.OM_EMU_SCPU === 'native' && !!MODEL_INFO.scpu_lle, replay: a.replay !== null,
    build: overlay ? overlay.summary.blocks.find((b) => b.block === 'main')?.sha256 ?? MODEL_INFO.rom_sha256 : null });
  if (nv.refuse) {
    report(`${PROG}: ${nv.refuse}`);
    return 1;
  }
  if (nv.file) {
    try { fileNvram(nv.file).load(); } catch (e) {
      report(`${PROG}: ${/^S-NVRAM /.test(e.message) ? e.message : `S-NVRAM ${nv.file}: ${e.message}`} (--nvram off for a blank camera)`);
      return 1;
    }
  }
  // --card-put: the local files read here, and put on a copy of the kept card in memory, so a refusal (no
  // OM_EMU_CARD, a blank or missing card, a name the volume does not take, a full card) stops the start; the lab worker
  // puts the same files on the card it opens
  let cardFiles = null;
  if (a.card_put.length) {
    const file = process.env.OM_EMU_CARD;
    if (!file) {
      report(`${PROG}: --card-put needs the card kept in a file, OM_EMU_CARD=FILE (a card the firmware formatted: node emu/bin/card.mjs new FILE)`);
      return 1;
    }
    try {
      cardFiles = a.card_put.map((item) => {
        const at = item.indexOf('='), local = item.slice(at + 1);
        try { return { path: item.slice(0, at), bytes: new Uint8Array(fs.readFileSync(local)) }; } catch (e) { throw new CardFsError(`${local}: cannot read it (${e.code ?? e.message})`); }
      });
      cardPut(fileCard(file, process.env.OM_EMU_CARD_SIZE ? { sectors: cardSectors(process.env.OM_EMU_CARD_SIZE) } : {}).open(), cardFiles);
    } catch (e) {
      if (e instanceof TypeError || e instanceof ReferenceError) throw e;     // a bug, not a refusal
      report(`${PROG}: --card-put refused: ${file}: ${e.message}`);
      return 1;
    }
  }
  let replayNvram = null;          // the log's record, for the line and the session line (a malformed one is the Player's to report)
  if (replayText !== null) {
    try { replayNvram = replayNvramRecord(a.replay, replayText, (p) => fs.readFileSync(p, 'utf8')); } catch { /* the Player raises it */ }
  }
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
  if (overlay) say(`play: patched firmware: ${patchLine(overlay.summary)}`);
  // the overlay's bytes where the boot does not load or is not shown to load (S-STALERAM's ranges), before the lab
  // starts (src/lab/patchaudit.mjs)
  const unloaded = overlay ? startUnloaded(overlay, a.loaded) : undefined;
  if (unloaded !== undefined) say(`play: patch audit: ${unloadedLine(unloaded)}`);
  if (cardFiles) say(`play: --card-put: ${cardFiles.map((f) => `${f.path} (${f.bytes.length} bytes)`).join(', ')} onto ${process.env.OM_EMU_CARD} before the first session`);
  const rom = overlay?.rom ?? loadImage();
  let switchTo = null, trying = null;
  // POST /api/model: a reason to refuse, or null (the switch is taken: playapi queues the quit). A switch never
  // downloads or unpacks (the page has no view of the terminal's progress), and starts a new session in the chosen
  // model's default out directory, so --out (its session.json would be overwritten) and --replay (the log is the old
  // model's) refuse it. A model the lab does not load on is refused before this session stops (labLoads).
  const onSwitch = async (code) => {
    if (switchTo || trying) return `already switching to ${switchTo ?? trying}`;
    if (patches) return `a session with ${a.main !== null ? '--main' : '--patch'} cannot switch (its patches are for ${MODEL}'s blocks): start ${PROG} --model ${code}`;
    if (a.out !== null || a.replay !== null) return `a session with ${a.out !== null ? '--out' : '--replay'} cannot switch: start ${PROG} --model ${code}`;
    if (nv.custom) return `a session whose state is kept in ${nv.file} (${nv.source}) cannot switch (the file is ${MODEL}'s): start ${PROG} --model ${code}`;
    if (!blocksPresent(MODELS[code])) return `no firmware for ${code} (${MODELS[code].name}): run node emu/bin/fetch-fw.mjs --model ${code}`;
    trying = code;
    const why = await labLoads(code);
    trying = null;
    if (why) return why;
    switchTo = code;
    return null;
  };
  // the options the lab worker's environment gives it (labworker.mjs, src/lab/play.mjs lens_option), for the page's
  // session line (GET /api/session): fixed for the process, set in the environment before the start
  const session = { host: 'node', lens: process.env.OM_EMU_LENS || 'native', nvram: replayNvram ? `the log ${a.replay}` : nv.file,
    card: process.env.OM_EMU_CARD || null, card_size: process.env.OM_EMU_CARD_SIZE ? cardGiB(process.env.OM_EMU_CARD_SIZE) : null,
    ...(overlay ? { patch: overlay.summary } : {}) };
  overlay = null;                      // the worker makes its own blocks (patches)
  const api = new PlayApi(proxy, { tables: Tables.of(rom), framePng: pngCache(), check, page: new Uint8Array(fs.readFileSync(PAGE)),
    session, cardImage: jpegRgba, imagePng: pngRgba,     // the Card panel's pictures, decoded here on the main thread
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
  say(a.replay === null ? nv.line : replayNvram ? `play: --replay: each session starts from the kept state its log records (S-NVRAM, in memory)${nv.envIgnored ? '; OM_EMU_NVRAM ignored' : ''}`
    : `play: --replay: the log kept no state, a blank camera at each start (S-SETSAVE)${nv.envIgnored ? '; OM_EMU_NVRAM ignored' : ''}`);
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
  worker = new Worker(new URL('./labworker.mjs', import.meta.url), { workerData: { args: a, flags, port: port2, out, argv, patches, nvram: nv.file, cardFiles, loaded: a.loaded }, transferList: [port2],
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
