// The STM32L4's flash interface (RM0394 section 3.7, at 0x40022000): ACR (latency, prefetch, caches; kept, with no
// effect on timing, as the core counts one cycle per instruction), the unlock sequences of CR and the option bytes,
// SR's write-1-to-clear flags, and OPTR's factory value (I: read protection level 0, the RM's factory value). Erase and
// programming are not modelled: a write to the flash array itself stops the run at the bus (the flash is ROM to the
// core), so the SCPU's firmware update path (docs/om1-scpu-spec.md section 2) stops there by name.
import { PlainRegs, Unmodelled, merge } from './regs.mjs';

export const ACR = 0x00, PDKEYR = 0x04, KEYR = 0x08, OPTKEYR = 0x0c, SR = 0x10, CR = 0x14, ECCR = 0x18, OPTR = 0x20;
const KEY1 = 0x45670123, KEY2 = 0xcdef89ab, OPTKEY1 = 0x08192a3b, OPTKEY2 = 0x4c5d6e7f;
const LOCK = 1 << 31, OPTLOCK = 1 << 30;

const LAYOUT = {
  [ACR]: { reset: 0x00000600, writable: 0x7f07 }, [PDKEYR]: { reset: 0 }, [KEYR]: { reset: 0 }, [OPTKEYR]: { reset: 0 },
  [SR]: { reset: 0 }, [CR]: { reset: 0xc0000000 }, [ECCR]: { reset: 0 }, [OPTR]: { reset: 0xffeff8aa },
  0x24: { reset: 0xffff0000 }, 0x28: { reset: 0x0fff0000 }, 0x2c: { reset: 0xff00ffff }, 0x30: { reset: 0xff00ffff },
};

export class FlashInterface extends PlainRegs {
  constructor() { super('FLASH', LAYOUT); this.keyStep = 0; this.optStep = 0; }
  reset() { this.resetRegs(); this.keyStep = 0; this.optStep = 0; }
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
      case SR: this.set(SR, this.get(SR) & ~(v & mask & 0xc3fb)); return;    // write 1 to clear
      case CR: {
        if (cr & LOCK) return;                                       // locked: CR is read-only
        let nv = merge(cr, v, mask, 0xcf0707ff);
        if (nv & (3 << 16)) throw new Unmodelled(`FLASH ${nv & (1 << 16) ? 'erase (CR.STRT)' : 'option byte programming (CR.OPTSTRT)'}`);
        this.set(CR, nv);
        return;
      }
    }
    super.wr(off, v, mask);
  }
}
