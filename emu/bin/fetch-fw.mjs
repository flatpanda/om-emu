#!/usr/bin/env node
// Provision a model's firmware (host/firmware.mjs provision): unpacked/<code>'s main code block and resource block, the
// two files every node entry point reads (checks/lib/env.mjs ORIGINAL, BLOCK), from the .BIN in fw/ or fw/old/ (or
// $OM_FW_DIR, $OM_BIN, --bin FILE), downloaded from the vendor's updater API when it is missing, checked against
// BLOBS.sha256 and MODELS and unpacked with the JS unpacker (src/fw/olyfw.mjs). Blocks already there are checked
// against their MODELS digests and made again when they are not the model's.
// The model: --model CODE, else OM_EMU_MODEL, else E143 (host/modelarg.mjs; --model list shows each one's firmware).
// Node only. bin/play.mjs provisions its model the same way on first use.
//   node emu/bin/fetch-fw.mjs [--model CODE|list] [--check] [--bin FILE]
//     (--check: exit 1 if the blocks are missing or are not the model's, change nothing)
import { parseArgs } from 'node:util';
import { takeModel } from '../host/modelarg.mjs';

const PROG = 'fetch-fw.mjs';
const argv = takeModel(PROG, process.argv.slice(2));
let opts;
try {
  ({ values: opts } = parseArgs({ args: argv, options: { check: { type: 'boolean', default: false }, bin: { type: 'string' } } }));
} catch (e) {
  process.stderr.write(`${PROG}: ${e.message}\nusage: node emu/bin/fetch-fw.mjs [--model CODE|list] [--check] [--bin FILE]\n`);
  process.exit(2);
}
const { provision } = await import('../host/firmware.mjs');
process.exitCode = await provision(PROG, { make: !opts.check, verify: true, bin: opts.bin ?? null });
