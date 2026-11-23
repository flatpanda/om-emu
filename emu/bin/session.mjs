#!/usr/bin/env node
// A scripted, headless play session: the tokens of --script FILE, then those on the command line, run in order on the
// play runtime's Player in this process (no HTTP server), each step's record one JSON line on stdout and a summary
// line at the end; the human lines on stderr. The module is host/session.mjs openSession, the supported scripting API
// (emu/README.md "Scripted sessions").
//   node emu/bin/session.mjs [--model CODE] [--patch FILE... | --main FILE] [--card FILE] [--no-card]
//                            [--card-put DOS/PATH=LOCAL]... [--card-get DOS/PATH=LOCAL]... [--nvram off|FILE]
//                            [--loaded auto|on|off] [--creative-dial K] [--held KEY]... [--a15 auto|off|on] [--device tft|evf]
//                            [--rotate off|on]
//                            [--osd-errors fail|report] [--settle MS] [--out DIR] [--script FILE]... [TOKEN...]
// --rotate on runs PER_ROTATE natively (play's --rotate, H-ROTINIT; off by default), and tilt:roll=R[,pitch=P] is the
// play input tilt (degrees), which waits its own lab time.
// --osd-errors fail fails a step in which the OSD engine refused a picture; report only lists them. The default is
// fail on E143, E146 and E147, whose stock flows were measured with none, and report on the other bodies.
// --nvram is off by default (a blank camera at each start), unlike play's: a scripted verification starts from a known
// camera unless told otherwise. --card FILE is written back in place at each session's end, as play's OM_EMU_CARD.
// --no-card starts with the first slot empty (the card, --card's or a blank one, out of it until card:in); card:out
// and card:in (card:out:2, card:in:2 the second slot's) take the card out and put it back while the camera runs, and
// a restart keeps the slot as the last session left it.
// Each argument and each --script line is split into tokens at white space ("..." keeps spaces; # starts a comment).
// The tokens: KEY (a press: down, 150 ms, up, then --settle of lab time), KEY:down, KEY:up, hold:KEY[:MS],
// main_dial:+N / sub_dial:-N, wait:MS, play's own tokens (WAIT:MS, EV:..., SET:id=v, GET:id, ...; a SET or GET
// setting may be named, SET:MODE_SLEEP=60), switch:ID=V,
// switch:ID+N or switch:ID-N (creative_dial, mode_dial, still_movie, lever, ...), power:off, restart[:card=FILE] (a new session in this process
// on the same nvram file and card, or the card FILE), shot:FILE.png (the last published frame, /api/frame's pixels),
// read:ADDR:LEN, dump:ADDR:LEN:FILE (up to 64 MiB into FILE), write:ADDR=HEX (a poke: flagged in the summary and the last line), call:FN[:d0=..,a0=..,limit=N]
// (and entry=PC, stop=PC..., frame=MASK/SIZE: a mid-function call; space=notation|runtime for an address outside the
// image's two ranges), call:@FILE (the call op's whole request as JSON;
// one with mem is a poke), setting:ID or setting:NAME (a setting's value by the getter, with its id and the firmware's
// own name for it: setting:44, setting:MODE_MOVIE; a name is this body's, read from its .BIN, and one it lacks is a
// usage error), card-ls, card-get:DOS/PATH=LOCAL, exif:DOS/PATH, and the checks expect:gui=NAME (or ~TEXT),
// expect:mem:ADDR=HEX (or !=HEX), expect:setting:ID=V (or NAME, or !=V), expect:card:DOS/PATH, expect:standin:NAME, expect:exif:DOS/PATH:FIELD=TEXT (or ~TEXT); a card path may end in a
// pattern with * and ? (the last match by name). Relative LOCAL and FILE paths of the tokens resolve against --out.
// Traces and stops: trace:PC[,PC...][:stack=N] and trace:mem:ADDR:LEN[:r|w|rw] record each hit in the later steps'
// records, with N stack words per pc hit (trace:off disarms); break:PC[,PC...] and break:mem:ADDR:LEN[:r|w|rw] end the
// step that meets one at the stop (at a hooked pc before the hook answers), where the next tokens (reads, dumps, writes,
// a call, after break:off at a watchpoint's stop, expects, the card, trace:, break:) run until resume (break:off
// disarms). A run whose tokens end at a stop ends there, nothing run after it (the summary's ended_at_stop, the last
// line), exit 0 when every step passed.
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
  { opt: '--no-card', type: 'flag', default: false },
  { opt: '--card-put', type: 'str', repeat: true, metavar: 'DOS/PATH=LOCAL' },
  { opt: '--card-get', type: 'str', repeat: true, metavar: 'DOS/PATH=LOCAL' },
  { opt: '--nvram', type: 'str', default: 'off', metavar: 'off|FILE' },
  { opt: '--loaded', type: 'str', choices: ['auto', 'on', 'off'], default: 'auto' },
  { opt: '--creative-dial', type: 'int', metavar: 'K' },
  { opt: '--held', type: 'str', repeat: true, metavar: 'KEY' },
  { opt: '--a15', type: 'str', choices: ['auto', 'off', 'on'], default: 'auto' },
  { opt: '--device', type: 'str', choices: ['tft', 'evf'], default: 'tft' },
  { opt: '--rotate', type: 'str', choices: ['off', 'on'], default: 'off' },
  { opt: '--osd-errors', type: 'str', choices: ['fail', 'report'] },       // the default: openSession's, per body
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
    s = await openSession({ patch: a.patch, main: a.main, card: a.card, noCard: a.no_card, cardPut: a.card_put, cardGet: a.card_get, nvram: a.nvram, loaded: a.loaded,
      creativeDial: a.creative_dial, held: a.held, a15: a.a15, device: a.device, rotate: a.rotate, osdErrors: a.osd_errors, settle: a.settle, out: a.out, tokens, say: err, onRecord: line });
  } catch (e) {
    if (!(e instanceof SessionRefused)) throw e;
    err(e.message);
    line({ summary: true, ok: false, errors: [e.message] });
    return 1;
  }
  line(s.first);
  if (s.first.ok) s.run(tokens);              // each record printed as it ends (onRecord): a debug stop's record first
  const sum = s.close();
  line(sum);
  const f = sum.failed;
  const poked = sum.pokes.length ? `; POKED: ${sum.pokes.length} write(s) (${sum.pokes.map((p) => `step ${p.step} ${p.addr ?? p.token}`).join(', ')}): the run depends on memory the firmware did not write` : '; no poke';
  const e = sum.ended_at_stop, atStop = e ? `; ended at the debug stop of step ${e.step} (${e.kind} at ${e.pc}): nothing ran after it` : '';
  err(`${f ? `FAILED at ${f.step === null ? f.token : `step ${f.step} (${f.token})`}: ${f.message}` : 'passed'}; ${sum.steps} step(s) on ${sum.model}${sum.patch ? ', patched' : ''}${atStop}${poked}`);
  return f ? 1 : 0;
}

const argv = takeModel(PROG, process.argv.slice(2));
main(argv).then((rc) => { process.exitCode = rc; }, async (e) => {
  if (e instanceof UsageError) { process.stderr.write(`${PROG}: ${e.message}\n${e.usage ? `${e.usage}\n` : ''}`); process.exitCode = 2; return; }
  const { exitFor } = await import('../checks/lib/env.mjs');    // a bug: its stack, exit 1
  process.exitCode = exitFor(PROG, e);
});
