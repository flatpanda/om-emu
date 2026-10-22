// The nav tool on node: its command line (--start and --blank exclude each other, --evf-layout needs --device evf), one
// stdout line per token, a PNG per step (--png each|end|none; the .ycc removed), session.json (JSON with a one-space
// indent), 'error: ...' on stderr and rc 1 for a FirmwareError or ValueError. Wall seconds print with two decimals
// per step and one for the whole run. Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import { MODEL } from '../src/fw/model.mjs';
import { REPO, loadImage, loadBlock, createHash, exitFor } from '../checks/lib/env.mjs';
import { parseArgs, intValue } from '../checks/lib/args.mjs';
import { write_outputs, jsonText } from '../checks/lib/png.mjs';
import { isValueError } from '../checks/lib/errors.mjs';
import * as N from '../src/lab/nav.mjs';
import { FirmwareError, ValueError } from '../src/lab/errors.mjs';
import { show } from '../src/util/show.mjs';
import { decimalInt } from '../src/util/parse.mjs';
import { installChildTrace } from '../checks/lib/childtrace.mjs';
import { provision } from './firmware.mjs';

export const PROG = 'nav.mjs';
const OUT = path.join(REPO, 'emu/out/nav', MODEL);
// The stand-in texts for the keys main() records (m8_inputs)
const M8_TEXTS = {
  "H-BOOTTIME": "time mode: 0x5003121c, 0x500642dd and 0x50058959 run natively in boot order at display start, in place of H-TIMER (the init task that calls them at 0x5002ccd7/0x5002cd7b/0x5002cd82 is replaced by the lab task)",
  "H-DEFER": "time mode: task 16's init 0x5005304d runs natively after the boot steps and its entry 0x500530f7 may start; its caller 0x500248e2 in the boot function 0x500248b4 is not traced",
  "ELAPSE": "time mode: the lab task waits while lab time runs to a target (RUN_TO_EVENT); the timers' IRQs are accepted at the idle point (H-IRQGATE); inside display steps OlyTaSS (A10) moves the clock without servicing them (overruns counted)",
  "H-TIMER": "M8: the software-timer boot step 0x50058959 (called at 0x5002cd82) runs natively in display start; the hardware-timer init 0x500642dd (0x5002cd7b) does not: table pointer 0xa32ca47c = 0 and the low-RAM u16 at 6 * ch + 2 = 0 for ch 16..31 are asserted, so 0x50064323/0x50064352/0x5006437d return 0x5201/0x5202/0 without touching hardware; 0x50064478/0x5006449b/0x500644fa raise if reached",
  "store-first": "M8 option (--store-first): the store init runs after display task init and before the first DISPLAY OPEN (boot order, settings spec section 4); the default keeps M6's order",
  "S-TAKEOVER": "M8, evf_layout only: 0x50ab6299(9, 2) natively after GUI creation, the value API 70405 writes at 0x50ae0048 (boot take-over 0x501e6adb); module 9 may then be read (0x50ab5780) only by ChangeOutline (returns 0x50abcfd7, 0x50abcfe2); the camera's state at menu time is not known",
  "H-CONNECT": "M8, evf_layout only: sendEvent(0x83, 7) in POWER_ON, then settle: GUI message 0x9601, lOutput 7, the INTERNAL_EVF row of the sender 0x5105053c (its EVF row is lOutput 3); which row the camera takes is not traced",
  "H-RESEND": "M8 (the SWITCH token): 0x503e52c7(kind 1 TFT / 32 EVF, {1, 1, 1}) natively, the request openDevice 0x50d83338 makes after its open (0x50d8350d..0x50d83535); openDevice's caller is not traced",
  "H-UPDATE": "M8 (the SWITCH token): the GUI's re-display wrapper 0x510bd84b (gpiUpdateDisplay(1)) from the lab task after the switch; which code updates the display after a switch on the camera is not traced",
};
export const ACTIONS = [
  { name: 'script', positional: true },
  { opt: '--lang', type: 'str', default: 'en' },
  { opt: '--device', type: 'str', choices: ['tft', 'evf'], default: 'tft' },
  { opt: '--u1', type: 'str', choices: ['refuse', 'skip', 'write'], default: 'skip' },
  { opt: '--start', type: 'str' },                        // default 7,1,1; not with --blank
  { opt: '--blank', type: 'flag', default: false },
  { opt: '--seed', type: 'path', default: null },
  { opt: '--png', type: 'str', choices: ['each', 'end', 'none'], default: 'each' },
  { opt: '--clock', type: 'int', default: null },
  { opt: '--no-open', type: 'flag', default: false },
  { opt: '--store-first', type: 'flag', default: false },
  { opt: '--evf-layout', type: 'flag', default: false },
  { opt: '--a15', type: 'flag', default: false },
  { opt: '--time', type: 'flag', default: false },
  { opt: '--out', type: 'path', default: null },
  { opt: '--tag', type: 'str', default: 'nav' },
];
const say = (line) => process.stdout.write(line + '\n');
// --seed FILE: a JSON object of setting id: value, both integers (an id as its decimal key), seeded in ascending id
// order (a JSON object's integer keys come in that order)
function readSeed(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new ValueError(`--seed ${file}: ${e.message}`); }
  const seed = new Map();
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new ValueError(`--seed ${file}: not a JSON object`);
  for (const k of Object.keys(doc)) {
    const id = intValue(k), v = typeof doc[k] === 'number' ? doc[k] : intValue(String(doc[k]));
    if (id === null || !Number.isSafeInteger(v)) throw new ValueError(`--seed ${file}: ${JSON.stringify(k)}: ${String(doc[k])}: an integer id and value`);
    seed.set(id, v);
  }
  return seed;
}
const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const words = (s) => s.split(/\s+/).filter(Boolean);
const cmpTuple = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };

export async function main(argv) {
  let a;
  try { a = parseArgs(PROG, argv, ACTIONS); } catch (e) { return exitFor(PROG, e); }
  const fw = await provision(PROG, { make: false });      // no fetch here: a model without its blocks is refused
  if (fw) return fw;
  try { return run(a); } catch (e) {
    return exitFor(PROG, e);                 // a usage error exits 2, an uncaught error prints its stack, rc 1
  }
}

function run(a) {
  if (a.blank && a.start !== undefined) a.error('--start and --blank exclude each other');
  const start = a.blank ? null : (a.start ?? '7,1,1').split(',').map(decimalInt);
  if (start !== null && (start.length !== 3 || start.includes(null))) a.error('--start: three integers T,P,C');
  const seed = a.seed ? readSeed(a.seed) : new Map();    // in the file's order
  const out = a.out ?? path.join(OUT, a.tag);
  fs.mkdirSync(out, { recursive: true });
  const doc = { script: a.script, lang: a.lang, device: a.device, u1: a.u1, start, seed, clock: a.clock,
    nav_pri: N.NAV_PRI, budgets: { post: N.POST_HOOKS, step: N.STEP_HOOKS, storm: N.STORM, wait_storm_per_ms: N.WAIT_STORM_PER_MS, wait_hooks_per_ms: N.WAIT_HOOKS_PER_MS },
    steps: [] };
  const t0 = performance.now();
  let rc = 0;
  if (a.evf_layout && a.device !== 'evf') a.error('--evf-layout needs --device evf');
  if (a.evf_layout && words(a.script).some((t) => t.startsWith('SWITCH'))) a.error('SWITCH with --evf-layout is not defined');
  // OM_CHILD_TRACE (golden traces of child labs, checks/lib/childtrace.mjs): every lab of this process traced, written at exit
  const trace = installChildTrace({ argv: process.argv.slice(2), install: false });
  if (trace) process.on('exit', (code) => trace.finish(code));
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, ...(trace?.fields ?? {}),
    writeOutputs: (lab, name, device, comp, dump, dir) => write_outputs(lab, name, device, comp, dump, dir) };
  const nav = new N.NavSession(env, { lang: a.lang, device: a.device, u1: a.u1, start, seed, open_menu: false, out, tag: a.tag,
    store_first: a.store_first, evf_layout: a.evf_layout, a15: a.a15, time: a.time });
  let tokens = words(a.script);
  try {
    nav.enter();
    try {
      const lab = nav.lab;
      doc.bring_up_seconds = nav.bringup_seconds;
      const store = {};
      for (const [k, v] of Object.entries(lab.store_log)) if (k !== 'cflush') store[k] = v;
      store.cflush = {};
      for (const [k, v] of lab.store_log.cflush) store.cflush['0x' + (k >>> 0).toString(16).padStart(8, '0')] = v;
      doc.store = store;
      if (a.clock !== null) nav.clock(a.clock);
      if (!a.no_open) tokens = ['OPEN', ...tokens];
      for (let n = 0; n < tokens.length; n++) {
        const tok = tokens[n];
        const rec = nav.step(tok);
        if (a.png === 'each' || (a.png === 'end' && n === tokens.length - 1)) {
          const png = nav.screenshot(nav.device, path.join(out, `${String(rec.n).padStart(2, '0')}-${tok.replaceAll(':', '_').replaceAll('=', '_')}`));
          fs.rmSync(png.replace(/\.png$/, '.ycc'), { force: true });
          rec.png = png;
        }
        const st = rec.state, mn = st.menu ?? {};
        const g = (k) => String(mn[k] ?? null);
        const writes = show(rec.writes.map((w) => [w.id, w.d1, w.a1, w.ret]));
        say(`${String(rec.n).padStart(2, '0')} ${pad(tok, 10)} ${rec.state_before.slice(0, 6)} -> ${st.gui} ${st.gui_name}: panel ` +
          `${st.panel} tab ${g('tab_id')} page ${g('page')}/${g('pages')} row ${g('cursor_row')}; writes ${writes}; ` +
          `${rec.engine_commands} engine cmds, hooks ${show(rec.hooks)}, ${rec.seconds.toFixed(2)} s` + (rec.png ? `; ${rec.png}` : ''));
      }
      const hits = lab.stub_hits.entries().filter(([[ph]]) => ['store', 'persist', 'menu', 'bring-up'].includes(ph)).sort((x, y) => cmpTuple(x[0], y[0]));
      doc.stand_ins = {};
      for (const [[, n, w], v] of hits) doc.stand_ins[`${n} (${w})`] = v;
      const used = [...(a.time ? ['H-BOOTTIME', 'H-DEFER', 'ELAPSE'] : ['H-TIMER']), ...(a.store_first ? ['store-first'] : []),
        ...(a.evf_layout ? ['S-TAKEOVER', 'H-CONNECT'] : []), ...(tokens.some((t) => t.startsWith('SWITCH')) ? ['H-RESEND', 'H-UPDATE'] : [])];
      doc.m8_inputs = {};
      for (const k of used) doc.m8_inputs[k] = M8_TEXTS[k];
      doc.h_timer = lab.timer_log;
      if (a.time) {
        const timer = {};
        for (const [n, c] of lab.timer.running()) timer[n] = { expiries: c.expiries, overruns: c.overruns };
        doc.time = { boot: lab.time_log_boot, lab_time: lab.lab_time(), timer };
      } else doc.time = null;
      doc.b2 = lab.takeover_log;
    } finally { nav.close(); }
  } catch (e) {
    if (!(e instanceof FirmwareError || isValueError(e))) throw e;
    doc.error = [...e.message].slice(0, 3000).join('');
    process.stderr.write(`error: ${[...e.message].slice(0, 2000).join('')}\n`);
    rc = 1;
  }
  doc.steps = nav.steps;
  doc.seconds = Math.round((performance.now() - t0) / 100) / 10;
  const file = path.join(out, 'session.json');
  fs.writeFileSync(file, jsonText(doc, 1));
  say(`${file} (${doc.seconds.toFixed(1)} s)`);
  return rc;
}
export { ValueError };
