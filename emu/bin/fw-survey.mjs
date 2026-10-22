#!/usr/bin/env node
// The multi-model survey (docs/model-survey.md): which bodies the vendor's updater API serves, their .BINs, and per
// main code block the facts that decide how far the lab can follow it. Node only.
//   node emu/bin/fw-survey.mjs probe [FROM TO]     codes E<FROM>..E<TO> (default 100 199): model, file, size, date
//   node emu/bin/fw-survey.mjs fetch CODE ...      download each code's .BIN with its reply (fw/, or fw/old/ below
//                                                  E140, as BLOBS.md files them); a file already there is kept
//   node emu/bin/fw-survey.mjs survey [BIN ...]    default: every fw/*.BIN and fw/old/*.BIN; one row per body
// survey's columns: the container (blocks, all checksums 0), the main block's size and olycompress sections, the
// run-time base of the image (the peak of pointer - string start over the image's pointers; E143: 0x60021020), the
// MMIO family (mov-imm32 loads of E143's ISC 0x97000000 / VSC 0x9bb80000 against E144's ISC 0x8fe00000 / VSC
// 0x9c000000 / OSD engine 0x9c100000) and whether the resource block holds olycompress blobs (resources.mjs's origin
// rule needs one).
import fs from 'node:fs';
import path from 'node:path';
import { walk, readBlock } from '../src/fw/olyfw.mjs';
import { lz4Block } from '../src/lab/resources.mjs';
import { ask, replyTag as tag } from '../src/fw/updater.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const MAGIC = Buffer.from('olycompress');
const say = (s) => process.stderr.write(`fw-survey: ${s}\n`);
const hex = (v) => '0x' + (v >>> 0).toString(16);
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

async function probe(from = 100, to = 199) {
  for (let n = from; n <= to; n++) {
    const reply = await ask(`E${n}`);
    if (reply) console.log(`E${n}\t${tag(reply, 'model_name')}\t${tag(reply, 'file_name')}\t${tag(reply, 'file_size')}\t${tag(reply, 'up_date')}`);
    await new Promise((res) => setTimeout(res, 300));
  }
}

async function fetchCodes(codes) {
  for (const code of codes) {
    const reply = await ask(code);
    if (!reply) { say(`${code}: the API serves no firmware`); continue; }
    const dir = path.join(REPO, Number(code.slice(1)) < 140 ? 'fw/old' : 'fw'), name = tag(reply, 'file_name'), size = Number(tag(reply, 'file_size'));
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).size === size) { say(`${code}: ${name} already present`); continue; }
    const d = await fetch(tag(reply, 'url').replaceAll('&amp;', '&'));
    if (!d.ok) throw new Error(`${code}: download failed: HTTP ${d.status}`);
    const data = Buffer.from(await d.arrayBuffer());
    if (data.length !== size) throw new Error(`${code}: ${data.length} bytes, the reply says ${size}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, data);
    fs.writeFileSync(path.join(dir, `${code}_reply.xml`), reply);
    say(`${code}: ${name} (${size} bytes)`);
  }
}

// The image's run-time base: the code's address constants (the distinct imm32 of mov imm32,Dn/An into
// 0x40000000..0x80000000, mostly strings and globals) vote constant - start against every 8th string start (8
// printable bytes after a NUL), in 4 KiB buckets; the 16 highest buckets' exact peaks (against every string start)
// are each scored by the share of the image's aligned words that, taken as pointers from that base, land on a string
// start (E143: 7.5% at 0x60021020). Pointer tables are left out of the vote: their fixed strides make peaks of their own
function runBase(img) {
  const pr = (c) => c >= 0x20 && c < 0x7f;
  const strs = [];
  for (let o = 1; o + 8 < img.length; o++) if (img[o - 1] === 0 && pr(img[o]) && pr(img[o + 1]) && pr(img[o + 2]) && pr(img[o + 3]) && pr(img[o + 4]) && pr(img[o + 5]) && pr(img[o + 6]) && pr(img[o + 7])) strs.push(o);
  const vals = new Set();
  for (let o = 2; o + 4 <= img.length; o++) {
    if (img[o - 2] !== 0xfc || ((img[o - 1] & 0xfc) !== 0xcc && (img[o - 1] & 0xfc) !== 0xdc)) continue;
    const v = u32(img, o); if (v >= 0x40000000 && v < 0x80000000) vals.add(v);
  }
  const ptrs = [...vals], few = strs.filter((_, i) => i % 8 === 0);
  const C = new Uint32Array(1 << 18);
  for (const v of ptrs) for (const s of few) { const d = (v - s) >>> 0; if (d >= 0x40000000 && d < 0x80000000) C[(d - 0x40000000) >>> 12]++; }
  // the string starts s with v - s in [lo, lo + 0x3000): strs is ascending
  const first = (x) => { let a = 0, b = strs.length; while (a < b) { const m = (a + b) >> 1; if (strs[m] < x) a = m + 1; else b = m; } return a; };
  const isStr = new Uint8Array(img.length);
  for (const s of strs) isStr[s] = 1;
  const score = (B) => { let n = 0, m = 0; for (let o = 0; o + 4 <= img.length; o += 4) { const t = (u32(img, o) - B) >>> 0; if (t < img.length) { m++; n += isStr[t]; } } return [n, m]; };
  let best = null, bestHits = -1, share = 0;
  for (const pk of [...C.keys()].sort((a, b) => C[b] - C[a]).slice(0, 16)) {
    const lo = 0x40000000 + ((pk - 1) << 12), H = new Map();
    for (const v of ptrs) for (let i = first(v - lo - 0x3000 + 1); i < strs.length && strs[i] <= v - lo; i++) { const d = (v - strs[i]) >>> 0; H.set(d, (H.get(d) ?? 0) + 1); }
    const peak = [...H].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (peak === undefined) continue;
    const [n, m] = score(peak);
    if (n > bestHits) { best = peak; bestHits = n; share = n / m; }
  }
  return [best, share];
}
// mov imm32,Dn / An (fc cc..cf, fc dc..df) loading v
function movs(img, v) {
  const n = Buffer.from([v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24]);
  let c = 0;
  for (let p = img.indexOf(n); p >= 0; p = img.indexOf(n, p + 1)) if (p >= 2 && img[p - 2] === 0xfc && ((img[p - 1] & 0xfc) === 0xcc || (img[p - 1] & 0xfc) === 0xdc)) c++;
  return c;
}

async function survey(files) {
  console.log(['code', 'file', 'blocks', 'checksums', 'main', 'olycompress', 'run base', 'MMIO family', 'resources'].join('\t'));
  for (const file of files) {
    const buf = new Uint8Array(fs.readFileSync(file)), read = (o, n) => buf.subarray(o, o + n);
    const { blocks, end } = await walk(read, buf.length);
    let ok = end === buf.length, rom = null, res = null;
    for (const b of blocks) {
      const r = await readBlock(read, b);
      ok &&= r.cksum_ok;
      if (b.typ === 'OE' && b.flags === 0x100) rom = Buffer.from(r.data);
      if (b.typ === 'OE' && b.flags === 0x101) res = Buffer.from(r.data);
    }
    const img = Buffer.from(rom);
    let sections = 0;
    for (let q = rom.indexOf(MAGIC); q >= 0; q = rom.indexOf(MAGIC, q + 1), sections++) img.set(lz4Block(rom.subarray(q + 32, q + 32 + u32(rom, q + 16)), u32(rom, q + 20)), q);
    const x = movs(img, 0x97000000) + movs(img, 0x9BB80000), ix = movs(img, 0x8FE00000) + movs(img, 0x9C000000);
    const family = x > ix ? 'E143 (ISC 0x97000000, VSC 0x9bb80000)' : `E144 (ISC 0x8fe00000, VSC 0x9c000000${movs(img, 0x9C100000) ? ', engine 0x9c100000' : ''})`;
    const name = path.basename(file);
    console.log([`E${name.slice(6, 9)}`, name, blocks.length, ok ? 'ok' : 'BAD', `${(rom.length / 1048576).toFixed(1)} MiB`, sections,
      (([b, f]) => `${hex(b)} (${(100 * f).toFixed(1)}%)`)(runBase(img)), family, res && res.indexOf(MAGIC) >= 0 ? 'olycompress' : 'plain'].join('\t'));
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'probe') await probe(...args.map(Number));
else if (cmd === 'fetch') await fetchCodes(args);
else if (cmd === 'survey') {
  const all = ['fw', 'fw/old'].flatMap((d) => fs.existsSync(path.join(REPO, d)) ? fs.readdirSync(path.join(REPO, d)).filter((f) => f.endsWith('.BIN')).map((f) => path.join(REPO, d, f)) : []);
  await survey(args.length ? args : all.sort((a, b) => path.basename(a).localeCompare(path.basename(b))));
} else { say('usage: fw-survey.mjs probe [FROM TO] | fetch CODE ... | survey [BIN ...]'); process.exit(2); }
