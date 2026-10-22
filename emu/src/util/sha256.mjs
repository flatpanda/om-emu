// Synchronous, incremental SHA-256 (FIPS 180-4) with the part of node's crypto.createHash the lab uses:
// createHash('sha256').update(string | Uint8Array | TypedArray).digest('hex' | undefined) and copy(). Strings are UTF-8
// (node's default). Worker-safe: the browser player's env.createHash, where node:crypto does not exist and WebCrypto's
// digest is asynchronous and not incremental. Tested against node's crypto (test/test_web.mjs, gate B2).
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Int32Array(64);
const enc = new TextEncoder();
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function blocks(H, p, off, end) {
  let h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7];
  for (; off < end; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + 4 * i;
      W[i] = p[j] << 24 | p[j + 1] << 16 | p[j + 2] << 8 | p[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = (a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3);
      const s1 = (b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  H[0] = h0; H[1] = h1; H[2] = h2; H[3] = h3; H[4] = h4; H[5] = h5; H[6] = h6; H[7] = h7;
}

export class Sha256 {
  constructor() { this.H = new Int32Array(IV); this.buf = new Uint8Array(64); this.n = 0; this.len = 0; }
  update(data) {
    const p = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let i = 0;
    this.len += p.length;
    if (this.n) {
      const k = Math.min(64 - this.n, p.length);
      this.buf.set(p.subarray(0, k), this.n); this.n += k; i = k;
      if (this.n < 64) return this;
      blocks(this.H, this.buf, 0, 64); this.n = 0;
    }
    const full = i + ((p.length - i) & ~63);
    if (full > i) blocks(this.H, p, i, full);
    if (full < p.length) { this.buf.set(p.subarray(full), 0); this.n = p.length - full; }
    return this;
  }
  copy() {
    const c = new Sha256();
    c.H.set(this.H); c.buf.set(this.buf); c.n = this.n; c.len = this.len;
    return c;
  }
  digest(encoding) {
    const H = this.H.slice(), tail = new Uint8Array(this.n < 56 ? 64 : 128);
    tail.set(this.buf.subarray(0, this.n));
    tail[this.n] = 0x80;
    const bits = this.len * 8, e = tail.length;
    const hi = Math.floor(bits / 2 ** 32), lo = bits >>> 0;
    tail[e - 8] = hi >>> 24; tail[e - 7] = hi >>> 16; tail[e - 6] = hi >>> 8; tail[e - 5] = hi;
    tail[e - 4] = lo >>> 24; tail[e - 3] = lo >>> 16; tail[e - 2] = lo >>> 8; tail[e - 1] = lo;
    blocks(H, tail, 0, e);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; }
    if (encoding === 'hex') { let s = ''; for (const b of out) s += HEX[b]; return s; }
    if (encoding !== undefined) throw new Error(`sha256 digest: encoding ${encoding} not supported`);
    return out;
  }
}
export function createHash(name) {
  if (name !== 'sha256') throw new Error(`createHash(${name}): only sha256`);
  return new Sha256();
}
