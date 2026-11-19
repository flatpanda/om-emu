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
//   the card FILE before the first session mounts it), noCard (the first slot empty at the start, the card out of it
//   until a card:in token; a restart keeps the slot as the last session left it, card:out included, and restart:card=
//   FILE puts that card in), cardGet ['DOS/PATH=LOCAL'...] (copied off at close), nvram
//   'off' (the default: a blank camera at each start) | FILE (kept there between sessions and runs, S-NVRAM),
//   loaded 'auto'|'on'|'off' (S-STALERAM), creativeDial K, held [KEY...] (keys held down at power-on, released once
//   the start is done: H-STARTKEY reads MENU's), a15 'auto'|'off'|'on' and device 'tft'|'evf' (play's --a15
//   and --device), osdErrors 'fail' (a step with an OSD engine refusal fails; the default on OSD_FAIL_BODIES) |
//   'report' (the default on the other bodies), out DIR (session-N.json logs; relative paths of the tokens resolve
//   against it), settle MS (the lab time after a press, a dial or a switch; default 600), tokens [TEXT...]
//   (checked before the boot: a token the grammar or the model does not have throws TokenError), say(line) (the human
//   lines: the patched firmware, the patch audit, the kept state, the card), onRecord(record) (each step's record as
//   it ends, in step order: a debug stop's record ends at the stop, before the records of the tokens run there),
//   atStop(record) (a debug stop's tokens for a lone step(): called at the stop and after each token run there, it
//   returns the next token's text, 'resume' to let the firmware go on, or null to end the run at the stop).
// It throws TokenError (a usage error) or SessionRefused (an option refused: a patch, the nvram file, a --card-put, an
// --out it cannot make; a local file a step cannot write is that step's failure, 'FILE: cannot write it (CODE)');
// a lab error during the boot is the first step's failure, not a throw.
// The session's methods (each step's record is the JSON line bin/session.mjs prints):
//   step(text)   one token -> {step, token, ok, phase, lab_ns, gui, frame, ...its result, error?}; after a failed step
//                (a firmware or lab error, a refused input, a failed expect) the session takes no more steps; a step
//                that met a debug stop returns the record that ran last (resume's), the others went to onRecord
//   run(texts)   the tokens in order until one fails; their records (a debug stop takes its tokens from texts)
// Traces and stops (the live debug route's probe, break and watch ops, src/debug/live.mjs; the armed sets are the
// script's: sent whole at each trace: or break: token and again after each restart): trace:PC[,PC...] and
// trace:mem:ADDR:LEN[:r|w|rw] record each hit while later steps run (a step's record: hits, the first HITS_PER_STEP,
// hits_dropped, hit_counts), trace:off disarms; break:PC[,PC...] and break:mem:ADDR:LEN[:r|w|rw] stop the firmware
// inside the step that meets one (its record: stopped), where only the AT_STOP kinds run until resume, whose record
// carries the rest of that step; break:off disarms. A run that ends at a stop (its tokens done) or fails there ends
// with the firmware held (StopEnd unwinds the tick: nothing runs after the stop) and the summary's ended_at_stop.
//   input(inp)   one raw input as POST /api/input takes it, its result; listed in the summary as the tokens' are
//                (a debug write, setReg(s) or call with mem among pokes, a harness token among harness_inputs, a
//                call that ran among calls; a poke's token is 'input', the others' entries have via 'input')
//   status()     the Player's status document (play's GET /api/status)
//   summary()    {summary, ok, model, patch, patch_audit, stand_ins, pokes, harness_inputs, calls, card, nvram, errors,
//                steps, failed, traces ({armed: the arming steps, now, counts, hits_dropped, stops} or null),
//                ended_at_stop ({step, token, kind, pc, lab_ns} or null)}
//   close()      the session closed, --card-get's files copied off, the logs written; the summary
// Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { UsageError, intValue } from '../checks/lib/args.mjs';

export const PRESS_MS = 150, HOLD_MS = 2000, SETTLE_MS = 600, DIAL_MAX = 8, READ_MAX = 0x10000;
export const HITS_PER_STEP = 100;      // a record's hits: the first this many, the rest counted (hits_dropped)
// trace:PC:stack=N's bound (src/debug/live.mjs STACK_WORDS_MAX, which the live route checks); dump:'s, in bytes (the
// debug read's READ_MAX at a time)
export const STACK_WORDS = 256, DUMP_MAX = 64 * 1024 * 1024;
// --osd-errors' default: fail on the bodies whose stock flows were measured with no OSD engine refusal (X, 2026-11-14:
// about 410 steps of INFO, the Super Control Panel, the menus, S1 and S2, playback and the dials on E143, E146 and
// E147), report on the others: stock sessions on E118, E120, E125, E129, E130, E132, E133, E137, E140, E142 and E145
// meet BMP_LUT refusals at the open, INFO or the menu (X, 2026-11-14), so a default fail would fail stock firmware there
export const OSD_FAIL_BODIES = new Set(['E143', 'E146', 'E147']);
export class TokenError extends UsageError {}
export class SessionRefused extends Error {}
class StopEnd extends Error {}          // unwinds a held debug stop at the script's end or a failure there
// the steps that run at a debug stop (the firmware held inside a tick): reads, pokes, checks, the card, arming, resume
const AT_STOP = new Set(['read', 'dump', 'write', 'call', 'setting', 'expect', 'card-ls', 'card-get', 'exif', 'shot', 'trace', 'break', 'resume']);

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
const RESERVED = ['wait', 'hold', 'switch', 'restart', 'shot', 'read', 'dump', 'write', 'call', 'setting', 'exif', 'expect', 'trace', 'break', 'resume'];
// a setting as a token gives it: an id (decimal or 0x) or a name of the firmware's own (MODE_MOVIE), resolved per body
// by openSession (src/fw/setnames.mjs; the names read from the user's firmware, host/setnames.mjs)
const SETTING = '(?:\\d+|0x[0-9a-fA-F]+|[A-Z][A-Z0-9_]*)';
const settingOf = (s) => (/^[A-Z]/.test(s) ? s : Number(s));
const CALL_KEYS =['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3', 'limit', 'space', 'entry', 'stop', 'frame'];
// the fields of a call:@FILE request (src/debug/call.mjs callSpec's)
export const CALL_FILE_KEYS = ['fn', 'space', 'entry', 'stops', 'regs', 'stack', 'frame', 'mem', 'read', 'restore', 'limit', 'scratch'];
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
  if ((m = new RegExp(`^setting:(${SETTING})$`).exec(t))) return step('setting', { setting: settingOf(m[1]) });
  if (/^setting(?::|$)/.test(t)) throw new TokenError(`${t}: setting:ID or setting:NAME (setting:44, setting:MODE_MOVIE)`);
  if ((m = /^call:@(.+)$/.exec(t))) return step('call', { file: m[1] });      // the request's JSON (read once the lab is in)
  if ((m = /^call:([^:]+)(?::(.*))?$/.exec(t))) {
    const regs = {}, stops = [];
    let limit = null, space = null, entry = null, frame = null;
    for (const kv of (m[2] ?? '').split(',').filter(Boolean)) {
      const [k, v, more] = kv.split('=');
      if (more !== undefined || v === undefined || !CALL_KEYS.includes(k)) throw new TokenError(`${t}: ${JSON.stringify(kv)} is not one of ${CALL_KEYS.map((x) => `${x}=`).join(', ')}`);
      if (k === 'space') { if (v !== 'notation' && v !== 'runtime') throw new TokenError(`${t}: space=notation or space=runtime`); space = v; continue; }
      if ((k === 'entry' && entry !== null) || (k === 'frame' && frame !== null)) throw new TokenError(`${t}: ${k}= given twice`);
      if (k === 'frame') {
        const f = /^([^/]+)\/([^/]+)$/.exec(v), [mask, size] = f ? [intValue(f[1]), intValue(f[2])] : [null, null];
        if (mask === null || size === null || mask < 0 || mask > 255 || size < 0 || size > 255) throw new TokenError(`${t}: frame=MASK/SIZE, two bytes (frame=0xf0/20)`);
        frame = [mask, size];
        continue;
      }
      const n = intValue(v);
      if (n === null || n < 0 || n > 0xffffffff) throw new TokenError(`${t}: ${k}=${v} is not a 32-bit value`);
      if (k === 'limit') limit = n; else if (k === 'entry') entry = n; else if (k === 'stop') stops.push(n); else regs[k] = n;
    }
    return step('call', { fn: addrOf(t, m[1], 'the function'), regs, limit, space, ...(entry !== null ? { entry } : {}), ...(stops.length ? { stops } : {}), ...(frame ? { frame } : {}) });
  }
  if ((m = /^(trace|break):(?:(off)|mem:([^:]+):([^:]+)(?::(r|w|rw))?|([^:]+)(?::stack=([^:]*))?)$/.exec(t))) {
    if (m[2]) return step(m[1], { off: true });
    if (m[7] !== undefined) {                     // trace:PC[,PC...]:stack=N: each hit at these pcs carries N stack words
      const n = intValue(m[7]);
      if (m[1] !== 'trace') throw new TokenError(`${t}: stack=N is trace's (a stop's read: reads the stack there)`);
      if (n === null || n < 1 || n > STACK_WORDS) throw new TokenError(`${t}: stack=${m[7]} is not 1..${STACK_WORDS} words`);
      return step('trace', { pcs: m[6].split(',').map((a) => addrOf(t, a, 'the pc')), stack: n });
    }
    if (m[6] !== undefined) return step(m[1], { pcs: m[6].split(',').map((a) => addrOf(t, a, 'the pc')) });
    const len = intValue(m[4]), lo = addrOf(t, m[3], 'the address');
    if (len === null || len < 1 || lo + len > 2 ** 32) throw new TokenError(`${t}: the length ${JSON.stringify(m[4])} is not 1.. bytes within 32 bits`);
    return step(m[1], { mem: { addr: lo, len, kind: m[5] ?? 'w' } });
  }
  if ((m = /^(trace|break):/.exec(t))) throw new TokenError(`${t}: ${m[1]}:PC[,PC...]${m[1] === 'trace' ? '[:stack=N]' : ''}, ${m[1]}:mem:ADDR:LEN[:r|w|rw] or ${m[1]}:off`);
  if ((m = /^dump:([^:]+):([^:]+):(.+)$/.exec(t))) {   // dump:ADDR:LEN:FILE: LEN bytes from ADDR into FILE (under --out)
    const len = intValue(m[2]), lo = addrOf(t, m[1], 'the address');
    if (len === null || len < 1 || len > DUMP_MAX) throw new TokenError(`${t}: the length ${JSON.stringify(m[2])} is not 1..${DUMP_MAX} bytes`);
    if (lo + len > 2 ** 32) throw new TokenError(`${t}: ${JSON.stringify(m[1])}+${len} runs past 32 bits`);
    return step('dump', { addr: lo, len, file: m[3] });
  }
  if ((m = /^dump(?::|$)/.exec(t))) throw new TokenError(`${t}: dump:ADDR:LEN:FILE (LEN 1..${DUMP_MAX} bytes)`);
  if (t === 'resume') return step('resume');
  if ((m = /^card:(out|in)(?::([12]))?$/.exec(t))) return step('card', { action: m[1] === 'out' ? 'remove' : 'insert', slot: Number(m[2] ?? 1) });
  if (/^card:/.test(t)) throw new TokenError(`${t}: card:out or card:in, :2 for the second slot`);
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
  throw new TokenError(`${t}: not a token (keys and KEY:down|up, hold:KEY[:MS], DIAL:+N|-N, wait:MS, play's WAIT:/EV:/SET:/... tokens, switch:ID=V|+N|-N, power:off, restart[:card=FILE], card:out|in[:2], shot:FILE.png, read:ADDR:LEN, dump:ADDR:LEN:FILE, write:ADDR=HEX, call:FN[:d0=..,entry=..,stop=..], call:@FILE, setting:ID|NAME, card-ls, card-get:DOS=LOCAL, exif:DOS, expect:..., trace:PC[,PC..][:stack=N]|mem:ADDR:LEN[:r|w|rw]|off, break:..., resume)`);
}
// A call:@FILE token's request: the file's text (name: the file, for the refusals) as a JSON object of the call op's
// fields (CALL_FILE_KEYS; src/debug/call.mjs checks their values), else TokenError
export function callFileRequest(t, name, text) {
  let q;
  try { q = JSON.parse(text); } catch (e) { throw new TokenError(`${t}: ${name}: not JSON (${e.message})`); }
  if (q === null || typeof q !== 'object' || Array.isArray(q)) throw new TokenError(`${t}: ${name}: a JSON object of the call op's fields (${CALL_FILE_KEYS.join(', ')})`);
  const bad = Object.keys(q).filter((k) => !CALL_FILE_KEYS.includes(k));
  if (bad.length) throw new TokenError(`${t}: ${name}: ${bad.map((k) => JSON.stringify(k)).join(', ')} not among the call op's fields (${CALL_FILE_KEYS.join(', ')})`);
  return q;
}
function parseExpect(t) {
  let m;
  if ((m = /^expect:gui([=~])(.+)$/.exec(t))) return { what: 'gui', op: m[1], text: m[2] };
  if ((m = /^expect:mem:([^=!]+)(!?=)(.*)$/.exec(t))) return { what: 'mem', addr: addrOf(t, m[1], 'the address'), op: m[2], hex: hexOf(t, m[3]) };
  if ((m = new RegExp(`^expect:setting:(${SETTING})(!?=)(-?(?:\\d+|0x[0-9a-fA-F]+))$`).exec(t))) return { what: 'setting', setting: settingOf(m[1]), op: m[2], value: m[3].startsWith('-') ? -Number(m[3].slice(1)) : Number(m[3]) };
  if ((m = /^expect:card:(.+)$/.exec(t))) return { what: 'card', path: dosPath(t, m[1]) };
  if ((m = /^expect:standin:([A-Z0-9][A-Z0-9-]*)$/.exec(t))) return { what: 'standin', name: m[1] };
  if ((m = /^expect:exif:([^:]+):([A-Za-z0-9]+)([=~])(.*)$/.exec(t))) {
    if (!FIELD_NAMES.has(m[2])) throw new TokenError(`${t}: field ${m[2]} is not one of ${[...FIELD_NAMES].join(', ')}`);
    return { what: 'exif', path: dosPath(t, m[1]), field: m[2], op: m[3], text: m[4] };
  }
  throw new TokenError(`${t}: expect:gui=NAME|~TEXT, expect:mem:ADDR=HEX|!=HEX, expect:setting:ID|NAME=V|!=V, expect:card:DOS/PATH, expect:standin:NAME, expect:exif:DOS/PATH:FIELD=TEXT|~TEXT`);
}

// A step's Player inputs (play's POST /api/input documents) for the kinds that are inputs; settle: the lab time after a
// press, a dial or a switch (card:out / card:in: the Player's card input, which waits its own lab time). Each wait of a
// step (wait:MS, a press's, a hold's, the settle) is a {type: 'wait', ms} of the session's, which openSession sends as
// 'WAIT:ms' tokens of at most WAIT_SLICE_MS toward the wait's end, as the idle player runs lab time (src/lab/player.mjs
// SLICE_NS, idle_slice toward its target): the camera application's stand-ins deliver at the end of each Player input
// (src/lab/play.mjs PlaySession end: camapp.tick, the DISPLAY and module replies, S-BOOTDONE, the timed callbacks), so
// one long WAIT held them to its end, and when the application's start-up finished depended on how a script divided its
// waits (X, 2026-11-14: 'wait:2000' and 'wait:1500 wait:500' before S1 gave Caduceus v0.29.1 two different Picture Mode
// pages). Each slice is what is left to the end, at most WAIT_SLICE_MS, measured from where the last one ended: an
// input can end past its lab time (the frame it publishes at the shown device's boundary), and slices of a fixed 50 ms
// added those overruns up (X, 2026-11-14, E143's shooting screen: wait:1500 took 1634.8 ms, wait:3000 3203.1 ms; one
// WAIT:1500 1534.8 ms). A play token 'WAIT:ms' is sent as written.
export const WAIT_SLICE_MS = 50;
export function stepInputs(st, settle = SETTLE_MS) {
  const wait = (ms) => [{ type: 'wait', ms }];
  const key = (id, action) => ({ type: 'key', id, action });
  switch (st.kind) {
    case 'press': return [key(st.id, 'down'), ...wait(PRESS_MS), key(st.id, 'up'), ...wait(settle)];
    case 'hold': return [key(st.id, 'down'), ...wait(st.ms), key(st.id, 'up'), ...wait(settle)];
    case 'edge': return [key(st.id, st.action)];
    case 'display': return [key(st.id, 'down'), ...wait(settle)];      // a display control's press (openSession: lv, eye)
    case 'dial': return [{ type: 'dial', id: st.id.replace(/_dial$/, ''), detents: st.detents }, ...wait(settle)];   // the Player's dial ids: main, sub
    case 'wait': return wait(st.ms);
    case 'token': return [{ type: 'token', token: st.token }];
    case 'switch': return [{ type: 'switch', id: st.id, ...('value' in st ? { value: st.value } : { step: st.by }) }, ...wait(settle)];
    case 'power': return [{ type: 'switch', id: 'power', value: 0 }];
    case 'card': return [{ type: 'card', action: st.action, ...(st.slot !== 1 ? { slot: st.slot } : {}) }];
    case 'read': return [{ type: 'debug', op: 'read', addr: st.addr, size: st.len }];
    case 'setting': return [{ type: 'debug', op: 'setting', setting: st.id ?? st.setting }];
    case 'write': return [{ type: 'debug', op: 'write', addr: st.addr, hex: st.hex }];
    case 'call':
      if (st.file !== undefined && !st.request) throw new TokenError(`${st.text}: the request is read from the file by openSession (callFile)`);
      return [st.request ?{ type: 'debug', op: 'call', ...st.request } : { type: 'debug', op: 'call', fn: st.fn, regs: st.regs, ...(st.limit !== null ? { limit: st.limit } : {}), ...(st.space ? { space: st.space } : {}),
      ...(st.entry !== undefined ? { entry: st.entry } : {}), ...(st.stops ? { stops: st.stops } : {}), ...(st.frame ? { frame: st.frame } : {}) }];
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
  if (e.what === 'setting') {
    const r = got.setting(e.id ?? e.setting);
    return (r.value === e.value) === (e.op === '=') ? null : `setting ${r.id}${r.name ? ` (${r.name})` : ''} reads ${r.value}, want ${e.op === '=' ? '' : 'anything but '}${e.value}`;
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
  const { codePc, notationOf } = await import('../src/debug/live.mjs');
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
  const { callSpec } = await import('../src/debug/call.mjs');
  const { frameSource } = await import('../src/lab/sources.mjs');
  const { settingNames } = await import('./setnames.mjs');
  const { SettingNameError } = await import('../src/fw/setnames.mjs');
  const say = o.say ?? (() => {});
  const settle = o.settle ?? SETTLE_MS;
  const out = o.out ? path.resolve(o.out) : null;
  const local = (p) => path.resolve(out ?? '.', p);

  // the tokens given up front, checked before the boot: the grammar, then the controls this model has
  const checkStep = (st) => {
    const id = st.kind === 'power' ? 'power' : st.id;
    if (id !== undefined && !BY_ID.has(id)) throw new TokenError(`${st.text}: ${MODEL} has no control ${JSON.stringify(id)} (${[...BY_ID.keys()].filter((k) => !k.startsWith('fw_')).join(', ')}, fw_<code>)`);
    if (st.kind === 'dial' && BY_ID.get(id).kind !== 'dial') throw new TokenError(`${st.text}: ${id} is not a dial (main_dial, sub_dial)`);
    // a display control (lv, eye): the Player switches the display at its key's down and takes no up (player.mjs), so
    // the token is the down and the settle (a toggle); an edge or a hold of it is refused
    if (id !== undefined && BY_ID.get(id).kind === 'display' && ['press', 'hold', 'edge'].includes(st.kind)) {
      if (st.kind !== 'press') throw new TokenError(`${st.text}: ${id} switches the display at its press (the token ${id}${id === 'eye' ? ', or switch:eye=1|0' : ''}); it has no down, up or hold of its own`);
      return { ...st, kind: 'display' };
    }
    if (['card-ls', 'card-get', 'exif'].includes(st.kind) || st.expect?.what === 'card' || st.expect?.what === 'exif') {
      if (!STORAGE) throw new TokenError(`${st.text}: ${MODEL} has no card with a file system in the lab (S-CARD)`);
    }
    if (st.kind === 'card' && !STORAGE?.hls) throw new TokenError(`${st.text}: ${MODEL} has no card with its HLS media side in the lab (src/fw/models.mjs card_fs.hls)`);
    // a setting by name (setting:, expect:setting:, play's GET: and SET:): resolved in this body's table now, an unknown
    // name refused before the boot; the step carries the id and the name
    const named = (text, v) => {
      if (typeof v === 'number') { const n = namesOr(); return { id: v, name: n ? n.name(v) : null }; }
      try { return settingNames(MODEL).resolve(v); } catch (e) {
        if (e instanceof SettingNameError) throw new TokenError(`${text}: ${e.message}`);
        throw e;
      }
    };
    if (st.kind === 'setting') return { ...st, ...named(st.text, st.setting) };
    if (st.expect?.what === 'setting') return { ...st, expect: { ...st.expect, ...named(st.text, st.expect.setting) } };
    const gs = st.kind === 'token' ? /^(GET|SET):([^=]+)(=.*)?$/.exec(st.token) : null;
    if (gs) {
      const s = named(st.text, /^[A-Z]/.test(gs[2]) ? gs[2] : intValue(gs[2]) ?? gs[2]);
      return { ...st, token: `${gs[1]}:${s.id ?? gs[2]}${gs[3] ?? ''}`, setting: s };
    }
    if (st.kind === 'call' && st.file !== undefined) {           // call:@FILE: the request read and checked now
      const file = local(st.file);
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new TokenError(`${st.text}: ${file}: cannot read it (${e.code ?? e.message})`); }
      const request = callFileRequest(st.text, file, text);
      try { callSpec(request); } catch (e) { if (e?.name !== 'BadRequest') throw e; throw new TokenError(`${st.text}: ${file}: ${e.message}`); }
      return { ...st, request };
    }
    return st;
  };
  // the names where an id is printed (null where the body's firmware offers none: an id needs no name)
  const namesOr = () => { try { return settingNames(MODEL); } catch (e) { if (e instanceof SettingNameError) return null; throw e; } };
  const parse = (t) => checkStep(parseToken(t));
  const planned = (o.tokens ?? []).map(parse);
  const pairs = (list, what) => (list ?? []).map((item) => {
    const at = item.indexOf('=');
    if (at <= 0 || at === item.length - 1) throw new TokenError(`${what} ${item}: DOS/PATH=LOCAL`);
    return { path: item.slice(0, at), local: item.slice(at + 1) };
  });
  const puts = pairs(o.cardPut, '--card-put'), gets = pairs(o.cardGet, '--card-get');
  // play's --a15 and --device: the A15 guard's mode (auto: under play's bracket guard) and the device shown at the start
  // (the eye sensor's or LV's switch tokens change it later; shot: takes the shown device's frame)
  const a15Arg = o.a15 ?? 'auto', deviceArg = o.device ?? 'tft', osdPolicy = o.osdErrors ?? (OSD_FAIL_BODIES.has(MODEL) ? 'fail' : 'report');
  if (!['fail', 'report'].includes(osdPolicy)) throw new TokenError(`--osd-errors ${osdPolicy}: fail or report`);
  if (!['auto', 'off', 'on'].includes(a15Arg)) throw new TokenError(`--a15 ${a15Arg}: auto, off or on`);
  if (!['tft', 'evf'].includes(deviceArg)) throw new TokenError(`--device ${deviceArg}: tft or evf`);
  if (deviceArg === 'evf' && !BY_ID.has('eye')) throw new TokenError(`--device evf: ${MODEL} has no eye sensor in the lab (no EVF to start on)`);
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
  // --no-card: the first slot empty at the start (src/lab/storage.mjs, the holder's out); the card is put in by card:in
  if (o.noCard) {
    if (!STORAGE?.hls) throw new SessionRefused(`--no-card: ${MODEL} has no card with its HLS media side in the lab (src/fw/models.mjs card_fs.hls)`);
    card.out = true;
  }
  if (STORAGE) say(`${cardFile ? `card ${cardFile} (written back in place)${putFiles.length ? `; --card-put ${putFiles.map((f) => `${f.path} (${f.bytes.length} bytes)`).join(', ')}` : ''}` : 'card: a blank card in memory (the firmware formats it)'}${o.noCard ? '; the slot empty at the start (--no-card; card:in puts it in)' : ''}`);
  if (out) { try { fs.mkdirSync(out, { recursive: true }); } catch (e) { throw new SessionRefused(`--out ${out}: cannot make it (${e.code ?? e.message})`); } }

  // the Player's options and env, as play's lab worker makes them (host/labworker.mjs), idle off
  const a = { ...PLAYER_PARSER, no_browser: true, idle: 'off', debug_api: true, out: out ?? '<out>', no_wait_on_error: true, hdmi: 'off', audio: 'auto', rotate: 'off',
    take: 'stand-in', cpu2: 'stand-in', creative_dial: o.creativeDial ?? null, held: o.held ?? [], a15: a15Arg, device: deviceArg };
  let frame = null, sessionNo = 0;
  const baseEnv = { rom: fw?.rom ?? E.loadImage(), resBlock: fw?.resBlock ?? E.loadBlock(), nand: E.loadNand(), createHash: E.createHash, ...E.scpuEnv(),
    ...(fw ? { patch: fw.summary, patchRanges: fw.changed } : {}), loaded: o.loaded ?? 'auto',
    deflate: (b, level) => new Uint8Array(zlib.deflateSync(b, { level })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)),
    wallClock: () => Number(process.hrtime.bigint()) / 1e9, debugHost: { holdStop: (r) => holdStop(r), settingNames: () => settingNames(MODEL) },
    onFrame: (w, h, raw, meta) => { frame = { w, h, raw: raw.slice(), sha16: meta.sha16, device: meta.device }; }, onAudio: () => {} };
  const envFor = (k) => ({ ...baseEnv, card, ...(nv.file ? { nvram: fileNvram(nv.file) } : {}),
    ...(out ? { logSink: (name, text) => { const f = path.join(out, `session-${k}${name.slice('session'.length)}`); if (name.endsWith('.jsonl')) fs.appendFileSync(f, text); else fs.writeFileSync(f, text); } } : {}) });

  const records = [], pokes = [], harness = [], calls = [], errors = [], standins = new Set();
  let pl = null, failed = null, tasks = new Set(), audit = null, closed = false, lastFrameError = null;
  // traces and stops: the armed sets (run-time pcs, ranges {addr, len, kind}), the arming steps, the hits' totals; the
  // record whose inputs run now (a stop ends it, resume's takes over), the stop held now and the one the run ended at,
  // where a held stop's tokens come from (run()'s list; else options.atStop), the records completed
  const traced = { pcs: [], mem: [], stack: new Map() }, stops = { pcs: [], mem: [] }, armedLog = [], hitTotals = new Map(), completed = new WeakSet();
  let hitsDropped = 0, stopCount = 0, running = null, held = null, ended = null, source = null, stopError = null;
  const fail = (rec, message) => { rec.ok = false; rec.error = message; failed ??= { step: rec.step, token: rec.token, message }; errors.push(`step ${rec.step} (${rec.token}): ${message}`); };
  const labMessage = () => pl?.error?.message ?? 'the session stopped';
  // the OSD engine's refusals since the last record ({NAME: count}, src/dev/engine.mjs failures), or null; the firmware
  // goes on after one and the picture is not drawn, so a record says so. A restart's machine has its own engine
  let osdEngine = null, osdSeen = {};
  const osdErrors = () => {
    const eng = pl?.session?.lab?.sim?.m?.devices?.engine ?? null;
    if (eng !== osdEngine) { osdEngine = eng; osdSeen = {}; }
    if (!eng) return null;
    const d = {};
    for (const [k, v] of Object.entries(eng.failures)) if (v > (osdSeen[k] ?? 0)) d[k] = v - (osdSeen[k] ?? 0);
    osdSeen = { ...eng.failures };
    return Object.keys(d).length ? d : null;
  };
  // --osd-errors fail (the default on OSD_FAIL_BODIES): a step whose OSD engine refused a picture fails, as a picture
  // the lab could not draw is not verified; report (the default elsewhere): the record only lists them
  const osdFail = (rec, osd) => {
    rec.osd_errors = osd;
    const n = Object.values(osd).reduce((x, y) => x + y, 0);
    if (osdPolicy === 'fail' && rec.ok) fail(rec, `the OSD engine refused ${n} picture(s) (${Object.entries(osd).map(([k, v]) => `${k} ${v}`).join(', ')}), not drawn; --osd-errors report only reports them`);
  };
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
    if (out) {                                     // a companion an earlier run left would start this session's replay there
      for (const c of ['carried', 'card']) {
        try { fs.unlinkSync(path.join(out, `session-${sessionNo}.${c}.json`)); } catch (e) { if (e.code !== 'ENOENT') throw new SessionRefused(`--out ${out}: cannot clear session-${sessionNo}.${c}.json (${e.code ?? e.message})`); }
      }
    }
    pl = new Player(a, envFor(sessionNo));
    pl.off_positions = positions;
    pl.open_session();
  };
  const closePlayer = () => {
    if (!pl) return;
    note();
    try { pl.close_session(); } finally { pl.write_log(); }
  };
  // stepInputs' list as the Player's inputs: each {type: 'wait', ms} as WAIT tokens toward the wait's end (stepInputs),
  // the next slice taken after the last one ran (a generator); with no session (after power:off) one WAIT:ms, which
  // the Player answers as before
  function* playerInputs(list) {
    const now = () => pl?.session?.lab?.lab_time() ?? null;
    for (const inp of list) {
      if (inp.type !== 'wait') { yield inp; continue; }
      const t0 = now();
      if (t0 === null) { yield { type: 'token', token: `WAIT:${inp.ms}` }; continue; }
      const end = t0 + inp.ms * 1e6;
      for (let t = t0; t !== null && t < end; t = now()) yield { type: 'token', token: `WAIT:${Math.min(WAIT_SLICE_MS, Math.ceil((end - t) / 1e6))}` };
    }
  }
  // one input through the Player's own loop (submit, then the tick that takes it): its result; at a debug stop (held,
  // inside a tick) a debug input is taken as the live route takes one there (live.mjs stopped)
  const apply = (inp) => {
    const seq = pl.submit(inp);
    if (held) {
      const x = pl.next_debug(false, false);
      if (x?.seq !== seq) throw new Error(`session: at a debug stop the Player took ${JSON.stringify(x)}, not input ${seq}`);
      pl.debug_input(x);
    } else pl.tick();
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
  // dump:ADDR:LEN:FILE: the debug read READ_MAX bytes at a time (a read that fails fails the step, the file unwritten);
  // the record names the ranges of it the boot does not load or is not shown to load under the loaded-ranges mode
  // (S-STALERAM): their bytes are the lab's fill, not anything the camera holds
  const dump = (st, rec) => {
    const out = new Uint8Array(st.len);
    for (let o = 0; o < st.len; o += READ_MAX) {
      const n = Math.min(READ_MAX, st.len - o);
      out.set(Buffer.from(memHex(st.addr + o, n), 'hex'), o);
    }
    const file = local(st.file);
    writeLocal(file, out);
    const un = pl?.session?.lab?.sim?.unloaded ?? null, hi = st.addr + st.len;
    const overlap = un ? un.gaps.filter((g) => g.lo < hi && g.hi > st.addr) : [];
    Object.assign(rec, { file, addr: h8(st.addr), len: st.len, sha256: createHash('sha256').update(out).digest('hex'),
      ...(overlap.length ? { unloaded: overlap.map((g) => ({ lo: h8(Math.max(g.lo, st.addr)), hi: h8(Math.min(g.hi, hi)), kind: g.kind ?? 'gap' })), fill: `0x${un.fill.toString(16)}` } : {}) });
  };

  // one step: its record (the JSON line); a failure ends the run
  const run = (st) => {
    const rec = { step: records.length, token: st.text, ok: true };
    records.push(rec);
    running = rec;
    try {
      if (failed) throw new SessionRefused(`the run failed at step ${failed.step}`);
      if (ended) throw new SessionRefused(`the run ended at the debug stop of step ${ended.step}`);
      if (held && !AT_STOP.has(st.kind)) {
        throw new SessionRefused(`${st.text}: at a debug stop only read:, dump:, write:, call:, expect:, card-ls, card-get:, exif:, shot:, trace:, break: and resume run (the firmware is held inside a tick); resume first`);
      }
      if (st.kind === 'restart') {
        const positions = pl?.phase === 'off' ? pl.off_positions : null;    // after power:off; else a battery pull, a fresh start
        drain(rec);                                // the old session's last hits, before its Player goes
        closePlayer();
        if (st.card) { cardFile = path.resolve(local(st.card)); card = fileCard(cardFile); rec.card = cardFile; }
        open(positions);
        rec.session = sessionNo;
        if (pl.phase === 'error') fail(rec, labMessage());
        else if (traced.pcs.length || traced.mem.length || stops.pcs.length || stops.mem.length) sendArmed(rec, true, true);   // the script's traces and stops, on the new session
      } else if (st.kind === 'trace' || st.kind === 'break') arm(st, rec);
      else if (st.kind === 'resume') {
        if (!held) throw new SessionRefused('resume: the session is not at a debug stop');
      } else if (st.kind === 'shot') {
        if (!frame) throw new SessionRefused('no frame published yet in this session');
        const file = local(st.file);
        writeLocal(file, pngRaw(frame.w, frame.h, frame.raw));
        rec.file = file;
        rec.size = [frame.w, frame.h];
        rec.device = frame.device;
        rec.source = frameSource(frame.device, !!pl.scene_used);     // what the picture is, in words (src/lab/sources.mjs)
      } else if (st.kind === 'dump') dump(st, rec);
      else if (st.kind === 'card-ls') rec.card = listing();
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
          card: (p) => find(p), exif: (p) => exifOf(p)?.fields ?? null, standins: pl ? pl.stand_ins_in_use() : [],
          setting: (v) => debugOp('setting', { setting: v }).setting });
        if (e.what === 'setting') rec.setting = { id: e.id, name: e.name };
        rec.expect = e.what;
        if (why !== null) fail(rec, `expect failed: ${why}`);
      } else {
        let last = null;
        for (const inp of playerInputs(stepInputs(st, settle))) {
          const before = pl.dropped.toObject(), res = apply(inp);
          last = res;
          const r = running;                       // after a debug stop and resume, resume's record carries the rest
          if (pl.phase === 'error') { fail(r, labMessage()); if (pl.error?.stderr_tail) r.stderr_tail = pl.error.stderr_tail; break; }
          if (res.error) { fail(r, res.error); break; }
          if (res.dropped) { fail(r, `the player dropped ${JSON.stringify(inp)} (${Object.keys(pl.dropped.toObject()).filter((k) => pl.dropped.toObject()[k] !== before[k]).join(', ') || 'no reason counted'})`); break; }
          if (pl.input_error && inp.type !== 'debug') { fail(r, `the input was not taken: ${pl.input_error}`); break; }
          if (res.debug) {
            // a call:@FILE request with mem writes memory the firmware did not (a poke, as input()'s call with mem)
            if (st.kind === 'call' && st.request?.mem?.length) pokes.push({ step: rec.step, token: st.text, mem: st.request.mem });
            if (!res.debug.ok) { fail(rec, `${inp.op}: ${res.debug.error?.type ?? 'error'}: ${res.debug.error?.message ?? JSON.stringify(res.debug.error)}`); break; }
            if (st.kind === 'read') rec.hex = res.debug.hex;
            if (st.kind === 'setting') rec.setting = res.debug.setting;
            if (st.kind === 'call') {
              const d = res.debug;
              Object.assign(rec, { fn: d.fn.notation, d0: d.regs.d0, steps: d.steps, stubs: d.stubs, regs: d.regs });
              // a mid-function call's entry, how it ended (a stop: which), a call:@FILE request's reads and scratch
              Object.assign(rec, { ...(d.entry ? { entry: d.entry.notation } : {}), end: d.end, ...(d.stop ? { stop: d.stop } : {}),
                ...(d.reads.length ? { reads: d.reads } : {}), ...(d.scratch !== null ? { scratch: d.scratch } : {}) });
              calls.push({ step: rec.step, fn: d.fn.notation });
            }
            if (st.kind === 'write') pokes.push({ step: rec.step, token: st.text, addr: h8(st.addr), hex: st.hex });
          }
        }
        if (st.kind === 'token' && HARNESS_TOKEN.test(st.token)) harness.push({ step: rec.step, token: st.token });
        // play's GET: and SET: (by id or by name): the setting with its name, and what the Player's record read
        if (st.kind === 'token' && st.setting && rec.ok) {
          const got = last?.record?.get ?? last?.record?.set ?? null;
          rec.setting = { id: st.setting.id, name: st.setting.name, ...(got ? { value: got.read_back ?? got.value } : {}) };
        }
      }
    } catch (e) {
      if (e instanceof StopEnd) {                // the script ended at a debug stop, or a step there failed: nothing ran after it
        if (stopError) { const u = stopError; stopError = null; throw u; }
        return running;
      }
      if (BUG(e) && !(e instanceof LabError)) throw e;
      fail(running, e instanceof SessionRefused || e instanceof CardFsError ? e.message : `${e.name}: ${e.message}`);
    }
    return complete(running, st.kind);
  };
  // a step's record finished: the session's state after it, the probes' hits, and onRecord (once per record)
  const complete = (rec, kind = null) => {
    if (completed.has(rec)) return rec;
    completed.add(rec);
    try {
      if (pl?.session) pl.publish_status();
    } catch (e) { if (BUG(e)) throw e; }
    const st2 = pl?.status_doc ?? {};
    Object.assign(rec, { phase: pl?.phase ?? null, lab_ns: pl?.session?.lab?.lab_time() ?? null, gui: pl?.session ? st2.gui_name ?? null : null, frame: pl?.frame?.[3] ?? null });
    if (kind === 'restart') {
      rec.nvram = st2.nvram ?? null;          // the stores the new session restored (S-NVRAM)
      rec.carried = st2.carried ?? null;      // the controls' positions carried from power:off (null: a fresh start)
    }
    if (pl?.frame_error && pl.frame_error !== lastFrameError) rec.frame_error = pl.frame_error;     // once, when it changes
    lastFrameError = pl?.frame_error ?? null;
    const osd = osdErrors();
    if (osd) osdFail(rec, osd);
    drain(rec);
    note();
    o.onRecord?.(rec);
    return rec;
  };

  // ---- traces and stops (trace:, break:, resume): the live debug route's probe, break and watch ops on the
  // session's Player (src/debug/live.mjs), the script's armed sets sent whole at each change and after each restart
  const label = (w) => `${h8(w.addr)}+${w.len}:${w.kind}`;
  const describe = () => ({ trace: { pcs: traced.pcs.map((pc) => h8(notationOf(pc))), mem: traced.mem.map(label),
      ...(traced.stack.size ? { stack: Object.fromEntries([...traced.stack].map(([pc, n]) => [h8(notationOf(pc)), n])) } : {}) },
    break: { pcs: stops.pcs.map((pc) => h8(notationOf(pc))), mem: stops.mem.map(label) } });
  const debugOp = (op, body) => {
    const r = apply({ type: 'debug', op, ...body });
    if (!r.debug?.ok) throw new SessionRefused(`${op}: ${r.debug?.error?.message ?? r.error ?? 'refused'}`);
    return r.debug;
  };
  const sendArmed = (rec, probes, breaks) => {
    if (!pl?.session) throw new SessionRefused(`no session to arm (${pl?.phase ?? 'none'}): restart first`);
    if (breaks) {
      // a pc the lab hooks stops before the hook answers (the stop's record names it, stopped.hook)
      const hooks = pl.session.lab?.hooks ?? new Map(), hooked = stops.pcs.filter((pc) => hooks.has(pc));
      if (hooked.length) rec.hooked_breaks = hooked.map((pc) => ({ pc: h8(notationOf(pc)), hook: hooks.get(pc)[1] }));
      debugOp('break', { pcs: stops.pcs });
      debugOp('watch', { list: stops.mem.map((w, i) => ({ id: i, addr: w.addr, len: w.len, kind: w.kind, action: 'stop' })) });
    }
    if (probes) {
      const p = debugOp('probe', { pcs: traced.pcs, mem: traced.mem.map((w) => ({ addr: w.addr, len: w.len, kind: w.kind })), stack: [...traced.stack] });
      if (p.hooked.length) rec.hooked = p.hooked;
    }
    rec.armed = describe();
  };
  const arm = (st, rec) => {
    const set = st.kind === 'trace' ? traced : stops, was = { pcs: [...set.pcs], mem: [...set.mem], stack: new Map(set.stack ?? []) };
    if (st.kind === 'break' && !st.off && !source && !o.atStop) throw new SessionRefused('break: a debug stop runs the script\'s next tokens where it is held: run() (bin/session.mjs) or options.atStop gives them, a lone step() does not');
    if (st.off) { set.pcs = []; set.mem = []; set.stack?.clear(); } else {
      for (const a of st.pcs ?? []) {
        const pc = codePc(a, 'pc');
        if (!set.pcs.includes(pc)) set.pcs.push(pc);
        if (set.stack) { if (st.stack) set.stack.set(pc, st.stack); else set.stack.delete(pc); }   // the pc's last trace: token's stack=
      }
      if (st.mem) set.mem.push(st.mem);
    }
    try { sendArmed(rec, st.kind === 'trace', st.kind === 'break'); } catch (e) { set.pcs = was.pcs; set.mem = was.mem; if (set.stack) set.stack = was.stack; throw e; }
    armedLog.push({ step: rec.step, token: st.text });
  };
  // the probes' hits since the last record onto rec (at most HITS_PER_STEP, the rest counted), and their counts
  const drain = (rec) => {
    const L = pl?.live ?? null;
    if (L === null || (armedLog.length === 0 && !L.hitLog.length && !L.hitDropped)) return;
    const h = L.take_hits(HITS_PER_STEP);
    const key = (k) => (k.startsWith('mem:') ? `mem ${traced.mem[Number(k.slice(4))] ? label(traced.mem[Number(k.slice(4))]) : k}` : k);
    if (h.hits.length) rec.hits = h.hits.map((x) => (x.kind === 'mem' ? { ...x, range: traced.mem[x.range] ? label(traced.mem[x.range]) : x.range } : x));
    if (h.dropped) { rec.hits_dropped = h.dropped; hitsDropped += h.dropped; }
    const c = Object.entries(h.counts).map(([k, v]) => [key(k), v]);
    if (c.length) rec.hit_counts = Object.fromEntries(c);
    for (const [k, v] of c) hitTotals.set(k, (hitTotals.get(k) ?? 0) + v);
  };
  // the live route's holdStop: the firmware is held at a debug stop inside the tick of running's input; the record ends
  // there, the script's next tokens run at the stop until resume (whose record carries the rest of that step), and the
  // script's end or a failure there ends the run at the stop (StopEnd unwinds the tick: nothing runs after it)
  const holdStop = (srec) => {
    const rec = running, rt = Number(srec.regs.pc);
    rec.stopped = { kind: srec.stop, pc: h8(notationOf(rt)), lab_ns: srec.lab_ns, regs: srec.regs, ...(srec.hook ? { hook: srec.hook } : {}),
      ...(srec.watch ? { watch: { range: stops.mem[srec.watch.id] ? label(stops.mem[srec.watch.id]) : srec.watch.id, addr: srec.watch.addr, size: srec.watch.size, dir: srec.watch.dir, value: srec.watch.value, pc: h8(notationOf(Number(srec.watch.pc))) } } : {}) };
    stopCount += 1;
    held = { step: rec.step, token: rec.token, kind: srec.stop, pc: rec.stopped.pc, lab_ns: srec.lab_ns };
    try {
      complete(rec);
      for (;;) {
        const t = source ? source.next() : o.atStop ? o.atStop(rec) ?? null : null;
        if (t === null) { ended = held; throw new StopEnd(); }
        let st2;
        try { st2 = parse(t); } catch (e) { stopError = e; ended = held; throw new StopEnd(); }
        if (st2.kind === 'resume') {
          const r = { step: records.length, token: st2.text, ok: true, resumed: { step: held.step, pc: held.pc } };
          records.push(r);
          running = r;
          return;
        }
        const r = run(st2);
        if (!r.ok) { ended = held; throw new StopEnd(); }
      }
    } finally { held = null; }
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
    const osd = osdErrors();
    if (osd) osdFail(rec, osd);
    note();
  }

  const summary = () => {
    let cardRows = null;
    if (STORAGE) { try { cardRows = listing(); } catch (e) { if (BUG(e)) throw e; cardRows = { error: e.message }; } }
    return { summary: true, ok: failed === null, model: MODEL, osd_errors_policy: osdPolicy, patch: fw ? patchLine(fw.summary) : null, patch_audit: audit ?? startAudit, stand_ins: [...standins], pokes, harness_inputs: harness, calls,
      card: cardRows, card_file: cardFile, nvram: nv.file, errors: [...errors], steps: records.length, failed,
      traces: armedLog.length ? { armed: armedLog, now: describe(), counts: Object.fromEntries(hitTotals), hits_dropped: hitsDropped, stops: stopCount } : null, ended_at_stop: ended };
  };
  return {
    model: MODEL,
    records,
    get failed() { return failed; },
    get player() { return pl; },
    first: records[0],
    step: (t) => run(parse(t)),
    run: (texts) => {
      const list = texts ?? planned.map((x) => x.text), n0 = records.length, prev = source;
      let i = 0;
      source = { next: () => (i < list.length ? list[i++] : null) };      // a debug stop's tokens: the list's next ones
      try {
        while (i < list.length) { const r = run(parse(list[i++])); if (!r.ok || failed || ended) break; }
      } finally { source = prev; }
      return records.slice(n0);
    },
    planned: planned.map((x) => x.text),
    input: (inp) => {
      if (inp?.type === 'debug' && (['write', 'setReg', 'setRegs'].includes(inp.op) || (inp.op === 'call' && inp.mem))) pokes.push({ step: records.length, token: 'input', input: inp });
      const res = apply(inp);
      if (inp?.type === 'token' && typeof inp.token === 'string' && HARNESS_TOKEN.test(inp.token)) harness.push({ step: records.length, token: inp.token, via: 'input' });
      if (inp?.type === 'debug' && inp.op === 'call' && res.debug?.ok) calls.push({ step: records.length, fn: res.debug.fn.notation, via: 'input' });
      return res;
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
