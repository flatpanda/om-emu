// The exceptions the independent references raise. refs/ imports nothing from src/ (test_pure.mjs), so these mirror
// src/lab/errors.mjs's shape: a RefError is a failure the reference reports, named by its class, notes the lines added
// to the report; a JS TypeError or RangeError is a bug. Unported marks a path the reference leaves out (thrown, never
// approximated), as src/core/mem.mjs's does.
export class RefError extends Error {
  constructor(message) { super(message); this.notes = []; }
  get name() { return this.constructor.name; }
}
export class ValueError extends RefError {}
export class KeyError extends RefError {}
export class IndexError extends RefError {}
export class Unported extends Error {
  constructor(what) { super(`unported: ${what}`); this.name = 'Unported'; }
}
