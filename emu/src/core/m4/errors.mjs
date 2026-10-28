// The Cortex-M4 core's host-side errors: not guest events (those are exceptions the core takes), but stops of the
// emulation that a caller reports.
// Unimplemented: the guest reached something the core does not model (an FP data-processing instruction, a system
// register outside sys.mjs's set, a derived fault during exception entry); the core's state is the instruction's start.
export class Unimplemented extends Error {
  constructor(what) { super(`Cortex-M4: not modelled: ${what}`); this.name = 'Unimplemented'; this.what = what; }
}
// BusError: thrown by a bus for an access the hardware answers with a bus error; the core takes a BusFault for it.
export class BusError extends Error {
  constructor(addr, write) { super(`bus error at 0x${(addr >>> 0).toString(16)}${write ? ' (write)' : ''}`); this.name = 'BusError'; this.addr = addr >>> 0; this.write = !!write; }
}
