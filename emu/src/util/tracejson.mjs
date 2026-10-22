// The JSON of trace documents and digests: values normalised to JSON (norm, normOut), canonical JSON (canonJson),
// and the JSON text the screen-layer and workload digests hash (spacedJson, asciiJson). Their bytes are recorded in
// emu/golden.json: a change to any of them is a change of every session's layers.
import { bytesHex } from './bytes.mjs';

// The members of a set of ints or of strs, sorted (numbers numerically, strings by UTF-16 code unit).
export const sortMembers = (xs) => [...xs].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : a < b ? -1 : a > b ? 1 : 0));
// o[k] = v as an own data property for any key, '__proto__' included (o[k] = v would set the object's prototype).
export function setKey(o, k, v) {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  else o[k] = v;
  return o;
}

// The normalised JSON of a value (trace format om1-stage0-ref/2): tuple -> list, set -> sorted list, Map keys -> str,
// bytes -> {"hex": ...}.
export function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (v instanceof Uint8Array) return { hex: bytesHex(v) };
  if (v instanceof Set) return sortMembers([...v].map(norm));
  if (Array.isArray(v)) return Array.from(v, norm);
  if (v instanceof Map) { const o = {}; for (const [k, x] of v) setKey(o, String(k), norm(x)); return o; }
  const o = {};
  for (const [k, x] of Object.entries(v)) setKey(o, k, norm(x));      // '__proto__' too
  return o;
}
// A return value as normalised JSON, bytes over 4 KiB as their sha256 and length (sha: bytes -> hex).
export function normOut(v, sha) {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return v.length > 4096 ? { sha256: sha(v), len: v.length } : { hex: bytesHex(v) };
  if (typeof v !== 'object') return v;
  if (v instanceof Set) return sortMembers([...v].map((x) => normOut(x, sha)));
  if (Array.isArray(v)) return Array.from(v, (x) => normOut(x, sha));
  if (v instanceof Map) { const o = {}; for (const [k, x] of v) setKey(o, String(k), normOut(x, sha)); return o; }
  const o = {};
  for (const [k, x] of Object.entries(v)) setKey(o, k, normOut(x, sha));
  return o;
}
// Canonical JSON of a JSON value: no white space, object keys sorted by code point, strings as JSON.stringify writes
// them (non-ASCII kept); a non-integer number is refused.
const byCodePoint = (a, b) => {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d; }
  return x.length - y.length;
};
export function canonJson(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new TypeError(`canon: float ${v}`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonJson).join(',') + ']';
  return '{' + Object.keys(v).sort(byCodePoint).map((k) => JSON.stringify(k) + ':' + canonJson(v[k])).join(',') + '}';
}
// The digests' JSON text: ASCII only (U+007F and above as \uXXXX escapes), keys in the object's order; spacedJson puts
// ', ' between items and ': ' after keys, asciiJson no white space.
const ascii = (s) => s.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export const spacedJson = (v) => ascii(spaced(v));
export const asciiJson = (v) => ascii(JSON.stringify(v));
function spaced(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(spaced).join(', ') + ']';
  return '{' + Object.keys(v).map((k) => JSON.stringify(k) + ': ' + spaced(v[k])).join(', ') + '}';
}
