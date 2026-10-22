// The text of a value in messages, notes and reports: JSON-like with ', ' between items and ': ' after keys. A string
// is JSON-quoted, null and undefined are null, a number is String(n), a BigInt its digits; an array is [a, b], a Set
// its members sorted (numbers by value, anything else by its text), a Map or an object {key: value} in insertion
// order (a string key quoted, another key shown), a Uint8Array <hex digits>, another typed array an array, and an
// object with a toJSON() method the value toJSON returns. asText(v) is a string as it is and any other value shown.
export function show(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') return String(v);
  if (typeof v.toJSON === 'function') return show(v.toJSON());
  if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
  if (v instanceof Uint8Array) return `<${Array.from(v, (x) => x.toString(16).padStart(2, '0')).join('')}>`;
  if (ArrayBuffer.isView(v)) return show(Array.from(v));
  if (v instanceof Set) return `[${sortedMembers(v).join(', ')}]`;
  const entries = v instanceof Map ? [...v] : Object.entries(v);
  return `{${entries.map(([k, x]) => `${show(k)}: ${show(x)}`).join(', ')}}`;
}
export const asText = (v) => (typeof v === 'string' ? v : show(v));
// A Set's members as text, sorted: numerically when all are numbers, else by their text (UTF-16 code units).
function sortedMembers(s) {
  const xs = [...s];
  if (xs.every((x) => typeof x === 'number' || typeof x === 'bigint')) return xs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(show);
  return xs.map(show).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
