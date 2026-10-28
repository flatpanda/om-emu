#!/usr/bin/env node
// The SCPU image's instruction census (docs/om1-scpu-spec.md section 8 step 3): every Thumb / Thumb-2 encoding the
// code reached by recursive descent uses, counted with the Cortex-M4 core's own decoder (src/core/m4/census.mjs), so
// that the core implements what the firmware needs. Prints a table (encoding, count, first address); no listing.
//   node emu/bin/m4census.mjs [IMAGE] [--base ADDR] [--json FILE] [--sweep]
// IMAGE defaults to E143's SCPU block (unpacked/E143/...blk0e560000...); --sweep also prints the forms a linear sweep
// of the gaps decodes (data decoded as code among them); --json writes the counts.
import fs from 'node:fs';
import path from 'node:path';
import { census } from '../src/core/m4/census.mjs';
import { parseArgs } from '../checks/lib/args.mjs';
import { exitFor } from '../checks/lib/env.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const DEFAULT = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk0e560000.OE.0107.bin');
const hex = (v) => '0x' + (v >>> 0).toString(16);

const SPEC = [{ opt: '--base', type: 'int', default: 0x08000000, metavar: 'ADDR' }, { opt: '--json', type: 'path' },
  { opt: '--sweep', type: 'flag' }, { name: 'image', positional: true, required: false }];
let opts;
try { opts = parseArgs('m4census.mjs', process.argv.slice(2), SPEC); } catch (e) { process.exit(exitFor('m4census.mjs', e)); }
const file = opts.image || DEFAULT;
const img = new Uint8Array(fs.readFileSync(file));
const base = opts.base;
// the code range: up to the erased tail (0xff to the end)
let end = img.length;
while (end > 0 && img[end - 1] === 0xff) end--;
const r = census(img, { base, codeEnd: base + end });
const table = (m) => [...m.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
console.log(`image ${path.basename(file)}: ${img.length} bytes at ${hex(base)}, code range to ${hex(base + end)}`);
console.log(`descent: ${r.roots} vector roots, ${r.rounds} pointer rounds (${r.pointers} pointers), ${r.instructions} instructions, ${r.codeBytes} code bytes, ${r.dataBytes} data bytes (${r.literals} literals)`);
const rows = table(r.forms);
const ops = new Map();
for (const [, e] of rows) ops.set(e.op, (ops.get(e.op) || 0) + e.n);
console.log(`${rows.length} encodings, ${ops.size} executor ops`);
for (const [k, e] of rows) console.log(`  ${String(e.n).padStart(6)}  ${k.padEnd(48)} ${hex(e.first)}`);
const flagged = rows.filter(([, e]) => ['udf', 'nocp', 'vfp'].includes(e.op));
console.log(`UNDEFINED / coprocessor / unimplemented-VFP forms reached: ${flagged.length ? flagged.map(([k, e]) => `${k} x${e.n} (${hex(e.first)})`).join(', ') : 'none'}`);
if (opts.sweep) {
  console.log(`linear sweep of the gaps: ${r.swept} decodes`);
  for (const [k, e] of table(r.sweep).slice(0, 60)) console.log(`  ${String(e.n).padStart(6)}  ${k.padEnd(48)} ${hex(e.first)}`);
}
if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ image: path.basename(file), base, instructions: r.instructions,
  forms: Object.fromEntries(rows.map(([k, e]) => [k, { n: e.n, first: hex(e.first), op: e.op }])) }, null, 1) + '\n');
