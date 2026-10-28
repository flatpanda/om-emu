#!/usr/bin/env node
// The Cortex-M4 decoder (emu/src/core/m4/decode.mjs) against GNU objdump on an image's code: every instruction the
// census (emu/src/core/m4/census.mjs) reaches must have objdump's length and a matching mnemonic. Runs inside the
// om-emu VM only (objdump with the arm target; the firmware stays there as data, objdump's listing goes to a scratch
// file and is never printed): it prints the counts and the (ours, objdump's) mnemonic pairs that differ, by encoding.
//   orb -m om-emu node tools/m4-oracle/objcheck.mjs IMAGE [--base 0x08000000] [--scratch DIR]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { census } from '../../emu/src/core/m4/census.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const base = Number(opt('--base', '0x08000000'));
const scratch = opt('--scratch', fs.mkdtempSync(path.join(os.tmpdir(), 'm4objcheck-')));
fs.mkdirSync(scratch, { recursive: true });
const file = argv[0];
if (!file) { console.error('usage: objcheck.mjs IMAGE [--base ADDR] [--scratch DIR]'); process.exit(2); }
const img = new Uint8Array(fs.readFileSync(file));
let end = img.length;
while (end > 0 && img[end - 1] === 0xff) end--;
const r = census(img, { base, codeEnd: base + end });

// objdump's view of each census instruction: disassemble from each run start (a maximal run of consecutive census
// instructions) so that its sync matches the census's
const listing = path.join(scratch, 'objdump.txt');
const theirs = new Map();
const addrs = [...r.code.keys()].sort((a, b) => a - b);
const runs = [];
for (let i = 0; i < addrs.length;) {
  let j = i;
  while (j + 1 < addrs.length && addrs[j] + r.code.get(addrs[j]).len === addrs[j + 1]) j++;
  runs.push([addrs[i], addrs[j] + r.code.get(addrs[j]).len]);
  i = j + 1;
}
const bin = path.join(scratch, 'img.bin');
fs.writeFileSync(bin, img);
// objdump keeps its decode in sync within a range, so one call per run (batched into one process per 400 runs)
for (let k = 0; k < runs.length; k += 400) {
  let out = '';
  for (const [a, b] of runs.slice(k, k + 400)) {
    out += execFileSync('objdump', ['-D', '-b', 'binary', '-marm', '-Mforce-thumb', `--adjust-vma=${base}`,
      `--start-address=${a}`, `--stop-address=${b}`, bin], { encoding: 'utf8', maxBuffer: 1 << 26 });
  }
  fs.appendFileSync(listing, out);
  for (const line of out.split('\n')) {
    const m = /^\s*([0-9a-f]+):\t([0-9a-f]{4}(?: [0-9a-f]{4})?)\s*\t(\S+)/.exec(line);
    if (m) theirs.set(parseInt(m[1], 16), { len: m[2].length === 4 ? 2 : 4, mn: m[3] });
  }
}

const COND = /(eq|ne|cs|cc|hs|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|al)$/;
const norm = (mn) => mn.replace(/\.(n|w)$/, '');
function matches(ours, mn) {
  const t = norm(mn);
  const cands = new Set([t]);
  for (const c of [...cands]) { const s = c.replace(COND, ''); if (s && s !== c) cands.add(s); }
  for (const c of [...cands]) { if (c.endsWith('s')) cands.add(c.slice(0, -1)); }
  for (const c of [...cands]) { const s = c.replace(COND, ''); if (s) cands.add(s); }   // movscs: cs, then s
  const ALIAS = { adr: ['add', 'addw', 'sub', 'subw'], add: ['addw'], sub: ['subw'], mov: ['movw', 'cpy'], push: ['stmdb', 'str'],
    pop: ['ldmia', 'ldm', 'ldr'], ldm: ['ldmia', 'pop'], stm: ['stmia', 'stmea'], ldmdb: ['ldmea'], stmdb: ['push', 'stmfd'],
    vstm: ['vstmia', 'vstmdb'], vldm: ['vldmia', 'vldmdb'], vpush: ['vstmdb'], vpop: ['vldmia'], rsb: ['neg'],
    lsl: ['mov'], lsr: ['mov'], asr: ['mov'], ror: ['mov'], rrx: ['mov'],
    b: ['b'], nop: ['nop'], cbnz: ['cbnz'], cbz: ['cbz'], it: ['it', 'itt', 'ite', 'ittt', 'itte', 'itet', 'itee', 'itttt', 'ittte', 'ittet', 'ittee', 'itett', 'itete', 'iteet', 'iteee'] };
  const ok = [ours, ...(ALIAS[ours] || [])];
  for (const c of cands) if (ok.includes(c)) return true;
  return false;
}
let lenBad = 0, mnBad = 0, missing = 0, undef = 0;
const pairs = new Map();
for (const a of addrs) {
  const d = r.code.get(a), t = theirs.get(a);
  if (!t) { missing++; continue; }
  if (/undefined|\.word|\.short/i.test(t.mn)) undef++;
  if (t.len !== d.len) { lenBad++; continue; }
  const ours = d.enc.split(' ')[0].toLowerCase();
  if (!matches(ours, t.mn)) {
    mnBad++;
    const k = `${d.enc} | ${norm(t.mn)}`;
    const e = pairs.get(k) || { n: 0, first: a };
    e.n++; pairs.set(k, e);
  }
}
console.log(`census instructions ${addrs.length} in ${runs.length} runs; objdump lines matched ${addrs.length - missing}; length mismatches ${lenBad}; objdump undefined ${undef}; mnemonic mismatches ${mnBad}`);
for (const [k, e] of [...pairs.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(e.n).padStart(5)}  ${k}  (first 0x${e.first.toString(16)})`);
console.log(`objdump listing (scratch, not for the repo): ${listing}`);
