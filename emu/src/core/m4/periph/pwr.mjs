// The STM32L4's power controller (RM0394 section 5.4, at 0x40007000): CR1 (low-power mode selection, backup domain
// write access DBP, voltage scaling, low-power run), CR2..CR4, the status registers SR1 / SR2 with SCR clearing SR1,
// and the GPIO pull-up / pull-down control registers used in standby. A voltage scaling change completes at once
// (SR2.VOSF stays 0, I: the regulator's settling time is not modelled) and SR2.REGLPF follows CR1.LPR. The low-power
// modes are the machine's (stm32l4.mjs): lowPowerMode() reports CR1.LPMS (0..2 Stop 0..2, 3 Standby, 4..7 Shutdown),
// standbyPull() the pulls CR3.APC applies in Standby and Shutdown, and the exits from Standby and Shutdown leave the
// wake-up flags in SR1 (standbyExit, shutdownExit). A Stop mode changes nothing here.
import { PlainRegs } from './regs.mjs';

export const CR1 = 0x00, CR2 = 0x04, CR3 = 0x08, CR4 = 0x0c, SR1 = 0x10, SR2 = 0x14, SCR = 0x18;
const LAYOUT = {
  [CR1]: { reset: 0x00000200, writable: 0x000067f7 }, [CR2]: { reset: 0, writable: 0x000007ff },
  [CR3]: { reset: 0x00008000, writable: 0x0000851f }, [CR4]: { reset: 0, writable: 0x0000031f },
  [SR1]: { reset: 0, ro: true }, [SR2]: { reset: 0, ro: true }, [SCR]: { reset: 0 },
};
// PUCRx / PDCRx for the ports A..H (0x20 + 8 * port)
for (let p = 0; p < 8; p++) { LAYOUT[0x20 + 8 * p] = { reset: 0 }; LAYOUT[0x24 + 8 * p] = { reset: 0 }; }

export class Pwr extends PlainRegs {
  constructor() { super('PWR', LAYOUT); }
  reset() { this.resetRegs(); }
  // the exit from standby (RM0394 5.3.9, 5.4): a reset of PWR but for CR3, CR4 and the standby pulls PUCRx / PDCRx,
  // which standby keeps, and SR1, which gets the wake-up flags and SBF
  standbyExit(sr1) {
    const keep = [...this.v.entries()].filter(([o]) => o === CR3 || o === CR4 || o >= 0x20);
    this.resetRegs();
    for (const [o, v] of keep) this.set(o, v);
    this.set(SR1, sr1 | (1 << 8));
  }
  // the exit from Shutdown (RM0394 5.3.10): a brown-out reset, so all of PWR is reset (I: CR3, CR4 and the pulls as
  // well), but for SR1's wake-up flags, which tell the wake-up source (I); SBF stays clear
  shutdownExit(sr1) {
    this.resetRegs();
    this.set(SR1, sr1 & 0x801f);
  }
  // the levels the standby pulls give a pin (APC set): 1 pull-up, 0 pull-down, -1 none
  standbyPull(port, pin) {
    if (!(this.get(CR3) & (1 << 10))) return -1;
    if ((this.get(0x20 + 8 * port) >>> pin) & 1) return 1;
    if ((this.get(0x24 + 8 * port) >>> pin) & 1) return 0;
    return -1;
  }
  // backup domain write access (RTC, BDCR)
  dbp() { return (this.get(CR1) & (1 << 8)) !== 0; }
  lowPowerMode() { return this.get(CR1) & 7; }
  wr(off, v, mask) {
    if (off === SCR) { this.set(SR1, this.get(SR1) & ~(v & mask & 0x11f)); return; }
    super.wr(off, v, mask);
    if (off === CR1) {
      const lpr = (this.get(CR1) >>> 14) & 1;
      this.set(SR2, (this.get(SR2) & ~(1 << 9)) | (lpr << 9));
    }
  }
}
