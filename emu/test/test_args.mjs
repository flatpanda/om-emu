// The command-line parser of the checks and the node tools (checks/lib/args.mjs): values, defaults, repeats, an
// optional value, positionals, '--', and each usage error (its message and the usage line it carries); and the number
// parsers of the lab's text inputs (src/util/parse.mjs).
//   node emu/test/test_args.mjs
import { parseArgs, usage, intValue, UsageError } from '../checks/lib/args.mjs';
import { decimalInt, intLiteral, decimalNumber } from '../src/util/parse.mjs';

const SPEC = [
  { opt: '--seed', type: 'int' },
  { opt: '--paced', type: 'number', metavar: 'S' },
  { opt: '--kernel', type: 'str', choices: ['native', 'none'], default: 'native' },
  { opt: '--write-notes', type: 'flag' },
  { opt: '--stop', type: 'int', repeat: true, metavar: 'ADDR' },
  { opt: '--stack', type: 'int', bare: 16, default: 0, metavar: 'WORDS' },
  { opt: '--out', type: 'path', required: true },
  { name: 'script', positional: true, required: false },
];
const USAGE = 'usage: t.mjs [--seed SEED] [--paced S] [--kernel native|none] [--write-notes] [--stop ADDR]... [--stack [WORDS]] --out OUT [SCRIPT]';

export function argsTests() {
  const bad = [];
  let checks = 0;
  const parse = (argv, spec = SPEC) => { try { return { ...parseArgs('t.mjs', argv, spec) }; } catch (e) { if (!(e instanceof UsageError)) throw e; return `${e.message} | ${e.usage}`; } };
  const eq = (label, got, want) => { checks++; if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  eq('usage line', usage('t.mjs', SPEC), USAGE);
  eq('defaults', parse(['--out', 'o']), { out: 'o', kernel: 'native', stop: [], stack: 0 });
  eq('values', parse(['--seed', '0x10', '--paced', '2.5', '--kernel=none', '--write-notes', '--out=o', 'OPEN DOWN']),
    { seed: 16, paced: 2.5, kernel: 'none', write_notes: true, out: 'o', script: 'OPEN DOWN', stop: [], stack: 0 });
  eq('a negative value', parse(['--seed', '-1', '--out', 'o']).seed, -1);
  eq('repeat', parse(['--stop', '1', '--stop', '0b11', '--out', 'o']).stop, [1, 3]);
  eq('bare value', parse(['--stack', '--out', 'o']).stack, 16);
  eq('optional value given', parse(['--stack', '4', '--out', 'o']).stack, 4);
  eq("'--' ends the options", parse(['--out', 'o', '--', '--seed']).script, '--seed');
  const err = (label, argv, msg) => eq(label, parse(argv), `${msg} | ${USAGE}`);
  err('unknown option', ['--out', 'o', '--s', '1'], 'unknown option --s');
  err('no abbreviation', ['--out', 'o', '--write'], 'unknown option --write');
  err('missing value', ['--out', 'o', '--seed'], '--seed needs a value');
  err('an option as the value', ['--seed', '--out', 'o'], '--seed needs a value');
  err('invalid int', ['--out', 'o', '--seed', 'x'], '--seed x: not an integer');
  err('invalid number', ['--out', 'o', '--paced', 'inf'], '--paced inf: not a number');
  err('choices', ['--out', 'o', '--kernel', 'x'], '--kernel x: one of native, none');
  err('a flag with a value', ['--out', 'o', '--write-notes=1'], '--write-notes takes no value');
  err('required option', [], '--out is required');
  err('extra argument', ['--out', 'o', 'a', 'b'], 'unexpected argument b');
  eq('required positional', parse([], [{ name: 'x', positional: true }]), 'X is required | usage: t.mjs X');
  eq('error()', (() => { try { parseArgs('t.mjs', ['--out', 'o'], SPEC).error('--write-notes pins the default'); } catch (e) { return [e instanceof UsageError, e.message, e.usage]; } })(),
    [true, '--write-notes pins the default', USAGE]);
  eq('intValue', ['0', '12', '-0x1F', '0o17', '0B101', '1_0', '0x', ' 1', '9007199254740992'].map(intValue), [0, 12, -31, 15, 5, null, null, null, null]);
  eq('decimalInt', ['7', '+7', '-0', ' 1_000 ', '01', '1__0', '0x10', '', '1.0', '9007199254740992'].map(decimalInt), [7, 7, 0, 1000, 1, null, null, null, null, null]);
  eq('intLiteral', ['0x1F', '-0b101', '0o17', '0x_f', '42', '000', '010', '0o8', '0x', ' +5 '].map(intLiteral), [31, -5, 15, 15, 42, 0, null, null, null, 5]);
  eq('decimalNumber', ['3', '2.5', '.5', '5.', '1e3', '-2.5E-1', '1_0.5', 'inf', 'nan', '1e400', '.', '0x1'].map(decimalNumber), [3, 2.5, 0.5, 5, 1000, -0.25, 10.5, null, null, null, null, null]);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = argsTests();
  console.log(`args: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
