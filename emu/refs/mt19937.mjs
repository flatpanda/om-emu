// The seeded generator of the checks: the MT19937 core with CPython 3.14's random.Random seeding (init_by_array over
// the int seed's 32-bit words) and the derived draws the checks make, bit-exact with CPython, because the checks'
// pinned inputs (check_osd's scenario, the ISA vectors' memory windows, the seeded display, live-view and text cases)
// were drawn by it: random, getrandbits (k <= 53), randbytes, randrange, choice, shuffle, sample, choices, uniform,
// and clone. Seeds are integers (a Number while safe, else a BigInt); draws take and return Numbers. An independent
// reference: it imports only refs/ (test_pure.mjs).
//
// The MT19937 core (init_genrand, init_by_array, genrand_uint32) follows Makoto Matsumoto's and Takuji Nishimura's
// mt19937ar.c as CPython's Modules/_randommodule.c carries it, under its notice:
//
// Copyright (C) 1997 - 2002, Makoto Matsumoto and Takuji Nishimura,
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
//
// 1. Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright
// notice, this list of conditions and the following disclaimer in the
// documentation and/or other materials provided with the distribution.
//
// 3. The names of its contributors may not be used to endorse or promote
// products derived from this software without specific prior written
// permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR
// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
// EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
// PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
// LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
// NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// The Lib/random.py methods follow CPython's implementation: Copyright (c) 2001 Python Software Foundation; All Rights
// Reserved; used under the Python Software Foundation License Version 2.
import { Unported } from './errors.mjs';

const N = 624, M = 397;
const MATRIX_A = 0x9908b0df, UPPER = 0x80000000, LOWER = 0x7fffffff;
const mul32 = Math.imul;
const bitLength = (n) => (n === 0 ? 0 : n.toString(2).length);

export class MT19937 {
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.index = N + 1;
    if (seed !== undefined) this.seed(seed);
  }

  // ---- seeding (Modules/_randommodule.c init_genrand, init_by_array, random_seed's int key)
  init_genrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) { const p = mt[i - 1] ^ (mt[i - 1] >>> 30); mt[i] = (mul32(1812433253, p) + i) >>> 0; }
    this.index = N;
  }
  init_by_array(key) {
    const mt = this.mt, kl = key.length;
    this.init_genrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, kl); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ mul32(p, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= kl) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ mul32(p, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }
  // An integer seed: its absolute value as 32-bit words from the least significant; 0 is the one-word key [0].
  seed(a) {
    if (!(Number.isSafeInteger(a) || typeof a === 'bigint')) throw new TypeError(`MT19937 seed ${a}: an integer`);
    let n = BigInt(a);
    if (n < 0n) n = -n;
    const key = [];
    do { key.push(Number(n & 0xffffffffn)); n >>= 32n; } while (n > 0n);
    this.init_by_array(key);
  }
  // A generator in this one's state, drawing the same values from here on.
  clone() {
    const c = new MT19937();
    c.mt.set(this.mt);
    c.index = this.index;
    return c;
  }

  // ---- the generator (genrand_uint32)
  genrand() {
    const mt = this.mt;
    if (this.index >= N) {
      let kk = 0, y;
      for (; kk < N - M; kk++) { y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER); mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0); }
      for (; kk < N - 1; kk++) { y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER); mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0); }
      y = (mt[N - 1] & UPPER) | (mt[0] & LOWER);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  // ---- random_random, getrandbits, randbytes
  // A double in [0, 1) from 53 bits of two words.
  random() { const a = this.genrand() >>> 5, b = this.genrand() >>> 6; return (a * 67108864 + b) * (1 / 9007199254740992); }
  // k random bits, 0 <= k <= 53 (k <= 32: one word >> (32 - k); else the low word first, the high word cut to the bits
  // left).
  getrandbits(k) {
    if (!Number.isInteger(k) || k < 0 || k > 53) throw new RangeError(`MT19937.getrandbits(${k}): 0 <= k <= 53`);
    if (k === 0) return 0;
    if (k <= 32) return this.genrand() >>> (32 - k);
    const lo = this.genrand(), hi = this.genrand() >>> (64 - k);
    return hi * 4294967296 + lo;
  }
  // n random bytes: getrandbits(8 n) little-endian, word by word.
  randbytes(n) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`MT19937.randbytes(${n}): n >= 0`);
    const out = new Uint8Array(n);
    let i = 0;
    for (; i + 4 <= n; i += 4) { const w = this.genrand(); out[i] = w; out[i + 1] = w >>> 8; out[i + 2] = w >>> 16; out[i + 3] = w >>> 24; }
    if (i < n) { const w = this.genrand() >>> (32 - 8 * (n - i)); for (let s = 0; i < n; i++, s += 8) out[i] = w >>> s; }
    return out;
  }

  // ---- the derived draws (Lib/random.py)
  // _randbelow_with_getrandbits: k = n.bit_length(), draw k bits until r < n; 0 < n <= 2**53.
  _randbelow(n) {
    if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError(`MT19937._randbelow(${n}): a safe integer n > 0`);
    const k = bitLength(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }
  // randrange(stop) or randrange(start, stop, step = 1): a step of 1 draws below the width, another step below the
  // number of steps.
  randrange(start, stop = null, step = 1) {
    if (stop === null) {
      if (start > 0) return this._randbelow(start);
      throw new RangeError(`empty range in randrange(${start})`);
    }
    const width = stop - start;
    if (step === 1) {
      if (width > 0) return start + this._randbelow(width);
      throw new RangeError(`empty range in randrange(${start}, ${stop})`);
    }
    if (step === 0) throw new RangeError('zero step for randrange()');
    const n = step > 0 ? Math.floor((width + step - 1) / step) : Math.floor((width + step + 1) / step);
    if (n <= 0) throw new RangeError(`empty range in randrange(${start}, ${stop}, ${step})`);
    return start + step * this._randbelow(n);
  }
  // A sequence: an Array, a string, a typed array, or {range: n} for 0 .. n - 1 (no list built).
  choice(seq) {
    const [n, at] = seqOf(seq);
    if (!n) throw new RangeError('choice from an empty sequence');
    return at(this._randbelow(n));
  }
  // In place: Fisher-Yates from the end.
  shuffle(x) {
    for (let i = x.length - 1; i >= 1; i--) { const j = this._randbelow(i + 1); const t = x[i]; x[i] = x[j]; x[j] = t; }
  }
  // k distinct members: the pool path when n <= setsize, else the set path; setsize = 21 + 4 ** ceil(log(3k, 4)) for
  // k > 5, in integers (equal to Python's float formula for every k below 3,000,000, and refused above).
  sample(population, k) {
    const [n, at] = seqOf(population);
    if (!Number.isSafeInteger(k) || k < 0 || k > n) throw new RangeError(`MT19937.sample: k ${k} of ${n}`);
    if (k >= 3000000) throw new Unported('MT19937.sample: setsize for k >= 3,000,000 (float log not modelled)');
    const result = new Array(k);
    let setsize = 21;
    if (k > 5) { let p = 1; while (p < 3 * k) p *= 4; setsize += p; }
    if (n <= setsize) {
      const pool = Array.from({ length: n }, (_, j) => at(j));
      for (let i = 0; i < k; i++) { const j = this._randbelow(n - i); result[i] = pool[j]; pool[j] = pool[n - i - 1]; }
    } else {
      const selected = new Set();
      for (let i = 0; i < k; i++) {
        let j = this._randbelow(n);
        while (selected.has(j)) j = this._randbelow(n);
        selected.add(j);
        result[i] = at(j);
      }
    }
    return result;
  }
  // choices(population, weights = null, {k = 1}): without weights floor(random() * n); with Number weights their
  // running sums and the first sum above random() * total (bisect_right over the first n - 1).
  choices(population, weights = null, { k = 1 } = {}) {
    const [n, at] = seqOf(population);
    const out = [];
    if (weights === null) {
      for (let i = 0; i < k; i++) out.push(at(Math.floor(this.random() * n)));
      return out;
    }
    const cum = [];
    let acc = 0;
    for (const w of weights) { acc += w; cum.push(acc); }
    if (cum.length !== n || !n) throw new RangeError(`MT19937.choices: ${cum.length} weights for ${n} members`);
    const total = cum[n - 1];
    if (!(total > 0) || !Number.isFinite(total)) throw new RangeError(`MT19937.choices: weight total ${total}`);
    for (let i = 0; i < k; i++) {
      const x = this.random() * total;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (x < cum[mid]) hi = mid; else lo = mid + 1; }
      out.push(at(lo));
    }
    return out;
  }
  uniform(a, b) { return a + (b - a) * this.random(); }
}

// [length, member at j] of a sequence: Array, string, typed array, or {range: n}.
function seqOf(s) {
  if (s !== null && typeof s === 'object' && Object.hasOwn(s, 'range')) return [Math.max(0, s.range), (j) => j];
  if (typeof s === 'string' || Array.isArray(s) || ArrayBuffer.isView(s)) return [s.length, (j) => s[j]];
  throw new TypeError('MT19937: a sequence (an Array, string, typed array or {range: n})');
}
