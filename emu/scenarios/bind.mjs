// The argument binding of the replayers (scenarios/session_replay.mjs, scenarios/osd_replay.mjs): a recorded call's
// positional args fill `params` in order, its keywords must be among `keywords` (default: params) and not given twice,
// required parameters (no entry in `defaults`) must be present; varkw: the name of a parameter that then collects the
// other keywords as an object. A call that does not bind throws (a plain Error, so it is reported, never compared as
// an outcome) instead of being guessed.
export const MISSING = Symbol('missing');
export function bind(name, params, args, kwargs, { keywords = params, defaults = {}, varkw = null } = {}) {
  if (args.length > params.length) throw new Error(`replay: ${name}() takes ${params.length} positional arguments but ${args.length} were given`);
  const k = {};
  args.forEach((a, i) => { k[params[i]] = a; });
  const extra = {};
  for (const [key, v] of Object.entries(kwargs)) {
    if (Object.hasOwn(k, key)) throw new Error(`replay: ${name}() got multiple values for argument '${key}'`);
    if (!keywords.includes(key)) {
      if (varkw === null) throw new Error(`replay: ${name}() got an unexpected keyword argument '${key}'`);
      extra[key] = v;
      continue;
    }
    k[key] = v;
  }
  for (const p of params) {
    if (Object.hasOwn(k, p)) continue;
    if (!Object.hasOwn(defaults, p)) throw new Error(`replay: ${name}() missing required argument '${p}'`);
    if (defaults[p] !== MISSING) k[p] = defaults[p];
  }
  if (varkw !== null) k[varkw] = extra;
  return k;
}

// Every replayed call's outcome digest, in env.replayStats.outcomes: bin/run.mjs writes them into the trace, where
// golden's output layer keeps them, so a change to what a call returns shows there.
export function outcomeSeen(env, got) {
  const rs = env.replayStats;
  if (rs) (rs.outcomes ??= []).push(env.createHash('sha256').update(JSON.stringify(got)).digest('hex').slice(0, 16));
}
