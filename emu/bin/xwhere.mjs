#!/usr/bin/env node
// Where a ported model's code address is in E143: node emu/bin/xwhere.mjs MODEL ADDRESS... (disassembly notation or
// run-time copy address at the model's image base, answered at E143's; the nearest paired instruction at or before
// it, with the distance). Reads emu/out/port/MODEL/rev.bin, written by bin/port.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from '../src/fw/models.mjs';
const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const [model, ...addrs] = process.argv.slice(2);
const from = MODELS[model], to = MODELS.E143;
const rev = new Int32Array(new Uint8Array(fs.readFileSync(path.join(REPO, 'emu/out/port', model, 'rev.bin'))).buffer);
for (const s of addrs) {
  // rev.bin spans the model's run-time image, its preload rows included (bin/port.mjs)
  const v = parseInt(s, 16) >>> 0, rt = v >= from.image_base && v < from.image_base + rev.length;
  const base = rt ? from.image_base : 0x50000000, out = rt ? to.image_base : 0x50000000, o = v - base;
  let k = o; while (k >= 0 && o - k < 0x400 && rev[k] < 0) k--;
  console.log(s, k >= 0 && rev[k] >= 0 ? `E143 ${(out + rev[k] + (o - k)).toString(16)}${o === k ? '' : ` (paired at -0x${(o - k).toString(16)})`}` : 'unpaired');
}
