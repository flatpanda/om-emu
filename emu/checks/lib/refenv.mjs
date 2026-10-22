// The environment of a check's child: the terminal it runs under (no colour) and the run variables it must not inherit.
export const TERMINAL = { NO_COLOR: '1' };
// A run's own variables (bin/checks.mjs ENV_WHITELIST) and the test seams' (the predicate seam, the child hook and
// tracer): inherited from the caller's environment they would reach a check's children unrecorded, so they are
// refused, exit 2.
export const LEAKY = ['OM_MACHINE', 'OM_MENU_MUTANT', 'OM_NAV_MUTANT', 'OM_TEXT_MUTANT', 'OM_MENU_STORE', 'OM_FAULT',
  'OM_PRED_REC', 'OM_PRED_MUT', 'OM_HTTP_REC', 'OM_CHILD_TRACE', 'OM_HOST_MEM'];      // the last: node only (host/memprobe.mjs)
export function childEnv(base = process.env) {
  const leak = LEAKY.filter((k) => Object.hasOwn(base, k));
  if (leak.length) {
    process.stderr.write(`refenv: the environment sets ${leak.join(', ')}: a check child would inherit it unrecorded; unset it (a run sets its own in runs.json "env")\n`);
    process.exit(2);
  }
  const env = { ...base, ...TERMINAL };
  delete env.FORCE_COLOR;
  return env;
}
