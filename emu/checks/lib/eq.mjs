// The result seam of the JS checks: every pass/fail comparison of a check goes through eq(got, want), structural
// equality (src/util/equal.mjs deepEqual: === on primitives), so a recorder and a tautology mutant can act on it
// without editing the check. A comparison with no natural pair of values is eq(cond, true).
//   OM_CHECK_RESULTS=<file>  the results, written when the process exits as the RNG tape is (lib/rngtape.mjs; the
//                            main thread's comparisons only): per site the passes and fails and the first FIRST
//                            failing pairs, {format, node, sites: {"check_display.mjs:123": {pass, fail, first:
//                            [{got, want}]}}}, the values as JSON (plain() below)
//   OM_EQ_MUT=<site>         the comparison at that site always holds (a tautology mutant: finds comparisons nothing
//                            trips)
// A site is the source line that makes the comparison: the caller of eq() at depth 1, or of the helper that calls
// eq() at depth 2 (a Group's eq / true, a check(), a report()). Without either variable eq() is deepEqual.
// OM_FAULT (fault(name)): a JS-only fault point, read once at module load; it acts on lab or device state upstream
// of both sides of a comparison (never on the observer), so the comparison trips where the unfaulted run never trips
// it.
import fs from 'node:fs';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { deepEqual } from '../../src/util/equal.mjs';

const FORMAT = 'om1-checkresults/1';
const FIRST = 3, ITEMS = 64, CHARS = 400;
const REC = process.env.OM_CHECK_RESULTS || null, MUT = process.env.OM_EQ_MUT ?? null;
const FAULT = process.env.OM_FAULT ?? null;
const SITES = new Map();
function site(depth) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = depth + 1;                   // the frames up to the site only: eq() runs in hot loops
  const lines = new Error().stack.split('\n');
  Error.stackTraceLimit = limit;
  const m = /\/([^/]+\.mjs):(\d+):\d+\)?$/.exec(lines[depth + 1] ?? '');
  return m ? `${m[1]}:${m[2]}` : '?';
}
// A value as JSON: BigInts, Maps, Sets and typed arrays tagged, lists cut to ITEMS items and strings to CHARS chars
// (with the full length), undefined as {undefined: true}.
export function plain(v, d = 0) {
  if (v === undefined) return { undefined: true };
  if (typeof v === 'bigint') return { bigint: v.toString() };
  if (typeof v === 'number' && !Number.isFinite(v)) return { number: String(v) };
  if (typeof v === 'string') return v.length > CHARS ? { string: v.slice(0, CHARS), length: v.length } : v;
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? { function: v.name } : v;
  if (d > 8) return { depth: true };
  const list = (xs, n) => { const a = xs.slice(0, ITEMS).map((x) => plain(x, d + 1)); return n > ITEMS ? { items: a, length: n } : a; };
  if (ArrayBuffer.isView(v)) return { [v.constructor.name]: list(Array.from(v.subarray?.(0, ITEMS) ?? []), v.length) };
  if (Array.isArray(v)) return list(v, v.length);
  if (v instanceof Map) return { map: list([...v], v.size) };
  if (v instanceof Set) return { set: list([...v], v.size) };
  const proto = Object.getPrototypeOf(v);
  const o = {};
  for (const k of Object.keys(v).slice(0, ITEMS)) o[k] = plain(v[k], d + 1);
  return proto === Object.prototype || proto === null ? o : { [proto.constructor?.name ?? 'object']: o };
}
// Does got equal want? The comparison at the caller's site (depth: see above).
export function eq(got, want, depth = 1) {
  const ok = deepEqual(got, want);
  if (!REC && !MUT) return ok;
  const s = site(depth + 1);
  if (REC) {
    let r = SITES.get(s);
    if (!r) SITES.set(s, r = { pass: 0, fail: 0, first: [] });
    if (ok) r.pass += 1;
    else { r.fail += 1; if (r.first.length < FIRST) r.first.push({ got: plain(got), want: plain(want) }); }
  }
  return MUT === s ? true : ok;
}
if (REC && isMainThread) {
  process.on('exit', () => {
    fs.mkdirSync(path.dirname(REC), { recursive: true });
    fs.writeFileSync(REC, JSON.stringify({ format: FORMAT, node: process.version, sites: Object.fromEntries(SITES) }));
  });
}
// Is the JS-only fault point `name` on (OM_FAULT)?
export const fault = (name) => FAULT === name;
