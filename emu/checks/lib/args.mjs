// The command lines of the checks and the node tools: a declared list of options
//   { opt: '--seed', type: 'int' | 'number' | 'str' | 'path' | 'flag', choices, metavar, default, required,
//     repeat (given more than once: the list of the values, [] when not given), bare (the value of the option given
//     without one: '--stack [WORDS]') }
// and positionals { name, positional: true, required (default true) }, which take the non-option arguments in order.
// An option's value is --opt=VALUE or the next argument unless that starts with '--' (so '--seed -1' is a value). int
// is decimal or 0x / 0o / 0b, with an optional '-'; number a finite decimal. No abbreviations; '--' ends the options.
// The result holds the values by dest ('--write-notes' -> write_notes, a positional by its name; an option neither
// given nor defaulted is absent) and error(msg), a usage error of the command's own rules. A usage error (an unknown
// option, a missing or invalid value, a missing required argument) is a UsageError carrying the usage line:
// checks/lib/env.mjs exitFor prints 'PROG: message' and the usage line on stderr, exit 2.
export class UsageError extends Error {
  constructor(message, usage = null) { super(message); this.usage = usage; }
}
const dest = (a) => a.name ?? a.opt.slice(2).replaceAll('-', '_');
const metavar = (a) => a.metavar ?? (a.choices ? a.choices.join('|') : dest(a).toUpperCase());

export function usage(prog, spec) {
  const one = (a) => {
    if (a.positional) return a.required === false ? `[${metavar(a)}]` : metavar(a);
    const s = a.type === 'flag' ? a.opt : `${a.opt} ${a.bare !== undefined ? `[${metavar(a)}]` : metavar(a)}`;
    return `${a.required ? s : `[${s}]`}${a.repeat ? '...' : ''}`;
  };
  return ['usage:', prog, ...spec.filter((a) => !a.positional).map(one), ...spec.filter((a) => a.positional).map(one)].join(' ');
}
// An integer argument (decimal, 0x / 0o / 0b, an optional '-'), or null.
export function intValue(text) {
  const m = /^(-?)(?:0x([0-9a-f]+)|0o([0-7]+)|0b([01]+)|(\d+))$/i.exec(text);
  if (!m) return null;
  const v = m[2] ? parseInt(m[2], 16) : m[3] ? parseInt(m[3], 8) : m[4] ? parseInt(m[4], 2) : Number(m[5]);
  return Number.isSafeInteger(v) ? (m[1] ? -v : v) : null;
}
const numberValue = (text) => (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)) ? Number(text) : null);
const CONVERT = { int: [intValue, 'an integer'], number: [numberValue, 'a number'], str: [(t) => t], path: [(t) => t] };

export function parseArgs(prog, argv, spec) {
  const fail = (msg) => { throw new UsageError(msg, usage(prog, spec)); };
  const options = new Map(spec.filter((a) => !a.positional).map((a) => [a.opt, a]));
  const out = {}, rest = [];
  const take = (a, text) => {
    const [convert, what] = CONVERT[a.type], v = convert(text);
    if (v === null) fail(`${a.opt} ${text}: not ${what}`);
    if (a.choices && !a.choices.includes(v)) fail(`${a.opt} ${text}: one of ${a.choices.join(', ')}`);
    if (a.repeat) (out[dest(a)] ??= []).push(v); else out[dest(a)] = v;
  };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (!s.startsWith('-')) { rest.push(s); continue; }
    const eq = s.indexOf('='), name = eq < 0 ? s : s.slice(0, eq), a = options.get(name);
    if (!a) fail(`unknown option ${name}`);
    if (a.type === 'flag') {
      if (eq >= 0) fail(`${name} takes no value`);
      out[dest(a)] = true;
    } else if (eq >= 0) take(a, s.slice(eq + 1));
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) take(a, argv[++i]);
    else if (a.bare !== undefined) out[dest(a)] = a.bare;
    else fail(`${name} needs a value`);
  }
  const positionals = spec.filter((a) => a.positional);
  if (rest.length > positionals.length) fail(`unexpected argument ${rest[positionals.length]}`);
  positionals.forEach((a, k) => { if (k < rest.length) out[a.name] = rest[k]; });
  for (const a of spec) {
    const d = dest(a);
    if (Object.hasOwn(out, d)) continue;
    if (a.required || (a.positional && a.required !== false)) fail(`${a.positional ? metavar(a) : a.opt} is required`);
    if (Object.hasOwn(a, 'default')) out[d] = Array.isArray(a.default) ? [...a.default] : a.default;
    else if (a.repeat) out[d] = [];
  }
  Object.defineProperty(out, 'error', { value: fail });
  return out;
}
