// The A/D converter at 0x98c00000 (board adc; docs/hle-gaps/4.7.md 4.7.20): what the A/D driver's single-channel path
// programs and reads, on the lab clock. D on E143 unless tagged (disassembly notation):
//   - the driver's init 0x5004d3c3 attaches IRQ 319 to the handler 0x5004d09c (0x5004ccc7: 0x50053f76(319, ..)); a
//     request (0x5004d4f4) whose channel the table (0xa32bff10) holds starts through 0x5004d831 -> 0x5004cce0, which
//     takes the single-channel path 0x5004cf16 while bit 0 of +0x28 reads 0 (0x5004cced..f6);
//   - 0x5004cf16: the converter clock's divider to +0x08 (0x5004cec2: log2 of clock 9 / the request's rate, after
//     two clock gates 0x50061c3a), a wait until bit 0 of +0x38 is set (0x5004cf22..35), +0x14 1 and +0x10 1, then the
//     control word to +0x00, built from 0x100: the converter channel (the table entry's byte +1, < 10) in bits 12..15,
//     bits 0..1 2 for more than one sample (1 sample: 0; channels >= 10 take another form, 0x5004cf57..6f), and 1 to
//     +0x04 (0x5004cfb1..b7); the mode byte (0xa32bfebc) 2 or 1;
//   - the handler 0x5004d09c reads +0x34 (the scan path's status), then +0x1c (the channels >= 10), then +0x14, and for
//     +0x14 non-zero (0x5004d0d3) writes +0x10 0 and +0x14 1, reads the sample, the channel's data word +0x3c + 4 k
//     for k 0..7, +0x70 for 8, +0x74 for 9 (the jump table 0x601186ac, 0x5004d270), counts it and, while samples are
//     owed, writes +0x14 1 and +0x10 1 again; after the last the stop 0x5004cfc0 clears bit 0 of +0x04, waits until it
//     reads 0, writes +0x10 0, +0x14 1, +0x00 0 and closes the gates (0x5004cefa).
// The model: +0x00, +0x04, +0x08, +0x10 store what is written and read it back (+0x00 and +0x08 have no reader the
// lab has met: a read is UNKNOWN); +0x04 bit 0 written 1 with a control word of mode 2 starts conversions of the
// word's channel, one every SAMPLE_NS of lab time (A-ADC-2), each latching the channel's value into its data word and
// setting the status (+0x14 reads 1); +0x04 written with bit 0 clear stops them; +0x14 written 1 clears the status;
// IRQ 319 is high while the status and +0x10 are both 1 (A-ADC-3, I: the line as the timer block's). +0x38 reads 1
// (A-ADC-1, I: the converter ready at once). +0x28, +0x34 and +0x1c read 0: the lab's converter runs no scan and
// no channel >= 10 (the driver's other paths, 0x5004cd21 and 0x5004d00b, write words the model refuses). A channel's
// value comes from the lab (values(k), src/lab/play.mjs H-ADINIT); a channel the lab gives none is UNKNOWN at its start.
// Any other offset, width or value, a mode-0 (single sample) or channel >= 10 start, and a debugger access, are UNKNOWN.
// Built by the machine on a board that gives adc (src/machine.mjs), passive until the firmware starts a conversion.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// A-ADC-2 (I): one sample every 10 us of lab time; the firmware gives the converter's clock (its rate argument, the
// divider) but no conversion time
export const SAMPLE_NS = 10000;
export const ADC_SIZE = 0x78;
const CTL = 0x00, START = 0x04, DIV = 0x08, IE = 0x10, STATUS = 0x14, CH10_STATUS = 0x1c, SCAN = 0x28, SCAN_STATUS = 0x34,
  READY = 0x38, DATA = 0x3c, DATA8 = 0x70, DATA9 = 0x74, CHANNELS = 10;

export class Adc {
  // cfg: the board's adc {base, irq}
  constructor(machine, clock, intc, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc; this.cfg = { base: cfg.base, irq: cfg.irq };
    this.ctl = 0; this.start = 0; this.div = null; this.ie = 0; this.status = 0;
    this.channel = null; this.next = Infinity;
    this.data = new Uint32Array(CHANNELS);
    this.samples = new Uint32Array(CHANNELS);      // conversions per channel (tests, probes)
    this.values = null;                            // (k) => the channel's value, 0..0xfff, or null (the lab's)
    this.errors = [];
    addRegion({ base: cfg.base, size: ADC_SIZE, kind: K_MMIO, name: 'om1.adc',
      dev: { read: (a, w, dbg) => this.read(a - cfg.base, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.base, v, w, dbg) } });
    intc.drive(cfg.irq);
    clock.add({ next: () => this.next, fire: (at) => this.fire(at) });
  }
  unknown(kind, off, size, value, dbg) {
    if (!dbg) {
      this.errors.push({ kind, addr: this.cfg.base + off, size, value, pc: ctx.pc() });
      this.m.stderr(`om-emu: om1.adc UNKNOWN ${kind} ${hex8(this.cfg.base + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    }
    throw BUS;
  }
  updateLine() { this.intc.setLine(this.cfg.irq, this.status === 1 && this.ie === 1); }
  fire(at) {
    const k = this.channel;
    this.data[k] = this.value(k);
    this.samples[k]++;
    this.status = 1;
    this.next = at + SAMPLE_NS;
    this.updateLine();
  }
  value(k) {
    const v = this.values?.(k) ?? null;
    if (v === null || !Number.isInteger(v) || v < 0 || v > 0xfff) throw new Error(`om1.adc: the lab gives converter channel ${k} no value (${v})`);
    return v;
  }
  run(off, dbg) {
    const mode = this.ctl & 3, k = (this.ctl >>> 12) & 0xf;
    if (mode !== 2 || (this.ctl & ~0xf103) !== 0) return this.unknown('write (start: a control word other than mode 2 with a channel)', off, 4, this.ctl, dbg);
    if (k >= CHANNELS) return this.unknown(`write (start: channel ${k})`, off, 4, this.ctl, dbg);
    const v = this.values?.(k) ?? null;
    if (v === null) return this.unknown(`write (start: channel ${k}, which the lab gives no value)`, off, 4, this.ctl, dbg);
    this.channel = k;
    this.next = this.clock.t + SAMPLE_NS;
  }
  read(off, size, dbg) {
    if (dbg || size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    switch (off) {
      case START: return this.start;
      case IE: return this.ie;
      case STATUS: return this.status;
      case SCAN: case SCAN_STATUS: case CH10_STATUS: return 0;
      case READY: return 1;                        // A-ADC-1
      case DATA8: return this.data[8];
      case DATA9: return this.data[9];
      default:
        if (off >= DATA && off < DATA + 4 * 8) return this.data[(off - DATA) >> 2];
        return this.unknown('read', off, size, 0, dbg);
    }
  }
  write(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3)) return this.unknown('write', off, size, value, dbg);
    value >>>= 0;
    switch (off) {
      case CTL:
        if (this.channel !== null && value !== 0) return this.unknown('write (control word while converting)', off, size, value, dbg);
        this.ctl = value;
        return;
      case START:
        if (value > 1) return this.unknown('write', off, size, value, dbg);
        if (value === 1 && this.channel === null) this.run(off, dbg);
        else if (value === 0) { this.channel = null; this.next = Infinity; }
        this.start = value;
        return;
      case DIV:
        if (value > 32) return this.unknown('write (divider exponent)', off, size, value, dbg);
        this.div = value;
        return;
      case IE:
        if (value > 1) return this.unknown('write', off, size, value, dbg);
        this.ie = value;
        this.updateLine();
        return;
      case STATUS:
        if (value !== 1) return this.unknown('write', off, size, value, dbg);
        this.status = 0;
        this.updateLine();
        return;
      default:
        return this.unknown('write', off, size, value, dbg);
    }
  }
  // the debugger's view (tests, probes)
  info() {
    return { ctl: this.ctl, start: this.start, div: this.div, ie: this.ie, status: this.status, channel: this.channel,
      samples: [...this.samples], data: [...this.data], errors: this.errors.length };
  }
}
