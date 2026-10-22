// The errors as the checks and the node hosts report and classify them. src/ and refs/ cannot share a class tree
// (test_pure), so a ValueError is either the lab's (src/lab/errors.mjs: UnicodeDecodeError, JSONDecodeError) or a
// reference's (refs/errors.mjs: SettingsError, NavRefusal); isValueError takes both.
import { ValueError, AssertionError } from '../../src/lab/errors.mjs';
import { ValueError as RefValueError } from '../../refs/errors.mjs';

export const isValueError = (e) => e instanceof ValueError || e instanceof RefValueError;
// 'Name: message' (the name alone for an empty message), then each note (addNote) on a line of its own
export function describe(e) {
  if (!(e instanceof Error)) return String(e);
  return [`${e.name}${e.message ? `: ${e.message}` : ''}`, ...(Array.isArray(e.notes) ? e.notes : [])].join('\n');
}
// what an uncaught error prints: its stack (whose first lines are describe's first), then its notes
export function stackOf(e) {
  if (!(e instanceof Error)) return String(e);
  return [e.stack, ...(Array.isArray(e.notes) ? e.notes : [])].join('\n');
}
// A register value VscDebug.bank reports, in arithmetic or formatting: null (never written, or never latched) is an
// AssertionError naming it; undefined (a name the bank does not list) is a bug.
export function regValue(v, name = 'the register') {
  if (v === undefined) throw new Error('regValue: undefined (a name the bank does not list)');
  if (v === null) throw new AssertionError(`${name} is not latched`);
  return v;
}
export const reg = (bank, name) => regValue(bank.get(name), name);    // the named register of a bank
// whether a child's output lines hold an uncaught error's stack (stackOf: its frames, '    at ...')
export const hasStack = (lines) => lines.some((l) => /^ {4}at .*:\d+:\d+\)?$/.test(l));
