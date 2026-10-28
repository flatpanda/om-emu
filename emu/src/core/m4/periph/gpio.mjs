// The STM32L4's GPIO ports (RM0394 section 8, at 0x48000000 + 0x400 * port; A..E and H, port index 0..4 and 7): MODER,
// OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR, LCKR (the lock sequence), AFRL / AFRH and BRR, with the RM's reset values
// for ports A and B (the debug pins) and the others' all-analog reset. A pin's digital input, what IDR reads and what
// EXTI sees: an output pin reads its ODR bit; an analog pin reads 0 (its Schmitt trigger is off, RM0394 8.4.12); an
// input or alternate-function pin reads the level the board drives on it (drive(pin, level)), else its pull (up 1,
// down 0), else 0 for a floating pin (I). Alternate-function signals (a UART's TX, SPI's MISO) are the peripheral
// models' own and do not reach IDR. Every change of a pin's input level goes to the listeners (EXTI's edge detector,
// the board) as (port, pin, level), an output pin's included (so the board sees PC2 / PC3, the link's lines). What the
// chip itself drives on a pin goes to the output listeners (onOutput) as (port, pin, level), level -1 when it stops
// driving it: an output pin drives its ODR bit, an open-drain output only a 0 (its 1 releases the pin), every other
// mode nothing (an alternate function's signal is the peripheral model's own, as above). A far end that must tell a
// released pin from a driven 0 (the MN link's lines, src/lab/scpum4.mjs) listens there.
import { Regs, merge } from './regs.mjs';

export const MODER = 0x00, OTYPER = 0x04, OSPEEDR = 0x08, PUPDR = 0x0c, IDR = 0x10, ODR = 0x14, BSRR = 0x18, LCKR = 0x1c,
  AFRL = 0x20, AFRH = 0x24, BRR = 0x28;
export const PORT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// reset values (RM0394 8.5): MODER, OSPEEDR, PUPDR
const RESET = { 0: [0xabffffff, 0x0c000000, 0x64000000], 1: [0xfffffebf, 0, 0x00000100] };

export class GpioPort extends Regs {
  constructor(gpio, index) {
    super(`GPIO${PORT_NAMES[index]}`);
    this.gpio = gpio; this.index = index;
    this.drive = new Int8Array(16).fill(-1);      // the board's level on each pin, -1 none (not the chip's: kept by reset)
    this.reset();
  }
  reset() {
    const [moder, ospeedr, pupdr] = RESET[this.index] || [0xffffffff, 0, 0];
    this.moder = moder; this.otyper = 0; this.ospeedr = ospeedr; this.pupdr = pupdr; this.odr = 0;
    this.afr = [0, 0]; this.lckr = 0; this.lockStep = 0;
    if (this.levels === undefined) { this.levels = this.compute(); [this.dmask, this.dval] = this.computeDriven(); } else this.update();
  }
  mode(pin) { return (this.moder >>> (2 * pin)) & 3; }
  level(pin) {
    const m = this.mode(pin);
    if (m === 1) return (this.odr >>> pin) & 1;
    if (m === 3) return 0;
    if (this.drive[pin] >= 0) return this.drive[pin];
    const pull = (this.pupdr >>> (2 * pin)) & 3;
    return pull === 1 ? 1 : 0;
  }
  compute() { let v = 0; for (let p = 0; p < 16; p++) v |= this.level(p) << p; return v >>> 0; }
  // the pins the chip drives and their levels, as masks [driven, value]: an output pin, but an open-drain one whose ODR
  // bit is 1 (a released pin)
  computeDriven() {
    let driven = 0;
    for (let p = 0; p < 16; p++) if (this.mode(p) === 1 && !((this.otyper >>> p) & (this.odr >>> p) & 1)) driven |= 1 << p;
    return [driven >>> 0, (this.odr & driven) >>> 0];
  }
  // what the chip drives on a pin: its level, or -1 for none
  driven(pin) { return (this.dmask >>> pin) & 1 ? (this.dval >>> pin) & 1 : -1; }
  // recompute the levels and report the changed pins, then what the chip drives and its changes
  update() {
    const old = this.levels, now = this.compute();
    this.levels = now;
    const diff = old ^ now;
    if (diff) for (let p = 0; p < 16; p++) if ((diff >>> p) & 1) this.gpio.changed(this.index, p, (now >>> p) & 1);
    const om = this.dmask, ov = this.dval, [dm, dv] = this.computeDriven();
    this.dmask = dm; this.dval = dv;
    const dd = (dm ^ om) | ((dv ^ ov) & dm & om);
    if (dd) for (let p = 0; p < 16; p++) if ((dd >>> p) & 1) this.gpio.outputChanged(this.index, p, this.driven(p));
  }
  setDrive(pin, level) { this.drive[pin] = level < 0 ? -1 : level ? 1 : 0; this.update(); }

  rd(off) {
    switch (off) {
      case MODER: return this.moder;
      case OTYPER: return this.otyper;
      case OSPEEDR: return this.ospeedr;
      case PUPDR: return this.pupdr;
      case IDR: return this.levels & 0xffff;
      case ODR: return this.odr;
      case BSRR: return 0;
      case LCKR: return this.lckr;
      case AFRL: return this.afr[0];
      case AFRH: return this.afr[1];
      case BRR: return 0;
    }
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    const locked = (this.lckr >>> 16) & 1 ? this.lckr & 0xffff : 0;
    const keep = (bitsPer) => {                  // the bits of locked pins stay
      let m = 0;
      for (let p = 0; p < 16; p++) if ((locked >>> p) & 1) m |= ((1 << bitsPer) - 1) << (bitsPer * (p % (32 / bitsPer)));
      return ~m >>> 0;
    };
    switch (off) {
      case MODER: this.moder = merge(this.moder, v, mask, keep(2)); break;
      case OTYPER: this.otyper = merge(this.otyper, v, mask, 0xffff & keep(1)); break;
      case OSPEEDR: this.ospeedr = merge(this.ospeedr, v, mask, keep(2)); break;
      case PUPDR: this.pupdr = merge(this.pupdr, v, mask, keep(2)); break;
      case IDR: return;
      case ODR: this.odr = merge(this.odr, v, mask, 0xffff); break;
      case BSRR: { const w = v & mask; this.odr = ((this.odr & ~(w >>> 16)) | (w & 0xffff)) & 0xffff; break; }
      case BRR: this.odr = (this.odr & ~(v & mask)) & 0xffff; break;
      case LCKR: {                                // LCKK: write 1, write 0, write 1 with the same LCK[15:0], read
        const k = (v >>> 16) & 1, pins = v & 0xffff;
        if (this.lckr & 0x10000) return;
        if (this.lockStep === 0 && k) { this.lockStep = 1; this.lockPins = pins; }
        else if (this.lockStep === 1 && !k && pins === this.lockPins) this.lockStep = 2;
        else if (this.lockStep === 2 && k && pins === this.lockPins) { this.lockStep = 0; this.lckr = 0x10000 | pins; }
        else this.lockStep = 0;
        return;
      }
      case AFRL: this.afr[0] = merge(this.afr[0], v, mask); return;
      case AFRH: this.afr[1] = merge(this.afr[1], v, mask); return;
      default: throw this.missing(off, true, v);
    }
    this.update();
  }
}

export class Gpio {
  constructor() {
    this.ports = [];
    this.listeners = [];
    this.outputs = [];
  }
  add(index) { const p = new GpioPort(this, index); this.ports[index] = p; return p; }
  port(name) { return this.ports[PORT_NAMES.indexOf(name)]; }
  // 'PC2' -> level; drive('PB12', 1), drive('PB12', -1) to release
  pin(name) { const p = this.port(name[1]); return p.level(Number(name.slice(2))); }
  drive(name, level) { this.port(name[1]).setDrive(Number(name.slice(2)), level); }
  // 'PC3' -> what the chip drives on it: 0, 1 or -1 (none)
  driven(name) { return this.port(name[1]).driven(Number(name.slice(2))); }
  onChange(fn) { this.listeners.push(fn); }
  changed(port, pin, level) { for (const f of this.listeners) f(port, pin, level); }
  onOutput(fn) { this.outputs.push(fn); }
  outputChanged(port, pin, level) { for (const f of this.outputs) f(port, pin, level); }
}
