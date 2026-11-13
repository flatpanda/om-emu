#!/usr/bin/env node
// A scripted, headless play session: the tokens of --script FILE, then those on the command line, run in order on the
// play runtime's Player in this process (no HTTP server), each step's record one JSON line on stdout and a summary
// line at the end; the human lines on stderr. The module is host/session.mjs openSession, the supported scripting API
// (emu/README.md "Scripted sessions").
//   node emu/bin/session.mjs [--model CODE] [--patch FILE... | --main FILE] [--card FILE] [--card-put DOS/PATH=LOCAL]...
//                            [--card-get DOS/PATH=LOCAL]... [--nvram off|FILE] [--loaded auto|on|off] [--creative-dial K]
//                            [--settle MS] [--out DIR] [--script FILE]... [TOKEN...]
// --nvram is off by default (a blank camera at each start), unlike play's: a scripted verification starts from a known
// camera unless told otherwise. --card FILE is written back in place at each session's end, as play's OM_EMU_CARD.
// Each argument and each --script line is split into tokens at white space ("..." keeps spaces; # starts a comment).
// The tokens: KEY (a press: down, 150 ms, up, then --settle of lab time), KEY:down, KEY:up, hold:KEY[:MS],
// main_dial:+N / sub_dial:-N, wait:MS, play's own tokens (WAIT:MS, EV:..., SET:id=v, GET:id, ...), switch:ID=V or
// switch:ID+N (creative_dial, mode_dial, lever, ...), power:off, restart[:card=FILE] (a new session in this process
// on the same nvram file and card, or the card FILE), shot:FILE.png (the last published frame, /api/frame's pixels),
// read:ADDR:LEN, write:ADDR=HEX (a poke: flagged in the summary and the last line), call:FN[:d0=..,a0=..,limit=N],
// card-ls, card-get:DOS/PATH=LOCAL, exif:DOS/PATH, and the checks expect:gui=NAME (or ~TEXT), expect:mem:ADDR=HEX (or
// !=HEX), expect:card:DOS/PATH, expect:standin:NAME, expect:exif:DOS/PATH:FIELD=TEXT (or ~TEXT); a card path may end in a
// pattern with * and ? (the last match by name). Relative LOCAL and FILE paths of the tokens resolve against --out.
// Exit 0 when every step passed; 1 a firmware or lab error, a refused input or option, a local file a step cannot write
// or an --out it cannot make ('FILE: cannot write it (CODE)'), or a failed expect (the step named on stderr); 2 a usage
// error.
import fs from 'node:fs';
import { takeModel, importLab } from '../host/modelarg.mjs';
import { parseArgs, UsageError } from '../checks/lib/args.mjs';
import { openSession, splitScript, parseToken, SessionRefused } from '../host/session.mjs';      // the lab only inside openSession

const PROG = 'session.mjs';
const SPEC = [
  { name: 'tokens', positional: true, rest: true, metavar: 'TOKEN' },
  { opt: '--patch', type: 'path', repeat: true, metavar: 'FILE' },
  { opt: '--main', type: 'path', metavar: 'FILE' },
  { opt: '--card', type: 'path', metavar: 'FILE' },
  { opt: '--card-put', type: 'str', repeat: true, metavar: 'DOS/PATH=LOCAL' },
  { opt: '--card-get', type: 'str', repeat: true, metavar: 'DOS/PATH=LOCAL' },
  { opt: '--nvram', type: 'str', default: 'off', metavar: 'off|FILE' },
  { opt: '--loaded', type: 'str', choices: ['auto', 'on', 'off'], default: 'auto' },
  { opt: '--creative-dial', type: 'int', metavar: 'K' },
  { opt: '--settle', type: 'int', metavar: 'MS' },
  { opt: '--out', type: 'path', metavar: 'DIR' },
  { opt: '--script', type: 'path', repeat: true, metavar: 'FILE' },
];
const line = (doc) => process.stdout.write(JSON.stringify(doc) + '\n');
const err = (s) => process.stderr.write(`${PROG}: ${s}\n`);

async function main(argv) {
  const a = parseArgs(PROG, argv, SPEC);
  if (a.settle !== undefined && a.settle < 0) a.error(`--settle ${a.settle}: not a lab time in ms`);
  const tokens = [];
  for (const f of a.script) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { a.error(`--script ${f}: cannot read it (${e.code ?? e.message})`); }
    tokens.push(...splitScript(text));
  }
  for (const t of a.tokens) tokens.push(...splitScript(t));
  // the usage checks that need no lab, before any (the controls the model has are checked once the lab is imported)
  if (a.main !== undefined && a.patch.length) a.error('--main and --patch exclude each other (--main is the whole change to the main code block)');
  for (const [opt, list] of [['--card-put', a.card_put], ['--card-get', a.card_get]]) for (const x of list) if (!/^[^=]+=.+$/.test(x)) a.error(`${opt} ${x}: DOS/PATH=LOCAL`);
  tokens.forEach(parseToken);
  const { provision } = await importLab(PROG, new URL('../host/firmware.mjs', import.meta.url).href);     // after takeModel
  if (await provision(PROG, { make: false })) return 1;       // no download here: a model without its blocks is refused
  let s;
  try {
    s = await openSession({ patch: a.patch, main: a.main, card: a.card, cardPut: a.card_put, cardGet: a.card_get, nvram: a.nvram, loaded: a.loaded,
      creativeDial: a.creative_dial, settle: a.settle, out: a.out, tokens, say: err });
  } catch (e) {
    if (!(e instanceof SessionRefused)) throw e;
    err(e.message);
    line({ summary: true, ok: false, errors: [e.message] });
    return 1;
  }
  line(s.first);
  if (s.first.ok) for (const t of tokens) { const r = s.step(t); line(r); if (!r.ok) break; }
  const sum = s.close();
  line(sum);
  const f = sum.failed;
  const poked = sum.pokes.length ? `; POKED: ${sum.pokes.length} write(s) (${sum.pokes.map((p) => `step ${p.step} ${p.addr ?? p.token}`).join(', ')}): the run depends on memory the firmware did not write` : '; no poke';
  err(`${f ? `FAILED at ${f.step === null ? f.token : `step ${f.step} (${f.token})`}: ${f.message}` : 'passed'}; ${sum.steps} step(s) on ${sum.model}${sum.patch ? ', patched' : ''}${poked}`);
  return f ? 1 : 0;
}

const argv = takeModel(PROG, process.argv.slice(2));
main(argv).then((rc) => { process.exitCode = rc; }, async (e) => {
  if (e instanceof UsageError) { process.stderr.write(`${PROG}: ${e.message}\n${e.usage ? `${e.usage}\n` : ''}`); process.exitCode = 2; return; }
  const { exitFor } = await import('../checks/lib/env.mjs');    // a bug: its stack, exit 1
  process.exitCode = exitFor(PROG, e);
});
