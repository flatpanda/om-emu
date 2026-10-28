#!/usr/bin/env node
// The SCPU's firmware on the STM32L4 machine (src/core/m4/periph/, docs/om1-scpu-spec.md section 8 step 5): from
// reset to the debug console's prompt "SUB> " on LPUART1, then each --line typed into the console (with a carriage
// return) and run until the next prompt. Prints the console's text as the firmware sent it and a summary per step: SCPU time, core
// cycles and instructions, standby. --drive sets a pin's level from the board (PC13=0, PB12=1; -1 releases it).
// Exit 0 when the prompt came and every line was answered with a prompt, 1 when the run stopped at something not
// modelled (named on stderr) or a prompt did not come. IMAGE defaults to the model's SCPU block (OM_EMU_MODEL, E143 by
// default; src/fw/models.mjs scpu_lle, the block the lab loads with OM_EMU_SCPU=native).
//   node emu/bin/scpu.mjs [IMAGE] [--line TEXT]... [--settle S] [--wait S] [--drive PIN=LEVEL]... [--after S]
import fs from 'node:fs';
import path from 'node:path';
import { Stm32l4 } from '../src/core/m4/periph/stm32l4.mjs';
import { parseArgs } from '../checks/lib/args.mjs';
import { exitFor } from '../checks/lib/env.mjs';
import { MODEL, MODEL_INFO } from '../src/fw/model.mjs';
import { scpuPath } from '../src/fw/models.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
export const SCPU_IMAGE = MODEL_INFO.scpu_lle ? path.join(REPO, scpuPath(MODEL_INFO)) : null;
const SPEC = [
  { opt: '--line', type: 'str', repeat: true, metavar: 'TEXT' },
  { opt: '--boot', type: 'number', default: 5, metavar: 'S' },           // the most SCPU time to the first prompt
  { opt: '--settle', type: 'number', default: 0.5, metavar: 'S' },       // SCPU time after it, before the first line
  { opt: '--wait', type: 'number', default: 5, metavar: 'S' },           // the most SCPU time to each line's prompt
  { opt: '--after', type: 'number', default: 0, metavar: 'S' },          // SCPU time after the last line
  { opt: '--drive', type: 'str', repeat: true, metavar: 'PIN=LEVEL' },
  { name: 'image', positional: true, required: false },
];
let opts;
try { opts = parseArgs('scpu.mjs', process.argv.slice(2), SPEC); } catch (e) { process.exit(exitFor('scpu.mjs', e)); }
const drive = {};
for (const d of opts.drive) {
  const m = /^P([A-DH])(\d{1,2})=(-1|0|1)$/.exec(d);
  if (!m || Number(m[2]) > 15) { process.stderr.write(`scpu.mjs: --drive ${d}: PIN=LEVEL, e.g. PC13=0 (levels 0, 1, -1)\n`); process.exit(2); }
  drive[`P${m[1]}${m[2]}`] = Number(m[3]);
}
const file = opts.image || SCPU_IMAGE;
if (!file) { process.stderr.write(`scpu.mjs: ${MODEL} gives no SCPU image the machine is known to boot (src/fw/models.mjs scpu_lle): pass IMAGE\n`); process.exit(2); }
if (!fs.existsSync(file)) { process.stderr.write(`scpu.mjs: no ${file} (a full unpack of the .BIN makes it: BLOBS.md, tools/olyfw.py --dump)\n`); process.exit(1); }

const m = new Stm32l4(new Uint8Array(fs.readFileSync(file)), { drive });
const t0 = Date.now();
let printed = 0;
const flush = () => {
  const text = m.consoleText(printed).replaceAll('\r\n', '\n').replaceAll('\r', '');
  printed = m.tx.LPUART1.length;
  if (text) process.stdout.write(text.endsWith('\n') ? text : text + '\n');
};
const summary = (what, r) => {
  flush();
  const t = `SCPU time ${m.seconds().toFixed(4)} s, ${m.cpu.cycles} cycles, ${m.cpu.insns} instructions, ${m.standbys} standby entr${m.standbys === 1 ? 'y' : 'ies'}${m.standby ? ' (in standby)' : ''}`;
  process.stderr.write(`[scpu] ${what}: ${r.reason}${r.error ? ` (${r.error.message}, pc 0x${(m.cpu.pc >>> 0).toString(16)})` : ''}; ${t}\n`);
  return r;
};
let ok = true;
let r = summary('boot to the prompt', m.boot(opts.boot));
if (r.reason !== 'until') ok = false;
else {
  r = m.run({ seconds: opts.settle });
  if (r.reason === 'stop') ok = false;
  for (const line of ok ? opts.line : []) {
    r = summary(`"${line}"`, m.command(line, opts.wait));
    if (r.reason !== 'until') { ok = false; break; }
  }
  if (ok && opts.after > 0) { r = summary(`${opts.after} s more`, m.run({ seconds: opts.after })); if (r.reason === 'stop') ok = false; }
}
flush();
process.stderr.write(`[scpu] ${ok ? 'ok' : 'FAILED'} in ${Date.now() - t0} ms\n`);
process.exit(ok ? 0 : 1);
