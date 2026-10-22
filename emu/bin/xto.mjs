#!/usr/bin/env node
// Where an E143 code address is in a ported model: node emu/bin/xto.mjs MODEL ADDRESS... (disassembly notation or
// run-time copy address at E143's image base, answered at the model's; through emu/out/port/MODEL/rev.bin, the
// nearest paired instruction at or before it).
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from '../src/fw/models.mjs';
const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const [model, ...addrs] = process.argv.slice(2);
const from = MODELS.E143, to = MODELS[model];
const rev = new Int32Array(new Uint8Array(fs.readFileSync(path.join(REPO, 'emu/out/port', model, 'rev.bin'))).buffer);
let n = 0; for (const o of rev) if (o > n) n = o;
const fwd = new Int32Array(n + 1).fill(-1);
for (let o = 0; o < rev.length; o++) if (rev[o] >= 0 && fwd[rev[o]] === -1) fwd[rev[o]] = o;
for (const s of addrs) {
  const v = parseInt(s, 16) >>> 0, rt = v >= from.image_base && v < from.image_base + from.rom_len;
  const base = rt ? from.image_base : 0x50000000, out = rt ? to.image_base : 0x50000000, o = v - base;
  let k = o; while (k >= 0 && o - k < 0x400 && fwd[k] < 0) k--;
  console.log(s, k >= 0 && fwd[k] >= 0 ? `${model} ${(out + fwd[k] + (o - k)).toString(16)}${o === k ? '' : ` (paired at -0x${(o - k).toString(16)})`}` : 'unpaired');
}
