#!/usr/bin/env node
// The Cortex-M4 core on the SCPU firmware (docs/om1-scpu-spec.md section 8 step 4): from the image's reset vector, on
// flash and SRAM alone (src/core/m4/boot.mjs), until the first access to an address nothing models. Prints how far it
// got: instructions, exceptions taken, the stopping access and pc.
//   node emu/bin/m4smoke.mjs [IMAGE] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { smoke } from '../src/core/m4/boot.mjs';
import { parseArgs } from '../checks/lib/args.mjs';
import { exitFor } from '../checks/lib/env.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
export const SCPU_IMAGE = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk0e560000.OE.0107.bin');
const SPEC = [{ opt: '--limit', type: 'int', default: 5000000 }, { name: 'image', positional: true, required: false }];
let opts;
try { opts = parseArgs('m4smoke.mjs', process.argv.slice(2), SPEC); } catch (e) { process.exit(exitFor('m4smoke.mjs', e)); }
const hex = (v) => '0x' + (v >>> 0).toString(16);
const t0 = Date.now();
const r = smoke(new Uint8Array(fs.readFileSync(opts.image || SCPU_IMAGE)), opts.limit);
console.log(`reset: pc ${hex(r.reset.pc)}, sp ${hex(r.reset.sp)}`);
console.log(`${r.insns} instructions in ${r.steps} steps (${Date.now() - t0} ms); exceptions taken: ${JSON.stringify(r.exceptions)}`);
console.log(r.stop ? `stopped: ${r.stop.message} at pc ${hex(r.pc)} (lr ${hex(r.lr)}, sp ${hex(r.sp)}, ipsr ${r.ipsr}, control ${r.control})`
  : `no stop within the limit (step result ${r.result}), pc ${hex(r.pc)}`);
