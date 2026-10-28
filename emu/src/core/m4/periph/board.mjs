// The SCPU's board as its STM32L4 sees it (docs/om1-scpu-spec.md sections 4 and 8 step 5): the levels external
// circuits drive on its pins, its oscillators, its analog inputs, the devices on its I2C buses and the far ends of
// its UARTs and of SPI2. None of it is read from a camera; the defaults are the "absent / idle" answers of step 5:
// - pins: none driven (I). An input reads the pull the firmware configures (PUPDR), else 0 for a floating pin (I).
//   So the hardware-phase straps PA6 / PC6 / PB9, which the firmware reads with pull-ups, read 1, 1, 1 (phase 7), and
//   PC13 and PC5, the port scan's inputs, read their pull-ups' 1 (the board's real levels are ?).
// - oscillators: LSE present (I; the firmware turns it on and selects it for the RTC, BDCR 0x8103), HSE absent (I;
//   the firmware never turns it on).
// - analog inputs: 0 on every ADC channel (?).
// - I2C1 / I2C2: no device acknowledges its address (I; the chargers, the PBH IO expander and the USB PD controller
//   are not modelled, section 4.2).
// - USART1 / USART2 (the battery packs, section 4.2): nothing is ever received (I).
// - SPI2 (the MN link, section 3.1): no master clocks it (in the lab, step 6, the MN does: src/lab/scpum4.mjs, whose
//   board, S-SCPUBOARD, is this one with the port scan's inputs PC13 and PC5 held low and the link's lines wired).
// A board object may override any of: drive {pin name: level}, analog(channel) -> 12-bit value, i2c(bus, address7)
// -> a device (i2c.mjs) or null, uartTx(name, byte) (a hook on what the firmware sends), hse, lse.
export const DEFAULT_BOARD = Object.freeze({
  drive: {},
  analog: () => 0,
  i2c: () => null,
  uartTx: null,
  hse: false,
  lse: true,
});
