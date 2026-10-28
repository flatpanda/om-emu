// The SCPU as a machine (docs/om1-scpu-spec.md section 8 step 5): the Cortex-M4 core (src/core/m4/) with the SCPU's
// flash and SRAM and the STM32L4 peripherals of this directory on its bus, the board's answers (board.mjs), the
// peripherals' events on the core's cycle counter (sched.mjs), and a run loop that sleeps through WFI / WFE by jumping
// to the next event and models the low-power modes PWR CR1.LPMS selects for a deep sleep: Stop 0, 1 and 2, Standby and
// Shutdown (below). An access to an address no model holds stops the run (Unmapped, src/core/m4/boot.mjs), as does a
// register or a mode a model does not implement (Unmodelled, regs.mjs): the run reports where, and nothing answers
// with a guess.
//   const m = new Stm32l4(image);
//   m.boot();                                  // to the debug console's first prompt "SUB> "
//   m.command('help');                         // the console's answer
//   m.nrst(true); m.nrst(false);               // a pulse on the NRST pin (the MN's reset line in the lab)
// The flash's bytes change only through the flash interface (flash.mjs: erase and programming); the bus reports each
// change to its code listeners (bus.onCodeWrite(fn(addr, len)), src/core/m4/bus.mjs), once at 0x08000000 and once at
// the boot alias 0, and the core's decode cache listens there.
import { CortexM4, STEP_OK, STEP_SLEEP } from '../cpu.mjs';
import { MemoryBus } from '../bus.mjs';
import { Unmapped, FLASH, FLASH_SIZE, SRAM, SRAM_SIZE } from '../boot.mjs';
import { Unmodelled } from './regs.mjs';
import { Scheduler } from './sched.mjs';
import { DEFAULT_BOARD } from './board.mjs';
import { Rcc, CCIPR, BDCR, CSR, HSI16_HZ, AHB1RSTR, AHB2RSTR, APB1RSTR1, APB1RSTR2, APB2RSTR } from './rcc.mjs';
import { FlashInterface } from './flash.mjs';
import { Pwr, CR1 as PWR_CR1, CR3, CR4 } from './pwr.mjs';
import { Gpio } from './gpio.mjs';
import { Exti, Syscfg } from './exti.mjs';
import { UsbStub, UsbPma } from './usb.mjs';
import { Adc } from './adc.mjs';
import { I2c } from './i2c.mjs';
import { Usart } from './usart.mjs';
import { Dma } from './dma.mjs';
import { Rtc } from './rtc.mjs';
import { Spi } from './spi.mjs';
import { Timer } from './tim.mjs';

// the STM32L4's peripheral addresses the image uses (docs/om1-scpu-spec.md section 1, D)
export const BASE = {
  TIM2: 0x40000000, RTC: 0x40002800, SPI2: 0x40003800, USART2: 0x40004400, I2C1: 0x40005400, I2C2: 0x40005800,
  USB: 0x40006800, PWR: 0x40007000, LPUART1: 0x40008000, SYSCFG: 0x40010000, EXTI: 0x40010400, TIM1: 0x40012c00,
  USART1: 0x40013800, TIM15: 0x40014000, TIM16: 0x40014400, DMA1: 0x40020000, DMA2: 0x40020400, RCC: 0x40021000,
  FLASH: 0x40022000, GPIOA: 0x48000000, ADC: 0x50040000,
};
// the debug console's prompt (docs/om1-scpu-spec.md section 5.3, the image's .data string)
export const PROMPT = 'SUB> ';
// RCC CSR's pin and brown-out reset flags (RM0394 RCC_CSR bits 26, 27)
const PINRSTF = 1 << 26, BORRSTF = 1 << 27;
// the power modes of `mode`; CR1.LPMS 0..2 select Stop 0..2, 3 Standby, 4..7 Shutdown (RM0394 5.4.1)
export const MODES = ['run', 'stop0', 'stop1', 'stop2', 'standby', 'shutdown'];

export class Stm32l4 {
  // image: the SCPU block (loaded at 0x08000000); board: overrides of DEFAULT_BOARD
  constructor(image, board = {}) {
    this.board = { ...DEFAULT_BOARD, ...board };
    this.flash = new Uint8Array(FLASH_SIZE).fill(0xff);
    this.flash.set(image.subarray(0, FLASH_SIZE));
    this.bus = new MemoryBus({ unmapped: (a, size, w, v) => { throw new Unmapped(a, size, w, v); } });
    this.bus.rom(FLASH, this.flash, (off, size, v) => this.flashIf.arrayWrite(off, size, v));   // writes: the flash interface's
    this.bus.alias(0, FLASH, FLASH_SIZE);
    this.sram = this.bus.ram(SRAM, SRAM_SIZE);
    this.cpu = new CortexM4({ bus: this.bus, irqs: 83, prioBits: 4 });
    // the core's decode cache (cpu.mjs: decoded instructions of cacheable code by pc) forgets what flash programming
    // changed, an instruction that starts up to 2 bytes before the range included
    this.bus.onCodeWrite((a, n) => { for (let p = Math.max(0, a - 2); p < a + n; p += 2) this.cpu.dcache.delete(p); });
    this.sched = new Scheduler(this.cpu);
    this.irqSrc = new Map();
    const sched = this.sched, irq = (n, h) => this.irq(n, h), hclkHz = () => this.rcc.hclkHz();
    // the peripherals whose clock a Stop mode stops each have a clock domain (sched.mjs); the RTC and the flash
    // interface run on the scheduler itself
    const dom = (name) => sched.domain(name);

    // reset and clocks, flash interface, power
    this.rcc = this.attach(BASE.RCC, new Rcc({ hse: this.board.hse, lse: this.board.lse, dbp: () => this.pwr.dbp() }));
    this.flashIf = this.attach(BASE.FLASH, new FlashInterface({ array: this.flash, sched, irq, irqn: 4, hclkHz,
      changed: (off, n) => this.bus.codeWritten(FLASH + off, n) }));
    this.pwr = this.attach(BASE.PWR, new Pwr());
    // GPIO A..D and H (the LQFP64 part's ports), EXTI and SYSCFG; EXTI's events go to the core's event input
    this.gpio = new Gpio();
    for (const i of [0, 1, 2, 3, 7]) this.attach(BASE.GPIOA + 0x400 * i, this.gpio.add(i));
    this.exti = this.attach(BASE.EXTI, new Exti(irq));
    this.exti.syscfg = this.attach(BASE.SYSCFG, new Syscfg());
    this.exti.onEvent = () => this.coreEvent();
    this.gpio.onChange((port, pin, level) => this.exti.gpio(port, pin, level));
    for (const [pin, level] of Object.entries(this.board.drive)) this.gpio.drive(pin, level);
    // DMA
    this.dma1 = this.attach(BASE.DMA1, new Dma({ name: 'DMA1', bus: this.bus, sched: dom('DMA1'), irq, irqs: [11, 12, 13, 14, 15, 16, 17] }));
    this.dma2 = this.attach(BASE.DMA2, new Dma({ name: 'DMA2', bus: this.bus, sched: dom('DMA2'), irq, irqs: [56, 57, 58, 59, 60, 68, 69] }));
    // the U(S)ARTs (kernel clocks from CCIPR: USART1SEL bits 1:0 on APB2, USART2SEL 3:2 and LPUART1SEL 11:10 on APB1);
    // their lines' bytes in order; LPUART1 is the debug console (docs/om1-scpu-spec.md section 5.3)
    this.tx = { USART1: [], USART2: [], LPUART1: [] };
    this.prompts = 0;                             // prompts so far: "SUB> " at the start of the output or of a line
    let tail = '\n';
    const onTx = (name) => (b) => {
      this.tx[name].push(b);
      if (name === 'LPUART1') { tail = (tail + String.fromCharCode(b)).slice(-PROMPT.length - 1); if (tail === '\n' + PROMPT) this.prompts++; }
      if (this.board.uartTx) this.board.uartTx(name, b);
    };
    const uart = (name, base, irqn, shift, apb, lp) => this.attach(base, new Usart({ name, lp, sched: dom(name), irq, irqn,
      kernelHz: () => this.rcc.uartHz(shift, apb), hclkHz, onTx: onTx(name) }));
    this.usart1 = uart('USART1', BASE.USART1, 37, 0, 2, false);
    this.usart2 = uart('USART2', BASE.USART2, 38, 2, 1, false);
    this.lpuart1 = uart('LPUART1', BASE.LPUART1, 70, 10, 1, true);
    // I2C1 / I2C2 (kernel clocks I2C1SEL / I2C2SEL in CCIPR bits 13:12 / 15:14: PCLK1, SYSCLK, HSI16)
    const i2cHz = (shift) => () => [this.rcc.pclk1Hz(), this.rcc.sysclkHz(), HSI16_HZ, 0][(this.rcc.get(CCIPR) >>> shift) & 3];
    const i2c = (name, base, bus, irqs, shift) => this.attach(base, new I2c({ name, sched: dom(name), irq, irqs, kernelHz: i2cHz(shift), hclkHz,
      device: (a) => this.board.i2c(bus, a) }));
    this.i2c1 = i2c('I2C1', BASE.I2C1, 1, [31, 32], 12);
    this.i2c2 = i2c('I2C2', BASE.I2C2, 2, [33, 34], 14);
    // SPI2, the MN link's slave (its master the MN in the lab, src/lab/scpum4.mjs; none on this machine alone); it has
    // no clock in a Stop mode
    this.spi2 = this.attach(BASE.SPI2, new Spi({ name: 'SPI2', irq, irqn: 36 }));
    this.spi2.clocked = () => !this.inStop();
    // the RTC in the backup domain (BDCR.BDRST resets it); its time follows the clock changes RCC makes
    this.rtc = this.attach(BASE.RTC, new Rtc({ sched, exti: this.exti, rtcHz: () => this.rcc.rtcHz(), hclkHz, dbp: () => this.pwr.dbp() }));
    this.rcc.resetLine(BDCR, 16, this.rtc);
    this.rcc.clockUsers.push({ before: () => this.rtc.advance(), after: () => this.rtc.clockChanged() });
    this.time = { cycles: 0, seconds: 0 };         // SCPU time at a cycle count, kept across HCLK changes
    this.rcc.clockUsers.push({ before: () => this.foldTime(), after: () => {} });
    // the timers: TIM1 (advanced, APB2), TIM2 (32-bit, APB1), TIM15 / TIM16 (APB2); TIM1 shares its break IRQ 24 with
    // TIM15, its update IRQ 25 with TIM16 and its trigger IRQ 26 with TIM17 (RM0394 table 46); TIM1 and TIM2 have the
    // encoder modes and ETR, TIM15 a slave mode controller without them, TIM16 none
    const tim = (name, base, bits, channels, irqs, apb, slave) => this.attach(base, new Timer({ name, bits, channels, sched: dom(name),
      irq: (n, h) => this.irq(n, h, name), irqs, clockHz: () => this.rcc.timerHz(apb), hclkHz, slave }));
    const full = { encoder: true, etr: true };
    this.tim1 = tim('TIM1', BASE.TIM1, 16, 4, { up: 25, cc: 27, trg: 26 }, 2, full);
    this.tim2 = tim('TIM2', BASE.TIM2, 32, 4, { up: 28, cc: 28, trg: 28 }, 1, full);
    this.tim15 = tim('TIM15', BASE.TIM15, 16, 2, { up: 24, cc: 24, trg: 24 }, 2, { encoder: false, etr: false });
    this.tim16 = tim('TIM16', BASE.TIM16, 16, 1, { up: 25, cc: 25 }, 2, null);
    // the internal trigger connections (?: RM0394's "TIMx internal trigger connection" tables as recalled, not checked):
    // TIM1 ITR0 = TIM15, ITR1 = TIM2; TIM2 ITR0 = TIM1; TIM15 ITR0 = TIM1. The others name timers or sources this part
    // lacks or the model leaves out (TIM3, TIM4, TIM8, TIM16 / TIM17 OC1, the USB SOF) and stop the run when selected.
    this.tim1.connect(0, this.tim15); this.tim1.connect(1, this.tim2);
    this.tim2.connect(0, this.tim1);
    this.tim15.connect(0, this.tim1);
    // ADC1, the USB device (with no host) and its packet memory
    this.adc = this.attach(BASE.ADC, new Adc({ sched: dom('ADC'), irq, analog: (ch) => this.board.analog(ch) }));
    this.usb = this.attach(BASE.USB, new UsbStub());
    this.attach(BASE.USB + 0x400, new UsbPma());
    // the DMA requests of the modelled peripherals (RM0394 tables 41 and 42): ADC1 on DMA1 1 and DMA2 3; SPI2 on DMA1
    // 4 / 5, USART2 on DMA1 6 / 7 and USART1 on DMA2 6 / 7 are the image's own choices (docs/om1-scpu-spec.md
    // sections 3.1 and 4.2)
    const both = (...fs) => (level) => fs.forEach((f) => f(level));
    this.adc.dmaRequest = both(this.dma1.wire(1, 0), this.dma2.wire(3, 0));
    this.spi2.dmaRx = this.dma1.wire(4, 1); this.spi2.dmaTx = this.dma1.wire(5, 1);
    this.usart2.dmaRx = this.dma1.wire(6, 2); this.usart2.dmaTx = this.dma1.wire(7, 2);
    this.usart1.dmaTx = this.dma2.wire(6, 2); this.usart1.dmaRx = this.dma2.wire(7, 2);
    // the peripheral reset bits of RCC (RM0394 6.4.7 .. 6.4.13)
    const lines = [[AHB1RSTR, 0, this.dma1], [AHB1RSTR, 1, this.dma2], [AHB1RSTR, 8, this.flashIf], [AHB2RSTR, 13, this.adc],
      [APB1RSTR1, 0, this.tim2], [APB1RSTR1, 14, this.spi2], [APB1RSTR1, 17, this.usart2], [APB1RSTR1, 21, this.i2c1],
      [APB1RSTR1, 22, this.i2c2], [APB1RSTR1, 26, this.usb], [APB1RSTR1, 28, this.pwr], [APB1RSTR2, 0, this.lpuart1],
      [APB2RSTR, 0, this.exti.syscfg], [APB2RSTR, 11, this.tim1], [APB2RSTR, 14, this.usart1], [APB2RSTR, 16, this.tim15],
      [APB2RSTR, 17, this.tim16]];
    for (const [reg, bit, dev] of lines) this.rcc.resetLine(reg, bit, dev);
    this.gpio.ports.forEach((p, i) => { if (p) this.rcc.resetLine(AHB2RSTR, i, p); });
    // the chip's resettable state (all but the backup domain's RTC and the board), for a system reset
    this.resettable = [this.flashIf, ...this.gpio.ports.filter(Boolean), this.exti, this.exti.syscfg, this.dma1, this.dma2,
      this.usart1, this.usart2, this.lpuart1, this.i2c1, this.i2c2, this.spi2, this.tim1, this.tim2, this.tim15, this.tim16,
      this.adc, this.usb];
    this.mode = 'run';                            // one of MODES
    this.standbys = 0;                            // Standby entries so far
    this.stops = 0;                               // Stop 0 / 1 / 2 entries so far
    this.shutdowns = 0;                           // Shutdown entries so far
    this.resetHeld = false;                       // the NRST pin held low (nrst)
  }
  attach(base, dev, size = 0x400) { this.bus.device(base, size, dev); return dev; }
  get standby() { return this.mode === 'standby'; }
  inStop() { return this.mode === 'stop0' || this.mode === 'stop1' || this.mode === 'stop2'; }
  inFlash(pc) { const a = pc >>> 0; return a < FLASH_SIZE || (a >= FLASH && a < FLASH + FLASH_SIZE); }

  // an NVIC line driven by one source; a line two peripherals share (TIM1 and TIM15 on 24, TIM1 and TIM16 on 25) is
  // the OR of its sources
  irq(n, high, src = '') {
    let m = this.irqSrc.get(n);
    if (!m) this.irqSrc.set(n, (m = new Map()));
    m.set(src, high);
    let any = false;
    for (const v of m.values()) any ||= v;
    this.cpu.sys.irqLine(n, any);
  }
  // an event on the core's event input (EXTI's event lines; ARMv7-M B1.5.18 WFE): it ends a WFE, else the event
  // register keeps it for the next WFE
  coreEvent() {
    if (this.cpu.sleeping === 'wfe') this.cpu.sleeping = false;
    else this.cpu.event = 1;
  }

  // ---- the debug console
  consoleText(from = 0) { return String.fromCharCode(...this.tx.LPUART1.slice(from)); }
  type(text) { this.lpuart1.receive([...text].map((c) => c.charCodeAt(0) & 0xff)); }
  // from reset to the first prompt, within `seconds` of SCPU time
  boot(seconds = 5) { return this.run({ seconds, until: () => this.prompts > 0 }); }
  // type a line (and a carriage return, the line editor's end of line) and run until the next prompt, or `seconds`;
  // returns the console's output for it (the echo included) and the run's result
  command(line, seconds = 5) {
    const from = this.tx.LPUART1.length, n = this.prompts;
    this.type(line + '\r');
    const r = this.run({ seconds, until: () => this.prompts > n });
    return { ...r, text: this.consoleText(from) };
  }

  // ---- the low-power modes: a WFI or WFE with SCR.SLEEPDEEP enters the one PWR CR1.LPMS selects (RM0394 5.3.6..5.3.10)
  enterLowPower() {
    const lpms = this.pwr.lowPowerMode();
    if (lpms === 3) return this.enterStandby();
    if (lpms >= 4) return this.enterShutdown();
    this.enterStop(lpms);
  }
  // Stop 0 / 1 / 2 (RM0394 5.3.6..5.3.8): HCLK and the APB clocks stop (the core, SysTick, DWT, and every peripheral
  // clock domain but those that work in the mode), SRAM and every register keep their contents, LSE and LSI run on
  // (the RTC). The peripherals that run in Stop n (I, from the RM's table of the functions per mode): the RTC; LPUART1
  // with CR1.UESM on LSE or HSI16 in all three; USART1 / USART2 with UESM on LSE or HSI16 and I2C1 / I2C2 with
  // CR1.WUPEN on HSI16 in Stop 0 and 1 (a kernel clock on HSI16 wakes it on demand). The core wakes at an interrupt
  // that would wake a WFI (the RTC's alarm and wake-up timer through EXTI lines 18 / 20, a GPIO's EXTI line, a running
  // peripheral's own interrupt), or, entered by WFE, at an EXTI event too; then the system clock is MSI or HSI16 by RCC
  // CFGR.STOPWUCK (rcc.mjs stopWake). Time runs on at the HCLK of the entry (I: the regulator's modes and the wake-up
  // latency are not modelled). WFE with SCR.SEVONPEND and Stop 2 from low-power run stop the run.
  enterStop(n) {
    if (this.cpu.sleeping === 'wfe' && (this.cpu.sys.scr & 0x10)) throw new Unmodelled('a Stop mode entered by WFE with SCB SCR.SEVONPEND');
    if (n === 2 && (this.pwr.get(PWR_CR1) & (1 << 14))) throw new Unmodelled('Stop 2 from low-power run (PWR CR1.LPR)');
    this.mode = `stop${n}`;
    this.stops++;
    for (const d of this.sched.domains) if (!this.runsInStop(d.name, n)) d.freeze();
  }
  runsInStop(name, n) {
    const ccipr = this.rcc.get(CCIPR), uartStopClock = (shift) => ((ccipr >>> shift) & 3) >= 2;   // HSI16 or LSE
    switch (name) {
      case 'LPUART1': return this.lpuart1.wakeCapable() && uartStopClock(10);
      case 'USART1': return n <= 1 && this.usart1.wakeCapable() && uartStopClock(0);
      case 'USART2': return n <= 1 && this.usart2.wakeCapable() && uartStopClock(2);
      case 'I2C1': return n <= 1 && this.i2c1.wakeCapable() && ((ccipr >>> 12) & 3) === 2;
      case 'I2C2': return n <= 1 && this.i2c2.wakeCapable() && ((ccipr >>> 14) & 3) === 2;
      default: return false;
    }
  }
  exitStop() {
    for (const d of this.sched.domains) d.thaw();
    this.mode = 'run';
    this.cpu.irqDirty = true;                     // the core takes what woke it at its next step
    this.rcc.stopWake();
  }
  // Standby (RM0394 5.3.9) and Shutdown (5.3.10): the core and every peripheral but the backup domain (the RTC, its
  // backup registers, BDCR) and PWR's standby configuration lose power. Each ends with a reset at a wake-up event: an
  // enabled WKUP pin at its active level (CR3.EWUPx, CR4.WPx: WKUP1 PA0, WKUP2 PC13, WKUP4 PA2, WKUP5 PC5; the board's
  // level, else the pull of PUCRx / PDCRx when CR3.APC, else 0, I), or an RTC alarm or wake-up with its interrupt
  // enabled on the internal wake-up line (CR3.EIWUL). Standby's exit is a system reset with PWR SR1.SBF and the
  // wake-up flags, SRAM cleared (I: its contents after standby are undefined; SRAM2 kept when CR3.RRS); Shutdown's is a
  // brown-out reset (RCC CSR BORRSTF and PINRSTF, I), all of PWR reset but SR1's wake-up flags (I) and SRAM cleared
  // whole. Time runs on at the HCLK of the entry (I). The reset of the GPIO ports at the entry stands for the pins' high
  // impedance.
  enterStandby() { this.enterOff('standby'); this.standbys++; }
  enterShutdown() { this.enterOff('shutdown'); this.shutdowns++; }
  enterOff(mode) {
    this.mode = mode;
    this.cpu.sleeping = false;
    for (const d of this.resettable) d.reset();
  }
  wakeFlags() {
    const cr3 = this.pwr.get(CR3), cr4 = this.pwr.get(CR4);
    let flags = 0;
    for (const [k, port, pin] of [[0, 0, 0], [1, 2, 13], [3, 0, 2], [4, 2, 5]]) {
      if (!((cr3 >>> k) & 1)) continue;
      const p = this.gpio.ports[port], drive = p.drive[pin], pull = this.pwr.standbyPull(port, pin);
      const level = drive >= 0 ? drive : pull >= 0 ? pull : 0;
      if (level === ((cr4 >>> k) & 1 ? 0 : 1)) flags |= 1 << k;
    }
    if ((cr3 & (1 << 15)) && this.rtc.wakeSource()) flags |= 1 << 15;  // EIWUL: WUFI
    return flags;
  }
  exitOff(flags) {
    const from = this.mode;
    this.rtc.advance();
    this.foldTime();
    this.mode = 'run';
    const keep = from === 'standby' && (this.pwr.get(CR3) & (1 << 8)) ? 0x4000 : 0;   // RRS: SRAM2 (the top 16 KiB) kept
    this.rcc.systemReset();
    if (from === 'standby') this.pwr.standbyExit(flags);
    else { this.rcc.set(CSR, this.rcc.get(CSR) | BORRSTF | PINRSTF); this.pwr.shutdownExit(flags); }
    this.sram.fill(0, 0, SRAM_SIZE - keep);
    for (const d of this.resettable) d.reset();
    this.irqSrc.clear();
    this.cpu.reset();
    this.rtc.clockChanged();
  }

  // ---- the NRST pin (RM0394 6.1.2: a pin reset is a system reset), for a board that drives it (the MN's reset line in
  // the lab, src/lab/scpum4.mjs). Held low (nrst(true)): the core and every peripheral but the backup domain (the RTC,
  // its backup registers, BDCR) are reset and stay so, nothing runs, and time and the RTC run on (run() lets cycles
  // pass to the next event); released (nrst(false)): the core starts from its reset vector. RCC CSR keeps its reset
  // flags and sets PINRSTF; PWR is reset whole (I: only an exit from standby keeps CR3, CR4 and the pulls); SRAM keeps
  // its contents (I: a reset does not clear it, and the image's start clears .bss and initialises .data itself). A pin
  // reset ends every low-power mode. The board's pin levels stay (they are not the chip's).
  nrst(held) {
    if (held === this.resetHeld) return;
    if (held) {
      this.rtc.advance();
      this.foldTime();
      for (const d of this.sched.domains) d.thaw();
      this.mode = 'run';
      this.cpu.sleeping = false;
      this.rcc.systemReset();
      this.rcc.set(CSR, this.rcc.get(CSR) | PINRSTF);
      this.pwr.reset();
      for (const d of this.resettable) d.reset();
      this.irqSrc.clear();
      this.cpu.reset();
      this.rtc.clockChanged();
    }
    this.resetHeld = held;
  }

  // SCPU time in seconds: the core's cycles at the HCLK of each stretch
  foldTime() {
    const c = this.cpu.cycles;
    this.time.seconds += (c - this.time.cycles) / this.rcc.hclkHz();
    this.time.cycles = c;
  }
  seconds() { this.foldTime(); return this.time.seconds; }

  // ---- running
  // cycles until SysTick next counts to 0 (Infinity when it is off)
  systickDue() {
    const s = this.cpu.sys;
    if (!(s.stCsr & 1) || (s.stRvr === 0 && s.stCvr === 0)) return Infinity;
    const counts = s.stCvr > 0 ? s.stCvr : s.stRvr + 1;
    return s.stCsr & 4 ? counts : counts * s.refDiv - s.stFrac;
  }
  // let k cycles pass with the core asleep or stalled (its clock runs: SysTick and DWT count)
  idle(k) { this.cpu.cycles += k; this.cpu.sys.tick(k); }
  // let time pass to cycle t with HCLK stopped (Stop, Standby, Shutdown, NRST held): the core's clock stands still
  pass(t) { if (t > this.cpu.cycles) this.cpu.cycles = t; }
  // run until until() is true (checked after every event and every `check` steps), `cycles` more core cycles (or
  // `seconds` at the HCLK of the start) have passed, or the run stops; returns { reason: 'until' | 'cycles' | 'stop' |
  // 'reset' | a low-power mode's name ('stop0', 'stop1', 'stop2', 'standby', 'shutdown'), error? } ('reset' and the
  // modes' names: held in reset or in that mode with no event to come and no limit; the board can still end it). A stop
  // leaves the core at the instruction that made the access.
  run({ cycles = Infinity, seconds = null, until = null, check = 1000 } = {}) {
    if (seconds !== null) cycles = Math.round(seconds * this.rcc.hclkHz());
    const cpu = this.cpu, sched = this.sched, q = sched.q, end = cpu.cycles + cycles;
    let n = 0;
    // time passes to the next event (or the limit), with HCLK stopped (pass) or running (idle)
    const wait = (extra, stopped) => {
      const t = Math.min(sched.next(), extra, end);
      if (t === Infinity) return false;
      if (stopped) this.pass(t); else if (t > cpu.cycles) this.idle(t - cpu.cycles);
      sched.fire();
      return true;
    };
    try {
      for (;;) {
        if (cpu.cycles >= end) return { reason: 'cycles' };
        if (this.resetHeld) {                       // NRST low: nothing runs; time, and the backup domain's events, go on
          if (!wait(Infinity, true)) return { reason: 'reset' };
          if (until && until()) return { reason: 'until' };
          continue;
        }
        if (this.mode === 'standby' || this.mode === 'shutdown') {
          const flags = this.wakeFlags();
          if (flags) { this.exitOff(flags); if (until && until()) return { reason: 'until' }; continue; }
          if (!wait(Infinity, true)) return { reason: this.mode };   // asleep until the board acts
          if (until && until()) return { reason: 'until' };
          continue;
        }
        if (this.mode !== 'run') {                  // a Stop mode
          if (!cpu.sleeping || cpu.sys.wakes()) { this.exitStop(); if (until && until()) return { reason: 'until' }; continue; }
          if (!wait(Infinity, true)) return { reason: this.mode };
          if (until && until()) return { reason: 'until' };
          continue;
        }
        if (cpu.sleeping && !cpu.irqDirty) {
          if (cpu.sys.scr & 4) {                    // WFI or WFE with SLEEPDEEP: the low-power mode PWR CR1.LPMS selects
            this.enterLowPower();
            if (until && until()) return { reason: 'until' };
            continue;
          }
          if (!wait(cpu.cycles + this.systickDue(), false)) return { reason: 'stop', error: new Unmodelled('asleep with nothing to wake the core') };
          if (until && until()) return { reason: 'until' };
          continue;
        }
        if (this.flashIf.busy && !cpu.sleeping && this.inFlash(cpu.pc)) {   // a fetch from flash waits for its operation's end
          wait(Infinity, false);                    // (the operation's end is an event)
          if (until && until()) return { reason: 'until' };
          continue;
        }
        const r = cpu.step();
        if (r !== STEP_OK && r !== STEP_SLEEP) return { reason: 'stop', error: new Unmodelled(`the core stopped (step result ${r})`) };
        if (q.length && q[0].t <= cpu.cycles) { sched.fire(); if (until && until()) return { reason: 'until' }; }
        if (until && ++n >= check) { n = 0; if (until()) return { reason: 'until' }; }
      }
    } catch (e) {
      if (e instanceof Unmapped || e instanceof Unmodelled || e.name === 'Unimplemented') return { reason: 'stop', error: e };
      throw e;
    }
  }
}
