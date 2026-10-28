// RCC, the STM32L4's reset and clock control (RM0394 section 6, at 0x40021000): its registers with their reset
// values, oscillator ready flags, the system clock switch and the clock tree as far as the other models need
// frequencies (SYSCLK, HCLK, PCLK1 / PCLK2, the timers' clocks, the UARTs' kernel clocks from CCIPR, LSE / LSI for the
// RTC). Oscillators and the PLL are ready at once when turned on and not ready at once when turned off (I: start-up
// times are not modelled; the HAL polls the flags), except a crystal the board lacks (board.mjs: HSE absent, LSE
// present), whose ready flag never sets. A peripheral reset bit (xxxRSTR) resets the peripherals the machine registered
// for it when the bit goes 1. BDCR, in the backup domain, takes writes only with PWR CR1.DBP set and survives a system
// reset; its BDRST resets the backup domain (the RTC).
import { PlainRegs, merge } from './regs.mjs';

export const MSI_HZ = [100e3, 200e3, 400e3, 800e3, 1e6, 2e6, 4e6, 8e6, 16e6, 24e6, 32e6, 48e6];
export const HSI16_HZ = 16e6, LSE_HZ = 32768, LSI_HZ = 32000, HSI48_HZ = 48e6;
const AHB_DIV = [1, 1, 1, 1, 1, 1, 1, 1, 2, 4, 8, 16, 64, 128, 256, 512];
const APB_DIV = [1, 1, 1, 1, 2, 4, 8, 16];

export const CR = 0x00, ICSCR = 0x04, CFGR = 0x08, PLLCFGR = 0x0c, PLLSAI1CFGR = 0x10, CIER = 0x18, CIFR = 0x1c,
  CICR = 0x20, AHB1RSTR = 0x28, AHB2RSTR = 0x2c, AHB3RSTR = 0x30, APB1RSTR1 = 0x38, APB1RSTR2 = 0x3c, APB2RSTR = 0x40,
  AHB1ENR = 0x48, AHB2ENR = 0x4c, AHB3ENR = 0x50, APB1ENR1 = 0x58, APB1ENR2 = 0x5c, APB2ENR = 0x60, CCIPR = 0x88,
  BDCR = 0x90, CSR = 0x94, CRRCR = 0x98, CCIPR2 = 0x9c;

const LAYOUT = {
  [CR]: { reset: 0x00000063 }, [ICSCR]: { reset: 0x10000000, writable: 0x7f00ff00 }, [CFGR]: { reset: 0 },
  [PLLCFGR]: { reset: 0x00001000 }, [PLLSAI1CFGR]: { reset: 0x00001000 }, [CIER]: { reset: 0 }, [CIFR]: { reset: 0, ro: true },
  [CICR]: { reset: 0 },
  [AHB1RSTR]: { reset: 0 }, [AHB2RSTR]: { reset: 0 }, [AHB3RSTR]: { reset: 0 }, [APB1RSTR1]: { reset: 0 },
  [APB1RSTR2]: { reset: 0 }, [APB2RSTR]: { reset: 0 },
  [AHB1ENR]: { reset: 0x00000100 }, [AHB2ENR]: { reset: 0 }, [AHB3ENR]: { reset: 0 }, [APB1ENR1]: { reset: 0 },
  [APB1ENR2]: { reset: 0 }, [APB2ENR]: { reset: 0 },
  0x68: { reset: 0x00011303 }, 0x6c: { reset: 0x000532ff }, 0x70: { reset: 0x00000101 }, 0x78: { reset: 0xf2feca3f },
  0x7c: { reset: 0x00000025 }, 0x80: { reset: 0x01677c01 },
  [CCIPR]: { reset: 0 }, [BDCR]: { reset: 0 }, [CSR]: { reset: 0x0c000600 }, [CRRCR]: { reset: 0 }, [CCIPR2]: { reset: 0 },
};
const RSTR = [AHB1RSTR, AHB2RSTR, AHB3RSTR, APB1RSTR1, APB1RSTR2, APB2RSTR];

export class Rcc extends PlainRegs {
  // hse / lse: whether the board has the crystal; dbp(): PWR CR1.DBP, the backup domain's (BDCR's) write access
  constructor({ hse = false, lse = true, dbp = () => true } = {}) {
    super('RCC', LAYOUT);
    this.hasHse = hse; this.hasLse = lse; this.dbp = dbp;
    this.resets = new Map();                      // `${register}:${bit}` -> [peripheral]
    this.clockUsers = [];                         // {before(), after()} around a write that may change a clock
  }
  // a system reset (an exit from standby among them): the backup domain's BDCR and CSR's reset flags stay (RM0394 6.1.3)
  systemReset() {
    const bdcr = this.get(BDCR), flags = this.get(CSR) & 0xff000000;
    this.resetRegs();
    this.set(BDCR, bdcr);
    this.set(CSR, (this.get(CSR) & 0x00ffffff) | flags);
  }
  // a peripheral reset by bit `bit` of reset register `reg`
  resetLine(reg, bit, dev) {
    const k = `${reg}:${bit}`;
    if (!this.resets.has(k)) this.resets.set(k, []);
    this.resets.get(k).push(dev);
  }

  wr(off, v, mask) {
    if (off !== CR && off !== CFGR && off !== PLLCFGR && off !== BDCR) return this.write1(off, v, mask);
    for (const u of this.clockUsers) u.before();
    this.write1(off, v, mask);
    for (const u of this.clockUsers) u.after();
  }
  write1(off, v, mask) {
    if (off === CR) return this.writeCr(merge(this.get(CR), v, mask, 0x0f0f0bfd));
    if (off === CFGR) {
      const nv = merge(this.get(CFGR), v, mask, 0x7f00fff3);
      this.set(CFGR, (nv & ~0xc) | ((nv & 3) << 2));       // SWS follows SW (I: at once)
      return;
    }
    if (off === PLLCFGR || off === PLLSAI1CFGR) { super.wr(off, v, mask); return; }
    if (off === CICR) return;                               // no clock interrupt flag is ever set
    if (RSTR.includes(off)) {
      const old = this.get(off), nv = merge(old, v, mask);
      this.set(off, nv);
      const rise = nv & ~old;
      for (let b = 0; b < 32; b++) if ((rise >>> b) & 1) for (const d of this.resets.get(`${off}:${b}`) || []) d.reset();
      return;
    }
    if (off === BDCR) { if (this.dbp()) this.writeBdcr(merge(this.get(BDCR), v, mask)); return; }
    if (off === CSR) {
      let nv = merge(this.get(CSR), v, mask, 0x00800f01);
      nv = (nv & ~2) | ((nv & 1) << 1);                    // LSIRDY follows LSION
      if (nv & (1 << 23)) nv &= ~(0xff000000 | (1 << 23)); // RMVF clears the reset flags
      this.set(CSR, nv);
      return;
    }
    if (off === CRRCR) { const nv = merge(this.get(CRRCR), v, mask, 1); this.set(CRRCR, nv | ((nv & 1) << 1)); return; }
    super.wr(off, v, mask);
  }
  writeCr(nv) {
    let rdy = 0;
    if (nv & (1 << 0)) rdy |= 1 << 1;                       // MSIRDY
    if (nv & (1 << 8)) rdy |= 1 << 10;                      // HSIRDY
    if ((nv & (1 << 16)) && this.hasHse) rdy |= 1 << 17;    // HSERDY
    if (nv & (1 << 24)) rdy |= 1 << 25;                     // PLLRDY
    if (nv & (1 << 26)) rdy |= 1 << 27;                     // PLLSAI1RDY
    nv = (nv & ~((1 << 1) | (1 << 10) | (1 << 17) | (1 << 25) | (1 << 27))) | rdy;
    this.set(CR, nv | (this.get(CR) & (1 << 3)));          // MSIRGSEL: writing 0 has no effect
  }
  writeBdcr(nv) {
    if (nv & (1 << 16)) {                                    // BDRST: the backup domain held in reset
      if (!(this.get(BDCR) & (1 << 16))) for (const d of this.resets.get(`${BDCR}:16`) || []) d.reset();
      this.set(BDCR, nv & (1 << 16));
      return;
    }
    nv = (nv & ~2) | ((nv & 1) && this.hasLse ? 2 : 0);     // LSERDY follows LSEON
    this.set(BDCR, nv & 0x0301ffbf);
  }

  // ---- the clock tree (RM0394 6.2)
  msiHz() {
    const cr = this.get(CR);
    const range = cr & (1 << 3) ? (cr >>> 4) & 15 : (this.get(CSR) >>> 8) & 15;
    return MSI_HZ[range] ?? MSI_HZ[6];
  }
  pllInHz() {
    const p = this.get(PLLCFGR), src = p & 3;
    return src === 1 ? this.msiHz() : src === 2 ? HSI16_HZ : 0;   // 3 = HSE: absent
  }
  pllRHz() {
    const p = this.get(PLLCFGR);
    const m = ((p >>> 4) & 7) + 1, n = (p >>> 8) & 0x7f, r = 2 * (((p >>> 25) & 3) + 1);
    return this.pllInHz() / m * n / r;
  }
  sysclkHz() {
    const sws = (this.get(CFGR) >>> 2) & 3;
    return sws === 0 ? this.msiHz() : sws === 1 ? HSI16_HZ : sws === 2 ? 0 : this.pllRHz();
  }
  hclkHz() { return this.sysclkHz() / AHB_DIV[(this.get(CFGR) >>> 4) & 15]; }
  pclk1Hz() { return this.hclkHz() / APB_DIV[(this.get(CFGR) >>> 8) & 7]; }
  pclk2Hz() { return this.hclkHz() / APB_DIV[(this.get(CFGR) >>> 11) & 7]; }
  // a timer's clock on APB1 (bus 1) or APB2 (bus 2): the bus clock, doubled when its prescaler is not 1
  timerHz(bus) {
    const div = APB_DIV[(this.get(CFGR) >>> (bus === 1 ? 8 : 11)) & 7];
    return (bus === 1 ? this.pclk1Hz() : this.pclk2Hz()) * (div === 1 ? 1 : 2);
  }
  // a U(S)ART's kernel clock from its CCIPR field (2 bits at `shift`): PCLK, SYSCLK, HSI16, LSE
  uartHz(shift, bus) {
    const sel = (this.get(CCIPR) >>> shift) & 3;
    return sel === 0 ? (bus === 1 ? this.pclk1Hz() : this.pclk2Hz()) : sel === 1 ? this.sysclkHz() : sel === 2 ? HSI16_HZ : LSE_HZ;
  }
  // the RTC's clock from BDCR.RTCSEL: none, LSE, LSI, HSE / 32
  rtcHz() {
    const sel = (this.get(BDCR) >>> 8) & 3;
    return sel === 1 ? LSE_HZ : sel === 2 ? LSI_HZ : 0;
  }
}
