// Firmware-free unit tests for src/fw/respatch.mjs (0x0101 resource-block extraction, diffing, override, and
// summary formatting).
//   node emu/test/test_respatch.mjs
import * as F from '../src/fw/olyfw.mjs';
import { createHash } from '../src/util/sha256.mjs';
import { PatchRefused, extractResourceBlock, diffResourceBlock, applyResourceOverride, resPatchLine } from '../src/fw/respatch.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const refusal = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof PatchRefused) return e.message; throw e; } };
const bytesEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Synthetic container block builder (same format as test_identify.mjs: head:32, scrambled body, tail:32).
function makeBlock(flags, body, { model = '1480', ver = 0x1000, load = 0x2000, cks = true, typ = 'OE' } = {}) {
  const head = (c) => {
    const h = new Uint8Array(32), dv = new DataView(h.buffer);
    h[0] = typ.charCodeAt(0); h[1] = typ.charCodeAt(1);
    h[2] = parseInt(model.slice(0, 2), 16); h[3] = parseInt(model.slice(2), 16);
    dv.setUint32(8, load, true); dv.setUint32(12, body.length, true);
    dv.setUint16(16, ver, true); dv.setUint16(20, flags, true); dv.setUint32(28, c, true);
    return h;
  };
  const total = (F.sum32(head(0)) + F.sum32(body) + F.sum32(head(0))) >>> 0;
  const stored = new Uint8Array(body.length);
  if (flags !== 0) {
    const n = body.length - (body.length % 16);
    for (let g = 0; g < n; g += 16) for (let k = 0; k < 16; k++) stored[g + F.PERM[k]] = body[g + k] ^ 0xff;
    for (let i = n; i < body.length; i++) stored[i] = body[i];
  } else {
    stored.set(body);
  }
  const out = new Uint8Array(64 + body.length);
  out.set(head(0), 0); out.set(stored, 32); out.set(head(cks ? (-total) >>> 0 : 0), 32 + body.length);
  return out;
}

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const synth = (n, seed) => Uint8Array.from({ length: n }, () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed >>> 24;
});

export function resPatchUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const refuses = (fn, re, what) => { const m = refusal(fn); ok(m !== null && re.test(m), `${what}: ${m ?? 'not refused'}`); };

  const main = synth(512, 11);
  // Ensure stockRes does not accidentally start with an Olympus container magic ('OE'/'OM'/'OA'/'OL')
  const stockRes = synth(256, 29);
  stockRes[0] = 0x10; stockRes[1] = 0x20;
  const stockSha = sha(stockRes);

  // 1. Raw block override
  {
    const mod = stockRes.slice();
    mod[32] ^= 0x55; mod[33] ^= 0xaa;
    const rawCopy = extractResourceBlock(mod);
    ok(bytesEq(rawCopy, mod) && rawCopy !== mod, 'extractResourceBlock returns an equal copy of a raw block');

    const { resBlock, summary } = applyResourceOverride(stockRes, mod, createHash);
    ok(bytesEq(resBlock, mod) && resBlock !== mod, 'raw override returns matching resBlock copy');
    ok(stockRes[32] !== mod[32], 'raw override leaves stockRes untouched');
    ok(summary.stock_size === 256 && summary.mod_size === 256, 'raw override sizes');
    ok(summary.stock_sha256 === stockSha && summary.mod_sha256 === sha(mod), 'raw override sha256 digests');
    ok(summary.changed_bytes === 2 && summary.same === false, 'raw override changed_bytes and same=false');
    ok(JSON.stringify(summary.ranges) === '[[32,2]]', `raw override ranges: ${JSON.stringify(summary.ranges)}`);
  }

  // 2. Container (.BIN) override (both valid checksum and un-recomputed checksum)
  {
    const mod = stockRes.slice();
    mod.set([0x45, 0x6e, 0x67], 64); // "Eng"
    const bin = cat(makeBlock(0x0100, main), makeBlock(0x0101, mod));
    const extracted = extractResourceBlock(bin);
    ok(bytesEq(extracted, mod), 'extractResourceBlock descrambles 0x0101 from .BIN container');

    const { resBlock, summary } = applyResourceOverride(stockRes, bin, createHash);
    ok(bytesEq(resBlock, mod), 'container override returns descrambled resBlock');
    ok(summary.changed_bytes === 3 && summary.same === false && JSON.stringify(summary.ranges) === '[[64,3]]',
      `container override summary: ${JSON.stringify(summary)}`);
    ok(summary.stock_sha256 === stockSha && summary.mod_sha256 === sha(mod), 'container override digests');

    // Un-recomputed checksum is also accepted (common for patched .BINs)
    const binNoCks = cat(makeBlock(0x0100, main, { cks: false }), makeBlock(0x0101, mod, { cks: false }));
    const resNoCks = applyResourceOverride(stockRes, binNoCks, createHash);
    ok(bytesEq(resNoCks.resBlock, mod) && resNoCks.summary.changed_bytes === 3, 'container override accepts non-zero checksum');
  }

  // 3. Identical block (raw and container)
  {
    const { resBlock, summary } = applyResourceOverride(stockRes, stockRes.slice(), createHash);
    ok(bytesEq(resBlock, stockRes), 'identical raw override preserves bytes');
    ok(summary.same === true && summary.changed_bytes === 0 && summary.ranges.length === 0, 'identical raw override summary');
    ok(summary.stock_sha256 === stockSha && summary.mod_sha256 === stockSha, 'identical raw override digests match');

    const stockBin = cat(makeBlock(0x0100, main), makeBlock(0x0101, stockRes));
    const fromBin = applyResourceOverride(stockRes, stockBin, createHash);
    ok(fromBin.summary.same === true && fromBin.summary.changed_bytes === 0 && fromBin.summary.ranges.length === 0,
      'identical container override reports same=true, 0 changed bytes');
  }

  // 4. Multiple disjoint diff ranges (start, adjacent-with-1-byte-gap, middle run, end)
  {
    const mod = stockRes.slice();
    mod[0] ^= 0x01;                                     // [0, 1]
    mod[10] ^= 0xff; mod[11] ^= 0xff; mod[12] ^= 0xff;  // [10, 3]
    // offset 13 unchanged -> separates [10, 3] and [14, 1]
    mod[14] ^= 0x0f;                                    // [14, 1]
    mod[254] ^= 0x80; mod[255] ^= 0x40;                 // [254, 2]
    const s = diffResourceBlock(stockRes, mod, createHash);
    ok(s.same === false && s.changed_bytes === 7, `disjoint changed_bytes: ${s.changed_bytes}`);
    ok(JSON.stringify(s.ranges) === '[[0,1],[10,3],[14,1],[254,2]]', `disjoint ranges: ${JSON.stringify(s.ranges)}`);
  }

  // 5. Size mismatch handling
  {
    const shorter = stockRes.slice(0, 200);
    const longer = new Uint8Array(300);
    longer.set(stockRes, 0);
    refuses(() => diffResourceBlock(stockRes, shorter, createHash), /size mismatch: override has 200 bytes, stock has 256 bytes/, 'shorter raw block refused');
    refuses(() => diffResourceBlock(stockRes, longer, createHash), /size mismatch: override has 300 bytes, stock has 256 bytes/, 'longer raw block refused');
    const shortBin = cat(makeBlock(0x0100, main), makeBlock(0x0101, synth(128, 7)));
    refuses(() => applyResourceOverride(stockRes, shortBin, createHash), /size mismatch: override has 128 bytes, stock has 256 bytes/, 'container with wrong 0x0101 size refused');
  }

  // 6. Malformed container & invalid input refusals
  {
    // Container missing 0x0101 block (only 0x0100)
    const mainOnly = makeBlock(0x0100, main);
    refuses(() => extractResourceBlock(mainOnly), /expected 1 OE 0x0101 resource block, found 0/, 'container without 0x0101 refused');

    // Container with duplicate 0x0101 blocks
    const dupRes = cat(makeBlock(0x0100, main), makeBlock(0x0101, stockRes), makeBlock(0x0101, stockRes));
    refuses(() => extractResourceBlock(dupRes), /expected 1 OE 0x0101 resource block, found 2/, 'container with 2 0x0101 blocks refused');

    // Truncated container header ('OE' + < 32 bytes)
    const truncHead = new Uint8Array([0x4f, 0x45, 0x14, 0x80, 0x00, 0x00]);
    refuses(() => extractResourceBlock(truncHead), /truncated or malformed container/, 'truncated container header refused');

    // Container cut inside 0x0101 body
    const fullBin = cat(makeBlock(0x0100, main), makeBlock(0x0101, stockRes));
    const cutBin = fullBin.subarray(0, fullBin.length - 40);
    refuses(() => extractResourceBlock(cutBin), /cut inside block .*body overruns file/, 'container cut inside 0x0101 refused');

    // Container with empty 0x0101 block
    const emptyResBin = cat(makeBlock(0x0100, main), makeBlock(0x0101, new Uint8Array(0)));
    refuses(() => extractResourceBlock(emptyResBin), /is empty/, 'container with empty 0x0101 refused');

    // Empty or non-Uint8Array inputs
    refuses(() => extractResourceBlock(new Uint8Array(0)), /non-empty Uint8Array/, 'empty Uint8Array refused');
    refuses(() => extractResourceBlock(null), /non-empty Uint8Array/, 'null input refused');
    refuses(() => extractResourceBlock('OE'), /non-empty Uint8Array/, 'string input refused');
    refuses(() => diffResourceBlock(new Uint8Array(0), stockRes, createHash), /stock resource block/, 'empty stockRes refused');
    refuses(() => diffResourceBlock(stockRes, stockRes, null), /createHash function/, 'missing createHash refused');
  }

  // 7. resPatchLine formatting
  {
    const sameSum = diffResourceBlock(stockRes, stockRes.slice(), createHash);
    const sameLine = resPatchLine(sameSum);
    ok(sameLine === `resource block unchanged (256 bytes); resource block sha256 ${stockSha.slice(0, 16)}`,
      `resPatchLine unchanged: ${sameLine}`);

    const oneMod = stockRes.slice();
    oneMod[5] ^= 0x01;
    const oneSum = diffResourceBlock(stockRes, oneMod, createHash);
    const oneLine = resPatchLine(oneSum);
    ok(oneLine === `resource block override (1 range, 1 byte changed); resource block sha256 ${oneSum.mod_sha256.slice(0, 16)} (stock ${stockSha.slice(0, 16)})`,
      `resPatchLine singular: ${oneLine}`);

    const multiMod = stockRes.slice();
    multiMod[5] ^= 0x01; multiMod[20] ^= 0x02; multiMod[21] ^= 0x03;
    const multiSum = diffResourceBlock(stockRes, multiMod, createHash);
    const multiLine = resPatchLine(multiSum);
    ok(multiLine === `resource block override (2 ranges, 3 bytes changed); resource block sha256 ${multiSum.mod_sha256.slice(0, 16)} (stock ${stockSha.slice(0, 16)})`,
      `resPatchLine plural: ${multiLine}`);
  }

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = resPatchUnits();
  console.log(`respatch: ${r.checks} checks, ${r.bad.length} failed`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
