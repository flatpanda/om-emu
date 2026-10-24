#!/usr/bin/env node
// The publication audit: run before anything is pushed to the public repository. It checks every blob reachable from
// the audited history (each blob id once, with every path it was committed at), every commit's identity and message,
// and exits 1 with the list of findings. Rules (the finding's name first):
//   path          a forbidden path: fw/, unpacked/, emu/out/, *.bin / *.BIN, .claude/, scratch and editor files, key
//                 and environment files, the updater's reply XML, node_modules/; or a path the repository's own
//                 .gitignore ignores
//   gitlink       a submodule entry (its content cannot be reviewed here)
//   size          a blob over --max-size (1 MiB)
//   binary        content that is not text: a NUL byte or invalid UTF-8
//   private-path  a home directory (under /Users, /home or C:\Users), /private/tmp, /var/folders, a sandbox
//                 directory (claude-NNN), .claude/ session state, a claude.ai session link
//   email         an address other than a noreply or example one
//   marker        a local private marker (--marker TEXT, or `git config --add pubaudit.marker TEXT`, which stays in
//                 .git/config and is never published), case-insensitive, in content, paths and commit messages
//   secret        GitHub, AWS, Slack, Anthropic, OpenAI, Google, GitLab and npm tokens, private-key headers,
//                 credentials in a URL, and random-looking tokens of 40 characters or more (randomToken)
//   hex-literal   a run of more than 128 hex digits (longer than any digest) that is not a fill
//   base64        a data: URI, or a base64 run of 1024 characters or more that is not a fill
//   firmware      a chunk of a local firmware image. Every 16-byte-aligned 32-byte window of every block of every
//                 .BIN under fw/ (descrambled; and of the unpacked blocks whose .BIN is absent) is matched against
//                 the raw bytes of binary blobs and the bytes decoded from text (hex runs; hex and decimal byte,
//                 halfword and word lists; address-prefixed listings: objdump, hexdump, xxd; base64), so any
//                 verbatim copy of 47 bytes or more is caught; and the text of text blobs is matched against the
//                 firmware's printable windows. Two kinds are allowed: a listing that matches at most LISTING_BUDGET
//                 bytes in a blob (a short disassembly excerpt), and quoted strings (the firmware's strings end in
//                 NUL, so a quoted one is a run no longer than the string; a run of text over TEXT_RUN_MAX bytes is
//                 a copied text resource). The published SHA-256 and CRC-32 tables are not firmware
//                 (publicTables). Without firmware on disk this rule is skipped with a warning.
//   identity      a commit author or committer whose address is not a noreply one
// Commit messages go through the text rules too. Windows with fewer than 8 distinct byte values (padding, fills,
// rules of dashes) are not compared. Known exceptions are the reviewed ALLOW list below, each with its reason; a
// binary or firmware exception names the exact blob, so a changed file is reviewed again.
//   node emu/bin/pubaudit.mjs [REF ...] [--since REF ...] [--fw PATH ...] [--no-fw] [--marker TEXT ...]
//                             [--max-size BYTES] [--all] [--explain N]
//     REF: what to audit, with its whole history (default: release, else HEAD; A..B is B --since A); --since REF
//     leaves out what REF already holds (the routine pre-push run); --fw: firmware files or directories (default:
//     fw/ and unpacked/ at the repository's root); --all: every finding, not the first 20 per rule; --explain N:
//     the first N matched runs of each firmware finding.
//     Exit 0: clean; 1: findings; 2: usage or git error.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { walk, descramble, TYPES } from '../src/fw/olyfw.mjs';

const PROG = 'pubaudit.mjs';
const USAGE = 'usage: node emu/bin/pubaudit.mjs [REF ...] [--since REF ...] [--fw PATH ...] [--no-fw] [--marker TEXT ...] [--max-size BYTES] [--all] [--explain N]';
export const WIN = 32, MIN_DISTINCT = 8;
export const MAX_SIZE = 1 << 20, LISTING_BUDGET = 512, TEXT_RUN_MAX = 128;
const SHOW = 20;

// The reviewed exceptions. rule and path (a glob: * within a directory, ** across) select the finding; blob (a prefix
// of the blob id) pins binary content; max caps a size exception.
export const ALLOW = [
  { rule: 'size', path: '**/isa_vectors.json', max: 2 << 20,
    reason: 'the recorded ISA vectors: instruction encodings and register values, memory from a seeded generator (about 1.3 MB)' },
  { rule: 'firmware', path: 'artifacts/nd128/manifest.json', blob: 'aef7d3028a',
    reason: "the ND128 patch's preimage at its patch site (58 bytes of E143 code), as tools/om1_nd128.py records it" },
];

// ---- path rules
const PATH_RULES = [
  [/^fw\//, 'the firmware directory fw/'],
  [/(?:^|\/)unpacked\//, 'unpacked firmware blocks'],
  [/^emu\/out\//, 'emu/out/: run output derived from firmware'],
  [/\.bin$/i, 'a .bin / .BIN image'],
  [/(?:^|\/)\.claude\//, 'assistant session state (.claude/)'],
  [/(?:^|\/)(?:\.DS_Store|Thumbs\.db|core)$|~$|\.(?:swp|swo|tmp|orig|rej|bak|log)$/, 'an editor, scratch or crash file'],
  [/(?:^|\/)(?:scratch|scratchpad)\//, 'a scratch directory'],
  [/(?:^|\/)node_modules\//, 'node_modules/'],
  [/(?:^|\/)\.env(?:\.[^/]*)?$|\.(?:pem|key|p12|pfx|keystore)$|(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/, 'a key or environment file'],
  [/_reply\.xml$/, "the updater API's reply (it carries the vendor's terms)"],
];

// ---- text rules: [rule, regex (global), what]
const TEXT_RULES = [
  ['private-path', /(?<![\w.~$-])\/(?:Users|home)\/[A-Za-z0-9._-]+/g, 'a home directory'],
  ['private-path', /\/private\/(?:tmp|var)\/|\/var\/folders\/|\b[A-Za-z]:\\+Users\\+/g, 'a private temporary or home directory'],
  ['private-path', /\bclaude-\d{3,}\b/g, 'a sandbox directory'],
  ['private-path', /\.claude\/(?:worktrees|projects|todos|settings|plans)\b/g, 'assistant session state'],
  ['private-path', /claude\.ai\/code\/session_\w+/g, 'a claude.ai session link'],
  ['secret', /\bgh[pousr]_[A-Za-z0-9]{36,}/g, 'a GitHub token'],
  ['secret', /\bgithub_pat_[A-Za-z0-9_]{50,}/g, 'a GitHub fine-grained token'],
  ['secret', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g, 'a private key'],
  ['secret', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'an AWS access key id'],
  ['secret', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'a Slack token'],
  ['secret', /\bsk-ant-[A-Za-z0-9_-]{20,}/g, 'an Anthropic API key'],
  ['secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g, 'an OpenAI API key'],
  ['secret', /\bAIza[0-9A-Za-z_-]{35}\b/g, 'a Google API key'],
  ['secret', /\bnpm_[A-Za-z0-9]{36}\b/g, 'an npm token'],
  ['secret', /\bglpat-[A-Za-z0-9_-]{20,}/g, 'a GitLab token'],
  ['secret', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+:[^\s/@'"`]+@[\w.-]+/g, 'credentials in a URL'],
  ['secret', /(?<![A-Za-z0-9_+=-])[A-Za-z0-9_+=-]{40,}(?![A-Za-z0-9_+=-])/g, 'a high-entropy token'],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, 'an email address'],
  ['hex-literal', /(?<![0-9A-Za-z])[0-9A-Fa-f]{129,}(?![0-9A-Za-z])/g, 'a hex run longer than any digest'],
  ['base64', /\bdata:[\w.+-]+\/[\w.+-]+(?:;[\w=-]+)*;base64,/g, 'a data: URI'],
  ['base64', /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{1024,}={0,2}/g, 'a base64 run'],
];
const EMAIL_OK = [/^(?:noreply|no-reply)@/i, /@users\.noreply\.github\.com$/i, /@example\.(?:com|org|net)$/i, /\.(?:invalid|test|example|localhost)$/i, /^git@/];
// A token that looks random: 40 characters or more of base64url (a slash ends it, so paths and links do not run
// together), mixed case, at least 3 digits, not hex, not an alphabet, and at least 4.5 bits of entropy per character. The longest identifiers here (guardTrig2KeyIn_SECOND_WAIT_To_READY_TRIG2,
// 4.48 bits) have fewer digits; 98% of random base64url tokens of 40 characters pass the entropy bound, all of 48.
// Shorter secrets are left to the patterns above.
function randomToken(s) {
  if (s.length < 40 || isHex(s) || !/[A-Z]/.test(s) || !/[a-z]/.test(s) || (s.match(/\d/g) ?? []).length < 3 || /ABCDEFGH|abcdefgh|01234567/.test(s)) return false;
  const count = new Map();
  for (const ch of s) count.set(ch, (count.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of count.values()) h -= (c / s.length) * Math.log2(c / s.length);
  return h >= 4.5;
}
// name@digest.json is a file name, not an address
const FILE_EXT = /\.(?:json|jsonl|mjs|js|md|txt|png|bin|html|css|sha256|log|xml|py|sh|c|h)$/i;
const IDENTITY_OK = [/^(?:noreply|no-reply)@/i, /@users\.noreply\.github\.com$/i];

// ---- the 32-byte window keys. A window's hash is a polynomial over its eight little-endian u32 words at byte
// offsets 0, 4, ..., 28, under two multipliers, mixed: rolled at every byte offset on the audited side, computed per
// aligned 16-byte group on the firmware side (h = prev * P^4 + group), so both see the same key for the same bytes.
const P1 = 0x01000193, P2 = 0x5bd1e995, SALT = 0x27d4eb2f;
const pw = (p, k) => { let r = 1; for (let i = 0; i < k; i++) r = Math.imul(r, p); return r; };
const P1_2 = pw(P1, 2), P1_3 = pw(P1, 3), P1_4 = pw(P1, 4), P1_7 = pw(P1, 7);
const P2_2 = pw(P2, 2), P2_3 = pw(P2, 3), P2_4 = pw(P2, 4), P2_7 = pw(P2, 7);
const fmix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
const NOT_TEXT = new Uint8Array(256).map((_, c) => (c >= 0x7f || (c < 0x20 && c !== 9 && c !== 10 && c !== 13)) ? 1 : 0);

// fn(pos, k1, k2) for each WIN-byte window of u8 with at least MIN_DISTINCT distinct byte values (and, with text,
// printable ASCII, tab, LF and CR only); k2 is never 0.
export function windows(u8, text, fn) {
  const n = u8.length;
  if (n < WIN) return;
  const cnt = new Int32Array(256), r1 = new Int32Array(4), r2 = new Int32Array(4);
  let distinct = 0, bad = 0;
  const word = (i) => u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24);
  for (let i = 0; i < WIN; i++) { if (cnt[u8[i]]++ === 0) distinct++; bad += NOT_TEXT[u8[i]]; }
  for (let i = 0; ; i++) {
    let h1 = 0, h2 = 0;
    if (i < 4) {
      for (let k = 0; k < WIN; k += 4) { const w = word(i + k); h1 = (Math.imul(h1, P1) + w) | 0; h2 = (Math.imul(h2, P2) + w) | 0; }
    } else {
      const o = word(i - 4), w = word(i + 28), j = i & 3;
      h1 = (Math.imul((r1[j] - Math.imul(o, P1_7)) | 0, P1) + w) | 0;
      h2 = (Math.imul((r2[j] - Math.imul(o, P2_7)) | 0, P2) + w) | 0;
    }
    r1[i & 3] = h1; r2[i & 3] = h2;
    if (distinct >= MIN_DISTINCT && (!text || bad === 0)) fn(i, fmix(h1), (fmix(h2 ^ SALT) | 1) >>> 0);
    if (i + WIN >= n) break;
    const out = u8[i], inn = u8[i + WIN];
    if (--cnt[out] === 0) distinct--;
    if (cnt[inn]++ === 0) distinct++;
    bad += NOT_TEXT[inn] - NOT_TEXT[out];
  }
}

// An open-addressing set of (k1, k2) keys with a u32 value each; grows.
class KeyTable {
  constructor(bits = 16) { this.init(bits); }
  init(bits) { this.bits = bits; this.mask = (1 << bits) - 1; this.t = new Uint32Array(3 << bits); this.n = 0; }
  // the value stored under the key, or -1
  get(k1, k2) {
    const t = this.t, m = this.mask;
    for (let s = k1 & m; ; s = (s + 1) & m) {
      const b = 3 * s, x = t[b + 1];
      if (x === 0) return -1;
      if (x === k2 && t[b] === k1) return t[b + 2];
    }
  }
  // stores v unless the key is there; returns true when added
  add(k1, k2, v) {
    const t = this.t, m = this.mask;
    for (let s = k1 & m; ; s = (s + 1) & m) {
      const b = 3 * s, x = t[b + 1];
      if (x === 0) {
        t[b] = k1; t[b + 1] = k2; t[b + 2] = v;
        if (++this.n * 2 > m) this.grow();
        return true;
      }
      if (x === k2 && t[b] === k1) return false;
    }
  }
  grow() {
    const old = this.t;
    this.init(this.bits + 1);
    for (let b = 0; b < old.length; b += 3) if (old[b + 1]) this.add(old[b], old[b + 1], old[b + 2]);
  }
}

// ---- decoding bytes out of text: [{kind, at (character offset), bytes}]
const RUN = /(?<![0-9A-Za-z_.])(?:(?:0[xX])?[0-9A-Fa-f]{1,10}[ \t\r\n,]+){15,}(?:0[xX])?[0-9A-Fa-f]{1,10}(?![0-9A-Za-z_.])/g;
const HEXRUN = /(?<![0-9A-Za-z])[0-9A-Fa-f]{64,}(?![0-9A-Za-z])/g;
const DUMPLINE = /^[ \t]*(?:0[xX])?[0-9A-Fa-f]{4,16}:?[ \t]+([^\n]*)$/gm;
const B64RUN = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{64,}={0,2}(?![A-Za-z0-9+/=])/g;
const isHex = (s) => /^[0-9A-Fa-f]+$/.test(s);

function hexBytes(s) {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
  return out;
}
// values of `size` bytes each, little- or big-endian
function packValues(vals, size, be) {
  const out = new Uint8Array(vals.length * size);
  vals.forEach((v, i) => { for (let k = 0; k < size; k++) out[i * size + (be ? size - 1 - k : k)] = Math.floor(v / 2 ** (8 * k)) & 0xff; });
  return out;
}
const widthOf = (max) => (max <= 0xff ? 1 : max <= 0xffff ? 2 : max <= 0xffffffff ? 4 : 0);

// a list of numbers separated by blanks or commas: the byte strings it can stand for
function listBytes(tokens) {
  const out = [];
  const prefixed = tokens.every((t) => /^0[xX]/.test(t));
  if (prefixed) {
    const digits = tokens.map((t) => t.length - 2), max = Math.max(...digits);
    const size = max <= 2 ? 1 : max <= 4 ? 2 : max <= 8 ? 4 : 0;
    if (size) out.push(packValues(tokens.map((t) => parseInt(t, 16)), size, false));
    return out;
  }
  if (tokens.some((t) => /^0[xX]/.test(t))) return out;
  const len = tokens[0].length, same = tokens.every((t) => t.length === len);
  if (tokens.every((t) => /^\d+$/.test(t))) {
    const vals = tokens.map(Number), size = widthOf(Math.max(...vals));
    if (size) out.push(packValues(vals, size, false));
  }
  if (same && (len === 2 || len === 4 || len === 8)) {
    const vals = tokens.map((t) => parseInt(t, 16)), size = len >> 1;
    out.push(packValues(vals, size, true));
    if (size > 1) out.push(packValues(vals, size, false));
  }
  return out;
}

// Published constants that the firmware and this code may both carry, in both byte orders: the SHA-256 round
// constants (cube roots of the first 64 primes) and initial hash (square roots of the first 8), the CRC-32 table.
export function publicTables() {
  const primes = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
  const frac = (x) => Math.floor((x - Math.floor(x)) * 2 ** 32);
  const k = primes.map((p) => frac(Math.cbrt(p))), h = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
  const crc = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1; return c; });
  return [k, h, crc].flatMap((t) => [packValues(t, 4, false), packValues(t, 4, true)]);
}

function b64Bytes(s) {
  try { return new Uint8Array(Buffer.from(s, 'base64')); } catch { return null; }
}

export function decodeText(text) {
  const segs = [];
  const push = (kind, at, bytes) => { if (bytes && bytes.length >= WIN) segs.push({ kind, at, bytes }); };
  for (const m of text.matchAll(HEXRUN)) push('hex', m.index, hexBytes(m[0]));
  for (const m of text.matchAll(RUN)) {
    const tokens = m[0].split(/[ \t\r\n,]+/).filter(Boolean);
    for (const b of listBytes(tokens)) push('list', m.index, b);
  }
  // listings: consecutive lines that start with an address and go on with byte or word tokens (objdump, hexdump -C,
  // xxd, od -x); a word of 4 or 8 digits is taken in both byte orders
  let cur = null, curEnd = -1, curAt = 0;
  const flush = () => {
    if (!cur) return;
    for (const order of cur) push('listing', curAt, Uint8Array.from(order));
    cur = null;
  };
  for (const m of text.matchAll(DUMPLINE)) {
    // objdump ends its byte column with a tab; hexdump -C and xxd end theirs with the ASCII column
    const tab = m[1].indexOf('\t'), tokens = [];
    for (const t of (tab >= 0 ? m[1].slice(0, tab) : m[1]).trim().split(/[ \t]+/)) { if (!/^(?:[0-9A-Fa-f]{2}){1,4}$/.test(t)) break; tokens.push(t); }
    if (!tokens.length) continue;
    if (m.index !== curEnd + 1) { flush(); curAt = m.index; }
    if (!cur) cur = [[], []];
    for (const t of tokens) {
      const v = hexBytes(t);
      cur[0].push(...v);
      cur[1].push(...v.slice().reverse());
    }
    curEnd = m.index + m[0].length;
  }
  flush();
  for (const m of text.matchAll(B64RUN)) {
    if (isHex(m[0]) || !/[0-9+/]/.test(m[0])) continue;
    push('base64', m.index, b64Bytes(m[0]));
  }
  return segs;
}

// ---- git
function gitRunner(repo) {
  return (args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 2 ** 31 - 1, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

// every (commit, path, blob, mode) the range adds or changes, oldest commit first, and every commit's metadata
function history(git, range) {
  const raw = git(['log', '--raw', '-z', '--no-renames', '--no-abbrev', '--root', '-m', '--reverse', '--format=%x01%H', ...range]).toString('utf8');
  const entries = [];
  let commit = null;
  const tok = raw.split('\0');
  for (let i = 0; i < tok.length; i++) {
    let t = tok[i];
    if (t.startsWith('\n')) t = t.slice(1);
    if (t.startsWith('\x01')) { commit = t.slice(1); continue; }
    if (t.startsWith(':')) {
      const [, mode, , blob, status] = t.slice(1).split(' ');
      const p = tok[++i];
      if (status !== 'D') entries.push({ commit, path: p, blob, mode });
    }
  }
  const meta = git(['log', '--format=%H%x00%an <%ae>%x00%ae%x00%cn <%ce>%x00%ce%x00%B%x00%x01', ...range]).toString('utf8');
  const commits = [];
  for (const rec of meta.split('\0\x01')) {
    const f = rec.replace(/^\n/, '').split('\0');
    if (f.length < 6) continue;
    commits.push({ id: f[0], author: f[1], authorEmail: f[2], committer: f[3], committerEmail: f[4], message: f[5] });
  }
  return { entries, commits };
}

function readBlobs(git, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 2000) {
    const buf = git(['cat-file', '--batch'], { input: ids.slice(i, i + 2000).join('\n') + '\n' });
    let p = 0;
    while (p < buf.length) {
      const nl = buf.indexOf(10, p);
      const [id, type, size] = buf.subarray(p, nl).toString().split(' ');
      if (type === 'missing') throw new Error(`blob ${id} is missing`);
      const n = Number(size);
      out.set(id, buf.subarray(nl + 1, nl + 1 + n));
      p = nl + 1 + n + 1;
    }
  }
  return out;
}

// ---- firmware
function firmwareFiles(roots) {
  const files = [];
  const visit = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) visit(path.join(p, e)); } else if (st.isFile() && /\.bin$/i.test(p)) files.push({ file: p, size: st.size });
  };
  roots.forEach(visit);
  return files;
}

// Calls onWindow(words, q, k1, k2, file index, file offset, descrambled 0/1) for each 16-byte-aligned window (words:
// the u32 view, q: the window's first word) of every reference: the descrambled blocks of each .BIN container, then
// each plain file that is not a block of a container already read. Returns the bytes scanned.
async function scanFirmware(files, onWindow) {
  let buf = new ArrayBuffer(1 << 24), buf2 = new ArrayBuffer(1 << 24);
  const need = (n) => { if (buf.byteLength < n) { buf = new ArrayBuffer(n); buf2 = new ArrayBuffer(n); } };
  const scan = (u8, fi, base, scr) => {
    const words = new Uint32Array(u8.buffer, u8.byteOffset, u8.length >> 2), groups = u8.length >> 4;
    let p1 = 0, p2 = 0;
    for (let g = 0; g < groups; g++) {
      const q = g << 2, w0 = words[q], w1 = words[q + 1], w2 = words[q + 2], w3 = words[q + 3];
      const b1 = (Math.imul(w0, P1_3) + Math.imul(w1, P1_2) + Math.imul(w2, P1) + w3) | 0;
      const b2 = (Math.imul(w0, P2_3) + Math.imul(w1, P2_2) + Math.imul(w2, P2) + w3) | 0;
      if (g > 0) onWindow(words, q - 4, fmix((Math.imul(p1, P1_4) + b1) | 0), (fmix((Math.imul(p2, P2_4) + b2) ^ SALT) | 1) >>> 0, fi, base + ((g - 1) << 4), scr);
      p1 = b1; p2 = b2;
    }
  };
  const containers = new Set();
  let bytes = 0;
  const plain = [];
  for (let fi = 0; fi < files.length; fi++) {
    const { file, size } = files[fi];
    const fd = fs.openSync(file, 'r');
    try {
      const read = (off, len) => { const b = new Uint8Array(len); fs.readSync(fd, b, 0, len, off); return b; };
      const head = size >= 32 ? read(0, 2) : null;
      const blocks = head && TYPES.includes(String.fromCharCode(head[0], head[1])) ? (await walk(read, size)).blocks.filter((b) => !b.error) : [];
      if (!blocks.length) { plain.push(fi); continue; }
      containers.add(path.basename(file));
      for (const b of blocks) {
        need(b.len);
        const body = new Uint8Array(buf, 0, b.len);
        fs.readSync(fd, body, 0, b.len, b.off + 32);
        scan(b.flags ? descramble(body, new Uint8Array(buf2, 0, b.len)) : body, fi, b.off + 32, b.flags ? 1 : 0);
        bytes += b.len;
      }
    } finally { fs.closeSync(fd); }
  }
  const CHUNK = 1 << 26;
  for (const fi of plain) {
    const { file, size } = files[fi];
    if ([...containers].some((c) => path.basename(file).startsWith(`${c}.blk`))) continue;
    const fd = fs.openSync(file, 'r');
    try {
      // overlapping chunks: each starts 16 bytes before the previous one ended, so no window is lost at a seam
      need(CHUNK + 16);
      for (let off = 0; off + WIN <= size; off += CHUNK) {
        const len = Math.min(CHUNK + 16, size - off);
        const u8 = new Uint8Array(buf, 0, len);
        fs.readSync(fd, u8, 0, len, off);
        scan(u8, fi, off, 0);
      }
      bytes += size;
    } finally { fs.closeSync(fd); }
  }
  return bytes;
}

function readFirmwareWindow(files, fi, off, scr) {
  const fd = fs.openSync(files[fi].file, 'r');
  try {
    const b = new Uint8Array(WIN);
    fs.readSync(fd, b, 0, WIN, off);
    return scr ? descramble(b) : b;
  } finally { fs.closeSync(fd); }
}

// ---- the audit
const globRe = (g) => new RegExp(`^${g.split('**').map((s) => s.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
const short = (id) => (id ? id.slice(0, 10) : '');
const lineOf = (text, at) => { let n = 1; for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++; return n; };
const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n)}...` : s);

function textFindings(text, markers, add) {
  for (const [rule, re, what] of TEXT_RULES) {
    let n = 0;
    for (const m of text.matchAll(re)) {
      if (rule === 'email' && (EMAIL_OK.some((ok) => ok.test(m[0])) || FILE_EXT.test(m[0]))) continue;
      if (what === 'a high-entropy token' && !randomToken(m[0])) continue;
      // a fill (a5a5a5...) is not a table
      if (rule === 'hex-literal' && new Set(hexBytes(m[0])).size < MIN_DISTINCT) continue;
      if (rule === 'base64' && !m[0].startsWith('data:') && (isHex(m[0]) || new Set(b64Bytes(m[0])).size < MIN_DISTINCT)) continue;
      const shown = rule === 'secret' ? `${m[0].slice(0, 8)}...` : clip(m[0]);
      if (n++ < 5) add(rule, `line ${lineOf(text, m.index)}: ${what}: ${shown}`);
    }
  }
  if (markers.length) {
    const low = text.toLowerCase();
    for (const mk of markers) {
      const at = low.indexOf(mk);
      if (at >= 0) add('marker', `line ${lineOf(text, at)}: a private marker`);
    }
  }
}

function isText(u8) {
  if (u8.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(u8); return true; } catch { return false; }
}

const isCommit = (git, r) => { try { git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]); return true; } catch { return false; } };

// refs: what to audit with its history (default: release, else HEAD; A..B stands for B with --since A); since: what
// to leave out; fw: firmware files and directories (null: fw/ and unpacked/ at the root; []: none, no warning)
export async function audit({ repo = process.cwd(), refs = null, since = [], fw = null, markers = [], maxSize = MAX_SIZE, allow = ALLOW } = {}) {
  const t0 = performance.now();
  const git = gitRunner(repo);
  const root = git(['rev-parse', '--show-toplevel']).toString().trim();
  if (!refs || !refs.length) refs = [isCommit(git, 'release') ? 'release' : 'HEAD'];
  since = [...since];
  refs = refs.map((r) => {
    const m = /^(.+?)\.\.(?!\.)(.*)$/.exec(r);
    if (!m) return r;
    since.push(m[1]);
    return m[2] || 'HEAD';
  });
  for (const r of [...refs, ...since]) {
    try { git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]); } catch { throw new UsageError(`not a commit: ${r}`); }
  }
  let configured = [];
  try { configured = git(['config', '--get-all', 'pubaudit.marker']).toString().split('\n').filter(Boolean); } catch { /* none set */ }
  const marks = [...markers, ...configured].map((m) => m.toLowerCase()).filter(Boolean);
  const range = [...refs, ...(since.length ? ['--not', ...since] : [])];
  const { entries, commits } = history(git, range);

  const findings = [], warnings = [];
  const allowRes = allow.map((a) => ({ ...a, re: a.path ? globRe(a.path) : null }));
  const add = (f) => {
    const a = allowRes.find((x) => x.rule === f.rule && (!x.re || x.re.test(f.path ?? '')) && (!x.blob || (f.blob ?? '').startsWith(x.blob)) && (x.max === undefined || (f.size ?? Infinity) <= x.max));
    if (!a) findings.push(f);
  };

  // blobs: first (commit, path), every path
  const blobs = new Map(), gitlinks = [];
  for (const e of entries) {
    if (e.mode === '160000') { gitlinks.push(e); continue; }
    let b = blobs.get(e.blob);
    if (!b) blobs.set(e.blob, b = { id: e.blob, commit: e.commit, path: e.path, paths: new Set(), symlink: e.mode === '120000' });
    b.paths.add(e.path);
  }
  for (const e of gitlinks) add({ rule: 'gitlink', path: e.path, blob: e.blob, commit: e.commit, detail: 'a submodule entry' });

  // path rules, per path (each path once, at its first blob)
  const seenPath = new Map();
  for (const b of blobs.values()) for (const p of b.paths) if (!seenPath.has(p)) seenPath.set(p, b);
  for (const [p, b] of seenPath) {
    const why = PATH_RULES.filter(([re]) => re.test(p)).map(([, what]) => what);
    if (why.length) add({ rule: 'path', path: p, blob: b.id, commit: b.commit, detail: why.join('; ') });
    const low = p.toLowerCase();
    if (marks.some((m) => low.includes(m))) add({ rule: 'marker', path: p, blob: b.id, commit: b.commit, detail: 'a private marker in the path' });
  }
  if (seenPath.size) {
    let ignored = '';
    try { ignored = git(['check-ignore', '--no-index', '--stdin', '-z'], { input: [...seenPath.keys()].join('\0') + '\0', cwd: root }).toString(); } catch (e) { if (e.status !== 1) throw e; }
    for (const p of ignored.split('\0').filter(Boolean)) {
      const b = seenPath.get(p);
      if (PATH_RULES.some(([re]) => re.test(p))) continue;
      add({ rule: 'path', path: p, blob: b.id, commit: b.commit, detail: "a path the repository's .gitignore ignores" });
    }
  }

  // commits
  for (const c of commits) {
    for (const [who, email] of [[c.author, c.authorEmail], [c.committer, c.committerEmail]]) {
      if (!IDENTITY_OK.some((ok) => ok.test(email))) { add({ rule: 'identity', path: '(commit)', commit: c.id, detail: `${who === c.author ? 'author' : 'committer'} ${clip(who, 60)} is not a noreply address` }); break; }
    }
    textFindings(c.message, marks, (rule, detail) => add({ rule, path: '(commit message)', commit: c.id, detail }));
  }

  // content
  const ids = [...blobs.keys()];
  const data = readBlobs(git, ids);
  let bytes = 0;
  const segments = [];   // {blob, kind, at, bytes}
  const texts = [];      // {blob, u8}
  for (const id of ids) {
    const b = blobs.get(id), u8 = data.get(id), base = { path: b.path, blob: id, commit: b.commit, size: u8.length };
    bytes += u8.length;
    if (u8.length > maxSize) add({ ...base, rule: 'size', detail: `${u8.length.toLocaleString('en-US')} bytes, over ${maxSize.toLocaleString('en-US')}` });
    if (!isText(u8)) {
      add({ ...base, rule: 'binary', detail: `not text (${u8.includes(0) ? 'NUL bytes' : 'invalid UTF-8'}), ${u8.length.toLocaleString('en-US')} bytes` });
      segments.push({ blob: b, kind: 'raw', at: 0, bytes: u8 });
      continue;
    }
    const text = new TextDecoder().decode(u8);
    textFindings(text, marks, (rule, detail) => add({ ...base, rule, detail }));
    if (!b.symlink) {
      texts.push({ blob: b, u8, text });
      for (const s of decodeText(text)) segments.push({ blob: b, ...s, text });
    }
  }

  // firmware
  const fwRoots = fw ?? ['fw', 'unpacked'].map((d) => path.join(root, d));
  const files = segments.length || texts.length ? firmwareFiles(fwRoots) : [];
  let fwBytes = 0, fwMs = 0;
  if (!files.length) {
    if ((segments.length || texts.length) && (fw === null || fw.length)) warnings.push(`no firmware images under ${fwRoots.map((r) => path.relative(root, r) || r).join(', ')}: the firmware rule did not run`);
  } else {
    const t1 = performance.now();
    // the audited side's windows that can match anywhere (binary blobs and decoded bytes)
    const bin = new KeyTable(16);
    const pub = new KeyTable(12);
    for (const t of publicTables()) windows(t, false, (_, k1, k2) => { pub.add(k1, k2, 0); });
    for (const s of segments) windows(s.bytes, false, (_, k1, k2) => { if (pub.get(k1, k2) < 0) bin.add(k1, k2, 0); });
    // the firmware side: hits on those, and its printable windows for the text
    const hits = new KeyTable(10), txt = new KeyTable(18);
    const locFile = [], locOff = [], locScr = [];
    const loc = (fi, off, scr) => { locFile.push(fi); locOff.push(off); locScr.push(scr); return locFile.length - 1; };
    fwBytes = await scanFirmware(files, (w, q, k1, k2, fi, off, scr) => {
      if (bin.n && bin.get(k1, k2) >= 0 && hits.get(k1, k2) < 0) hits.add(k1, k2, loc(fi, off, scr));
      // printable: no byte with the top bit set, no control byte but tab, LF and CR; and enough distinct bytes
      for (let k = q; k < q + 8; k++) {
        const x = w[k];
        if (x & 0x80808080) return;
        if (((x - 0x20202020) & ~x & 0x80808080) !== 0) {
          for (let s = 0; s < 32; s += 8) { const c = (x >>> s) & 0xff; if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) return; }
        }
      }
      const seen = new Set();
      for (let k = q; k < q + 8; k++) { const x = w[k]; seen.add(x & 0xff).add((x >>> 8) & 0xff).add((x >>> 16) & 0xff).add(x >>> 24); }
      if (seen.size < MIN_DISTINCT || seen.has(0x7f)) return;
      if (txt.get(k1, k2) < 0) txt.add(k1, k2, loc(fi, off, scr));
    });
    // locate the matches, each verified byte for byte: per blob and kind, the matching windows of each segment
    const cache = new Map();
    const fwWindow = (li) => {
      let v = cache.get(li);
      if (!v) { v = readFirmwareWindow(files, locFile[li], locOff[li], locScr[li]); if (cache.size < 100000) cache.set(li, v); }
      return v;
    };
    const groups = new Map();
    const hit = (b, kind, seg, pos, li) => {
      const fwin = fwWindow(li);
      for (let i = 0; i < WIN; i++) if (seg.bytes[pos + i] !== fwin[i]) return;
      const key = `${b.id}\0${kind}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { blob: b, kind, segs: new Map(), li });
      let ps = g.segs.get(seg);
      if (!ps) g.segs.set(seg, ps = []);
      ps.push(pos);
    };
    if (hits.n) for (const s of segments) windows(s.bytes, false, (pos, k1, k2) => { const li = hits.get(k1, k2); if (li >= 0) hit(s.blob, s.kind, s, pos, li); });
    if (txt.n) {
      for (const t of texts) {
        const seg = { bytes: t.u8, at: 0, text: t.text };
        windows(t.u8, true, (pos, k1, k2) => { const li = txt.get(k1, k2); if (li >= 0) hit(t.blob, 'text', seg, pos, li); });
      }
    }
    for (const g of groups.values()) {
      // the matched runs: the union of each segment's matching windows
      const runs = [];
      for (const [seg, ps] of g.segs) {
        ps.sort((a, b) => a - b);
        for (const p of ps) {
          const r = runs.length ? runs[runs.length - 1] : null;
          if (r && r.seg === seg && p <= r.end) r.end = Math.max(r.end, p + WIN); else runs.push({ seg, start: p, end: p + WIN });
        }
      }
      const matched = runs.reduce((n, r) => n + r.end - r.start, 0), longest = Math.max(...runs.map((r) => r.end - r.start));
      // the firmware's strings end in NUL, so a quoted string is one run no longer than the string; a longer run of
      // text is a copied text resource
      if (g.kind === 'text' ? longest <= TEXT_RUN_MAX : g.kind === 'listing' ? matched <= LISTING_BUDGET : false) continue;
      const li = g.li, where = `${path.relative(root, files[locFile[li]].file)}+0x${locOff[li].toString(16)}${locScr[li] ? ' (descrambled)' : ''}`;
      const r0 = runs[0], line = r0.seg.text === undefined ? '' : `line ${lineOf(r0.seg.text, g.kind === 'text' ? charAt(r0.seg.text, r0.start) : r0.seg.at)}: `;
      const show = (r) => (g.kind === 'text' ? JSON.stringify(new TextDecoder().decode(r.seg.bytes.subarray(r.start, r.end))) : Buffer.from(r.seg.bytes.subarray(r.start, r.end)).toString('hex'));
      add({ rule: 'firmware', path: g.blob.path, blob: g.blob.id, commit: g.blob.commit, runs: runs.map(show),
        detail: `${line}${matched} bytes ${KIND[g.kind]} match the firmware, in ${runs.length} run${runs.length > 1 ? 's' : ''}, the longest ${longest} (first at ${where})` });
    }
    fwMs = performance.now() - t1;
  }
  return { refs, since, commits: commits.length, blobs: ids.length, bytes, fwFiles: files.length, fwBytes, fwMs, findings, warnings, ms: performance.now() - t0 };
}
const KIND = { raw: 'of the raw content', text: 'of the text', hex: 'decoded from a hex run', list: 'decoded from a number list', listing: 'decoded from a listing', base64: 'decoded from base64' };
// the character offset of a byte offset in a text (for line numbers of raw text matches)
const charAt = (text, byteOff) => new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, byteOff)).length;

export class UsageError extends Error {}

// ---- command line
function report(r, all, explain) {
  const out = [];
  const what = `${r.refs.join(' ')}${r.since.length ? ` not in ${r.since.join(' ')}` : ''}`;
  const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
  out.push(`${PROG}: ${what}: ${r.commits} commits, ${r.blobs} blobs (${mb(r.bytes)})${r.fwFiles ? `; firmware: ${r.fwFiles} files, ${mb(r.fwBytes)} in ${(r.fwMs / 1000).toFixed(1)} s` : ''}; ${(r.ms / 1000).toFixed(1)} s`);
  for (const w of r.warnings) out.push(`WARNING: ${w}`);
  const byRule = new Map();
  for (const f of r.findings) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
  for (const [rule, list] of byRule) {
    out.push(`${rule} (${list.length})`);
    for (const f of all ? list : list.slice(0, SHOW)) {
      out.push(`  ${f.path}${f.blob ? `  blob ${short(f.blob)}` : ''}  commit ${short(f.commit)}  ${f.detail}`);
      if (explain && f.runs) for (const x of f.runs.slice(0, explain)) out.push(`      ${clip(x, 160)}`);
    }
    if (!all && list.length > SHOW) out.push(`  ... ${list.length - SHOW} more (--all)`);
  }
  out.push(r.findings.length ? `FAIL: ${r.findings.length} findings` : 'clean');
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
      since: { type: 'string', multiple: true, default: [] }, fw: { type: 'string', multiple: true }, 'no-fw': { type: 'boolean', default: false },
      marker: { type: 'string', multiple: true, default: [] }, 'max-size': { type: 'string' }, all: { type: 'boolean', default: false }, explain: { type: 'string' } } });
    if (args.values['max-size'] !== undefined && !/^\d+$/.test(args.values['max-size'])) throw new Error('--max-size takes a number of bytes');
    if (args.values.explain !== undefined && !/^\d+$/.test(args.values.explain)) throw new Error('--explain takes a number of runs');
  } catch (e) {
    process.stderr.write(`${PROG}: ${e.message}\n${USAGE}\n`);
    process.exit(2);
  }
  const v = args.values;
  try {
    const r = await audit({ refs: args.positionals, since: v.since, fw: v['no-fw'] ? [] : (v.fw ?? null),
      markers: v.marker, maxSize: v['max-size'] !== undefined ? Number(v['max-size']) : MAX_SIZE });
    console.log(report(r, v.all, v.explain === undefined ? 0 : Number(v.explain)));
    process.exit(r.findings.length ? 1 : 0);
  } catch (e) {
    process.stderr.write(`${PROG}: ${e instanceof UsageError ? e.message : (e.stderr?.toString().trim() || e.message)}\n`);
    process.exit(2);
  }
}
