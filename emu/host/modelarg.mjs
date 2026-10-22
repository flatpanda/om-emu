// --model CODE|list on a node tool's command line (bin/play.mjs, bin/nav.mjs, bin/fetch-fw.mjs). The lab's model is
// fixed when src/fw/model.mjs is first imported (OM_EMU_MODEL, else E143), so takeModel sets OM_EMU_MODEL from the
// option before the tool imports the lab: the tool's entry point imports only this module statically and the rest with
// importLab after takeModel returns (static imports are hoisted, and one that reaches model.mjs would fix the model
// before --model is read). The play server's lab worker inherits process.env, so it runs the same model. The option
// wins over OM_EMU_MODEL, and the tool's own parser never sees it (session.json keeps the namespace of
// play's and nav's parsers).
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from '../src/fw/models.mjs';
import { REPO, binPin, blocksPresent } from './blobs.mjs';

// argv without --model CODE / --model=CODE (the last one wins; nothing after '--' is read).
// A code MODELS does not have exits 2; 'list' prints the models and exits 0. -h / --help names the option (the tool's
// own parser, which refuses the help, does not have it).
export function takeModel(prog, argv) {
  const rest = [];
  let code = null;
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--') { rest.push(...argv.slice(i)); break; }
    if (s === '-h' || s === '--help') process.stderr.write(`${prog}: --model CODE|list picks the camera model (default OM_EMU_MODEL, else E143)\n`);
    if (s === '--model' || s.startsWith('--model=')) {
      code = s === '--model' ? argv[++i] : s.slice('--model='.length);
      if (!code) refuse(prog, '--model needs a model code');
    } else rest.push(s);
  }
  if (code === 'list') { list(); process.exit(0); }
  if (code !== null) {
    if (!Object.hasOwn(MODELS, code)) refuse(prog, `--model: unknown model ${JSON.stringify(code)}`);
    process.env.OM_EMU_MODEL = code;
  }
  return rest;
}

// import() of a tool's module that reaches the lab, after takeModel. A model the lab cannot load yet throws an Error
// while that module graph is evaluated (src/fw/board.mjs: a board fact its family lacks); it is refused as
// `<prog>: the lab does not load on <code> (<name>) yet: <message>`, exit 1, not as a stack trace. Any other exception
// (a SyntaxError, a TypeError: a bug, not a model) keeps its trace.
export async function importLab(prog, url) {
  try { return await import(url); } catch (e) {
    if (e?.constructor !== Error) throw e;
    const m = await import('../src/fw/model.mjs').catch(() => null);      // null: it is model.mjs that threw
    process.stderr.write(`${prog}: ${m ? `the lab does not load on ${m.MODEL} (${m.MODEL_INFO.name}) yet: ` : ''}${e.message}\n`);
    process.exit(1);
  }
}

function refuse(prog, why) {
  process.stderr.write(`${prog}: ${why} (choose from ${Object.keys(MODELS).join(', ')}; --model list names them)\n`);
  process.exit(2);
}

// One row per MODELS entry: code, name, firmware version, and its firmware on disk (host/firmware.mjs provision):
// present (both blocks unpacked), the .BIN's path (unpacked on first use), or missing (a download is tried on first
// use; the updater API serves only each body's latest release, so it may be refused).
function list() {
  const rows = Object.entries(MODELS).map(([code, m]) => {
    const pin = binPin(m);
    const fw = blocksPresent(m) ? 'present' : pin && fs.existsSync(path.join(REPO, pin.rel)) ? `${pin.rel} (unpacked on first use)` : 'missing';
    return [code, m.name, `v${m.version}`, fw];
  });
  const w = [0, 1, 2].map((k) => Math.max(...rows.map((r) => r[k].length)));
  for (const r of rows) process.stdout.write(`${r.slice(0, 3).map((c, k) => c.padEnd(w[k])).join('  ')}  ${r[3]}\n`);
}
