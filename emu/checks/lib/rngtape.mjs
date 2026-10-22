// The RNG tape: with
// OM_RNG_TAPE=<path> in the environment, every generator a check creates through newRandom() records each top-level
// call as [method, shape, result] (lengths and chosen positions computed on a clone over range(n), ints, float bits,
// bytes as sha256 and length), and the tape is written when the process exits. Without it, newRandom() is a plain
// MT19937. Nothing compares the tapes; a tape shows which draws a check made.
import fs from 'node:fs';
import path from 'node:path';
import { MT19937 } from '../../refs/mt19937.mjs';
import { sha256 } from './env.mjs';

const FORMAT = 'om1-rngtape/1';
const TAPES = [];
const fbits = (x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b.toString('hex'); };
const range = (n) => ({ range: n });
const lenOf = (s) => (s !== null && typeof s === 'object' && Object.hasOwn(s, 'range') ? s.range : s.length);

class TapedRandom extends MT19937 {
  seed(a) {
    super.seed(a);
    if (!this._depth) { this._tape = { seed: { int: String(a) }, calls: [] }; TAPES.push(this._tape); }
  }
  _rec(name, shape, run, result, pos = null) {
    if (this._depth) return run();
    const p = pos ? pos(this.clone()) : null;
    this._depth = 1;
    let r;
    try { r = run(); } finally { this._depth = 0; }
    this._tape.calls.push([name, shape, result(r, p)]);
    return r;
  }
  random() { return this._rec('random', [], () => super.random(), (r) => fbits(r)); }
  uniform(a, b) { return this._rec('uniform', [fbits(a), fbits(b)], () => super.uniform(a, b), (r) => fbits(r)); }
  getrandbits(k) { return this._rec('getrandbits', [k], () => super.getrandbits(k), (r) => r); }
  randbytes(n) { return this._rec('randbytes', [n], () => super.randbytes(n), (r) => ({ sha256: sha256(r), len: r.length })); }
  randrange(...a) { return this._rec('randrange', a.filter((x) => x !== undefined && x !== null), () => super.randrange(...a), (r) => r); }
  choice(s) { return this._rec('choice', [lenOf(s)], () => super.choice(s), (r, p) => p, (c) => c.choice(range(lenOf(s)))); }
  shuffle(x) {
    return this._rec('shuffle', [x.length], () => super.shuffle(x), (r, p) => p, (c) => { const l = Array.from({ length: x.length }, (_, i) => i); c.shuffle(l); return l; });
  }
  sample(pop, k) { return this._rec('sample', [lenOf(pop), k], () => super.sample(pop, k), (r, p) => p, (c) => c.sample(range(lenOf(pop)), k)); }
  choices(pop, weights = null, o = {}) {
    const k = o.k ?? 1;
    return this._rec('choices', [lenOf(pop), weights, k], () => super.choices(pop, weights, o), (r, p) => p, (c) => c.choices(range(lenOf(pop)), weights, { k }));
  }
}

const TAPE = process.env.OM_RNG_TAPE ?? null;
if (TAPE) {
  process.on('exit', () => {
    fs.mkdirSync(path.dirname(TAPE), { recursive: true });
    fs.writeFileSync(TAPE, JSON.stringify({ format: FORMAT, node: process.version, tapes: TAPES }));
  });
}
// A check's seeded generator.
export function newRandom(seed) { return TAPE ? new TapedRandom(seed) : new MT19937(seed); }
