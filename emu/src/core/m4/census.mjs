// The Thumb / Thumb-2 instruction census of a Cortex-M image (bin/m4census.mjs, docs/om1-scpu-spec.md section 8 step
// 3): which encodings the image's code uses, so that the core's scope follows the firmware. The code is found by
// recursive descent with decode.mjs, the core's own decoder:
//   1. roots: the vector table's handlers (entries 1 .. vectors - 1 that are odd and inside the image);
//   2. a walk follows fall-through, B / BL / CBZ / CBNZ targets and the cases of TBB / TBH tables (as many as the
//      range check before the table allows, else up to where the lowest case begins), and stops at BX, POP / LDM / LDR into pc, a data-processing write to pc, UDF and
//      anything past the image; an instruction inside an IT block also falls through;
//   3. then code pointers in data: an aligned word outside the code found so far that is odd, inside the image, and
//      whose walk decodes to no UNDEFINED encoding before its first stop; each round's pointers are walked, until a
//      round adds none.
// LDR (literal) words and table bytes are data. The census counts each instruction start once. A linear sweep of the
// rest of the code range (the gaps the descent leaves, decoded as if code) is reported apart: what the descent may
// have missed, with data decoded as code in it. Pure: the image comes in as bytes.
import { decode, thumbLength, ALU_CMP } from './decode.mjs';

const u16 = (img, o) => img[o] | (img[o + 1] << 8);
const u32 = (img, o) => (img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | (img[o + 3] << 24)) >>> 0;

// the instruction at address a: { d, a, hw1, hw2 } or null outside the image
function at(img, base, a) {
  const o = a - base;
  if (o < 0 || o + 2 > img.length) return null;
  const hw1 = u16(img, o), len = thumbLength(hw1);
  if (o + len > img.length) return null;
  const hw2 = len === 4 ? u16(img, o + 2) : 0;
  return { d: decode(hw1, hw2), a, hw1, hw2 };
}

// writes to pc that end a walk (the executor's own rules: BX, POP / LDM / LDR to pc, MOV / ADD to pc)
function stops(d) {
  switch (d.op) {
    case 'bx': case 'udf': return true;
    case 'ldm': return ((d.list >>> 15) & 1) === 1;
    case 'ldr': return d.rd === 15;
    case 'dp': return d.rd === 15;
    case 'b': return d.cond === 14;
    case 'tb': return true;
    default: return false;
  }
}

export function census(img, { base = 0x08000000, vectors = 99, codeEnd = base + img.length } = {}) {
  const code = new Map();                   // instruction start -> its record
  const covered = new Uint8Array(img.length);   // 1 code, 2 data (literal words, tables)
  const lit = new Set();
  const inImage = (a) => a >= base && a < codeEnd;
  const roots = [];
  for (let k = 1; k < vectors; k++) {
    const v = u32(img, 4 * k);
    if ((v & 1) && inImage(v & ~1)) roots.push(v & ~1);
  }
  for (let k = 0; k < vectors * 4; k++) covered[k] = 2;
  const walkAll = (starts) => {
    const work = [...starts];
    while (work.length) {
      let a = work.pop();
      let it = 0;                            // instructions left in an IT block
      const recent = [];                     // the walk's last few records, for a table's bound
      for (;;) {
        if (code.has(a) || !inImage(a)) break;
        const x = at(img, base, a);
        if (!x) break;
        const { d } = x;
        code.set(a, d);
        for (let i = 0; i < d.len; i++) covered[a - base + i] = 1;
        recent.push(d); if (recent.length > 4) recent.shift();
        const inIt = it > 0;
        if (it > 0) it--;
        if (d.op === 'it') it = 4 - (ctz(d.list));
        const pc4 = a + 4;
        if ((d.op === 'ldr' || d.op === 'ldrd') && d.rn === 15) {
          const ea = ((pc4 & ~3) + (d.add ? d.imm : -d.imm)) >>> 0, n = d.op === 'ldrd' ? 8 : d.sz;
          if (inImage(ea)) { for (let i = 0; i < n && ea - base + i < img.length; i++) if (!covered[ea - base + i]) covered[ea - base + i] = 2; lit.add(ea); }
        }
        if (d.op === 'b' || d.op === 'bl' || d.op === 'cbz') {
          const t = (pc4 + d.imm) >>> 0;
          if (inImage(t)) work.push(t);
        }
        if (d.op === 'tb') {
          const tbl = pc4, step = d.sz;
          // the bound: a CMP (immediate) of the index register among the walk's last instructions (the compiler's
          // range check before the table); else the table ends where its lowest case begins
          const cmp = recent.slice(0, -1).reverse().find((x) => x.op === 'dp' && x.alu === ALU_CMP && x.rm < 0 && x.rn === d.rm);
          const cases = cmp ? cmp.imm + 1 : Infinity;
          let end = Infinity;
          for (let e = tbl, k = 0; k < cases && e < end && inImage(e + step - 1); e += step, k++) {
            const v = step === 1 ? img[e - base] : u16(img, e - base);
            const t = tbl + 2 * v;
            for (let i = 0; i < step; i++) covered[e - base + i] = 2;
            if (t < end && t > e) end = t;
            if (inImage(t)) work.push(t);
            if (e + step >= end) break;
          }
        }
        if (stops(d) && !inIt) break;
        a += d.len;
      }
    }
  };
  walkAll(roots);
  let rounds = 0, pointers = 0;
  for (;;) {
    const found = [];
    for (let o = 0; o + 4 <= img.length; o += 4) {
      if (covered[o] === 1) continue;
      const v = u32(img, o);
      if (!(v & 1)) continue;
      const t = v & ~1;
      if (!inImage(t) || code.has(t) || covered[t - base] === 1) continue;
      if (valid(img, base, t, inImage)) found.push(t);
    }
    const fresh = [...new Set(found)].filter((t) => !code.has(t));
    if (!fresh.length) break;
    rounds++; pointers += fresh.length;
    walkAll(fresh);
  }
  // counts
  const forms = new Map();
  const add = (map, d, a) => { const k = d.enc; const e = map.get(k); if (e) e.n++; else map.set(k, { n: 1, first: a, op: d.op }); };
  const addrs = [...code.keys()].sort((x, y) => x - y);
  for (const a of addrs) add(forms, code.get(a), a);
  // the linear sweep of the gaps
  const sweep = new Map();
  let swept = 0;
  for (let o = vectors * 4; o + 2 <= codeEnd - base;) {
    if (covered[o]) { o += 2; continue; }
    const x = at(img, base, base + o);
    if (!x) break;
    if (x.hw1 === 0xffff && u16(img, o + 2) === 0xffff) { o += 2; continue; }   // erased flash
    add(sweep, x.d, base + o); swept++;
    o += x.d.len;
  }
  let codeBytes = 0, dataBytes = 0;
  for (let o = 0; o < codeEnd - base; o++) { if (covered[o] === 1) codeBytes++; else if (covered[o] === 2) dataBytes++; }
  return { roots: roots.length, rounds, pointers, instructions: code.size, codeBytes, dataBytes, literals: lit.size, forms, sweep, swept, code };
}

function ctz(x) { let n = 0; while (n < 4 && !((x >>> n) & 1)) n++; return n; }

// a candidate pointer's walk: no UNDEFINED or UNPREDICTABLE encoding before the first stop, at most 64 instructions
function valid(img, base, t, inImage) {
  let a = t;
  for (let i = 0; i < 64; i++) {
    if (!inImage(a)) return false;
    const x = at(img, base, a);
    if (!x || x.d.op === 'udf' || x.d.unp || x.d.op === 'nocp') return false;
    if (x.hw1 === 0xffff || x.hw1 === 0x0000) return false;   // erased flash, zero fill
    if (stops(x.d)) return true;
    a += x.d.len;
  }
  return true;
}
