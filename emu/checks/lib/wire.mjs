// A lab job's arguments and result across a worker_threads boundary (check_menu / check_nav --jobs): the
// structured clone keeps Maps, Sets, arrays, typed arrays and plain objects but drops the class of a Tally;
// encode() tags the values and decode() rebuilds them.
import { Tally } from '../../src/util/tally.mjs';

export function encode(v) {
  if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) return Array.from(v, encode);
  if (v instanceof Tally) return { $c: v.entries().map(([k, n]) => [encode(k), n]) };
  if (v instanceof Map) return { $m: [...v].map(([k, x]) => [encode(k), encode(x)]) };
  if (v instanceof Set) return { $s: [...v].map(encode) };
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error(`wire: an instance of ${v.constructor?.name} is not modelled`);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = encode(x);
  return { $o: o };
}
export function decode(v) {
  if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) return v.map(decode);
  if ('$c' in v) { const c = new Tally(); for (const [k, n] of v.$c) c.add(decode(k), n); return c; }
  if ('$m' in v) return new Map(v.$m.map(([k, x]) => [decode(k), decode(x)]));
  if ('$s' in v) return new Set(v.$s.map(decode));
  if ('$o' in v) { const o = {}; for (const [k, x] of Object.entries(v.$o)) o[k] = decode(x); return o; }
  throw new Error('wire: untagged object');
}
