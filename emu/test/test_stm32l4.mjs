// The SCPU's STM32L4 machine (src/core/m4/periph/, docs/om1-scpu-spec.md section 8 step 5):
// - stm32Units: each peripheral model on its own, against the reference manual's register semantics (RM0394): RCC's
//   ready flags and clock tree, the flash interface's unlock, GPIO with EXTI and SYSCFG, the U(S)ART's frame timing and
//   flags, DMA, I2C with an absent and a present device, SPI's FIFOs, a timer's update and compare, the RTC's calendar,
//   protection and wake-up timer, the ADC's conversion;
// - stm32Firmware: the E143 SCPU image on the machine from reset to the debug console's prompt, console commands and
//   their answers, the standby the default board leads to and the wake-up from it (needs the unpacked E143 SCPU
//   block; skipped without it).
//   node emu/test/test_stm32l4.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Scheduler } from '../src/core/m4/periph/sched.mjs';
import { Unmodelled } from '../src/core/m4/periph/regs.mjs';
import { Rcc } from '../src/core/m4/periph/rcc.mjs';
import { FlashInterface } from '../src/core/m4/periph/flash.mjs';
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

  // ---- FLASH: CR locked until the key sequence
  {
    const f = new FlashInterface();
    eq('FLASH CR locked after reset', f.read(0x14, 4) >>> 0, 0xc0000000);
    f.write(0x14, 4, 1);
    eq('FLASH CR ignores writes while locked', f.read(0x14, 4) & 1, 0);
    f.write(0x08, 4, 0x45670123); f.write(0x08, 4, 0xcdef89ab);
    eq('FLASH CR unlocked by KEYR', f.read(0x14, 4) >>> 31, 0);
    f.write(0x00, 4, 0x704);
    eq('FLASH ACR latency', f.read(0x00, 4) & 7, 4);
    throws('FLASH erase', () => f.write(0x14, 4, (1 << 16) | 2));
  }

  // ---- GPIO, SYSCFG and EXTI: levels, pulls, edges to the NVIC
  {
    const irq = lines();
    const gpio = new Gpio(), pc = gpio.add(2), exti = new Exti(irq.set), sys = new Syscfg();
    exti.syscfg = sys;
    gpio.onChange((port, pin, level) => exti.gpio(port, pin, level));
    eq('GPIOC analog after reset: IDR reads 0', pc.read(0x10, 4), 0);
    pc.write(0x00, 4, 0xffffffff & ~(3 << 26));                          // PC13 input
    pc.write(0x0c, 4, 1 << 26);                                          // pull-up
    eq('GPIO input with pull-up reads 1', (pc.read(0x10, 4) >>> 13) & 1, 1);
    pc.write(0x00, 4, (pc.read(0x00, 4) & ~(3 << 4)) | (1 << 4));        // PC2 output
    pc.write(0x18, 4, 1 << 2);
    eq('GPIO BSRR sets the output', (pc.read(0x14, 4) >>> 2) & 1, 1);
    pc.write(0x18, 4, 1 << 18);
    eq('GPIO BSRR resets the output', (pc.read(0x10, 4) >>> 2) & 1, 0);
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
  return { checks, bad };
}

// ---- the firmware: what the E143 SCPU image does on the machine (X, docs/om1-scpu-spec.md section 8 step 5)
export const BOOT = { promptCycles: 89724 };
export const BLOCKS = 'mem_put mdump mdump2 mdump4 phase olyq sctime heap sysctrl sysmem comm pwr chg psupp gio bkup adconv pbhioe pbhioedrv binfo pd help';

export async function stm32Firmware(file = path.join(ROOT, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk0e560000.OE.0107.bin')) {
  if (!fs.existsSync(file)) return { checks: 0, bad: [], skipped: [`no ${path.relative(ROOT, file)}`] };
  const { Stm32l4 } = await import('../src/core/m4/periph/stm32l4.mjs');
  const image = new Uint8Array(fs.readFileSync(file));
  const bad = [];
  let checks = 0;
  const eq = (what, got, want) => { checks++; if (got !== want) bad.push(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`); };
  const has = (what, text, want) => { checks++; if (!text.includes(want)) bad.push(`${what}: ${JSON.stringify(want)} not in ${JSON.stringify(text.slice(0, 300))}`); };
  const ok = (what, r) => { checks++; if (r.reason !== 'until') bad.push(`${what}: ${r.reason}${r.error ? ` ${r.error.message}` : ''}`); };

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
