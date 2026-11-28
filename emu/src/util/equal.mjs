// Structural equality of plain data: primitives by ===, arrays element by element, Uint8Arrays byte by byte, Sets by
// members (in any order), Maps and objects by keys (in any order) and values; an object only equals an object of the
// same prototype (a class instance its own class, by its own enumerable keys). null and undefined, a number and a
// BigInt or a boolean, an array and a Set are all different.
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  // any two arrays compare as lists (an Array subclass included)
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b) && !(Array.isArray(a) && Array.isArray(b))) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a instanceof Uint8Array) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    let bs = null, used = null;
    for (const x of a) {
      if (x === null || typeof x !== 'object') { if (!b.has(x)) return false; continue; }
      if (bs === null) { bs = [...b]; used = new Uint8Array(bs.length); }
      let ok = false;
      for (let i = 0; i < bs.length; i++) if (!used[i] && deepEqual(x, bs[i])) { used[i] = 1; ok = true; break; }
      if (!ok) return false;
    }
    return true;
  }
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, x] of a) if (!b.has(k) || !deepEqual(x, b.get(k))) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}
