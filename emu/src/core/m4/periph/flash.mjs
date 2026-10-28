// The STM32L4's flash interface (RM0394 section 3, at 0x40022000): ACR (latency, prefetch, caches; kept, with no
// effect on timing, as the core counts one cycle per instruction), the unlock sequences of CR (KEYR) and of the option
// bytes (OPTKEYR, RM0394 3.3.5 and 3.4.2), SR's flags, and the erase and programming of the main memory (RM0394 3.3.6,
// 3.3.7): page erase (PER with PNB, then STRT) and mass erase (MER1, then STRT), double-word programming (PG, then two
// word writes to the array) and fast programming (FSTPG, then the 32 double words of a row), each with BSY for its
// duration and EOP at its end when EOPIE, and the error flags (RM0394 3.3.7 and 3.7.5, SR): PROGERR (a double word
// not erased, unless the data is all zero), SIZERR (a byte or halfword write), PGAERR (a word outside the double word
// or the row in progress), PGSERR (an array write without PG or FSTPG, a start or a write while a previous error is not cleared, a
// start with no operation or two, fast programming without a mass erase before it), WRPERR (an address in a
// write-protected or PCROP area of the option bytes), with OPERR when ERRIE, and the FLASH interrupt (IRQ 4) from
// EOP / EOPIE and OPERR / ERRIE. The array is the flash's bytes the bus serves (the core fetches and reads them); it
// changes only here, and every change is reported (changed(offset, length): the machine passes it to the bus's code
// listeners, src/core/m4/bus.mjs onCodeWrite, where a decode cache hears it).
// Model shortcuts (I): an operation's bytes change when it starts and BSY stays set for its duration (the STM32L43x
// datasheet's typical tPROG, fast row, tERASE and tME as recalled, not checked: ?); a write to the array while BSY waits
// for the operation's end (it completes at once, the stall's time is not charged), an instruction fetch from flash
// stalls until it (the machine, stm32l4.mjs), a data read is not stalled. Fast programming takes the row's 64 words as
// they come (MISERR's deadline is not modelled) and needs a mass erase since the interface's last reset. The option
// bytes are the factory's (read protection level 0, no WRP or PCROP area) or a board's (optionBytes), loaded at reset;
// the option registers take writes only with OPTLOCK clear, and programming them (OPTSTRT) or reloading them
// (OBL_LAUNCH) stops the run (Unmodelled), as does a page number beyond the array. OPTVERR is never set (valid option
// bytes), RDERR never (nothing reads a PCROP area), and ECCR shows no ECC error.
import { PlainRegs, Unmodelled, merge } from './regs.mjs';

export const ACR = 0x00, PDKEYR = 0x04, KEYR = 0x08, OPTKEYR = 0x0c, SR = 0x10, CR = 0x14, ECCR = 0x18, OPTR = 0x20,
  PCROP1SR = 0x24, PCROP1ER = 0x28, WRP1AR = 0x2c, WRP1BR = 0x30;
// SR
export const EOP = 1, OPERR = 2, PROGERR = 8, WRPERR = 16, PGAERR = 32, SIZERR = 64, PGSERR = 128, MISERR = 256,
  FASTERR = 512, RDERR = 1 << 14, OPTVERR = 1 << 15, BSY = 1 << 16;
// CR
export const PG = 1, PER = 2, MER1 = 4, STRT = 1 << 16, OPTSTRT = 1 << 17, FSTPG = 1 << 18, EOPIE = 1 << 24,
  ERRIE = 1 << 25, RDERRIE = 1 << 26, OBL_LAUNCH = 1 << 27, OPTLOCK = 1 << 30, LOCK = 1 << 31;
export const KEY1 = 0x45670123, KEY2 = 0xcdef89ab, OPTKEY1 = 0x08192a3b, OPTKEY2 = 0x4c5d6e7f;
export const PAGE = 2048, ROW = 256;               // a page (the erase unit) and a fast-programming row, in bytes
// the errors a new operation refuses to start over (RM0394 3.3.6, 3.3.7: "check and clear all error flags")
const PROG_ERRORS = PROGERR | WRPERR | PGAERR | SIZERR | PGSERR | MISERR | FASTERR;
// durations in seconds (?: the datasheet's typical values as recalled)
const PROG_S = 82e-6, ROW_S = 1.9e-3, ERASE_S = 22e-3, MASS_S = 22.1e-3;
// the factory option bytes (I): OPTR with RDP level 0 (0xaa), PCROP start above its end and both WRP areas' start
// (bits 7:0) above their end (bits 23:16), so no area is protected
export const FACTORY_OPTIONS = Object.freeze({ [OPTR]: 0xffeff8aa, [PCROP1SR]: 0xffffffff, [PCROP1ER]: 0x0fff0000,
  [WRP1AR]: 0xff00ffff, [WRP1BR]: 0xff00ffff });

const LAYOUT = {
  [ACR]: { reset: 0x00000600, writable: 0x7f07 }, [PDKEYR]: { reset: 0 }, [KEYR]: { reset: 0 }, [OPTKEYR]: { reset: 0 },
  [SR]: { reset: 0 }, [CR]: { reset: 0xc0000000 }, [ECCR]: { reset: 0 }, [OPTR]: { reset: 0 },
  [PCROP1SR]: { reset: 0 }, [PCROP1ER]: { reset: 0 }, [WRP1AR]: { reset: 0 }, [WRP1BR]: { reset: 0 },
};

export class FlashInterface extends PlainRegs {
  // array: the flash's bytes (null: no array, erase and programming stop the run); sched, irq(n, level), irqn (the
  // FLASH interrupt), hclkHz() (the core's clock, for the operations' durations); changed(offset, length): bytes of the
  // array changed; optionBytes: {register offset: value} over FACTORY_OPTIONS
  constructor({ array = null, sched = null, irq = null, irqn = 4, hclkHz = () => 16e6, changed = () => {}, optionBytes = {} } = {}) {
    super('FLASH', LAYOUT);
    Object.assign(this, { array, sched, irq, irqn, hclkHz, changed, optionBytes });
    this.ops = 0;                                   // erase and programming operations started (kept across resets)
    this.busyEv = null;
    this.reset();
  }
  reset() {
    this.resetRegs();
    this.loaded = { ...FACTORY_OPTIONS, ...this.optionBytes };      // the option bytes in effect since the last load
    for (const [o, v] of Object.entries(this.loaded)) this.set(Number(o), v);
    this.keyStep = 0; this.optStep = 0;
    this.busyEv = this.sched ? this.sched.cancel(this.busyEv) : null;
    this.dw = null;                                 // the double word being written: {off, lo}
    this.row = null;                                // the fast-programming row being written: {off, words}
    this.massErased = false;
    if (this.irq) this.update();
  }
  get busy() { return this.busyEv !== null; }
  pages() { return this.array ? this.array.length / PAGE : 0; }
  rd(off) {
    if (off === PDKEYR || off === KEYR || off === OPTKEYR) return 0;
    return super.rd(off);
  }
  wr(off, v, mask) {
    const cr = this.get(CR);
    switch (off) {
      case ACR: { const nv = merge(this.get(ACR), v, mask, 0x7f07); this.set(ACR, nv & ~0x1800); return; }   // ICRST / DCRST self-clear (I)
      case KEYR:
        if (this.keyStep === 0 && v === KEY1) this.keyStep = 1;
        else if (this.keyStep === 1 && v === KEY2) { this.keyStep = 0; this.set(CR, cr & ~LOCK); }
        else { this.keyStep = 0; this.set(CR, cr | LOCK); }         // a wrong sequence locks until reset (RM 3.3.5)
        return;
      case OPTKEYR:
        if (this.optStep === 0 && v === OPTKEY1) this.optStep = 1;
        else if (this.optStep === 1 && v === OPTKEY2 && !(cr & LOCK)) { this.optStep = 0; this.set(CR, cr & ~OPTLOCK); }
        else this.optStep = 0;
        return;
      case PDKEYR: return;
      case SR: this.set(SR, this.get(SR) & ~(v & mask & 0xc3fb)); this.update(); return;    // write 1 to clear; BSY is read-only
      case CR: return this.writeCr(cr, v, mask);
      case ECCR: return;
      case OPTR: case PCROP1SR: case PCROP1ER: case WRP1AR: case WRP1BR:
        if (!(cr & OPTLOCK)) super.wr(off, v, mask);               // the option registers: only unlocked (RM 3.4.2)
        return;
    }
    super.wr(off, v, mask);
  }
  writeCr(cr, v, mask) {
    if (cr & LOCK) return;                                         // locked: CR is read-only
    const w = v & mask;
    // LOCK and OPTLOCK can only be set here (KEYR / OPTKEYR clear them); STRT is the hardware's while BSY
    let nv = (merge(cr, v, mask, 0x0f0607ff) | (w & (LOCK | OPTLOCK))) >>> 0;
    if (nv & OPTLOCK) nv &= ~(OPTSTRT | OBL_LAUNCH);               // they cannot be written while OPTLOCK is set
    if (nv & OBL_LAUNCH) throw new Unmodelled('FLASH option byte loading (CR.OBL_LAUNCH)');
    if (nv & OPTSTRT) throw new Unmodelled('FLASH option byte programming (CR.OPTSTRT)');
    if (!(nv & PG)) this.dw = null;                                // leaving a programming sequence drops its half word pair
    if (!(nv & FSTPG)) this.row = null;
    this.set(CR, (nv & ~STRT) | (cr & STRT));
    if (w & STRT) this.erase();
    this.update();
  }

  // ---- erase (RM0394 3.3.6)
  erase() {
    if (this.busy) this.finish();
    const cr = this.get(CR);
    if (this.get(SR) & PROG_ERRORS) return this.fail(PGSERR);
    const per = (cr & PER) !== 0, mer = (cr & MER1) !== 0;
    if ((cr & (PG | FSTPG)) || per === mer) return this.fail(PGSERR);   // no operation, or more than one (I)
    this.need();
    if (per) {
      const page = (cr >>> 3) & 0xff;
      if (page >= this.pages()) throw new Unmodelled(`FLASH page erase of page ${page}, beyond the ${this.array.length >> 10} KiB array`);
      if (this.protectedRange(page * PAGE, PAGE)) return this.fail(WRPERR);
      this.array.fill(0xff, page * PAGE, (page + 1) * PAGE);
      this.changed(page * PAGE, PAGE);
      return this.begin(ERASE_S, `page ${page} erase`, STRT);
    }
    if (this.protectedRange(0, this.array.length)) return this.fail(WRPERR);    // any protected area refuses it (I)
    this.array.fill(0xff);
    this.changed(0, this.array.length);
    this.massErased = true;
    this.begin(MASS_S, 'mass erase', STRT);
  }

  // ---- programming (RM0394 3.3.7): a write to the array (off from its start), from the bus
  arrayWrite(off, size, v) {
    if (this.busy) this.finish();
    const cr = this.get(CR);
    if (!(cr & (PG | FSTPG)) || (cr & (PER | MER1)) || (cr & PG && cr & FSTPG)) return this.fail(PGSERR);
    if (this.get(SR) & PROG_ERRORS) return this.fail(PGSERR);
    if (size !== 4) return this.fail(SIZERR);
    this.need();
    if (cr & FSTPG) return this.fastWrite(off, v >>> 0);
    if (!this.dw) {                                                  // the double word's first word, at its start
      if (off & 4) return this.fail(PGAERR);
      this.dw = { off, lo: v >>> 0 };
      return;
    }
    const { off: at, lo } = this.dw;
    this.dw = null;
    if (off !== at + 4) return this.fail(PGAERR);
    this.program(at, [lo, v >>> 0], PROG_S, 'double word');
  }
  // fast programming: a row's 64 words in order from the row's start
  fastWrite(off, v) {
    if (!this.row) {
      if (!this.massErased) return this.fail(PGSERR);
      if (off & (ROW - 1)) return this.fail(PGAERR);
      this.row = { off, words: [] };
    } else if (off !== this.row.off + 4 * this.row.words.length) { this.row = null; return this.fail(PGAERR); }
    this.row.words.push(v);
    if (this.row.words.length < ROW / 4) return;
    const { off: at, words } = this.row;
    this.row = null;
    this.program(at, words, ROW_S, 'fast row');
  }
  // program words (double words: an even count) at `at`, every double word erased or written all zero
  program(at, words, seconds, what) {
    const a = this.array, n = 4 * words.length;
    if (this.protectedRange(at, n)) return this.fail(WRPERR);
    for (let i = 0; i < words.length; i += 2) {
      const o = at + 4 * i;
      let erased = true;
      for (let k = 0; k < 8; k++) erased &&= a[o + k] === 0xff;
      if (!erased && (words[i] | words[i + 1]) !== 0) return this.fail(PROGERR);
    }
    for (let i = 0; i < n; i++) a[at + i] &= (words[i >> 2] >>> (8 * (i & 3))) & 0xff;   // programming only clears bits
    this.changed(at, n);
    this.begin(seconds, what, 0);
  }
  need() { if (!this.array) throw new Unmodelled('FLASH erase or programming with no flash array'); }

  // ---- the protected areas of the loaded option bytes: WRP areas A and B (pages), the PCROP area (double words)
  areas() {
    const o = this.loaded, out = [];
    for (const r of [WRP1AR, WRP1BR]) {
      const s = o[r] & 0xff, e = (o[r] >>> 16) & 0xff;
      if (s <= e) out.push([s * PAGE, (e + 1) * PAGE]);
    }
    const ps = o[PCROP1SR] & 0xffff, pe = o[PCROP1ER] & 0xffff;
    if (ps <= pe) out.push([ps * 8, (pe + 1) * 8]);
    return out;
  }
  protectedRange(at, n) { return this.areas().some(([s, e]) => at < e && at + n > s); }

  // ---- the operation in progress, its end and the errors
  begin(seconds, what, strt) {
    this.ops++;
    this.set(SR, this.get(SR) | BSY);
    this.set(CR, this.get(CR) | strt);
    if (!this.sched) return this.done();
    this.busyEv = this.sched.after(Math.max(1, Math.round(seconds * this.hclkHz())), () => { this.busyEv = null; this.done(); }, `FLASH ${what}`);
  }
  done() {
    this.set(SR, (this.get(SR) & ~BSY) | (this.get(CR) & EOPIE ? EOP : 0));
    this.set(CR, this.get(CR) & ~STRT);
    this.update();
  }
  // the operation in progress ends now (an access that waits for it)
  finish() { this.busyEv = this.sched.cancel(this.busyEv); this.done(); }
  fail(bits) {
    this.dw = null; this.row = null;
    this.set(SR, this.get(SR) | bits | (this.get(CR) & ERRIE ? OPERR : 0));
    this.update();
  }
  update() {
    if (!this.irq) return;
    const cr = this.get(CR), sr = this.get(SR);
    this.irq(this.irqn, !!(((cr & EOPIE) && (sr & EOP)) || ((cr & ERRIE) && (sr & OPERR)) || ((cr & RDERRIE) && (sr & RDERR))));
  }
}
