// The predicate seam of the JS checks: every pass/fail predicate of a check goes through
// pred(ok), so a recorder and a tautology mutant can act on it without editing the check.
//   OM_PRED_REC=<file>  append one JSON line per evaluation: {"site": "check_display.mjs:123", "ok": true}
//   OM_PRED_MUT=<site>  the predicate at that site always passes (a tautology mutant: finds predicates nothing trips)
// A site is the source line that evaluates the predicate: the caller of pred() at depth 1, or of the helper that calls
// pred() at depth 2 (a Group's eq / true, a check()). Without either variable pred(ok) is ok and costs one test.
// OM_FAULT (fault(name)): a JS-only fault point, read once at module load; it acts on lab or device state upstream
// of both sides of a predicate (never on the observer), so the predicate trips where the unfaulted run never trips it.
import fs from 'node:fs';

const REC = process.env.OM_PRED_REC ?? null, MUT = process.env.OM_PRED_MUT ?? null;
const FAULT = process.env.OM_FAULT ?? null;
function site(depth) {
  const lines = new Error().stack.split('\n');
  const m = /\/([^/]+\.mjs):(\d+):\d+\)?$/.exec(lines[depth + 1] ?? '');
  return m ? `${m[1]}:${m[2]}` : '?';
}
export function pred(ok, depth = 1) {
  if (!REC && !MUT) return ok;
  const s = site(depth + 1);
  if (REC) fs.appendFileSync(REC, JSON.stringify({ site: s, ok: !!ok }) + '\n');
  return MUT === s ? true : ok;
}
// Is the JS-only fault point `name` on (OM_FAULT)?
export const fault = (name) => FAULT === name;
