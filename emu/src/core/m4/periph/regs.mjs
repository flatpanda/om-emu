// The register-file base of the SCPU's STM32L4 peripheral models (this directory): a device for the Cortex-M4 bus
// (src/core/m4/bus.mjs: read(off, size), write(off, size, value)) whose subclasses implement word registers. A narrow
// access goes to its word: a read takes the addressed bytes of the word's value, a write passes the written bytes
// and their mask (rd(off, size) / wr(off, value, mask)), so a register with write side effects (write-1-to-clear,
// set / reset, data FIFOs) sees exactly the bytes the access carried. An offset a model does not implement throws
// Unmodelled: the run stops there, naming the peripheral, rather than reading a guess.

export class Unmodelled extends Error {
  constructor(what) { super(`STM32L4: not modelled: ${what}`); this.name = 'Unmodelled'; this.what = what; }
}

export const hex = (v) => '0x' + (v >>> 0).toString(16);
// a plain register's write: the written bytes replace the old ones under mask, within the register's writable bits
export const merge = (old, v, mask, writable = 0xffffffff) => ((old & ~(mask & writable)) | (v & mask & writable)) >>> 0;

export class Regs {
  constructor(name) { this.name = name; }
  read(off, size) {
    const sh = (off & 3) * 8;
    const w = this.rd(off & ~3, size) >>> 0;
    return size === 4 ? w | 0 : size === 2 ? (w >>> sh) & 0xffff : (w >>> sh) & 0xff;
  }
  write(off, size, v) {
    const sh = (off & 3) * 8;
    const mask = size === 4 ? 0xffffffff : ((size === 2 ? 0xffff : 0xff) << sh) >>> 0;
    this.wr(off & ~3, ((size === 4 ? v : v << sh) & mask) >>> 0, mask);
  }
  // subclasses: rd(off, size) -> u32, wr(off, value, mask)
  rd(off) { throw this.missing(off, false); }
  wr(off, v) { throw this.missing(off, true, v); }
  missing(off, write, v) {
    return new Unmodelled(`${this.name} ${write ? 'write' : 'read'} at +${hex(off)}${write ? ` = ${hex(v)}` : ''}`);
  }
}

// A register file of plain read / write words: each entry {reset, writable (mask of the writable bits), ro (true:
// writes ignored)}; a subclass overrides rd / wr for the registers with behaviour and calls super for the rest.
export class PlainRegs extends Regs {
  constructor(name, layout) {
    super(name);
    this.layout = layout;
    this.v = new Map();
    this.resetRegs();
  }
  resetRegs() { for (const [off, r] of Object.entries(this.layout)) this.v.set(Number(off), r.reset >>> 0); }
  get(off) { return this.v.get(off); }
  set(off, v) { this.v.set(off, v >>> 0); }
  rd(off) {
    if (!this.v.has(off)) throw this.missing(off, false);
    return this.v.get(off);
  }
  wr(off, v, mask) {
    const r = this.layout[off];
    if (!r) throw this.missing(off, true, v);
    if (r.ro) return;
    this.v.set(off, merge(this.v.get(off), v, mask, r.writable ?? 0xffffffff));
  }
}
