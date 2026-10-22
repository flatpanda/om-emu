// The generic device-state walker of the machine snapshot (machine.mjs snapshot/restore). It copies every field of each
// device object, so that no device file needs a snapshot method and a field a later stage adds is either covered or
// refused loudly, never skipped:
//   primitives are copied; functions are skipped (they are code, not state);
//   typed arrays are copied, except views of the machine buffer (guest memory covers them, and they must stay the
//   same views); arrays, plain objects, Map and Set are deep-copied;
//   wiring references (the machine, the other devices, the lab clock, the firmware image) are kept by identity;
//   anything else (a class instance the walker does not know) throws Unported at snapshot time, naming the device and
//   the field.
// Restore writes back in place (typed arrays with set(), arrays and objects element by element, Map and Set cleared
// and refilled with fresh copies), so references held elsewhere stay valid and a snapshot can be restored many times.
import { Unported } from '../core/mem.mjs';

const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

// A snapshot node: { t: 'p', v } primitive; { t: 'ta', v } typed-array copy; { t: 'mem' } a view of guest memory;
// { t: 'ref', v } a wiring reference; { t: 'fn' } a function; { t: 'a', v: [nodes] }; { t: 'o', v: { key: node } };
// { t: 'map', v: [[key, node]] }; { t: 'set', v: [values] }.
function take(v, ctx, where) {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return { t: 'p', v };
  if (typeof v === 'function') return { t: 'fn' };
  if (ctx.refs.has(v)) return { t: 'ref', v };
  if (ArrayBuffer.isView(v)) return v.buffer === ctx.buffer ? { t: 'mem' } : { t: 'ta', v: v.slice() };
  if (Array.isArray(v)) return { t: 'a', v: v.map((x, i) => take(x, ctx, `${where}[${i}]`)) };
  if (v instanceof Map) {
    return { t: 'map', v: [...v].map(([k, x]) => {
      if (k !== null && typeof k === 'object') throw new Unported(`machine snapshot: ${where} is a Map with object keys`);
      return [k, take(x, ctx, `${where}.get(${String(k)})`)];
    }) };
  }
  if (v instanceof Set) {
    return { t: 'set', v: [...v].map((x) => {
      if (x !== null && typeof x === 'object') throw new Unported(`machine snapshot: ${where} is a Set of objects`);
      return x;
    }) };
  }
  if (isPlain(v)) return { t: 'o', v: fields(v, ctx, where) };
  throw new Unported(`machine snapshot: ${where} is a ${v.constructor?.name ?? 'object'} the snapshot walker does not know`);
}
function fields(obj, ctx, where) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = take(obj[k], ctx, `${where}.${k}`);
  return out;
}
// A fresh value from a node (for a slot whose current value cannot be written in place).
function make(n) {
  switch (n.t) {
    case 'p': case 'ref': return n.v;
    case 'ta': return n.v.slice();
    case 'a': return n.v.map(make);
    case 'o': { const o = {}; for (const [k, x] of Object.entries(n.v)) if (x.t !== 'fn' && x.t !== 'mem') o[k] = make(x); return o; }
    case 'map': return new Map(n.v.map(([k, x]) => [k, make(x)]));
    case 'set': return new Set(n.v);
    default: throw new Error(`machine snapshot: cannot rebuild a ${n.t} node`);
  }
}
// Write node n into holder[key] (in place where the current value has the same shape).
function put(holder, key, n) {
  const cur = holder[key];
  switch (n.t) {
    case 'p': case 'ref': if (cur !== n.v) holder[key] = n.v; return;
    case 'fn': case 'mem': return;
    case 'ta':
      if (ArrayBuffer.isView(cur) && cur.constructor === n.v.constructor && cur.length === n.v.length) cur.set(n.v);
      else holder[key] = n.v.slice();
      return;
    case 'a':
      if (!Array.isArray(cur)) { holder[key] = make(n); return; }
      cur.length = n.v.length;
      for (let i = 0; i < n.v.length; i++) put(cur, i, n.v[i]);
      return;
    case 'o':
      if (cur === null || typeof cur !== 'object' || !isPlain(cur)) { holder[key] = make(n); return; }
      putFields(cur, n.v);
      return;
    case 'map':
      if (!(cur instanceof Map)) { holder[key] = make(n); return; }
      cur.clear();
      for (const [k, x] of n.v) cur.set(k, make(x));
      return;
    case 'set':
      if (!(cur instanceof Set)) { holder[key] = make(n); return; }
      cur.clear();
      for (const x of n.v) cur.add(x);
      return;
  }
}
function putFields(obj, f) {
  for (const k of Object.keys(obj)) if (!Object.hasOwn(f, k)) delete obj[k];     // a field added since the snapshot
  for (const [k, n] of Object.entries(f)) put(obj, k, n);
}

// devices: { name: object }; refs: the wiring references kept by identity; buffer: the machine buffer.
export function snapshotDevices(devices, refs, buffer) {
  const ctx = { refs: new Set(refs), buffer };
  const out = {};
  for (const [name, d] of Object.entries(devices)) out[name] = fields(d, ctx, name);
  return out;
}
export function restoreDevices(devices, snap) {
  for (const [name, d] of Object.entries(devices)) {
    if (!Object.hasOwn(snap, name)) throw new Error(`machine restore: device ${name} is not in the snapshot`);
    putFields(d, snap[name]);
  }
}
// A rough size in bytes of the copied device state (typed arrays and primitives), for the measurements.
function nodeBytes(n) {
  switch (n.t) {
    case 'ta': return n.v.byteLength;
    case 'a': return n.v.reduce((a, x) => a + nodeBytes(x), 0);
    case 'o': return Object.values(n.v).reduce((a, x) => a + nodeBytes(x), 0);
    case 'map': return n.v.reduce((a, [, x]) => a + 8 + nodeBytes(x), 0);
    case 'set': return 8 * n.v.length;
    case 'p': return 8;
    default: return 0;
  }
}
export function devicesBytes(snap) {
  let b = 0;
  for (const f of Object.values(snap)) for (const n of Object.values(f)) b += nodeBytes(n);
  return b;
}
