// The SCPU's STM32L4 machine (src/core/m4/periph/, docs/om1-scpu-spec.md section 8 step 5):
// - stm32Units: each peripheral model on its own, against the reference manual's register semantics (RM0394): RCC's
//   ready flags and clock tree, the flash interface's unlock and lock, page and mass erase, double-word and fast
//   programming with BSY / EOP and the error flags, the bus's writable ROM and its code-write notification, GPIO with
//   EXTI and SYSCFG (and what the chip drives on a pin: an output, an open-drain 1 released) and EXTI's events, the
//   U(S)ART's frame timing and flags, DMA, I2C with an absent and a present device and as a slave (an address match
//   and a byte each way), SPI's FIFOs and its overrun's clearing, a timer's update and compare and its slave modes
//   (gated, trigger, external clock 1 from another timer's TRGO, encoder), the RTC's calendar, protection and wake-up
//   timer, the ADC's conversion; and the machine on a synthetic image: Stop 2 woken by an EXTI interrupt (MSI after
//   it, a timer and SysTick stopped while stopped), Stop 1 woken by the RTC wake-up timer (HSI16 after it by
//   STOPWUCK), Stop 0 entered by WFE and ended by an EXTI event, Shutdown ended by a wake-up pin's reset, and flash
//   erase and programming seen at both of the flash's addresses and by the core's decode cache (written 2026-10-28,
//   not yet run);
// - stm32Firmware: the E143 SCPU image on the machine from reset to the debug console's prompt, console commands and
//   their answers, the standby the default board leads to and the wake-up from it, and, on a fresh machine, that the
//   boot path to the standby at about 3.03 s enters no Stop or Shutdown mode and no flash operation (needs the unpacked
//   E143 SCPU block; skipped without it).
//   node emu/test/test_stm32l4.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Scheduler } from '../src/core/m4/periph/sched.mjs';
import { Unmodelled } from '../src/core/m4/periph/regs.mjs';
import { Rcc } from '../src/core/m4/periph/rcc.mjs';
import { FlashInterface, PAGE, ROW, WRP1AR } from '../src/core/m4/periph/flash.mjs';
import { Gpio } from '../src/core/m4/periph/gpio.mjs';
import { Exti, Syscfg } from '../src/core/m4/periph/exti.mjs';
import { Usart } from '../src/core/m4/periph/usart.mjs';
import { Dma } from '../src/core/m4/periph/dma.mjs';
import { I2c } from '../src/core/m4/periph/i2c.mjs';
import { Spi } from '../src/core/m4/periph/spi.mjs';
import { Timer } from '../src/core/m4/periph/tim.mjs';
import { Rtc } from '../src/core/m4/periph/rtc.mjs';
import { Adc } from '../src/core/m4/periph/adc.mjs';
import { MemoryBus } from '../src/core/m4/bus.mjs';
import { Stm32l4 } from '../src/core/m4/periph/stm32l4.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const hex = (v) => '0x' + (v >>> 0).toString(16);

// a time base without a core: the cycle counter is set by hand, events fire in order
function clock() {
  const cpu = { cycles: 0 };
  const sched = new Scheduler(cpu);
  return {
    cpu, sched,
    // let n cycles pass, firing every event due on the way
    pass(n) {
      const end = cpu.cycles + n;
      for (;;) {
        const t = sched.next();
        if (t > end) break;
        cpu.cycles = t; sched.fire();
      }
      cpu.cycles = end;
    },
  };
}
const lines = () => { const l = new Map(); return { set: (n, h) => l.set(n, h), get: (n) => !!l.get(n) }; };
// a synthetic SCPU image for the machine's own units: SP 0x20010000, reset at 0x08000300 (`wait`, WFI or WFE, then a
// branch back to it), every other vector a handler at 0x08000310 that returns (bx lr)
function tinyImage(wait = 0xbf30) {
  const img = new Uint8Array(0x400), dv = new DataView(img.buffer);
  dv.setUint32(0, 0x20010000, true); dv.setUint32(4, 0x08000301, true);
  for (let n = 2; n < 99; n++) dv.setUint32(4 * n, 0x08000311, true);
  dv.setUint16(0x300, wait, true); dv.setUint16(0x302, 0xe7fd, true);   // wfi / wfe; b.n 0x08000300
  dv.setUint16(0x310, 0x4770, true);                                      // bx lr
  return img;
}

export function stm32Units() {
  const bad = [];
  let checks = 0;
  const eq = (what, got, want) => { checks++; if (got !== want) bad.push(`${what}: ${typeof got === 'number' ? hex(got) : got} != ${typeof want === 'number' ? hex(want) : want}`); };
  const throws = (what, f, cls = Unmodelled) => { checks++; try { f(); bad.push(`${what}: no ${cls.name}`); } catch (e) { if (!(e instanceof cls)) bad.push(`${what}: ${e.message}`); } };

  // ---- RCC: reset values, ready flags, the system clock switch and the clock tree
  {
    let dbp = false;
    const r = new Rcc({ dbp: () => dbp });
    eq('RCC CR reset (MSI 4 MHz on and ready)', r.read(0x00, 4), 0x63);
    eq('RCC HCLK after reset', r.hclkHz(), 4e6);
    r.write(0x00, 4, r.read(0x00, 4) | (1 << 8));
    eq('RCC HSIRDY follows HSION', (r.read(0x00, 4) >>> 10) & 1, 1);
    r.write(0x00, 4, r.read(0x00, 4) | (1 << 16));
    eq('RCC HSERDY stays 0 with no crystal', (r.read(0x00, 4) >>> 17) & 1, 0);
    r.write(0x08, 4, 1);
    eq('RCC SWS follows SW (HSI16)', (r.read(0x08, 4) >>> 2) & 3, 1);
    eq('RCC HCLK on HSI16', r.hclkHz(), 16e6);
    r.write(0x0c, 4, (1 << 0) | (0 << 4) | (40 << 8) | (1 << 24));     // PLL: MSI, M 1, N 40, R 2
    r.write(0x00, 4, r.read(0x00, 4) | (1 << 24));
    eq('RCC PLLRDY follows PLLON', (r.read(0x00, 4) >>> 25) & 1, 1);
    r.write(0x08, 4, 3 | (4 << 8));                                      // SW PLL, PPRE1 /2
    eq('RCC SYSCLK from the PLL (4 MHz * 40 / 2)', r.sysclkHz(), 80e6);
    eq('RCC PCLK1 with PPRE1 /2', r.pclk1Hz(), 40e6);
    eq('RCC APB1 timer clock doubled', r.timerHz(1), 80e6);
    r.write(0x90, 4, 1);
    eq('RCC BDCR ignores writes without PWR DBP', r.read(0x90, 4), 0);
    dbp = true;
    r.write(0x90, 4, 1 | (1 << 8) | (1 << 15));
    eq('RCC LSERDY follows LSEON, RTCSEL LSE', r.read(0x90, 4), 0x8103);
    eq('RCC RTC clock from LSE', r.rtcHz(), 32768);
    let resets = 0;
    r.resetLine(0x40, 14, { reset: () => resets++ });
    r.write(0x40, 4, 1 << 14); r.write(0x40, 4, 0);
    eq('RCC a reset bit resets its peripheral once', resets, 1);
    r.write(0x94, 4, 1 << 23);
    eq('RCC CSR RMVF clears the reset flags', r.read(0x94, 4) >>> 24, 0);
  }

  // ---- FLASH: the unlock and lock, page and mass erase, double-word and fast programming, BSY / EOP, the error flags
  {
    const c = clock(), irq = lines(), array = new Uint8Array(8 * PAGE).fill(0x5a), changes = [];
    const f = new FlashInterface({ array, sched: c.sched, irq: irq.set, hclkHz: () => 16e6, changed: (o, n) => changes.push(`${o}+${n}`) });
    const sr = () => f.read(0x10, 4) >>> 0, cr = (v) => f.write(0x14, 4, v), IE = (1 << 24) | (1 << 25);   // EOPIE ERRIE
    eq('FLASH CR locked after reset', f.read(0x14, 4) >>> 0, 0xc0000000);
    cr(1);
    eq('FLASH CR ignores writes while locked', f.read(0x14, 4) & 1, 0);
    f.write(0x08, 4, 0x45670123); f.write(0x08, 4, 0xcdef89ab);
    eq('FLASH CR unlocked by KEYR', f.read(0x14, 4) >>> 31, 0);
    f.write(0x00, 4, 0x704);
    eq('FLASH ACR latency', f.read(0x00, 4) & 7, 4);
    cr(0);
    eq('FLASH CR.OPTLOCK is not cleared by a CR write', (f.read(0x14, 4) >>> 30) & 1, 1);
    // a page erase: page 3, BSY for tERASE, then EOP and the interrupt
    cr(IE | (3 << 3) | 2); cr(IE | (3 << 3) | 2 | (1 << 16));
    eq('FLASH page erase: the page erased', array[3 * PAGE] === 0xff && array[4 * PAGE - 1] === 0xff, true);
    eq('FLASH page erase: the next page kept', array[4 * PAGE], 0x5a);
    eq('FLASH page erase: the change reported', changes.join(' '), `${3 * PAGE}+${PAGE}`);
    eq('FLASH BSY during the erase', (sr() >>> 16) & 1, 1);
    eq('FLASH CR.STRT shown while busy', (f.read(0x14, 4) >>> 16) & 1, 1);
    c.pass(Math.round(22e-3 * 16e6) - 1);
    eq('FLASH BSY for tERASE (22 ms at 16 MHz)', (sr() >>> 16) & 1, 1);
    c.pass(1);
    eq('FLASH EOP at the end, BSY and STRT clear', [sr() & 1, (sr() >>> 16) & 1, (f.read(0x14, 4) >>> 16) & 1].join(), '1,0,0');
    eq('FLASH interrupt (IRQ 4) with EOPIE', irq.get(4), true);
    f.write(0x10, 4, 1);
    eq('FLASH EOP cleared by writing 1, the interrupt with it', irq.get(4), false);
    // double-word programming and its errors
    cr(IE | 1);                                                            // PG
    f.arrayWrite(3 * PAGE, 4, 0x11223344); f.arrayWrite(3 * PAGE + 4, 4, 0x55667788);
    eq('FLASH a double word programmed', [...array.subarray(3 * PAGE, 3 * PAGE + 8)].map(hex).join(' '), '0x44 0x33 0x22 0x11 0x88 0x77 0x66 0x55');
    c.pass(Math.round(82e-6 * 16e6));
    eq('FLASH EOP after tPROG', sr() & 1, 1);
    f.write(0x10, 4, 1);
    f.arrayWrite(3 * PAGE, 4, 1); f.arrayWrite(3 * PAGE + 4, 4, 0);
    eq('FLASH PROGERR on a double word not erased, OPERR with ERRIE', sr() & 0xff, 8 | 2);
    eq('FLASH the error interrupt', irq.get(4), true);
    eq('FLASH the bytes kept', array[3 * PAGE], 0x44);
    f.write(0x10, 4, 0xc3fb);
    f.arrayWrite(3 * PAGE + 16, 2, 0xffff);
    eq('FLASH SIZERR on a halfword write', sr() & 0x40, 0x40);
    f.arrayWrite(3 * PAGE + 24, 4, 0);
    eq('FLASH PGSERR on a write with an error not cleared', sr() & 0x80, 0x80);
    f.write(0x10, 4, 0xc3fb);
    f.arrayWrite(3 * PAGE + 20, 4, 0);
    eq('FLASH PGAERR on a double word started at its second word', sr() & 0x20, 0x20);
    f.write(0x10, 4, 0xc3fb);
    f.arrayWrite(3 * PAGE, 4, 0); f.arrayWrite(3 * PAGE + 4, 4, 0);
    eq('FLASH zeros over programmed bytes', array[3 * PAGE] | array[3 * PAGE + 7], 0);
    c.pass(Math.round(82e-6 * 16e6));
    cr(IE);
    f.arrayWrite(5 * PAGE, 4, 0);
    eq('FLASH PGSERR on a write to the array without PG', sr() & 0x80, 0x80);
    eq('FLASH that write changed nothing', array[5 * PAGE], 0x5a);
    f.write(0x10, 4, 0xc3fb);
    // mass erase and fast programming
    cr(IE | (1 << 18));                                                    // FSTPG
    f.arrayWrite(6 * PAGE, 4, 0);
    eq('FLASH PGSERR on fast programming without a mass erase', sr() & 0x80, 0x80);
    f.write(0x10, 4, 0xc3fb);
    cr(IE | 4); cr(IE | 4 | (1 << 16));                                    // MER1, STRT
    eq('FLASH mass erase: the whole array', array.every((b) => b === 0xff), true);
    c.pass(Math.round(22.1e-3 * 16e6));
    eq('FLASH mass erase: EOP', sr() & 1, 1);
    f.write(0x10, 4, 1);
    cr(IE | (1 << 18));
    for (let i = 0; i < 64; i++) f.arrayWrite(ROW + 4 * i, 4, 0x01010101 * (i + 1));
    eq('FLASH fast programming: a row of 64 words', [array[ROW], array[ROW + 255]].join(), '1,64');
    eq('FLASH fast programming: BSY for the row', (sr() >>> 16) & 1, 1);
    c.pass(Math.round(1.9e-3 * 16e6));
    eq('FLASH fast programming: EOP', sr() & 1, 1);
    // write protection, the option registers, the lock
    const g = new FlashInterface({ array: new Uint8Array(4 * PAGE).fill(0xff), optionBytes: { [WRP1AR]: 0x00010001 } });
    g.write(0x08, 4, 0x45670123); g.write(0x08, 4, 0xcdef89ab);
    g.write(0x14, 4, 1);
    g.arrayWrite(PAGE, 4, 0); g.arrayWrite(PAGE + 4, 4, 0);
    eq('FLASH WRPERR on a page of a WRP area', g.read(0x10, 4) & 0x10, 0x10);
    g.write(0x10, 4, 0xc3fb);
    g.write(0x14, 4, 4 | (1 << 16));
    eq('FLASH WRPERR on a mass erase with a WRP area', g.read(0x10, 4) & 0x10, 0x10);
    g.write(0x2c, 4, 0xff00ffff);
    eq('FLASH the option registers ignore writes while OPTLOCK', g.read(0x2c, 4), 0x00010001);
    g.write(0x0c, 4, 0x08192a3b); g.write(0x0c, 4, 0x4c5d6e7f);
    eq('FLASH OPTLOCK cleared by OPTKEYR', (g.read(0x14, 4) >>> 30) & 1, 0);
    throws('FLASH option byte programming', () => g.write(0x14, 4, 1 << 17));
    g.write(0x14, 4, 1 << 31);
    eq('FLASH CR.LOCK set by a write', g.read(0x14, 4) >>> 31, 1);
    g.write(0x14, 4, 1);
    eq('FLASH a locked CR ignores writes', g.read(0x14, 4) & 1, 0);
  }

  // ---- the bus: a ROM region's writes through its handler, the code-write notification at every address
  {
    const bus = new MemoryBus(), got = [], heard = [];
    bus.rom(0x08000000, new Uint8Array(0x1000), (off, size, v) => got.push(`${off}:${size}:${v}`));
    bus.alias(0, 0x08000000, 0x1000);
    bus.onCodeWrite((a, n) => heard.push(`${hex(a)}+${n}`));
    bus.write32(0x08000010, 7); bus.write16(0x20, 9);
    eq('bus a ROM region\'s writes reach its handler, the alias\'s at the region\'s offsets', got.join(' '), '16:4:7 32:2:9');
    bus.codeWritten(0x08000100, 8);
    eq('bus a code write heard at the alias and at the region', heard.join(' '), '0x100+8 0x8000100+8');
  }

  // ---- GPIO, SYSCFG and EXTI: levels, pulls, edges to the NVIC
  {
    const irq = lines();
    const gpio = new Gpio(), pc = gpio.add(2), exti = new Exti(irq.set), sys = new Syscfg();
    exti.syscfg = sys;
    gpio.onChange((port, pin, level) => exti.gpio(port, pin, level));
    const outs = [];
    gpio.onOutput((port, pin, level) => outs.push(`${port}:${pin}=${level}`));
    eq('GPIOC analog after reset: IDR reads 0', pc.read(0x10, 4), 0);
    pc.write(0x00, 4, 0xffffffff & ~(3 << 26));                          // PC13 input
    pc.write(0x0c, 4, 1 << 26);                                          // pull-up
    eq('GPIO input with pull-up reads 1', (pc.read(0x10, 4) >>> 13) & 1, 1);
    pc.write(0x00, 4, (pc.read(0x00, 4) & ~(3 << 4)) | (1 << 4));        // PC2 output
    pc.write(0x18, 4, 1 << 2);
    eq('GPIO BSRR sets the output', (pc.read(0x14, 4) >>> 2) & 1, 1);
    pc.write(0x18, 4, 1 << 18);
    eq('GPIO BSRR resets the output', (pc.read(0x10, 4) >>> 2) & 1, 0);
    pc.write(0x04, 4, 1 << 2);                                           // PC2 open-drain: its 0 still driven
    pc.write(0x18, 4, 1 << 2);                                           // its 1 releases the pin
    eq('GPIO what the chip drives: an output its ODR bit, an open-drain 1 nothing', outs.join(' '), '2:2=0 2:2=1 2:2=0 2:2=-1');
    eq('GPIO driven() of a released pin', gpio.driven('PC2'), -1);
    pc.write(0x00, 4, pc.read(0x00, 4) | (3 << 4));                       // PC2 analog again
    eq('GPIO an input pin drives nothing', gpio.driven('PC13'), -1);
    sys.write(0x14, 4, 2 << 4);                                          // EXTICR4: line 13 on port C
    exti.write(0x0c, 4, 1 << 13); exti.write(0x00, 4, exti.read(0x00, 4) | (1 << 13));
    gpio.drive('PC13', 0);
    eq('EXTI falling edge sets PR13', (exti.read(0x14, 4) >>> 13) & 1, 1);
    eq('EXTI15_10 IRQ 40 raised', irq.get(40), true);
    exti.write(0x14, 4, 1 << 13);
    eq('EXTI PR write-1-to-clear lowers IRQ 40', irq.get(40), false);
    gpio.drive('PC13', 1);
    eq('EXTI rising edge not selected', (exti.read(0x14, 4) >>> 13) & 1, 0);
    sys.write(0x14, 4, 1 << 4);                                          // line 13 on port B
    gpio.drive('PC13', 0);
    eq('EXTI ignores a port SYSCFG does not select', (exti.read(0x14, 4) >>> 13) & 1, 0);
  }
  // ---- EXTI's events (EMR): to the core's event input, from an edge and from a software trigger
  {
    const irq = lines(), evs = [], gpio = new Gpio(), pa = gpio.add(0), exti = new Exti(irq.set);
    exti.syscfg = new Syscfg();
    exti.onEvent = (n) => evs.push(n);
    gpio.onChange((port, pin, level) => exti.gpio(port, pin, level));
    pa.write(0x00, 4, pa.read(0x00, 4) & ~3);                              // PA0 an input
    exti.write(0x08, 4, 1); exti.write(0x04, 4, 1);                        // line 0: rising edge, event mode only
    gpio.drive('PA0', 1);
    eq('EXTI an event from an edge on a line in event mode', evs.join(), '0');
    eq('EXTI no interrupt from a masked line', irq.get(6), false);
    exti.write(0x10, 4, 1);
    eq('EXTI a software trigger sends the event too', evs.join(), '0,0');
  }

  // ---- LPUART: frame timing at 115200 from 16 MHz, flags, the receive side
  {
    const c = clock(), irq = lines(), out = [];
    const u = new Usart({ name: 'LPUART1', lp: true, sched: c.sched, irq: irq.set, irqn: 70, kernelHz: () => 16e6, hclkHz: () => 16e6, onTx: (b) => out.push(b) });
    u.write(0x0c, 4, 0x8ae4);                                            // 115200 (the image's BRR)
    u.write(0x00, 4, 0x2d);                                              // UE RE TE RXNEIE
    eq('LPUART TEACK / REACK follow TE / RE', (u.read(0x1c, 4) >>> 21) & 3, 3);
    u.write(0x28, 1, 0x41); u.write(0x28, 1, 0x42);
    eq('LPUART TXE clear with TDR full behind the shift register', (u.read(0x1c, 4) >>> 7) & 1, 0);
    c.pass(1388);
    eq('LPUART no byte out before 10 bit times', out.length, 0);
    c.pass(2);
    eq('LPUART first byte out after 10 bits (1389 cycles)', out[0], 0x41);
    c.pass(1389);
    eq('LPUART second byte out', out[1], 0x42);
    eq('LPUART TC after the last frame', (u.read(0x1c, 4) >>> 6) & 1, 1);
    u.receive([0x68, 0x69]);
    c.pass(1389);
    eq('LPUART RXNE after one frame', (u.read(0x1c, 4) >>> 5) & 1, 1);
    eq('LPUART IRQ 70 with RXNEIE', irq.get(70), true);
    eq('LPUART RDR', u.read(0x24, 4), 0x68);
    eq('LPUART reading RDR clears RXNE', (u.read(0x1c, 4) >>> 5) & 1, 0);
    c.pass(1389);
    eq('LPUART the next byte', u.read(0x24, 4), 0x69);
    c.pass(1389);
    eq('LPUART IDLE a frame after the last byte', (u.read(0x1c, 4) >>> 4) & 1, 1);
    throws('LPUART hardware flow control', () => u.write(0x08, 4, 1 << 9));
    const usart = new Usart({ name: 'USART2', sched: c.sched, irq: irq.set, irqn: 38, kernelHz: () => 16e6, hclkHz: () => 16e6, onTx: (b) => out.push(b) });
    usart.write(0x0c, 4, 1667);                                          // 9600
    usart.write(0x00, 4, 0x140d);                                        // UE RE TE, PCE even, M0: 9-bit words (the image's)
    usart.write(0x28, 4, 0x07); usart.write(0x28, 4, 0x35);
    c.pass(2 * 11 * 1667 + 10);
    eq('USART 9-bit words with even parity on the line', out.slice(-2).map(hex).join(' '), '0x107 0x35');
  }

  // ---- DMA: memory to memory, and a peripheral's request
  {
    const c = clock(), irq = lines(), bus = new MemoryBus();
    const ram = bus.ram(0x20000000, 0x100);
    const dma = new Dma({ name: 'DMA1', bus, sched: c.sched, irq: irq.set, irqs: [11, 12, 13, 14, 15, 16, 17] });
    for (let i = 0; i < 16; i++) ram[i] = i + 1;
    dma.write(0x10, 4, 0x20000000); dma.write(0x14, 4, 0x20000080); dma.write(0x0c, 4, 4);
    dma.write(0x08, 4, (1 << 14) | (2 << 10) | (2 << 8) | (1 << 7) | (1 << 6) | 2 | 1);   // MEM2MEM, words, both increment, TCIE, EN
    c.pass(10);
    eq('DMA mem-to-mem copied 4 words', ram[0x80 + 15], 16);
    eq('DMA TCIF1 and GIF1', dma.read(0x00, 4) & 3, 3);
    eq('DMA channel 1 IRQ 11', irq.get(11), true);
    dma.write(0x04, 4, 1);
    eq('DMA IFCR CGIF clears the flags', dma.read(0x00, 4) & 15, 0);
    let req = null;
    const sink = [];
    bus.device(0x40000000, 0x400, { read: () => 0, write: (off, size, v) => { sink.push(v); req(sink.length < 3); } });
    req = dma.wire(7, 2);
    dma.write(0xa8, 4, 2 << 24);                                          // CSELR: channel 7 request 2
    dma.write(0x08 + 0x14 * 6 + 8, 4, 0x40000000); dma.write(0x08 + 0x14 * 6 + 12, 4, 0x20000000); dma.write(0x08 + 0x14 * 6 + 4, 4, 5);
    dma.write(0x08 + 0x14 * 6, 4, (1 << 7) | (1 << 4) | 1);              // MINC, memory to peripheral, EN
    req(true);
    c.pass(20);
    eq('DMA moves while its request is high', sink.join(','), '1,2,3');
    eq('DMA CNDTR counts down', dma.read(0x08 + 0x14 * 6 + 4, 4), 2);
    dma.write(0x08 + 0x14 * 5 + 4, 4, 1); dma.write(0xa8, 4, 3 << 20);
    throws('DMA a channel whose request nothing drives', () => dma.write(0x08 + 0x14 * 5, 4, 1));
  }

  // ---- I2C: an absent device NACKs, a present one takes the bytes
  {
    const c = clock(), irq = lines(), got = [];
    const dev = { start: () => true, write: (b) => { got.push(b); return true; }, read: () => 0x5a, stop: () => got.push('P') };
    const i2c = new I2c({ name: 'I2C1', sched: c.sched, irq: irq.set, irqs: [31, 32], kernelHz: () => 16e6, hclkHz: () => 16e6,
      device: (a) => (a === 0x6b ? dev : null) });
    i2c.write(0x10, 4, 0x00303d5b);                                       // 100 kHz-ish
    i2c.write(0x00, 4, 1 | (1 << 4) | (1 << 5));                         // PE NACKIE STOPIE
    i2c.write(0x04, 4, (0x09 << 1) | (1 << 16) | (1 << 25) | (1 << 13)); // address 0x09, 1 byte, AUTOEND, START
    eq('I2C BUSY after START', (i2c.read(0x18, 4) >>> 15) & 1, 1);
    c.pass(10000);
    eq('I2C an absent device: NACKF and STOPF', i2c.read(0x18, 4) & 0x30, 0x30);
    eq('I2C BUSY clear after the STOP', (i2c.read(0x18, 4) >>> 15) & 1, 0);
    eq('I2C event IRQ 31 with NACKIE', irq.get(31), true);
    i2c.write(0x1c, 4, 0x30);
    eq('I2C ICR clears NACKF / STOPF', i2c.read(0x18, 4) & 0x30, 0);
    i2c.write(0x04, 4, (0x6b << 1) | (2 << 16) | (1 << 25) | (1 << 13));
    c.pass(10000);
    eq('I2C TXIS when the device acknowledged', (i2c.read(0x18, 4) >>> 1) & 1, 1);
    i2c.write(0x28, 4, 0x11);
    c.pass(10000);
    i2c.write(0x28, 4, 0x22);
    c.pass(10000);
    eq('I2C the bytes and the STOP reached the device', got.join(','), '17,34,P');
    eq('I2C STOPF after AUTOEND', (i2c.read(0x18, 4) >>> 5) & 1, 1);
    eq('I2C the log', JSON.stringify(i2c.log.map((t) => [t.addr, t.ack])), '[[9,false],[107,true]]');
  }
  // ---- I2C as a slave: a board master's write of two bytes, then a repeated START and a read of one, at 100 kHz
  {
    const c = clock(), irq = lines(), done = [];
    const i2c = new I2c({ name: 'I2C2', sched: c.sched, irq: irq.set, irqs: [33, 34], kernelHz: () => 16e6, hclkHz: () => 16e6 });
    const isr = () => i2c.read(0x18, 4) >>> 0;
    i2c.write(0x08, 4, (1 << 15) | (0x42 << 1));                          // OAR1: 0x42, enabled
    i2c.write(0x00, 4, 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 5));   // PE TXIE RXIE ADDRIE STOPIE
    i2c.masterTransfer({ addr: 0x17, write: [1], done: (r) => done.push(r) });
    c.pass(20000);
    eq('I2C slave: another address is not acknowledged', JSON.stringify(done.shift()), '{"ack":false,"read":[]}');
    eq('I2C slave: no ADDR and no STOPF for it, the bus free again', isr() & (8 | 32 | (1 << 15)), 0);
    i2c.masterTransfer({ addr: 0x42, write: [0x11, 0x22], read: 1, hz: 100e3, done: (r) => done.push(r) });
    c.pass(1600);                                                         // START and the address: 10 bits of 160 cycles
    eq('I2C slave: ADDR, a write (DIR 0), ADDCODE 0x42, BUSY', [(isr() >>> 3) & 1, (isr() >>> 16) & 1, (isr() >>> 17) & 0x7f, (isr() >>> 15) & 1].join(), '1,0,66,1');
    eq('I2C slave: the event interrupt (IRQ 33) with ADDRIE', irq.get(33), true);
    c.pass(5000);
    eq('I2C slave: SCL stretched while ADDR is set', isr() & 4, 0);
    i2c.write(0x1c, 4, 8);                                                // ADDRCF
    c.pass(1440);
    eq('I2C slave: the first byte in RXDR', [(isr() >>> 2) & 1, i2c.rxdr].join(), '1,17');
    c.pass(1440);                                                         // the second byte waits while RXNE is set
    eq('I2C slave: RXDR', i2c.read(0x24, 4), 0x11);
    eq('I2C slave: the held byte follows at once', [(isr() >>> 2) & 1, i2c.read(0x24, 4)].join(), '1,34');
    c.pass(1600);                                                         // a repeated START, the address with read
    eq('I2C slave: ADDR again, a read (DIR 1)', [(isr() >>> 3) & 1, (isr() >>> 16) & 1].join(), '1,1');
    i2c.write(0x28, 4, 0x5a);                                             // the first byte, written ahead
    i2c.write(0x1c, 4, 8);
    eq('I2C slave: TXIS asks for the next byte', (isr() >>> 1) & 1, 1);
    i2c.write(0x28, 4, 0x5b);                                             // written ahead of the master's NACK
    c.pass(1440 + 160);
    eq('I2C slave: the master read the byte and stopped', JSON.stringify(done.shift()), '{"ack":true,"read":[90]}');
    eq('I2C slave: NACKF, STOPF, BUSY clear', [(isr() >>> 4) & 1, (isr() >>> 5) & 1, (isr() >>> 15) & 1].join(), '1,1,0');
    eq('I2C slave: the byte written ahead stays in TXDR (TXE 0)', isr() & 1, 0);
    i2c.write(0x18, 4, 1);
    eq('I2C slave: ISR.TXE flushes it', isr() & 1, 1);
    throws('I2C slave: a 10-bit own address', () => { i2c.write(0x08, 4, (1 << 15) | (1 << 10) | 0x42); i2c.masterTransfer({ addr: 0x21 }); c.pass(2000); });
  }

  // ---- SPI2 as slave: the transmit FIFO, the master's exchange, RXNE by FRXTH
  {
    const irq = lines();
    const spi = new Spi({ name: 'SPI2', irq: irq.set, irqn: 36 });
    spi.write(0x04, 4, 0x1700);                                           // 8-bit, FRXTH
    spi.write(0x00, 4, 0x40);                                             // SPE, slave
    spi.write(0x0c, 1, 0xa1); spi.write(0x0c, 1, 0xa2); spi.write(0x0c, 1, 0xa3);
    eq('SPI TXE clear with the FIFO more than half full', (spi.read(0x08, 4) >>> 1) & 1, 0);
    eq('SPI the master shifts the FIFO out in order', [spi.exchange(1), spi.exchange(2)].join(','), '161,162');
    eq('SPI RXNE with one byte (FRXTH)', spi.read(0x08, 4) & 1, 1);
    eq('SPI DR byte read', spi.read(0x0c, 1), 1);
    for (const b of [3, 4, 5, 6]) spi.exchange(b);                        // the receive FIFO full with 2..5: 6 is lost
    eq('SPI OVR with the receive FIFO full', (spi.read(0x08, 4) >>> 6) & 1, 1);
    eq('SPI OVR kept by an SR read alone', (spi.read(0x08, 4) >>> 6) & 1, 1);
    eq('SPI the bytes before the overrun kept', spi.read(0x0c, 1), 2);
    eq('SPI OVR read set by the SR read that clears it (after a DR read)', (spi.read(0x08, 4) >>> 6) & 1, 1);
    eq('SPI OVR clear after DR then SR', (spi.read(0x08, 4) >>> 6) & 1, 0);
    throws('SPI master mode', () => spi.write(0x00, 4, 0x44));
  }

  // ---- a timer: the update rate from PSC / ARR, a compare at CCR1 0
  {
    const c = clock(), irq = lines();
    let ups = 0;
    const t = new Timer({ name: 'TIM15', bits: 16, channels: 2, sched: c.sched, irq: (n, h) => { irq.set(n, h); }, irqs: { up: 24, cc: 24 }, clockHz: () => 16e6, hclkHz: () => 16e6 });
    t.write(0x28, 4, 15); t.write(0x2c, 4, 999); t.write(0x14, 4, 1);    // 1 MHz, 1000 ticks: 1 kHz; UG loads PSC
    t.write(0x10, 4, 0);
    t.write(0x0c, 4, 1 | 2);                                              // UIE CC1IE
    t.write(0x00, 4, 1);
    for (let i = 0; i < 10; i++) {
      c.pass(16000);
      if (t.read(0x10, 4) & 1) { ups++; t.write(0x10, 4, ~1); }
    }
    eq('TIM update every 1 ms at 16 MHz with PSC 15, ARR 999', ups, 10);
    eq('TIM CC1IF at CCR1 0 each period', (t.read(0x10, 4) >>> 1) & 1, 1);
    eq('TIM IRQ 24', irq.get(24), true);
    eq('TIM CNT runs', t.read(0x24, 4) < 1000, true);
    throws('TIM centre-aligned counting', () => t.write(0x00, 4, 1 | (1 << 5)));
  }
  // ---- timer slave modes: gated on TI1FP1, trigger on TI2FP2, external clock 1 from another timer's TRGO, encoder
  {
    const c = clock(), irq = lines();
    const timer = (name, bits, channels, irqs, slave) => new Timer({ name, bits, channels, sched: c.sched, irq: irq.set, irqs, clockHz: () => 16e6, hclkHz: () => 16e6, slave });
    const t2 = timer('TIM2', 32, 4, { up: 28, cc: 28, trg: 28 }, { encoder: true, etr: true });
    t2.write(0x08, 4, (5 << 4) | 5);                                       // SMCR: TS TI1FP1, SMS gated
    t2.write(0x0c, 4, 1 << 6);                                             // TIE
    t2.write(0x00, 4, 1);                                                  // CEN
    c.pass(1000);
    eq('TIM gated: no count while TRGI is low', t2.read(0x24, 4), 0);
    t2.input('TI1', 1);
    eq('TIM gated: TIF when the gate opens, the trigger interrupt (IRQ 28)', [(t2.read(0x10, 4) >>> 6) & 1, irq.get(28)].join(), '1,true');
    c.pass(1000);
    eq('TIM gated: counts while TRGI is high', t2.read(0x24, 4), 1000);
    t2.input('TI1', 0);
    c.pass(1000);
    eq('TIM gated: stops, not reset, when TRGI goes low', t2.read(0x24, 4), 1000);
    const t15 = timer('TIM15', 16, 2, { up: 24, cc: 24, trg: 24 }, { encoder: false, etr: false });
    t15.write(0x08, 4, (6 << 4) | 6);                                      // TS TI2FP2, SMS trigger
    c.pass(500);
    eq('TIM trigger: stopped before the edge', t15.read(0x00, 4) & 1, 0);
    t15.input('TI2', 1);
    eq('TIM trigger: a rising edge sets CEN and TIF', [t15.read(0x00, 4) & 1, (t15.read(0x10, 4) >>> 6) & 1].join(), '1,1');
    c.pass(300);
    eq('TIM trigger: counting from the edge', t15.read(0x24, 4), 300);
    throws('TIM15 has no encoder mode', () => t15.write(0x08, 4, 1));
    // TIM1's update events as TRGO (MMS update) clock a slave in external clock mode 1 through its ITR0
    const m1 = timer('TIM1', 16, 4, { up: 25, cc: 27, trg: 26 }, { encoder: true, etr: true });
    const s2 = timer('TIM2', 32, 4, { up: 28, cc: 28, trg: 28 }, { encoder: true, etr: true });
    s2.connect(0, m1);
    m1.write(0x04, 4, 2 << 4);                                             // CR2.MMS: update
    m1.write(0x2c, 4, 9);                                                  // ARR 9: an update every 10 cycles
    s2.write(0x08, 4, (0 << 4) | 7);                                       // TS ITR0, SMS external clock 1
    s2.write(0x00, 4, 1);
    m1.write(0x00, 4, 1);
    c.pass(100);
    eq('TIM external clock 1: the slave counts the master\'s 10 updates', s2.read(0x24, 4), 10);
    // encoder mode 3 on TIM1: a quadrature cycle forward counts 4, a step back 1 down with DIR
    const e1 = timer('TIM1', 16, 4, { up: 25, cc: 27, trg: 26 }, { encoder: true, etr: true });
    e1.write(0x08, 4, 3); e1.write(0x2c, 4, 99); e1.write(0x00, 4, 1);
    e1.input('TI1', 1); e1.input('TI2', 1); e1.input('TI1', 0); e1.input('TI2', 0);
    eq('TIM encoder: four edges forward', [e1.read(0x24, 4), (e1.read(0x00, 4) >>> 4) & 1].join(), '4,0');
    e1.input('TI2', 1);
    eq('TIM encoder: one edge back, DIR set', [e1.read(0x24, 4), (e1.read(0x00, 4) >>> 4) & 1].join(), '3,1');
  }

  // ---- RTC: protection, initialisation, the calendar across a leap day, the wake-up timer
  {
    const c = clock(), ex = [];
    let dbp = false;
    const exti = { line: (n, level) => ex.push(`${n}:${level ? 1 : 0}`) };
    const rtc = new Rtc({ sched: c.sched, exti, rtcHz: () => 32768, hclkHz: () => 16e6, dbp: () => dbp });
    rtc.write(0x50, 4, 0x1234);
    eq('RTC backup register write-protected without DBP', rtc.read(0x50, 4), 0);
    dbp = true;
    rtc.write(0x50, 4, 0x1234);
    eq('RTC backup register', rtc.read(0x50, 4), 0x1234);
    rtc.write(0x0c, 4, 0xffffffff);
    eq('RTC INIT refused while WPR is locked', (rtc.read(0x0c, 4) >>> 6) & 1, 0);
    rtc.write(0x24, 4, 0xca); rtc.write(0x24, 4, 0x53);
    rtc.write(0x0c, 4, 0xffffffff);
    eq('RTC INITF in init mode', (rtc.read(0x0c, 4) >>> 6) & 1, 1);
    rtc.write(0x04, 4, (0x24 << 16) | (4 << 13) | (0x02 << 8) | 0x29);   // 2024-02-29, Thursday
    rtc.write(0x00, 4, 0x235959);
    rtc.write(0x0c, 4, 0);                                                // leave init mode
    eq('RTC INITS with a year set', (rtc.read(0x0c, 4) >>> 4) & 1, 1);
    c.pass(16e6 + 1000);
    eq('RTC TR one second later', rtc.read(0x00, 4), 0);
    eq('RTC DR the next day (2024-03-01, Friday)', rtc.read(0x04, 4), (0x24 << 16) | (5 << 13) | (0x03 << 8) | 0x01);
    rtc.write(0x14, 4, 0);                                                // WUTR 0 (WUTWF with WUTE clear)
    rtc.write(0x08, 4, (1 << 10) | (1 << 14) | 4);                        // WUTE WUTIE, 1 Hz
    c.pass(16e6 + 1000);
    eq('RTC wake-up timer WUTF after 1 s', (rtc.read(0x0c, 4) >>> 10) & 1, 1);
    eq('RTC wake-up raises EXTI line 20', ex.includes('20:1'), true);
    eq('RTC a wake-up source for standby', rtc.wakeSource(), true);
  }

  // ---- ADC: the power-up sequence and a single conversion
  {
    const c = clock(), irq = lines();
    const adc = new Adc({ sched: c.sched, irq: irq.set, analog: (ch) => (ch === 9 ? 0x7ab : 0) });
    adc.write(0x08, 4, 0x10000000);                                       // DEEPPWD off, ADVREGEN
    adc.write(0x08, 4, 0x10000001);                                       // ADEN
    eq('ADC ADRDY', adc.read(0x00, 4) & 1, 1);
    adc.write(0x30, 4, 9 << 6);                                           // one conversion: channel 9
    adc.write(0x04, 4, 4);                                                // EOCIE
    adc.write(0x08, 4, 0x10000005);                                       // ADSTART
    c.pass(1000);
    eq('ADC EOC and EOS', adc.read(0x00, 4) & 0xc, 0xc);
    eq('ADC IRQ 18', irq.get(18), true);
    eq('ADC DR the channel\'s value', adc.read(0x40, 4), 0x7ab);
    eq('ADC ADSTART clear after a single sequence', (adc.read(0x08, 4) >>> 2) & 1, 0);
  }

  // ---- the machine on a synthetic image: the low-power modes and flash programming (register sequences as the
  // firmware would write them, through the bus)
  const machine = (wait) => { const m = new Stm32l4(tinyImage(wait)); return { m, w: (a, v) => m.bus.write32(a, v), r: (a) => m.bus.read32(a) >>> 0 }; };
  { // Stop 2 by WFI, woken by an EXTI interrupt; MSI after it (STOPWUCK 0); TIM2 and SysTick stop with HCLK
    const { m, w, r } = machine();
    m.run({ cycles: 100 });
    w(0x40021000, r(0x40021000) | (1 << 8) | (1 << 24));                  // RCC CR: HSION, PLLON
    w(0x40021008, 1);                                                      // CFGR: SYSCLK HSI16, STOPWUCK 0
    w(0x48000000, r(0x48000000) & ~3);                                     // PA0 an input
    w(0x40010408, 1); w(0x40010400, r(0x40010400) | 1);                    // EXTI line 0: rising edge, unmasked
    m.cpu.sys.write(0xe000e100, 4, 1 << 6);                                // NVIC: EXTI0 (IRQ 6)
    w(0x40000000, 1);                                                      // TIM2 counting
    m.cpu.sys.write(0xe000e014, 4, 0xffffff); m.cpu.sys.write(0xe000e010, 4, 5);   // SysTick on the processor clock
    w(0x40007000, (r(0x40007000) & ~7) | 2);                               // PWR CR1.LPMS: Stop 2
    m.cpu.sys.write(0xe000ed10, 4, 4);                                     // SCR.SLEEPDEEP
    let res = m.run({ cycles: 1000 });
    eq('Stop 2 entered by WFI with SLEEPDEEP', `${m.mode} ${m.stops}`, 'stop2 1');
    const cnt = m.tim2.read(0x24, 4) >>> 0, cvr = m.cpu.sys.stCvr;
    res = m.run({ cycles: 160000 });
    eq('Stop 2 with nothing to wake it: the run ends at its limit', res.reason, 'cycles');
    eq('Stop 2: TIM2 stands still', m.tim2.read(0x24, 4) >>> 0, cnt);
    eq('Stop 2: SysTick stands still', m.cpu.sys.stCvr, cvr);
    m.gpio.drive('PA0', 1);
    res = m.run({ cycles: 1000, until: () => m.mode === 'run' });
    eq('Stop 2 ended by an EXTI interrupt', res.reason, 'until');
    eq('after Stop with STOPWUCK 0: SYSCLK MSI (SWS 0) at 4 MHz', `${(r(0x40021008) >>> 2) & 3} ${m.rcc.hclkHz()}`, '0 4000000');
    eq('after Stop: PLL and HSI16 off, MSI on', [(r(0x40021000) >>> 24) & 1, (r(0x40021000) >>> 8) & 1, r(0x40021000) & 1].join(), '0,0,1');
    w(0x40010414, 1);                                                      // EXTI PR1: the line low again
    m.run({ cycles: 1000 });
    eq('TIM2 counts again after the wake-up (until the next Stop)', (m.tim2.read(0x24, 4) >>> 0) > cnt, true);
    eq('the interrupt taken, the loop back in Stop 2', `${m.mode} ${m.stops}`, 'stop2 2');
  }
  { // Stop 1, woken by the RTC wake-up timer 1 s later; HSI16 after it (STOPWUCK 1)
    const { m, w, r } = machine();
    m.run({ cycles: 100 });
    w(0x40021000, r(0x40021000) | (1 << 8));
    w(0x40021008, (1 << 15) | 1);                                          // SYSCLK HSI16, STOPWUCK: HSI16 after a Stop
    w(0x40007000, (r(0x40007000) & ~7) | (1 << 8) | 1);                    // PWR CR1: DBP, LPMS Stop 1
    w(0x40021090, 0x8101);                                                 // RCC BDCR: LSE on, the RTC's clock, RTCEN
    w(0x40002824, 0xca); w(0x40002824, 0x53);                              // RTC WPR: unlocked
    w(0x40002814, 0);                                                      // WUTR 0: one period
    w(0x40010408, 1 << 20); w(0x40010400, r(0x40010400) | (1 << 20));      // EXTI line 20 (the RTC's wake-up)
    m.cpu.sys.write(0xe000e100, 4, 1 << 3);                                // NVIC: RTC_WKUP (IRQ 3)
    m.cpu.sys.write(0xe000ed10, 4, 4);
    const t0 = m.cpu.cycles;
    w(0x40002808, (1 << 10) | (1 << 14) | 4);                              // RTC CR: WUTE WUTIE, ck_spre (1 Hz)
    const res = m.run({ seconds: 2, until: () => m.stops === 1 && m.mode === 'run' });
    eq('Stop 1 ended by the RTC wake-up timer', `${res.reason} ${m.stops}`, 'until 1');
    eq('the wake-up 1 s after the timer started (16e6 cycles at 16 MHz)', m.cpu.cycles - t0, 16e6);
    eq('after Stop with STOPWUCK 1: SYSCLK HSI16 (SWS 1) at 16 MHz, MSI off', `${(r(0x40021008) >>> 2) & 3} ${m.rcc.hclkHz()} ${r(0x40021000) & 1}`, '1 16000000 0');
    eq('the RTC wake-up flag', (r(0x4000280c) >>> 10) & 1, 1);
  }
  { // Stop 0 by WFE, ended by an EXTI event with no interrupt
    const { m, w, r } = machine(0xbf20);
    m.run({ cycles: 100 });
    eq('WFE sleeps', m.cpu.sleeping, 'wfe');
    w(0x48000000, r(0x48000000) & ~3);
    w(0x40010408, 1); w(0x40010404, 1);                                    // EXTI line 0: rising edge, event mode (EMR)
    w(0x40007000, r(0x40007000) & ~7);                                     // LPMS: Stop 0
    m.cpu.sys.write(0xe000ed10, 4, 4);
    let res = m.run({ cycles: 1000 });
    eq('Stop 0 entered by WFE', m.mode, 'stop0');
    m.gpio.drive('PA0', 1);
    res = m.run({ cycles: 1000, until: () => m.mode === 'run' });
    eq('Stop 0 ended by an EXTI event', res.reason, 'until');
    eq('no interrupt pending for it (EXTI0, exception 22)', m.cpu.sys.pending[22], 0);
    eq('the SPI has no clock in a Stop mode', (() => { m.run({ cycles: 100 }); try { m.spi2.exchange(0); return 'clocked'; } catch (e) { return e.name; } })(), 'Unmodelled');
  }
  { // Shutdown, ended by WKUP1 (PA0 high): a brown-out reset with the backup domain kept
    const { m, w, r } = machine();
    m.run({ cycles: 100 });
    w(0x40007000, r(0x40007000) | (1 << 8));                               // DBP
    w(0x40002850, 0x1234);                                                 // RTC backup register 0
    w(0x20000100, 0xdeadbeef);
    w(0x40021094, r(0x40021094) | (1 << 23));                              // RCC CSR.RMVF: the reset flags cleared
    w(0x40007008, 0x8001); w(0x4000700c, 0);                               // PWR CR3: EWUP1 (EIWUL kept), CR4: WKUP1 active high
    w(0x40007000, (r(0x40007000) & ~7) | 4);                               // LPMS: Shutdown
    m.cpu.sys.write(0xe000ed10, 4, 4);
    let res = m.run({ cycles: 1000 });
    eq('Shutdown entered', `${m.mode} ${m.shutdowns}`, 'shutdown 1');
    res = m.run({ cycles: 1000 });
    eq('Shutdown with PA0 low: still off', `${res.reason} ${m.mode}`, 'cycles shutdown');
    m.gpio.drive('PA0', 1);
    res = m.run({ cycles: 1000, until: () => m.mode === 'run' });
    eq('Shutdown ended by WKUP1', res.reason, 'until');
    eq('a brown-out reset: RCC CSR BORRSTF and PINRSTF', (r(0x40021094) >>> 26) & 3, 3);
    eq('PWR SR1: WUF1, not SBF', r(0x40007010), 1);
    eq('PWR CR3 back to its reset value', r(0x40007008), 0x8000);
    eq('SRAM cleared', r(0x20000100), 0);
    eq('the backup domain kept (RTC backup register 0)', r(0x40002850), 0x1234);
    eq('the core at its reset vector', m.cpu.pc >>> 0, 0x08000300);
  }
  { // flash erase and programming through the bus: both addresses, the decode cache, PGSERR for a stray write
    const { m, w, r } = machine();
    m.run({ cycles: 100 });
    eq('the core decoded its loop from flash', m.cpu.dcache.has(0x08000300), true);
    w(0x40022008, 0x45670123); w(0x40022008, 0xcdef89ab);                 // FLASH KEYR
    w(0x40022014, 2); w(0x40022014, 2 | (1 << 16));                        // PER page 0, STRT
    eq('a page erase reaches the bytes the core fetches, at both addresses', [m.bus.read16(0x08000300), m.bus.read16(0x300)].map(hex).join(' '), '0xffff 0xffff');
    eq('the decode cache forgets the erased code', m.cpu.dcache.has(0x08000300) || m.cpu.dcache.has(0x08000302), false);
    w(0x40022014, 1);                                                      // PG
    w(0x08000400, 0x11111111); w(0x08000404, 0x22222222);                  // waits for the erase, then programs
    eq('a double word programmed through the bus, seen at both addresses', [r(0x08000400), r(0x404)].map(hex).join(' '), '0x11111111 0x22222222');
    eq('two operations, the last still busy', `${m.flashIf.ops} ${m.flashIf.busy}`, '2 true');
    w(0x40022014, 0);
    w(0x08000500, 0);
    eq('a write to flash without PG: PGSERR, the bytes kept', `${hex(r(0x40022010) & 0x80)} ${hex(r(0x08000500))}`, '0x80 0xffffffff');
  }
  return { checks, bad };
}

// ---- the firmware: what the E143 SCPU image does on the machine (X, docs/om1-scpu-spec.md section 8 step 5)
export const BOOT = { promptCycles: 89724 };
export const BLOCKS = 'mem_put mdump mdump2 mdump4 phase olyq sctime heap sysctrl sysmem comm pwr chg psupp gio bkup adconv pbhioe pbhioedrv binfo pd help';

export async function stm32Firmware(file = path.join(ROOT, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk0e560000.OE.0107.bin')) {
  if (!fs.existsSync(file)) return { checks: 0, bad: [], skipped: [`no ${path.relative(ROOT, file)}`] };
  const image = new Uint8Array(fs.readFileSync(file));
  const bad = [];
  let checks = 0;
  const eq = (what, got, want) => { checks++; if (got !== want) bad.push(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`); };
  const has = (what, text, want) => { checks++; if (!text.includes(want)) bad.push(`${what}: ${JSON.stringify(want)} not in ${JSON.stringify(text.slice(0, 300))}`); };
  const ok = (what, r) => { checks++; if (r.reason !== 'until') bad.push(`${what}: ${r.reason}${r.error ? ` ${r.error.message}` : ''}`); };

  // nothing attached, nothing typed: the standby about 3.03 s after reset, with no Stop or Shutdown mode and no flash
  // erase or programming on the way (the low-power, flash, I2C slave and timer slave models leave the boot path as it
  // was; the prompt's cycle is checked below)
  {
    const s = new Stm32l4(image);
    ok('standby with nothing attached', s.run({ seconds: 5, until: () => s.standby }));
    const t = s.seconds();
    checks++; if (!(t > 3.0 && t < 3.06)) bad.push(`the standby at ${t.toFixed(4)} s, not about 3.03 s`);
    eq('no Stop or Shutdown on the way', s.stops + s.shutdowns, 0);
    eq('no flash erase or programming on the way', s.flashIf.ops, 0);
  }

  // the default board: the prompt, commands, then the standby the firmware chooses with no power source seen
  const m = new Stm32l4(image);
  let r = m.boot();
  ok('boot to the prompt', r);
  eq('the cycle of the first prompt', m.cpu.cycles, BOOT.promptCycles);
  eq('the first output is the prompt', m.consoleText().slice(0, 5), 'SUB> ');
  m.run({ seconds: 0.5 });
  has('the build line after the prompt', m.consoleText(), 'Build: --/-- --:--');
  has('the charger at I2C1 0x09 does not answer', m.consoleText(), '[CHG]<d05> b[0] Nack Detect[0x0004]');
  r = m.command('help');
  ok('help', r);
  has('help lists the blocks', r.text.replace(/\s+/g, ' '), `block name list ${BLOCKS} SUB>`);
  r = m.command('comm trace on');
  ok('comm trace on', r);
  has('comm trace on starts the trace', r.text, '[CMDM] Strat trace CMD data.');
  r = m.command('sysctrl get');
  has('sysctrl get: steady', r.text, 'now_state :  00000000');
  const sent = m.tx.USART2.length;
  r = m.command('binfo r all 0');
  eq('binfo r all 0: the body pack\'s command three times on USART2', m.tx.USART2.slice(sent).join(' '), '0 0 0 0 53 48 0 154 '.repeat(3).trim());
  has('binfo r all 0: no answer, zeros', r.text, 'data[50]: 0x00');
  r = m.command('phase');
  has('phase: straps PA6 / PC6 / PB9 on their pull-ups', r.text, 'develop pahase : 00000007');
  r = m.command('sysctrl dbg on');
  r = m.run({ seconds: 5, until: () => m.standby });
  ok('standby within 5 s', r);
  has('the system control task logs its standby', m.consoleText(), '!!! standby... !!! 2019/1/1 0:0:00');
  eq('one standby entry', m.standbys, 1);
  // PC13 low (WKUP2, active low) wakes it: a reset, the prompt again, the state bkground
  const n = m.prompts;
  r = m.run({ seconds: 1 });
  eq('asleep a second later', m.standby, true);
  m.gpio.drive('PC13', 0);
  r = m.run({ seconds: 1, until: () => m.prompts > n });
  ok('the prompt after the wake-up', r);
  eq('out of standby', m.standby, false);
  m.run({ seconds: 3 });
  r = m.command('sysctrl get');
  has('sysctrl get: bkground after the wake-up with PC13 low', r.text, 'now_state :  00000002');
  eq('still awake', m.standby, false);
  return { checks, bad, skipped: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = stm32Units(), f = await stm32Firmware();
  console.log(`STM32L4 models ${u.checks - u.bad.length}/${u.checks}; SCPU firmware on the machine ${f.skipped.length ? 'SKIPPED' : `${f.checks - f.bad.length}/${f.checks}`}`);
  [...u.bad, ...f.bad, ...f.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  process.exit(u.bad.length + f.bad.length ? 1 : 0);
}
