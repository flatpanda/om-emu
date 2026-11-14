// The scripted, headless play session: the supported scripting API of om-emu (bin/session.mjs is its command line).
// A project that modifies the firmware drives a whole verification from a shell script or a small module through
// this one module, with no import of the lab's internals and no HTTP server. It runs the play runtime's Player
// (src/lab/player.mjs) in this process with play's semantics (idle off: lab time moves only by the script's tokens),
// and every token becomes the JSON inputs of play's POST /api/input (key, dial, switch, token 'WAIT:ms', debug read,
// call and write, control), so nothing here is a second runtime.
//
//   const { openSession } = await import('.../emu/host/session.mjs');
//   const s = await openSession({ model: 'E147', patch: ['patch.json'], card: 'card.omsd', nvram: 'nv.json', out: 'run' });
//   for (const t of ['wait:1500', 's1', 'expect:gui~SHOOTING']) if (!s.step(t).ok) break;
//   const summary = s.close();          // summary.ok, summary.pokes, summary.patch_audit, ...
//
// openSession(options) -> a session (the lab's model is fixed at its first import: options.model, else OM_EMU_MODEL,
// else E143; a model other than the one already imported is refused). options:
//   model, patch [FILE...] | main FILE, card FILE (the card in the slot, written back in place at each session's end as
//   play's OM_EMU_CARD; absent: a blank card in memory that the firmware formats), cardPut ['DOS/PATH=LOCAL'...] (on
//   the card FILE before the first session mounts it), cardGet ['DOS/PATH=LOCAL'...] (copied off at close), nvram
//   'off' (the default: a blank camera at each start) | FILE (kept there between sessions and runs, S-NVRAM),
//   loaded 'auto'|'on'|'off' (S-STALERAM), creativeDial K, out DIR (session-N.json logs; relative paths of the tokens
//   resolve against it), settle MS (the lab time after a press, a dial or a switch; default 600), tokens [TEXT...]
//   (checked before the boot: a token the grammar or the model does not have throws TokenError), say(line) (the human
//   lines: the patched firmware, the patch audit, the kept state, the card).
// It throws TokenError (a usage error) or SessionRefused (an option refused: a patch, the nvram file, a --card-put, an
// --out it cannot make; a local file a step cannot write is that step's failure, 'FILE: cannot write it (CODE)');
// a lab error during the boot is the first step's failure, not a throw.
// The session's methods (each step's record is the JSON line bin/session.mjs prints):
//   step(text)   one token -> {step, token, ok, phase, lab_ns, gui, frame, ...its result, error?}; after a failed step
//                (a firmware or lab error, a refused input, a failed expect) the session takes no more steps
//   run(texts)   the tokens in order until one fails; their records
//   input(inp)   one raw input as POST /api/input takes it (a debug write among them is a poke), its result
//   status()     the Player's status document (play's GET /api/status)
//   summary()    {summary, ok, model, patch, patch_audit, stand_ins, pokes, harness_inputs, calls, card, nvram, errors,
//                steps, failed}
//   close()      the session closed, --card-get's files copied off, the logs written; the summary
// Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { UsageError, intValue } from '../checks/lib/args.mjs';

export const PRESS_MS = 150, HOLD_MS = 2000, SETTLE_MS = 600, DIAL_MAX = 8, READ_MAX = 0x10000;
export class TokenError extends UsageError {}
export class SessionRefused extends Error {}

// ---- the token grammar (firmware-free) --------------------------------------------------------------------------
// A script's text as tokens: '#' at a token's start comments out the rest of its line; tokens are separated by white
// space, and a double-quoted part ("FILM 1") keeps its spaces (the quotes dropped; \" and \\ inside quotes).
export function splitScript(text) {
  const out = [];
  for (const line of String(text).split(/\r\n|\r|\n/)) {
    let cur = null, q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) cur += line[++i];
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') { cur ??= ''; q = true; }
      else if (/\s/.test(c)) { if (cur !== null) out.push(cur); cur = null; }
      else if (c === '#' && cur === null) break;
      else cur = (cur ?? '') + c;
    }
    if (q) throw new TokenError(`unclosed quote in ${JSON.stringify(line)}`);
    if (cur !== null) out.push(cur);
  }
  return out;
}

const ID = '[a-z][a-z0-9_]*';
const PLAY_TOKEN = /^(?:(?:WAIT|WAIT_UNTIL|EV|SET|CLOCK|GET|XCALL|WINDOWS):\S+|OPEN|CLOSE|WINDOWS|INTC|VSC|B2|EYE|STORE)$/;
// play's tokens that are harness inputs, not the camera's (the summary lists them): a GUI event posted, a setting
// set through its native setter, the clock set, a native call of the lab's
const HARNESS_TOKEN = /^(?:EV:|SET:|CLOCK:|XCALL:|OPEN$|CLOSE$)/;
const RESERVED = ['wait', 'hold', 'switch', 'restart', 'shot', 'read', 'write', 'call', 'exif', 'expect'];
const CALL_KEYS =['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3', 'limit', 'space'];
export const EXIF_FIELDS = {
  ifd0: { Make: 0x010f, Model: 0x0110, ImageDescription: 0x010e, Orientation: 0x0112, Software: 0x0131, DateTime: 0x0132, Artist: 0x013b, Copyright: 0x8298 },
  exif: { ExposureTime: 0x829a, FNumber: 0x829d, ExposureProgram: 0x8822, ISO: 0x8827, DateTimeOriginal: 0x9003, DateTimeDigitized: 0x9004,
    ExposureBias: 0x9204, FocalLength: 0x920a, UserComment: 0x9286, ColorSpace: 0xa001, PixelXDimension: 0xa002, PixelYDimension: 0xa003 },
};
const FIELD_NAMES = new Set([...Object.keys(EXIF_FIELDS.ifd0), ...Object.keys(EXIF_FIELDS.exif)]);
const addrOf = (t, s, what) => {
  const v = intValue(s);
  if (v === null || v < 0 || v > 0xffffffff) throw new TokenError(`${t}: ${what} ${JSON.stringify(s)} is not a 32-bit address`);
  return v;
};
const hexOf = (t, s) => {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(s)) throw new TokenError(`${t}: ${JSON.stringify(s)} is not hex bytes (an even number of hex digits)`);
  return s.toLowerCase();
};
const dosPath = (t, s) => {
  const p = String(s).replace(/^[/\\]+/, '').replaceAll('\\', '/');
  if (!p || /[:"<>|]/.test(p) || /[*?]/.test(p.split('/').slice(0, -1).join('/'))) throw new TokenError(`${t}: ${JSON.stringify(s)} is not a card path (DOS/PATH, '*' and '?' in its last part only)`);
  return p;
};

// One token -> its step: {text, kind, ...}. TokenError for a token the grammar does not have.
export function parseToken(t) {
  if (typeof t !== 'string' || !t) throw new TokenError(`a token is a non-empty string, not ${JSON.stringify(t)}`);
  let m;
  const step = (kind, more = {}) => ({ text: t, kind, ...more });
  if ((m = /^wait:(\d+)$/.exec(t))) return step('wait', { ms: Number(m[1]) });
  if ((m = new RegExp(`^hold:(${ID})(?::(\\d+))?$`).exec(t))) return step('hold', { id: m[1], ms: m[2] === undefined ? HOLD_MS : Number(m[2]) });
  if ((m = new RegExp(`^switch:(${ID})(?:=(\\d+)|([+-]\\d+))$`).exec(t))) return step('switch', { id: m[1], ...(m[2] !== undefined ? { value: Number(m[2]) } : { by: Number(m[3]) }) });
  if (t === 'power:off') return step('power');
  if ((m = /^restart(?::card=(.+))?$/.exec(t))) return step('restart', { card: m[1] ?? null });
  if ((m = /^shot:(.+\.png)$/i.exec(t))) return step('shot', { file: m[1] });
  if ((m = /^read:([^:]+):([^:]+)$/.exec(t))) {
    const len = intValue(m[2]);
    if (len === null || len < 1 || len > READ_MAX) throw new TokenError(`${t}: the length ${JSON.stringify(m[2])} is not 1..${READ_MAX}`);
    return step('read', { addr: addrOf(t, m[1], 'the address'), len });
  }
  if ((m = /^write:([^=]+)=(.*)$/.exec(t))) return step('write', { addr: addrOf(t, m[1], 'the address'), hex: hexOf(t, m[2]) });
  if ((m = /^call:([^:]+)(?::(.*))?$/.exec(t))) {
    const regs = {};
    let limit = null, space = null;
    for (const kv of (m[2] ?? '').split(',').filter(Boolean)) {
      const [k, v, more] = kv.split('=');
      if (more !== undefined || v === undefined || !CALL_KEYS.includes(k)) throw new TokenError(`${t}: ${JSON.stringify(kv)} is not one of ${CALL_KEYS.map((x) => `${x}=`).join(', ')}`);
      if (k === 'space') { if (v !== 'notation' && v !== 'runtime') throw new TokenError(`${t}: space=notation or space=runtime`); space = v; continue; }
      const n = intValue(v);
      if (n === null || n < 0 || n > 0xffffffff) throw new TokenError(`${t}: ${k}=${v} is not a 32-bit value`);
      if (k === 'limit') limit = n; else regs[k] = n;
    }
    return step('call', { fn: addrOf(t, m[1], 'the function'), regs, limit, space });
  }
  if (t === 'card-ls') return step('card-ls');
  if ((m = /^card-get:([^=]+)=(.+)$/.exec(t))) return step('card-get', { path: dosPath(t, m[1]), local: m[2] });
  if ((m = /^exif:(.+)$/.exec(t))) return step('exif', { path: dosPath(t, m[1]) });
  if (t.startsWith('expect:')) return step('expect', { expect: parseExpect(t) });
  if (PLAY_TOKEN.test(t)) return step('token', { token: t });
  if (RESERVED.includes(t.split(':')[0])) throw new TokenError(`${t}: ${t.split(':')[0]} is a token's name, not a control (${t.split(':')[0]}:...)`);
  if ((m = new RegExp(`^(${ID}):(down|up)$`).exec(t))) return step('edge', { id: m[1], action: m[2] });
  if ((m = new RegExp(`^(${ID}):([+-]\\d+)$`).exec(t))) {
    const n = Number(m[2]);
    if (n === 0 || Math.abs(n) > DIAL_MAX) throw new TokenError(`${t}: a dial step of 1..${DIAL_MAX} detents either way (the player's cap)`);
    return step('dial', { id: m[1], detents: n });
  }
  if (new RegExp(`^${ID}$`).test(t)) return step('press', { id: t });
  throw new TokenError(`${t}: not a token (keys and KEY:down|up, hold:KEY[:MS], DIAL:+N|-N, wait:MS, play's WAIT:/EV:/SET:/... tokens, switch:ID=V|+N, power:off, restart[:card=FILE], shot:FILE.png, read:ADDR:LEN, write:ADDR=HEX, call:FN[:d0=..], card-ls, card-get:DOS=LOCAL, exif:DOS, expect:...)`);
}
function parseExpect(t) {
  let m;
  if ((m = /^expect:gui([=~])(.+)$/.exec(t))) return { what: 'gui', op: m[1], text: m[2] };
  if ((m = /^expect:mem:([^=!]+)(!?=)(.*)$/.exec(t))) return { what: 'mem', addr: addrOf(t, m[1], 'the address'), op: m[2], hex: hexOf(t, m[3]) };
  if ((m = /^expect:card:(.+)$/.exec(t))) return { what: 'card', path: dosPath(t, m[1]) };
  if ((m = /^expect:standin:([A-Z0-9][A-Z0-9-]*)$/.exec(t))) return { what: 'standin', name: m[1] };
  if ((m = /^expect:exif:([^:]+):([A-Za-z0-9]+)([=~])(.*)$/.exec(t))) {
    if (!FIELD_NAMES.has(m[2])) throw new TokenError(`${t}: field ${m[2]} is not one of ${[...FIELD_NAMES].join(', ')}`);
    return { what: 'exif', path: dosPath(t, m[1]), field: m[2], op: m[3], text: m[4] };
  }
  throw new TokenError(`${t}: expect:gui=NAME|~TEXT, expect:mem:ADDR=HEX|!=HEX, expect:card:DOS/PATH, expect:standin:NAME, expect:exif:DOS/PATH:FIELD=TEXT|~TEXT`);
}

// A step's Player inputs (play's POST /api/input documents) for the kinds that are inputs; settle: the lab time after
// a press, a dial or a switch
export function stepInputs(st, settle = SETTLE_MS) {
  const wait = (ms) => ({ type: 'token', token: `WAIT:${ms}` });
  const key = (id, action) => ({ type: 'key', id, action });
  switch (st.kind) {
    case 'press': return [key(st.id, 'down'), wait(PRESS_MS), key(st.id, 'up'), wait(settle)];
    case 'hold': return [key(st.id, 'down'), wait(st.ms), key(st.id, 'up'), wait(settle)];
    case 'edge': return [key(st.id, st.action)];
    case 'dial': return [{ type: 'dial', id: st.id, detents: st.detents }, wait(settle)];
    case 'wait': return [wait(st.ms)];
    case 'token': return [{ type: 'token', token: st.token }];
    case 'switch': return [{ type: 'switch', id: st.id, ...('value' in st ? { value: st.value } : { step: st.by }) }, wait(settle)];
    case 'power': return [{ type: 'switch', id: 'power', value: 0 }];
    case 'read': return [{ type: 'debug', op: 'read', addr: st.addr, size: st.len }];
    case 'write': return [{ type: 'debug', op: 'write', addr: st.addr, hex: st.hex }];
    case 'call': return [{ type: 'debug', op: 'call', fn: st.fn, regs: st.regs, ...(st.limit !== null ? { limit: st.limit } : {}), ...(st.space ? { space: st.space } : {}) }];
    default: return [];
  }
}

// An expect against what the session shows: null when it holds, else what was found. got: {gui, mem(addr, len) ->
// hex, card(path) -> entry or null, exif(path) -> fields or null, standins: [...]}
export function expectFails(e, got) {
  const text = (op, have, want) => (op === '=' ? have === want : typeof have === 'string' && have.includes(want));
  if (e.what === 'gui') return text(e.op, got.gui, e.text) ? null : `GUI ${JSON.stringify(got.gui)}, want ${e.op === '=' ? '' : 'one containing '}${JSON.stringify(e.text)}`;
  if (e.what === 'mem') {
    const h = got.mem(e.addr, e.hex.length / 2);
    return (h === e.hex) === (e.op === '=') ? null : `0x${e.addr.toString(16).padStart(8, '0')} holds ${h}, want ${e.op === '=' ? '' : 'anything but '}${e.hex}`;
  }
  if (e.what === 'card') return got.card(e.path) ? null : `no ${e.path} on the card`;
  if (e.what === 'standin') return got.standins.includes(e.name) ? null : `${e.name} is not among the stand-ins in use`;
  if (e.what === 'exif') {
    const f = got.exif(e.path);
    if (f === null) return `no ${e.path} on the card`;
    const have = f[e.field];
    return text(e.op, have === undefined ? undefined : String(have), e.text) ? null : `${e.field} ${have === undefined ? 'absent' : JSON.stringify(String(have))}, want ${e.op === '=' ? '' : 'one containing '}${JSON.stringify(e.text)}`;
  }
  throw new Error(`expect ${e.what}`);
}

// The fields of a JPEG's Exif (refs/exif.mjs readExif's IFD0 and Exif IFD) by name: ASCII as text, a RATIONAL as
// 'num/den', UserComment as its text after the 8-byte character code
export function exifFields(x) {
  const out = {};
  const val = (v) => (Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) ? `${v[0]}/${v[1]}` : v instanceof Uint8Array ? [...v] : v);
  for (const [ifd, names] of Object.entries(EXIF_FIELDS)) {
    const tags = x?.[ifd];
    if (!tags) continue;
    for (const [n, tag] of Object.entries(names)) {
      if (!tags.has(tag)) continue;
      const v = tags.get(tag);
      out[n] = n === 'UserComment' && v instanceof Uint8Array ? String.fromCharCode(...v.subarray(8)).replace(/\0+$/, '') : val(v);
    }
  }
  return out;
}

// ---- the session (the lab imported here, after the model is fixed) ----------------------------------------------
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const BUG = (e) => e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof RangeError;
// a local file the session writes (shot, card-get, --card-get), its directory made; one it cannot write is refused
// with the reason, as bin/card.mjs's get refuses it
const writeLocal = (file, bytes) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  } catch (e) { throw new SessionRefused(`${file}: cannot write it (${e.code ?? e.message})`); }
};

export async function openSession(o = {}) {
  if (o.model) process.env.OM_EMU_MODEL = o.model;      // effective only before the lab's first import
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  if (o.model && o.model !== MODEL) throw new SessionRefused(`model ${o.model}: the lab in this process is ${MODEL}'s (fixed at its first import; another model needs another process)`);
  const E = await import('../checks/lib/env.mjs');
  const { PatchRefused, patchLine } = await import('../src/fw/patch.mjs');
  const { startUnloaded, unloadedLine } = await import('../src/lab/patchaudit.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { BY_ID } = await import('../src/lab/play.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { nvramUnsupported } = await import('../src/lab/menu.mjs');
  const { LabError } = await import('../src/lab/errors.mjs');
  const { memoryCard } = await import('../src/lab/sdcard.mjs');
  const { cardPut, withCardFiles, CardFsError } = await import('../src/lab/cardfs.mjs');
  const { openVolume } = await import('../refs/volume.mjs');
  const { readExif } = await import('../refs/exif.mjs');
  const { fileCard } = await import('./card.mjs');
  const { nvramChoice, fileNvram } = await import('./nvram.mjs');
  const { pngRaw } = await import('./server.mjs');
  const say = o.say ?? (() => {});
  const settle = o.settle ?? SETTLE_MS;
  const out = o.out ? path.resolve(o.out) : null;
  const local = (p) => path.resolve(out ?? '.', p);

  // the tokens given up front, checked before the boot: the grammar, then the controls this model has
  const checkStep = (st) => {
    const id = st.kind === 'power' ? 'power' : st.id;
    if (id !== undefined && !BY_ID.has(id)) throw new TokenError(`${st.text}: ${MODEL} has no control ${JSON.stringify(id)} (${[...BY_ID.keys()].filter((k) => !k.startsWith('fw_')).join(', ')}, fw_<code>)`);
    if (st.kind === 'dial' && BY_ID.get(id).kind !== 'dial') throw new TokenError(`${st.text}: ${id} is not a dial (main_dial, sub_dial)`);
    if (['card-ls', 'card-get', 'exif'].includes(st.kind) || st.expect?.what === 'card' || st.expect?.what === 'exif') {
      if (!STORAGE) throw new TokenError(`${st.text}: ${MODEL} has no card with a file system in the lab (S-CARD)`);
    }
    return st;
  };
  const parse = (t) => checkStep(parseToken(t));
  const planned = (o.tokens ?? []).map(parse);
  const pairs = (list, what) => (list ?? []).map((item) => {
    const at = item.indexOf('=');
    if (at <= 0 || at === item.length - 1) throw new TokenError(`${what} ${item}: DOS/PATH=LOCAL`);
    return { path: item.slice(0, at), local: item.slice(at + 1) };
  });
  const puts = pairs(o.cardPut, '--card-put'), gets = pairs(o.cardGet, '--card-get');
  if (o.main && o.patch?.length) throw new TokenError('--main and --patch exclude each other (--main is the whole change to the main code block)');
  if ((gets.length || puts.length) && !STORAGE) throw new TokenError(`--card-put / --card-get: ${MODEL} has no card with a file system in the lab (S-CARD)`);

  // the overlay (as play's: checked against the stock blocks, refused with its reason)
  let fw = null, startAudit = null;
  if (o.patch?.length || o.main) {
    try { fw = E.patchedFirmware(E.overlayPatches({ patch: o.patch ?? [], main: o.main ?? null })); } catch (e) {
      if (e instanceof PatchRefused) throw new SessionRefused(`${o.main ? '--main' : '--patch'} refused: ${e.message}`);
      throw e;
    }
    say(`patched firmware: ${patchLine(fw.summary)}`);
    const u = startUnloaded(fw, o.loaded ?? 'auto');
    if (u !== undefined) say(`patch audit: ${unloadedLine(u)}`);
    // the summary's audit until a session's bring-up gives the whole one: hooks and ports not audited (null)
    startAudit = { hooks: null, ported: null, unloaded: u ?? null, tasks: [] };
  }
  // the kept state: off (a blank camera at each start) unless a file is named
  const nvArg = o.nvram ?? 'off';
  if (nvArg === 'on') throw new SessionRefused('--nvram on: name the file (--nvram FILE), or off');
  const nv = nvramChoice({ arg: nvArg, env: null, model: MODEL, unsupported: nvramUnsupported(), scpuNative: process.env.OM_EMU_SCPU === 'native' && !!MODEL_INFO.scpu_lle,
    build: fw ? fw.summary.blocks.find((b) => b.block === 'main')?.sha256 ?? null : null });
  if (nv.refuse) throw new SessionRefused(nv.refuse);
  if (nv.file) {
    try { fileNvram(nv.file).load(); } catch (e) { throw new SessionRefused(`${/^S-NVRAM /.test(e.message) ? e.message : `S-NVRAM ${nv.file}: ${e.message}`} (--nvram off for a blank camera)`); }
  }
  say(nv.line.replace(/^play: /, ''));
  // the card: a file (written back in place), else one in memory for the whole run; --card-put on a copy first
  const cardOf = (file, files = []) => {
    if (!file) return memoryCard();
    const fc = fileCard(path.resolve(file));
    if (!files.length) return fc;
    try { cardPut(fc.open(), files); } catch (e) {
      if (BUG(e)) throw e;
      throw new SessionRefused(`--card-put refused: ${file}: ${e.message}`);
    }
    return withCardFiles(fc, files);
  };
  if (puts.length && !o.card) throw new SessionRefused('--card-put needs --card FILE (a card the firmware formatted: node emu/bin/card.mjs new FILE)');
  const putFiles = puts.map(({ path: p, local: l }) => {
    try { return { path: p, bytes: new Uint8Array(fs.readFileSync(l)) }; } catch (e) { throw new SessionRefused(`--card-put ${p}=${l}: cannot read it (${e.code ?? e.message})`); }
  });
  let cardFile = o.card ? path.resolve(o.card) : null, card = cardOf(o.card, putFiles);
  if (STORAGE) say(cardFile ? `card ${cardFile} (written back in place)${putFiles.length ? `; --card-put ${putFiles.map((f) => `${f.path} (${f.bytes.length} bytes)`).join(', ')}` : ''}` : 'card: a blank card in memory (the firmware formats it)');
  if (out) { try { fs.mkdirSync(out, { recursive: true }); } catch (e) { throw new SessionRefused(`--out ${out}: cannot make it (${e.code ?? e.message})`); } }

  // the Player's options and env, as play's lab worker makes them (host/labworker.mjs), idle off
  const a = { ...PLAYER_PARSER, no_browser: true, idle: 'off', debug_api: true, out: out ?? '<out>', no_wait_on_error: true, hdmi: 'off', audio: 'auto', rotate: 'off',
    take: 'stand-in', cpu2: 'stand-in', creative_dial: o.creativeDial ?? null };
  let frame = null, sessionNo = 0;
  const baseEnv = { rom: fw?.rom ?? E.loadImage(), resBlock: fw?.resBlock ?? E.loadBlock(), nand: E.loadNand(), createHash: E.createHash, ...E.scpuEnv(),
    ...(fw ? { patch: fw.summary, patchRanges: fw.changed } : {}), loaded: o.loaded ?? 'auto',
    deflate: (b, level) => new Uint8Array(zlib.deflateSync(b, { level })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)),
    wallClock: () => Number(process.hrtime.bigint()) / 1e9,
    onFrame: (w, h, raw, meta) => { frame = { w, h, raw: raw.slice(), sha16: meta.sha16 }; }, onAudio: () => {} };
  const envFor = (k) => ({ ...baseEnv, card, ...(nv.file ? { nvram: fileNvram(nv.file) } : {}),
    ...(out ? { logSink: (name, text) => { const f = path.join(out, `session-${k}${name.slice('session'.length)}`); if (name.endsWith('.jsonl')) fs.appendFileSync(f, text); else fs.writeFileSync(f, text); } } : {}) });

  const records = [], pokes = [], harness = [], calls = [], errors = [], standins = new Set();
  let pl = null, failed = null, tasks = new Set(), audit = null, closed = false, lastFrameError = null;
  const fail = (rec, message) => { rec.ok = false; rec.error = message; failed ??= { step: rec.step, token: rec.token, message }; errors.push(`step ${rec.step} (${rec.token}): ${message}`); };
  const labMessage = () => pl?.error?.message ?? 'the session stopped';
  const note = () => {                             // what the run used, kept across sessions
    if (!pl) return;
    for (const x of pl.stand_ins_in_use()) standins.add(x);
    if (pl.patch_audit) { const d = pl.patch_audit_doc(); for (const t of d.tasks) tasks.add(t); audit = { ...d, tasks: [...tasks] }; }
  };
  // positions: the physical controls' positions a power:off left (src/lab/player.mjs power), which the next session's
  // start reads: a restart after power:off is the same camera powered on
  const open = (positions = null) => {
    sessionNo += 1;
    frame = null;
    pl = new Player(a, envFor(sessionNo));
    pl.off_positions = positions;
    pl.open_session();
  };
  const closePlayer = () => {
    if (!pl) return;
    note();
    try { pl.close_session(); } finally { pl.write_log(); }
  };
  // one input through the Player's own loop (submit, then the tick that takes it): its result
  const apply = (inp) => {
    const seq = pl.submit(inp);
    pl.tick();
    const res = pl.pop_result(seq);
    if (res === null) throw new SessionRefused(`input ${JSON.stringify(inp)}: no result (an answer the player defers, such as a debug cont, is not scripted)`);
    return res;
  };
  // the card in the first slot now: the session's (its sectors between ticks) or the one kept while none runs
  const cardNow = () => pl?.session?.storage?.card ?? card.open();
  const volume = () => {
    const c = cardNow(), read = (lba, n) => c.read(lba, n);
    if (read(0, 1).every((v) => v === 0)) throw new SessionRefused('the card is blank (not formatted)');
    return openVolume(read);
  };
  const rootOf = (vol) => (vol.type === 'exFAT' ? null : vol.rootCluster);
  const dirOf = (vol, e) => (vol.type === 'exFAT' ? e : e.cluster);
  const listing = () => {
    const vol = volume(), rows = [];
    const walk = (dir, prefix) => {
      for (const e of vol.list(dir)) {
        if (e.name === '.' || e.name === '..') continue;
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        rows.push(e.dir ? { path: p, dir: true } : { path: p, size: e.size });
        if (e.dir) walk(dirOf(vol, e), p);
      }
    };
    walk(rootOf(vol), '');
    return rows;
  };
  // a card path, '*' and '?' allowed in its last part (the last match by name): {vol, e, path} or null
  const find = (p) => {
    const vol = volume(), parts = p.split('/'), last = parts.pop();
    if (!/[*?]/.test(last)) { const e = vol.find(p); return e ? { vol, e, path: p } : null; }
    const dir = parts.length ? vol.find(parts.join('/')) : null;
    if (parts.length && (!dir || !dir.dir)) return null;
    const re = new RegExp(`^${last.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`, 'i');
    const hits = vol.list(dir ? dirOf(vol, dir) : rootOf(vol)).filter((e) => !e.dir && re.test(e.name)).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    return hits.length ? { vol, e: hits.at(-1), path: [...parts, hits.at(-1).name].join('/') } : null;
  };
  const fileBytes = (p) => {
    const f = find(p);
    if (!f) return null;
    if (f.e.dir) throw new SessionRefused(`${p} is a directory`);
    return { path: f.path, bytes: f.vol.data(f.e) };
  };
  const exifOf = (p) => {
    const f = fileBytes(p);
    if (!f) return null;
    const x = readExif(f.bytes);
    if (!x) throw new SessionRefused(`${f.path}: no Exif APP1`);
    return { path: f.path, fields: exifFields(x) };
  };
  const memHex = (addr, len) => {
    const r = apply({ type: 'debug', op: 'read', addr, size: len });
    if (!r.debug?.ok) throw new SessionRefused(`read ${h8(addr)}+${len}: ${r.debug?.error?.message ?? r.error}`);
    return r.debug.hex;
  };

  // one step: its record (the JSON line); a failure ends the run
  const run = (st) => {
    const rec = { step: records.length, token: st.text, ok: true };
    records.push(rec);
    try {
      if (failed) throw new SessionRefused(`the run failed at step ${failed.step}`);
      if (st.kind === 'restart') {
        const positions = pl?.phase === 'off' ? pl.off_positions : null;    // after power:off; else a battery pull, a fresh start
        closePlayer();
        if (st.card) { cardFile = path.resolve(local(st.card)); card = fileCard(cardFile); rec.card = cardFile; }
        open(positions);
        rec.session = sessionNo;
        if (pl.phase === 'error') fail(rec, labMessage());
      } else if (st.kind === 'shot') {
        if (!frame) throw new SessionRefused('no frame published yet in this session');
        const file = local(st.file);
        writeLocal(file, pngRaw(frame.w, frame.h, frame.raw));
        rec.file = file;
        rec.size = [frame.w, frame.h];
      } else if (st.kind === 'card-ls') rec.card = listing();
      else if (st.kind === 'card-get') {
        const f = fileBytes(st.path);
        if (!f) throw new SessionRefused(`no ${st.path} on the card`);
        const file = local(st.local);
        writeLocal(file, f.bytes);
        Object.assign(rec, { path: f.path, size: f.bytes.length, file });
      } else if (st.kind === 'exif') {
        const x = exifOf(st.path);
        if (!x) throw new SessionRefused(`no ${st.path} on the card`);
        Object.assign(rec, { path: x.path, exif: x.fields });
      } else if (st.kind === 'expect') {
        const e = st.expect;
        const why = expectFails(e, { gui: pl?.session ? (pl.publish_status(), pl.status_doc.gui_name ?? null) : null, mem: memHex,
          card: (p) => find(p), exif: (p) => exifOf(p)?.fields ?? null, standins: pl ? pl.stand_ins_in_use() : [] });
        rec.expect = e.what;
        if (why !== null) fail(rec, `expect failed: ${why}`);
      } else {
        for (const inp of stepInputs(st, settle)) {
          const before = pl.dropped.toObject(), res = apply(inp);
          if (pl.phase === 'error') { fail(rec, labMessage()); if (pl.error?.stderr_tail) rec.stderr_tail = pl.error.stderr_tail; break; }
          if (res.error) { fail(rec, res.error); break; }
          if (res.dropped) { fail(rec, `the player dropped ${JSON.stringify(inp)} (${Object.keys(pl.dropped.toObject()).filter((k) => pl.dropped.toObject()[k] !== before[k]).join(', ') || 'no reason counted'})`); break; }
          if (pl.input_error && inp.type !== 'debug') { fail(rec, `the input was not taken: ${pl.input_error}`); break; }
          if (res.debug) {
            if (!res.debug.ok) { fail(rec, `${inp.op}: ${res.debug.error?.type ?? 'error'}: ${res.debug.error?.message ?? JSON.stringify(res.debug.error)}`); break; }
            if (st.kind === 'read') rec.hex = res.debug.hex;
            if (st.kind === 'call') {
              const d = res.debug;
              Object.assign(rec, { fn: d.fn.notation, d0: d.regs.d0, steps: d.steps, stubs: d.stubs, regs: d.regs });
              calls.push({ step: rec.step, fn: d.fn.notation });
            }
            if (st.kind === 'write') pokes.push({ step: rec.step, token: st.text, addr: h8(st.addr), hex: st.hex });
          }
        }
        if (st.kind === 'token' && HARNESS_TOKEN.test(st.token)) harness.push({ step: rec.step, token: st.token });
      }
    } catch (e) {
      if (BUG(e) && !(e instanceof LabError)) throw e;
      fail(rec, e instanceof SessionRefused || e instanceof CardFsError ? e.message : `${e.name}: ${e.message}`);
    }
    try {
      if (pl?.session) pl.publish_status();
    } catch (e) { if (BUG(e)) throw e; }
    const st2 = pl?.status_doc ?? {};
    Object.assign(rec, { phase: pl?.phase ?? null, lab_ns: pl?.session?.lab?.lab_time() ?? null, gui: pl?.session ? st2.gui_name ?? null : null, frame: pl?.frame?.[3] ?? null });
    if (st.kind === 'restart') {
      rec.nvram = st2.nvram ?? null;          // the stores the new session restored (S-NVRAM)
      rec.carried = st2.carried ?? null;      // the controls' positions carried from power:off (null: a fresh start)
    }
    if (pl?.frame_error && pl.frame_error !== lastFrameError) rec.frame_error = pl.frame_error;     // once, when it changes
    lastFrameError = pl?.frame_error ?? null;
    note();
    return rec;
  };

  // the first session; a lab error during its boot is step 'open''s failure
  {
    const rec = { step: 0, token: 'open', ok: true };
    records.push(rec);
    try {
      open();
      if (pl.phase === 'error') fail(rec, labMessage());
    } catch (e) {
      if (BUG(e) && !(e instanceof LabError)) throw e;
      fail(rec, `${e.name}: ${e.message}`);
    }
    if (pl?.session) pl.publish_status();
    Object.assign(rec, { phase: pl?.phase ?? null, lab_ns: pl?.session?.lab?.lab_time() ?? null, gui: pl?.session ? pl.status_doc.gui_name ?? null : null, frame: pl?.frame?.[3] ?? null,
      session: sessionNo, ...(pl?.status_doc?.nvram ? { nvram: pl.status_doc.nvram } : {}) });
    note();
  }

  const summary = () => {
    let cardRows = null;
    if (STORAGE) { try { cardRows = listing(); } catch (e) { if (BUG(e)) throw e; cardRows = { error: e.message }; } }
    return { summary: true, ok: failed === null, model: MODEL, patch: fw ? patchLine(fw.summary) : null, patch_audit: audit ?? startAudit, stand_ins: [...standins], pokes, harness_inputs: harness, calls,
      card: cardRows, card_file: cardFile, nvram: nv.file, errors: [...errors], steps: records.length, failed };
  };
  return {
    model: MODEL,
    records,
    get failed() { return failed; },
    get player() { return pl; },
    first: records[0],
    step: (t) => run(parse(t)),
    run: (texts) => { const done = []; for (const t of texts ?? planned.map((x) => x.text)) { const r = run(parse(t)); done.push(r); if (!r.ok) break; } return done; },
    planned: planned.map((x) => x.text),
    input: (inp) => {
      if (inp?.type === 'debug' && (['write', 'setReg', 'setRegs'].includes(inp.op) || (inp.op === 'call' && inp.mem))) pokes.push({ step: records.length, token: 'input', input: inp });
      return apply(inp);
    },
    status: () => pl.status_doc,
    summary,
    close: () => {
      if (closed) return summary();
      closed = true;
      for (const g of gets) {
        try {
          const f = fileBytes(dosPath('--card-get', g.path));
          if (!f) throw new SessionRefused(`--card-get: no ${g.path} on the card`);
          const file = path.resolve(g.local);
          writeLocal(file, f.bytes);
          say(`--card-get: ${f.path} (${f.bytes.length} bytes) -> ${file}`);
        } catch (e) {
          if (BUG(e)) throw e;
          errors.push(e.message);
          failed ??= { step: null, token: '--card-get', message: e.message };
        }
      }
      const s = summary();
      try { closePlayer(); } catch (e) { if (BUG(e) && !(e instanceof LabError)) throw e; errors.push(`close: ${e.message}`); failed ??= { step: null, token: 'close', message: e.message }; return summary(); }
      return s;
    },
  };
}
