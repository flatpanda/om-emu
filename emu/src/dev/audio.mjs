// OM-1 audio serial port (board audio.port, IRQ audio.irq) and the SCA register page (board audio.sca, IRQ
// audio.sca_irq); docs/hle-gaps.md 4.5, where the firmware addresses cited here are listed. Built only when the
// machine's audio option is on (src/machine.mjs): without it these addresses stay the lab stub's, as before.
//
// The port is the audio driver's serial (I2S-like) port: double-buffered DMA from memory to the sound IC, TX (play)
// and RX (record). The model is TX only (D: every operand of the driver's TX path, 0x50aa8ce9..0x50aa9715; the bit
// meanings are I from how the code uses them):
//   +0x00   control: bits 0..2 from the common configuration (0x50aa92bc), bit 3 cleared at TX open (0x50aa9612) and
//           set at the port's stop (0x50aa9631), bit 4 the port's enable (0x50aa9578 sets, 0x50aa9631 clears), bit 5 TX
//           run (the TX start 0x50aa95be sets it; the ISR clears it once TX is disabled), bit 6 RX run (0x50aa95d7)
//   +0x0c   RX control (bit 2 RX enable, 0x50aa95b0); +0x10..+0x1c the RX slots; +0x20 the RX status and arm word
//           (0x300 arms both RX slots at the RX open 0x50aa9472, 0x100 / 0x200 one, 0x50aa9699); its bit 24 is common
//           to TX and RX: the port enable 0x50aa9578 writes +0x20 = 0x01000000 when +0x00 bit 0 and +0x20 bit 24 read
//           clear (what it does is ?), kept as storage, read back and written back by the ISR
//   +0x30   TX control: bit 2 TX enable (0x50aa95a2 sets, 0x50aa95f0 clears), bits 3..6 format bits of the TX
//           configuration (0x50aa9379)
//   +0x34 / +0x38  slot A / B address >> 4; +0x3c / +0x40 slot A / B length in bytes (the open 0x50aa9379, the re-arm
//           0x50aa9652: 768, one period of the 48 kHz ring)
//   +0x44   TX status and arm: a write of bit 10 / 11 arms slot A / B (0xc00 at the open, 0x400 or 0x800 at the
//           re-arm); the status reads in bits 0..5: 0 / 1 slot A / B done (the ISR 0x50aa90e2 records which in the byte
//           (0x62af2638): the slot its re-arm reloads, 0x50aa9652), 2 / 3 error log lines (0x06109009 / 0x0610900a),
//           4 the TX-ready callback 0x50aa8eda (the play start waits for its flag 0xed after the TX open, 0x50aac5a2),
//           5 a slot finished: the re-arm callback 0x50aa8ef3, then the stop when +0x30 bit 2 is clear. The ISR writes
//           the status it read back with 0xc00 masked out (0x50aa910b): the status bits are write 1 to clear (I)
//   +0x2c / +0x50  the RX / TX interrupt enables (the IRQ attach 0x50aa9515 writes 0xf and 0x38): IRQ audio.irq is
//           high while (TX status & +0x50) | (RX status & +0x2c) is not 0 (I: 0x38 are the TX bits 3, 4 and 5 the ISR
//           acts on as events; bits 0 and 1 come with bit 5)
//   the rest (+0x04, +0x08, +0x54, +0x58, +0x6c, +0x70, +0x84, +0x100..+0x11c, the common, TX and clock configuration
//           words of 0x50aa92bc, 0x50aa9379 and 0x50aa9069): storage, reset 0 (I: their roles are not read)
// A width other than 4, an unaligned access and a debugger write are UNKNOWN (a bus error, printed for a CPU access);
// so is any use of RX (+0x00 bit 6, an RX configuration or slot write, an RX arm), which stops the session.
//
// TX (A-AUDIO-1, I): a start (+0x00 bit 5 rising) with TX enabled plays slot A, then slot B, and so on, each armed slot
// in turn: the port fetches the slot's bytes from memory as it starts it and plays them for len / (rate x frame bytes)
// seconds of lab time (768 bytes at 48 kHz, 16-bit stereo: 4 ms); at the slot's end its done bit and bit 5 are set (one
// interrupt per slot), and the other slot, if armed, starts at once. A slot ending with the other not armed is an
// underrun: the port stops playing (counted; no status bit is set, which bit the hardware sets is ?). A slot armed
// with length 0 is empty: when its turn comes TX ends there, the port clearing +0x30 bit 2 (TX enable) itself, so the
// interrupt of the slot before it finds TX disabled and the ISR stops (counted apart; I). The driver's direct play
// (0x62af27d6 = 1) arms slot B with address 0 and length 0 beside the whole sound in slot A (0x50aad250, the TX open's
// 0xc00, D); the driver's one TX disable, the period callback's stop, is not reached on that path (the play slot's
// byte +133 stays -1, docs/hle-gaps.md 4.5, D), and command_play_end then waits for the TX done callback 0x50aad44b,
// which only the ISR's stop calls (0x50aac83a..0x50aac850, 0x50aa923c..0x50aa9265, D): so the port ends that TX
// itself (I, from that wait; X: with it the AF beep's release completes; that the real port raises an interrupt for the
// empty slot instead is not excluded, ?). Clearing TX run lets the slot playing play to its end, with no interrupt
// there, and starts no other (I: the firmware's end clears it at the interrupt that starts the sound's last period, X,
// so a stop at once would cut that period; and the ISR's done bits would write through its cleared TX object,
// 0x50aa9206). A start while that slot still plays cuts it there: the frames it played go to the lab and the new
// start's slot A plays at once (counted as cut; ?: what the hardware does then is not read, the model only keeps the
// two sounds from overlapping). TX enable rising sets bit 4 (I: the start's wait for it comes between the TX open and
// the TX start). The format is the TX configuration's. The driver copies one of four templates by its format record
// (0x50aab154: 0x60dbf2b4, 0x60dbf2d4, 0x60dbf2f4, 0x60dbf314; the 24-bit ones set +0x04 bit 23 and +0x30 bit 4, D; the
// record's +0 = 2 picks 0x60dbf2d4 or 0x60dbf314, 0x50aab1ba / 0x50aab18d, D, and the direct play, 0x62af27d6 = 1,
// writes that, X). Modelled: the copy task's template for a 48 kHz 16-bit stereo WAV (0x60dbf2b4: +0x04 bits 20..24 =
// 0x01, +0x30 bits 3..6 = 0x8; X, test/test_audiohw.mjs) and the direct play's (0x60dbf2d4, the AF sound's, keyed
// PRM_AUD_AFOK_VOL: +0x04 bits 20..24 = 0x01, +0x30 bits 3..6 = 0, X; the two templates differ in their words 1 and 7,
// D, what that changes in the port is ?), its samples taken as the same 16-bit stereo (I: +0x04's bits are the same),
// at 48 kHz, the rate the play path pairs with 16 bits (0x50aac51b..48: a 48000 Hz 16-bit stereo WAV, else 96000 Hz
// 24-bit; the port's clock words come from the system clock record, 0x50031c73 + 0x10b0, not from the format, D), with
// 16-bit little-endian samples, left then right (I). Another configuration at a start is UNKNOWN. A slot's bytes go to
// the lab as a block {t_ns (its start), rate, channels, bytes} that take() hands over (the lab's sink:
// src/lab/audiohw.mjs); at most BLOCKS_KEPT wait (the oldest go first, counted).
//
// The SCA (0x9bb00000) is the driver's memory-to-memory sample converter and mixer (aud_seq_sca_open / exec strings;
// its IRQ 45 handler 0x50aab51d). Its page is storage for the init's writes (+0x08 = 0x3e0, +0x3b0 = 1, +0x3b4 = 1,
// 0x50aaee3c); a start (+0xa0 bit 0 or 4) is UNKNOWN: the firmware uses it to convert a source and destination that are
// both 128-byte aligned (the converter table 0x6035e59c, 0x50aa8278) and to mix two players (0x50aa7b73), neither
// modelled. Its interrupt stays low.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const PORT_SIZE = 0x1000, SCA_SIZE = 0x1000;
export const CTRL = 0x00, RX_CTRL = 0x0c, RX_STATUS = 0x20, RX_IE = 0x2c, TX_CTRL = 0x30, TX_ADDR = [0x34, 0x38], TX_LEN = [0x3c, 0x40];
export const TX_STATUS = 0x44, TX_IE = 0x50, TX_FMT_A = 0x04;
export const C_ENABLE = 0x10, C_TX_RUN = 0x20, C_RX_RUN = 0x40, TX_ENABLE = 0x04;
export const S_DONE = [0x01, 0x02], S_READY = 0x10, S_SLOT = 0x20, ARM = [0x400, 0x800], S_BITS = 0x3f;
// the RX words a TX path never writes (the RX configuration 0x50aa9472 and its slots); +0x20 takes the ISR's write-back
const RX_WORDS = new Set([RX_CTRL, 0x10, 0x14, 0x18, 0x1c]);
const RX_ARM = 0x300, RX_B24 = 0x01000000;      // +0x20: the RX arms, and the bit the port enable writes without +0x00 bit 0
// the TX formats modelled: the configuration's bits (+0x04 bits 20..24, +0x30 bits 3..6) as the driver's template
// writes them
export const TX_FORMATS = [{ name: 's16 stereo 48 kHz', fmt04: 0x01, fmt30: 0x8, rate: 48000, channels: 2, bytes: 2 },
  { name: 's16 stereo 48 kHz (direct)', fmt04: 0x01, fmt30: 0x0, rate: 48000, channels: 2, bytes: 2 }];
export const BLOCKS_KEPT = 4096;
export const SCA_START = 0xa0, SCA_STATUS = 0x04;

export class AudioPort {
  constructor(machine, clock, intc, bus, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc; this.bus = bus;
    this.cfg = { ...cfg };
    this.reg = new Uint32Array(PORT_SIZE / 4);
    this.txStatus = 0;
    this.rxWord = 0;                 // +0x20 bit 24, the port enable's (storage)
    this.armed = [null, null];       // per slot: {addr, len} latched at its arm
    this.playing = null;             // the slot playing: {slot, t0, end, bytes}
    this.next = 0;                   // the slot the port plays next
    this.format = null;
    this.blocks = [];                // played slots not taken yet
    this.stats = { starts: 0, slots: 0, bytes: 0, underruns: 0, overruns: 0, dropped: 0, irqs: 0, readies: 0, stops: 0, cut: 0, empty: 0 };
    this.sca = new Uint32Array(SCA_SIZE / 4);
    addRegion({ base: cfg.port, size: PORT_SIZE, kind: K_MMIO, name: 'om1.audio-port',
      dev: { read: (a, w, dbg) => this.read(a - cfg.port, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.port, v, w, dbg) } });
    addRegion({ base: cfg.sca, size: SCA_SIZE, kind: K_MMIO, name: 'om1.audio-sca',
      dev: { read: (a, w, dbg) => this.scaRead(a - cfg.sca, w, dbg), write: (a, v, w, dbg) => this.scaWrite(a - cfg.sca, v, w, dbg) } });
    intc.drive(cfg.irq);
    intc.drive(cfg.sca_irq);
    clock.add({ next: () => (this.playing ? this.playing.end : Infinity), fire: (at) => this.slotEnd(at) });
  }
  unknown(name, kind, a, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: ${name} UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why}`);
    throw BUS;
  }
  portUnknown(kind, off, size, value, dbg, why) { return this.unknown('om1.audio-port', kind, this.cfg.port + off, size, value, dbg, why); }
  // IRQ audio.irq's level
  pending() { return (this.txStatus & this.reg[TX_IE >> 2]) !== 0; }
  update() { this.intc.setLine(this.cfg.irq, this.pending()); }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.portUnknown('read', off, size, 0, dbg);
    if (off === TX_STATUS) return this.txStatus;
    if (off === RX_STATUS) return this.rxWord;             // no RX: no RX status, only bit 24's storage
    return this.reg[off >> 2];
  }
  write(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3)) return this.portUnknown('write', off, size, value, dbg);
    value >>>= 0;
    if (RX_WORDS.has(off)) return this.portUnknown('write', off, size, value, dbg, ' (RX is not modelled)');
    if (off === RX_STATUS) {
      if (value & ~RX_B24) return this.portUnknown('write', off, size, value, dbg, ' (RX is not modelled)');
      this.rxWord = value;                                 // the port enable's bit 24, or the ISR's write-back of it
      return;
    }
    if (off === TX_STATUS) {
      if (value & ~(S_BITS | ARM[0] | ARM[1])) return this.portUnknown('write', off, size, value, dbg);
      this.txStatus = (this.txStatus & ~(value & S_BITS)) >>> 0;
      for (const s of [0, 1]) {
        if (!(value & ARM[s])) continue;
        const addr = this.reg[TX_ADDR[s] >> 2] << 4 >>> 0, len = this.reg[TX_LEN[s] >> 2];
        if (len === 0) { this.armed[s] = { addr, len: 0 }; continue; }      // an empty slot (the direct play's B)
        if (!this.bus.span(addr, len)) return this.portUnknown('write', off, size, value, dbg, ` (slot ${'AB'[s]} at ${hex8(addr)}, ${len} bytes: not in memory)`);
        this.armed[s] = { addr, len };
      }
      this.update();
      return;
    }
    const old = this.reg[off >> 2];
    if (off === CTRL && (value & C_RX_RUN)) return this.portUnknown('write', off, size, value, dbg, ' (RX run: RX is not modelled)');
    this.reg[off >> 2] = value;
    if (off === TX_CTRL && (value & TX_ENABLE) && !(old & TX_ENABLE)) {    // TX ready
      this.txStatus = (this.txStatus | S_READY) >>> 0;
      this.stats.readies += 1;
    }
    if (off === CTRL && (value & C_TX_RUN) && !(old & C_TX_RUN)) this.start();
    if (off === CTRL && !(value & C_TX_RUN) && (old & C_TX_RUN)) this.stop();
    this.update();
  }
  // the TX configuration's format at a start
  txFormat() {
    const f04 = (this.reg[TX_FMT_A >> 2] >>> 20) & 0x1f, f30 = (this.reg[TX_CTRL >> 2] >>> 3) & 0xf;
    return TX_FORMATS.find((f) => f.fmt04 === f04 && f.fmt30 === f30) ?? null;
  }
  start() {
    if (!(this.reg[TX_CTRL >> 2] & TX_ENABLE) || !(this.reg[CTRL >> 2] & C_ENABLE)) {
      this.m.stderr(`om-emu: om1.audio-port UNKNOWN TX start with +0x00 ${hex8(this.reg[0])} +0x30 ${hex8(this.reg[TX_CTRL >> 2])} (port or TX not enabled) pc ${hex8(ctx.pc())}`);
      throw BUS;
    }
    const f = this.txFormat();
    if (!f) {
      this.m.stderr(`om-emu: om1.audio-port UNKNOWN TX start with configuration +0x04 ${hex8(this.reg[TX_FMT_A >> 2])} +0x30 ${hex8(this.reg[TX_CTRL >> 2])}: not a format the model has pc ${hex8(ctx.pc())}`);
      throw BUS;
    }
    if (this.playing) this.cut(this.clock.t);
    this.format = { ...f };
    this.stats.starts += 1;
    this.next = 0;
    this.play(this.clock.t);
  }
  // a start while a stopped sound's last slot still plays: that slot ends at t, the frames played by then kept
  cut(t) {
    const p = this.playing, frame = this.format.channels * this.format.bytes;
    const frames = Math.min(p.bytes.length / frame, Math.floor((t - p.t0) * this.format.rate / 1e9));
    this.stats.cut += 1;
    this.playing = null;
    if (frames > 0) this.keep({ ...p, bytes: p.bytes.subarray(0, frames * frame) });
  }
  keep(p) {
    this.stats.slots += 1; this.stats.bytes += p.bytes.length;
    if (this.blocks.length >= BLOCKS_KEPT) { this.blocks.shift(); this.stats.dropped += 1; }
    this.blocks.push({ t_ns: p.t0, rate: this.format.rate, channels: this.format.channels, bytes: p.bytes });
  }
  // TX run cleared: the slot playing plays to its end, without an interrupt, and no other starts
  stop() {
    this.stats.stops += 1;
    if (this.playing) this.playing.last = true;
  }
  // the next slot starts at t, if armed: its bytes fetched now
  play(t) {
    const s = this.next, a = this.armed[s];
    if (!a) { this.stats.underruns += 1; this.playing = null; return; }
    if (a.len === 0) {                // an empty slot: TX ends here, its enable cleared (A-AUDIO-1, I)
      this.armed[s] = null; this.stats.empty += 1; this.playing = null;
      this.reg[TX_CTRL >> 2] = (this.reg[TX_CTRL >> 2] & ~TX_ENABLE) >>> 0;
      return;
    }
    const frame = this.format.channels * this.format.bytes;
    if (a.len % frame) {
      this.m.stderr(`om-emu: om1.audio-port UNKNOWN slot ${'AB'[s]} of ${a.len} bytes: not whole ${frame}-byte frames pc ${hex8(ctx.pc())}`);
      throw BUS;
    }
    const bytes = new Uint8Array(a.len);
    this.bus.read(a.addr, bytes);
    this.armed[s] = null;
    this.playing = { slot: s, t0: t, end: t + Math.round(a.len / frame * 1e9 / this.format.rate), bytes };
    this.next = 1 - s;
  }
  // the clock: the playing slot ends at `at`
  slotEnd(at) {
    const p = this.playing;
    this.keep(p);
    if (p.last) { this.playing = null; return; }
    if (this.txStatus & S_SLOT) this.stats.overruns += 1;     // the last slot's interrupt not taken yet
    this.txStatus = (this.txStatus | S_DONE[p.slot] | S_SLOT) >>> 0;
    this.stats.irqs += 1;
    this.play(at);
    this.update();
  }
  // the played slots since the last take, oldest first
  take() { const b = this.blocks; this.blocks = []; return b; }
  status() {
    return { running: (this.reg[CTRL >> 2] & C_TX_RUN) !== 0, playing: this.playing ? 'AB'[this.playing.slot] : null, format: this.format?.name ?? null,
      armed: this.armed.map((a) => a && { addr: hex8(a.addr), len: a.len }), tx_status: hex8(this.txStatus), ...this.stats };
  }
  // ---- the SCA page
  scaRead(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('om1.audio-sca', 'read', this.cfg.sca + off, size, 0, dbg);
    return this.sca[off >> 2];
  }
  scaWrite(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3)) return this.unknown('om1.audio-sca', 'write', this.cfg.sca + off, size, value, dbg);
    if (off === SCA_START && (value & 0x11)) return this.unknown('om1.audio-sca', 'write', this.cfg.sca + off, size, value, dbg, ' (an SCA start: the SCA is not modelled)');
    if (off === SCA_STATUS) return;                         // write 1 to clear (the handler 0x50aab51d); the model sets none
    this.sca[off >> 2] = value >>> 0;
  }
}
