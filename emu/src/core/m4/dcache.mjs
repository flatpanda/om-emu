// The Cortex-M4 core's decode cache, its cached tier (cpu.mjs: tier 'cached'): decoded instructions (decode.mjs
// records) kept by address, so a pc that runs again skips its fetch and its decode. Direct-mapped on the halfword
// address; a slot holds the pc, the record, and the code page the instruction's bytes lie in with that page's version
// when it was decoded (bus.mjs: codePage, pageVer). A slot hits only while the page still has that version: any
// write to the page through the bus (a store, a DMA transfer) or reported to it (bus.written: a flash erase, a clear)
// gives the page a new one, so self-modifying code, code copied to SRAM and flash programming decode again from the
// new bytes. bus.codeEpoch changing (a region added, a version wrapped) drops every slot.
//
// What is not cached (decoded on every run, as the reference tier does): an instruction outside a byte region (a
// device's registers, an unmapped address: the fetch's own fault or stop stays the reference's), and a 32-bit
// instruction whose halfwords lie in two pages. A record does not depend on the core's state: the Thumb bit is checked
// before the fetch (INVSTATE), and an IT block changes how an instruction executes, not its record (the 16-bit forms'
// setflags 2 is resolved by the executor at each run: cpu.mjs dp, mul), so the key is the address alone.
//
// mutant (tests only, test/test_m4.mjs): 1 a hit skips the page's version (a write to code goes unseen); 2 a record
// is kept with the IT state of its first run baked into its setflags. The lockstep against the reference tier must
// catch both.

export const DC_BITS = 14;

export class DecodeCache {
  constructor(bus, { bits = DC_BITS, mutant = 0 } = {}) {
    this.bus = bus;
    this.mask = (1 << bits) - 1;
    this.tag = new Int32Array(1 << bits).fill(-1);   // the pc (int32); -1 empty: a fetch pc is even
    this.page = new Int32Array(1 << bits);           // the code page (bus.codePage) and its version at the decode
    this.ver = new Uint32Array(1 << bits);
    this.rec = new Array(1 << bits).fill(null);
    this.epoch = bus.codeEpoch;
    this.fills = 0;                                  // decodes kept (a test's measure of the cache's use)
    this.mutant = mutant;
    if (mutant === 1) this.lookup = staleLookup;
  }
  flush() { this.tag.fill(-1); this.rec.fill(null); }
  // the record kept for pc, or null
  lookup(pc) {
    const bus = this.bus;
    if (this.epoch !== bus.codeEpoch) { this.flush(); this.epoch = bus.codeEpoch; return null; }
    const i = (pc >>> 1) & this.mask;
    return this.tag[i] === pc && bus.pageVer[this.page[i]] === this.ver[i] ? this.rec[i] : null;
  }
  // keep d, decoded at pc (fetched from memory just now) under the IT state it; marks its page as holding code, so the
  // next write there changes the page's version
  fill(pc, d, it) {
    const bus = this.bus, p = bus.codePage(pc >>> 0);
    if (p < 0 || bus.codePage((pc + d.len - 1) >>> 0) !== p) return;
    if (this.mutant === 2 && d.s === 2) d = { ...d, s: (it & 15) ? 0 : 1 };
    const pv = bus.pageVer, i = (pc >>> 1) & this.mask;
    pv[p] |= 1;
    this.tag[i] = pc; this.page[i] = p; this.ver[i] = pv[p]; this.rec[i] = d;
    this.fills++;
  }
}

// mutant 1's lookup: the tag alone
function staleLookup(pc) {
  const i = (pc >>> 1) & this.mask;
  return this.tag[i] === pc ? this.rec[i] : null;
}
