// The SCPU's memory without peripherals (docs/om1-scpu-spec.md sections 1 and 2): the image in a 256 KiB flash at
// 0x08000000 with its boot alias at 0, 64 KiB of SRAM at 0x20000000 (SRAM1 and SRAM2 contiguous, I), and nothing
// else: the first access anywhere else stops the run with Unmapped, naming the address and the pc. This is the
// smoke test of the core on the firmware (section 8 step 4) and the frame the STM32L4 peripherals of step 5 attach to.
import { CortexM4, STEP_OK, STEP_SLEEP } from './cpu.mjs';
import { MemoryBus } from './bus.mjs';

export class Unmapped extends Error {
  constructor(addr, size, write, value) {
    super(`unmapped ${write ? 'write' : 'read'} of ${size} at 0x${(addr >>> 0).toString(16)}${write ? ` = 0x${(value >>> 0).toString(16)}` : ''}`);
    this.name = 'Unmapped'; this.addr = addr >>> 0; this.size = size; this.write = write;
  }
}

export const FLASH = 0x08000000, FLASH_SIZE = 0x40000, SRAM = 0x20000000, SRAM_SIZE = 0x10000;

export function scpuMachine(image) {
  const flash = new Uint8Array(FLASH_SIZE).fill(0xff);
  flash.set(image.subarray(0, FLASH_SIZE));
  const bus = new MemoryBus({ unmapped: (a, size, w, v) => { throw new Unmapped(a, size, w, v); } });
  bus.rom(FLASH, flash);
  bus.alias(0, FLASH, FLASH_SIZE);
  bus.ram(SRAM, SRAM_SIZE);
  return { bus, cpu: new CortexM4({ bus, irqs: 83, prioBits: 4 }) };
}

// run from reset for at most limit steps: how far the image gets before its first access to an unmodelled address
export function smoke(image, limit = 5e6) {
  const { cpu } = scpuMachine(image);
  const entered = new Map();
  const enter = cpu.enter.bind(cpu);
  cpu.enter = (n, ret) => { entered.set(n, (entered.get(n) || 0) + 1); return enter(n, ret); };
  let stop = null, result = STEP_OK, steps = 0;
  const pc0 = cpu.pc, sp0 = cpu.r[13];
  try {
    for (; steps < limit; steps++) {
      result = cpu.step();
      if (result !== STEP_OK && result !== STEP_SLEEP) break;
    }
  } catch (e) {
    if (!(e instanceof Unmapped) && e.name !== 'Unimplemented') throw e;
    stop = e;
  }
  return { reset: { pc: pc0, sp: sp0 }, insns: cpu.insns, steps, result, stop, pc: cpu.pc, lr: cpu.r[14], sp: cpu.r[13],
    ipsr: cpu.ipsr, control: cpu.control, exceptions: Object.fromEntries(entered), cpu };
}
