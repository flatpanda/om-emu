// Scripted session CLI options --cpu2, --camapp, and --play-native (bin/session.mjs, host/session.mjs openSession):
//   sessionCliUnits  (firmware-free) valid and invalid --cpu2, --camapp, --play-native CLI flags in bin/session.mjs
//                    (exit 2 on invalid choice before opening any lab), programmatic validation in host/session.mjs,
//                    header documentation, and default/choice parity with host/playcli.mjs.
//   node emu/test/test_session_cli.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../checks/lib/args.mjs';
import {
  TokenError,
  CPU2_CHOICES, CAMAPP_CHOICES, PLAY_NATIVE_CHOICES,
  validateCpu2, validateCamapp, validatePlayNative,
} from '../host/session.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const BIN = path.join(EMU, 'bin/session.mjs');
const PLAYCLI = path.join(EMU, 'host/playcli.mjs');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const cli = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: opts.timeout ?? 30000, env: { ...process.env, ...(opts.env ?? {}) } });
  const lines = [];
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { lines.push({ unparsed: l }); } }
  return { rc: r.status, lines, err: r.stderr ?? '' };
};

export function sessionCliUnits() {
  const t = tester(), { ok } = t;

  // Defaults and choices match host/playcli.mjs ACTIONS (parsed without importing lab modules)
  const extractOpt = (src, opt) => {
    const m = new RegExp(`\\{[^\\n]*opt:\\s*'${opt}'[^\\n]*\\}`).exec(src);
    if (!m) return null;
    const choices = /choices:\s*\[([^\]]+)\]/.exec(m[0])?.[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) ?? null;
    const def = /default:\s*'([^']+)'/.exec(m[0])?.[1] ?? null;
    return { choices, default: def };
  };
  const playSrc = fs.readFileSync(PLAYCLI, 'utf8');
  const binSrc = fs.readFileSync(BIN, 'utf8');
  for (const [opt, choices, validate] of [
    ['--cpu2', CPU2_CHOICES, validateCpu2],
    ['--camapp', CAMAPP_CHOICES, validateCamapp],
    ['--play-native', PLAY_NATIVE_CHOICES, validatePlayNative],
  ]) {
    const playOpt = extractOpt(playSrc, opt);
    const binOpt = extractOpt(binSrc, opt);
    ok(playOpt && binOpt
      && JSON.stringify(binOpt.choices) === JSON.stringify(playOpt.choices)
      && binOpt.default === playOpt.default
      && JSON.stringify(choices) === JSON.stringify(playOpt.choices)
      && validate(undefined) === playOpt.default,
      `${opt} choices/default match playcli.mjs: bin=${JSON.stringify(binOpt)} host=${JSON.stringify({ choices, default: validate(undefined) })} playcli=${JSON.stringify(playOpt)}`);
  }

  // Programmatic validators: valid values accepted, invalid values throw TokenError (UsageError)
  for (const v of ['auto', 'stand-in', 'native']) ok(validateCpu2(v) === v, `validateCpu2 accepts ${v}`);
  for (const bad of ['bogus', '', null, 1, 'on']) {
    const e = thrown(() => validateCpu2(bad));
    ok(e instanceof TokenError && e instanceof UsageError && /--cpu2 .*: one of auto, stand-in, native/.test(e.message),
      `validateCpu2 refuses ${JSON.stringify(bad)}: ${e?.message ?? 'accepted'}`);
  }

  for (const v of ['1', '2', '3']) ok(validateCamapp(v) === v, `validateCamapp accepts ${JSON.stringify(v)}`);
  for (const v of [1, 2, 3]) ok(validateCamapp(v) === String(v), `validateCamapp accepts numeric ${v}`);
  for (const bad of ['0', '4', '', null, 4, 'auto']) {
    const e = thrown(() => validateCamapp(bad));
    ok(e instanceof TokenError && e instanceof UsageError && /--camapp .*: one of 1, 2, 3/.test(e.message),
      `validateCamapp refuses ${JSON.stringify(bad)}: ${e?.message ?? 'accepted'}`);
  }

  for (const v of ['auto', 'on', 'off']) ok(validatePlayNative(v) === v, `validatePlayNative accepts ${v}`);
  for (const bad of ['yes', '', null, true, 'native']) {
    const e = thrown(() => validatePlayNative(bad));
    ok(e instanceof TokenError && e instanceof UsageError && /--play-native .*: one of auto, on, off/.test(e.message),
      `validatePlayNative refuses ${JSON.stringify(bad)}: ${e?.message ?? 'accepted'}`);
  }

  // bin/session.mjs header documents the three options
  const head = fs.readFileSync(BIN, 'utf8').split('\nimport ')[0];
  ok(head.includes('[--cpu2 auto|stand-in|native]'), 'bin/session.mjs header documents [--cpu2 auto|stand-in|native]');
  ok(head.includes('[--camapp 1|2|3]'), 'bin/session.mjs header documents [--camapp 1|2|3]');
  ok(head.includes('[--play-native auto|on|off]'), 'bin/session.mjs header documents [--play-native auto|on|off]');

  // CLI invalid choices & missing values: exit 2 before opening any lab, no stdout
  for (const [args, re, what] of [
    [['--cpu2'], /--cpu2 needs a value/, '--cpu2 without value'],
    [['--cpu2', 'bogus'], /--cpu2 bogus: one of auto, stand-in, native/, '--cpu2 invalid choice'],
    [['--cpu2=off'], /--cpu2 off: one of auto, stand-in, native/, '--cpu2=off invalid choice'],
    [['--camapp'], /--camapp needs a value/, '--camapp without value'],
    [['--camapp', '4'], /--camapp 4: one of 1, 2, 3/, '--camapp invalid choice'],
    [['--camapp=0'], /--camapp 0: one of 1, 2, 3/, '--camapp=0 invalid choice'],
    [['--play-native'], /--play-native needs a value/, '--play-native without value'],
    [['--play-native', 'yes'], /--play-native yes: one of auto, on, off/, '--play-native invalid choice'],
    [['--play-native=true'], /--play-native true: one of auto, on, off/, '--play-native=true invalid choice'],
  ]) {
    const r = cli(args);
    ok(r.rc === 2 && re.test(r.err) && !r.lines.length, `CLI ${what}: rc ${r.rc} ${r.err.slice(0, 200)}`);
  }

  // CLI valid choices: accepted by parser (proceeds to token validation, failing on invalid token 'OK' with exit 2 before any lab)
  for (const [args, what] of [
    [['--cpu2', 'auto', 'OK'], '--cpu2 auto'],
    [['--cpu2', 'stand-in', 'OK'], '--cpu2 stand-in'],
    [['--cpu2=native', 'OK'], '--cpu2=native'],
    [['--camapp', '1', 'OK'], '--camapp 1'],
    [['--camapp', '2', 'OK'], '--camapp 2'],
    [['--camapp=3', 'OK'], '--camapp=3'],
    [['--play-native', 'auto', 'OK'], '--play-native auto'],
    [['--play-native', 'on', 'OK'], '--play-native on'],
    [['--play-native=off', 'OK'], '--play-native=off'],
    [['--cpu2', 'native', '--camapp', '2', '--play-native', 'on', 'OK'], 'all three options combined'],
  ]) {
    const r = cli(args);
    ok(r.rc === 2 && /OK: not a token/.test(r.err) && !r.lines.length, `CLI valid ${what}: rc ${r.rc} ${r.err.slice(0, 200)}`);
  }

  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = sessionCliUnits();
  console.log(`session cli units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length ? 1 : 0);
}
