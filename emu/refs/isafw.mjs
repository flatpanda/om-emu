// check_isa's independent references for its firmware functions (firmware_cases): every case's
// name, function, input registers and memory, and the expected value, computed independently
// (calendar.timegm, integer arithmetic on unbounded ints, Fraction rounding, the 72 libm results committed in
// isa_vectors.json). Pure: integers are BigInt where they may pass 2^53, and the seeded draws (premultiply's
// four random words) come from the caller's generator seeded 1 (refs/mt19937.mjs MT19937 or the check's taped one).
const M32 = 0xffffffffn;
export const OUT = 0xA2022000, STRUCT = 0xA2023000;
const hex8 = (v) => v.toString(16).padStart(8, '0');

// calendar.timegm(t) for a (Y, M, D, h, m, s) tuple: the proleptic Gregorian day count, no time zone.
export function timegm(t) {
  const [y, mo, d, h, mi, s] = t;
  const a = Math.floor((14 - mo) / 12), yy = y + 4800 - a, mm = mo + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  return (jdn - 2440588) * 86400 + h * 3600 + mi * 60 + s;
}
// floor division and arithmetic right shift (rounding toward -infinity) on BigInt
const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };
const shr = (a, n) => (a >= 0n ? a >> n : -((-a + (1n << n) - 1n) >> n));
const abs = (a) => (a < 0n ? -a : a);
const le16 = (v) => [v & 255, (v >> 8) & 255];

// The cases, in check_isa's order: [name, function, regs {name: int, unmasked}, frame [mask, size] or null, memory [[address,
// bytes]], kind ('mem' or 'd0'), want address (kind 'mem') or null, want (BigInt, unbounded)]. vectors: the
// 'firmware' list of isa_vectors.json; rng: the generator seeded 1.
export function firmwareCases(vectors, rng) {
  const out = [];
  const timestamp = STRUCT;
  for (const t of [[2000, 1, 1, 0, 0, 0], [2024, 10, 7, 12, 34, 56], [2038, 1, 19, 3, 14, 8], [2038, 1, 19, 3, 14, 7],
    [2061, 7, 4, 23, 59, 59], [2099, 12, 31, 23, 59, 59], [2012, 3, 1, 0, 0, 0], [2016, 12, 31, 1, 2, 3]]) {
    out.push([`timegm(${t.join(', ')})`, 0x5012bf16, { a0: OUT, a1: timestamp }, null,
      [[timestamp, new Uint8Array([...le16(t[0]), ...t.slice(1), 0])]], 'mem', OUT, BigInt(timegm(t))]);
  }
  for (const [fn, plus] of [[0x51010a1f, true], [0x5101a2d0, false]]) {
    for (const text of ['0', '-1', '-12345', '+42', '2147483647', '-2147483648', '4294967295', '-99', '12a', '7']) {
      const negative = text.slice(0, 1) === '-';
      const digits = (plus ? '+-' : '-').includes(text.slice(0, 1)) && text.length ? text.slice(1) : text;
      const isdigit = digits.length > 0 && /^[0-9]+$/.test(digits);
      const want = isdigit ? (negative ? -BigInt(digits) : BigInt(digits)) : 0n;
      out.push([`atoi@${hex8(fn)}(${JSON.stringify(text)})`, fn, { a0: timestamp }, null,
        [[timestamp, new Uint8Array([...new TextEncoder().encode(text), 0])]], 'd0', null, want]);
    }
  }
  for (const [a, d] of [[1000, 7], [4096, 4096], [1, 512], [4000000000, 3], [123456789, 1000], [3000000001, 65537]]) {
    out.push([`roundup(${a},${d})`, 0x516ca634, { d0: a, d1: d }, null, [], 'd0', null, -floorDiv(-BigInt(a), BigInt(d)) * BigInt(d)]);
  }
  const words = [0xFFFFFFFF, 0x80402080, 0x12345678, 0xFF00FF7F, 0x01020300];
  for (let k = 0; k < 4; k++) words.push(rng.getrandbits(32));
  for (const v of words) {
    const alpha = v & 255;
    let want = BigInt(v & 255);
    for (const i of [1, 2, 3]) {        // int(Fraction(c * alpha, 255) + Fraction(1, 2)): floor((2 c alpha + 255) / 510)
      const c = BigInt((v >>> (8 * i)) & 255);
      want |= ((2n * c * BigInt(alpha) + 255n) / 510n) << BigInt(8 * i);
    }
    out.push([`premultiply(0x${hex8(v >>> 0)})`, 0x5178074b, { d0: v >>> 0 }, null, [], 'd0', null, want]);
  }
  for (const [a, b] of [[0x18000, 0x28000], [-0x18000, 0x28000], [0x7fff0000, 0x20000], [-5 * 65536, -7 * 65536], [123456789, 987654]]) {
    out.push([`fixmul16(${a},${b})`, 0x5048367b, { d0: a, d1: b }, [0, 0], [], 'd0', null, shr(BigInt(a) * BigInt(b), 16n)]);
  }
  for (const [a, b, c] of [[100000, 300000, 70], [-100000, 300000, 70], [2 ** 30, 2 ** 20, 2 ** 29], [123456, 654321, 1000], [-46341, 46341, -3]]) {
    const p = BigInt(a) * BigInt(b), C = BigInt(c);
    const q = floorDiv(abs(p), abs(C)) * (((p < 0n) === (C < 0n)) ? 1n : -1n);
    out.push([`muldiv(${a},${b},${c})`, 0x5048368a, { d0: a, d1: b, a0: c }, [0, 0], [], 'd0', null, q]);
  }
  for (const item of vectors) {
    out.push([`${item.name}(${item.d0},${item.d1})`, parseInt(item.fn, 16), { d0: parseInt(item.d0, 16), d1: parseInt(item.d1, 16) },
      null, [], 'd0', null, BigInt(parseInt(item.result, 16))]);
  }
  return out;
}
// the registers as the check passes them to HLE.call: {k: v & M32}
export const regs32 = (regs) => Object.fromEntries(Object.entries(regs).map(([k, v]) => [k, Number(BigInt(v) & M32)]));
// want & M32 of a case (a negative want in two's complement)
export const want32 = (w) => Number(BigInt.asUintN(32, w));
