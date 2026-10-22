// A tally of counts keyed by any JSON-able value (an array of strs and ints, a str): insertion order kept.
export class Tally {
  constructor(other = null) { this.m = new Map(); if (other) for (const [k, v] of other.m) this.m.set(k, [v[0], v[1]]); }
  add(key, n = 1) { const s = JSON.stringify(key), e = this.m.get(s); if (e) e[1] += n; else this.m.set(s, [key, n]); }
  get(key) { return this.m.get(JSON.stringify(key))?.[1] ?? 0; }
  has(key) { return this.m.has(JSON.stringify(key)); }
  entries() { return [...this.m.values()]; }
  // mostCommon(n): the n [key, count] pairs of the highest counts, highest first, ties in insertion order (a stable
  // sort); all of them when n is null.
  mostCommon(n = null) {
    const all = this.entries().sort((a, b) => b[1] - a[1]);
    return n === null ? all : all.slice(0, Math.max(0, n));
  }
  get size() { return this.m.size; }
}
