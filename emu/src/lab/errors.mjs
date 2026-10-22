import { show } from '../util/show.mjs';

// The errors the lab raises: a LabError is a failure the lab reports (a check prints it, a replay digests its name and
// message, the player shows it), any other JS error is a bug. name is the class's own; notes: lines added to the
// report (addNote).
export class LabError extends Error {
  constructor(message) { super(message); this.notes = []; }
  get name() { return this.constructor.name; }
  addNote(n) { this.notes.push(n); }
}
export class RuntimeError extends LabError {}               // e.g. 'GDB m...: E14'
export class FirmwareError extends RuntimeError {}
export class EngineError extends FirmwareError {}
export class ValueError extends LabError {}
export class KeyError extends LabError {}
export class IndexError extends LabError {}
export class UnicodeDecodeError extends ValueError {}
export class AssertionError extends LabError {}

// table[key] for a key the plain-object table owns (never an Object.prototype name such as 'constructor'), else a
// KeyError whose message is the key.
export function lookup(table, key) {
  if (!Object.hasOwn(table, key)) throw new KeyError(show(key));
  return table[key];
}

