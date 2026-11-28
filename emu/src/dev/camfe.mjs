// S-CAMFE: the camera front end's control plane as cam.c's second init programs it (docs/hle-gaps/4.2.md 4.2.5; E143,
// --take probe with the probe's cam_fe opt-in, off by default). The second init (0x50155357, USTART's call at
// 0x50024d80) writes 256 registers in 15 blocks (the sync generators 0x9b000000 and 0x9b080000, the SLVS receiver
// 0x98280000, the PRO, AE / AWB, AF, PFP and DMA units, the camera clock and control block 0x9b500000, 0x9b180000,
// 0x9b200000, 0x9b280000, 0x9b680000 and the words 0x9a801c00..0x9a801c34) and reads 16 of them (X: its trace under
// a recording stub, every access 4 bytes; D: the code at the pcs named below). What the registers do is not
// modelled: no clock, sensor timing, statistics or DMA. The device is a register file that takes exactly that program:
//   - PROGRAM below lists, by register, the values the init writes (X, recorded from the trace; the RMW registers'
//     values are those A-CAMFE-1 gives them). A write of one of them is kept; any other value is UNKNOWN, so a later
//     write that would start a unit, change a clock or a configuration (none is modelled) stops loudly
//   - A-CAMFE-1 (I): the registers the init reads before it writes them read 0 (their reset value is ?). They are the
//     read-modify-writes 0x9a801c00..0x9a801c30 (but +0x18; |= 1, |= 2, |= 4, each under the lock 0x500640d4 /
//     0x500640de, 0x501639bb..0x50163ca6), 0x9b000000 and 0x9b080000 (&= ~8, 0x501a0948, 0x501a2de0) and 0x9b000a08
//     (&= ~0x10000000, 0x5019d89f); the init branches on none of the values it reads there (D), so the reset value
//     reaches only the bits it does not touch, which nothing in the lab reads. Read again they give what was written
//   - A-CAMFE-2 (I): the clock block's +0xa08 bit 0, which the init writes 1 and then polls until it does not read 1
//     (0x5016381a..0x5016382c, D), has cleared at the next read (how long the hardware takes is ?)
//   - every other read (the clock gates 0x9b5008xx included: no code in cam.c's range reads them by address, D), a
//     width other than 4, an address outside PROGRAM and a debugger write are UNKNOWN (a bus error, printed for a CPU
//     access)
// No other interrupt line is driven: the units' status registers (IRQs 15-17, 19-22, 24-42 and 243-247, attached by
// the init) are not modelled, so none of their handlers runs (docs/hle-gaps/4.2.md 4.2.5: who would raise them, and why no
// stand-in does); IRQ 18 is SSG1's command unit's (below).
// The power-on's clock enables (docs/hle-gaps/4.2.md 4.2.6; POWER_ON below). cam_seq_power.c's power-on (cam.c's request
// 6) turns the camera clocks on before it programs anything else in these blocks (its event 0x10800000,
// 0x5019caac -> 0x5019d213), through the clock block's gate functions: each keeps a count in RAM and writes its gate's
// bit to the gate's "on" word when the count leaves 0 and to its "off" word when it returns to 0 (D: 0x5015ff11 /
// 0x629a7f37 with 0x2000 to +0x800; 0x5015fbc3 / 0x5015ff58, 0x629a7f2a, 1 to +0x800 / +0x808; 0x501602fa /
// 0x50160601, 0x629a7f50, 1 to +0x810 / +0x818, around every access of SSG1's registers; 0x501609e6, 0x629a7f3a, 1 to
// +0x870). The init's program holds those of +0x800..+0x818; the power-on adds (X: its trace; D: the pcs)
//   +0x870 = 1          0x501609f6, the gate 0x501609e6 turns on at a count of 0 (which clock is ?)
//   +0x008 = 0x700      0x5015fb32 (0x5015fb17, count 0x629a7f28; its reverse 0x5015fb69 writes 0x700 to +0x004: a
//                       set / clear pair of three enable bits, I; the init writes 0x100 here)
//   +0x9a0, +0x9e0      cam_cpm.c's 0x5016591d(0x20000010): group 1 ors its low 29 bits into both
//                       (0x50165955..0x50165962), each read first: A-CAMFE-1 again (the code branches on neither
//                       value, D); then the update strobe +0xa08 = 1 and its poll (0x50165b31, A-CAMFE-2's word)
// They are enables with no reader in the lab, so the register file takes them.
// SSG1's command unit (docs/hle-gaps/4.2.md 4.2.6 and its 2026-11-22 subsection; SSG below), the unit that sends the
// sensor its serial commands (that role I). Its driver 0x5019deed..0x5019e47c (D) and the SSG's requests 7 / 8
// (0x5019d91a, 0x5019dacb -> 0x5019dc8f) use, of SSG1 at 0x9b000000:
//   +0x000      bit 6 cleared before a start (0x5019e076) and set again when a queue empties (0x5019e2e7,
//               0x5019e418): the init's word (A-CAMFE-1), which now takes 0x40 beside 0
//   +0x004      status, write 1 to clear (IRQ 18's handler 0x5019e218 reads it, ands +0x014 and writes the result
//               back): bit 21 a mode-0 batch's end (0x5019e279), bit 20 a mode-1 entry's end (0x5019e34b), bit 22
//               a one-shot call (0x5019e47c; the model never sets it). IRQ 18 is high while status & +0x014 is not 0
//   +0x014      the interrupt mask the init writes (0x700000), read by the handler
//   +0x60c      read before and between the unit's accesses into 0x62a25ee4, which nothing reads (D: the word's ten
//               references are stores); reads 0 (A-CAMFE-4)
//   +0xa00      the start: count << 8 | 1 (count 1..120 entries of the command RAM, 0x5019e167..0x5019e171) starts
//               a run; 0 after an end (0x5019e287, 0x5019e38f). A run ends after RUN_NS + ENTRY_NS per entry of lab
//               time (A-CAMFE-3), with status bit 21 when +0xa04 bit 8 is set (a mode-0 batch) and bit 20 when it is
//               clear (a mode-1 entry, count 1). Mode 0 and mode 1 both write 0x101 for one entry; what tells them
//               apart in the unit is not in the code: the model takes +0xa04 bit 8, which mode 1 sets from its table
//               word 0x62a254e0 (0x5019e1f4) and which the driver sets again when the mode-1 queue empties
//               (0x5019e3ef..0x5019e3fa), while the power-on's +0xa04 = 0x2100 has it set (I, part of A-CAMFE-3)
//   +0xa04..+0xa64  the unit's configuration (+0xa04, +0xa08, +0xa0c, +0xa14, +0xa18, +0xa1c, +0xa20, +0xa24 and
//               the ten words +0xa40..+0xa64, 0x5019dc8f by the parameter table's flags; +0xa14 by 0x5019dc77, the
//               enqueue's read 0x5019e01e and the handler's restore 0x5019e31b / 0x5019e44c): storage, a read
//               before the first write UNKNOWN (+0xa08 keeps A-CAMFE-1). What their values mean (the run's timing,
//               +0xa18 / +0xa1c, I) is not modelled
//   +0xa10      the sensor's reply to a mode-1 entry (0x5019e366): UNKNOWN, as nothing in the lab answers for the
//               sensor
//   +0x3000..+0x33bf  the command RAM, 120 entries of two words (0x5019e100..0x5019e10f, 0x5019e1b0..0x5019e1bd):
//               write-only storage; a run's entries are kept in runs (the newest RUNS_KEPT)
// A start while a run is in progress, or with a count of 0 or above 120, is UNKNOWN.
// Built on demand by the probe (src/lab/take.mjs H-CAMINIT2), not by the machine.
import { BUS, K_MMIO, addRegion, findRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// [64 KiB block base, [[offset, value...]...]]: the second init's writes (X, 2026-11-10)
export const PROGRAM = [
  [0x98280000, [[0x198, 0x1]]],
  [0x9A800000, [[0x1C00, 0x1, 0x3, 0x7], [0x1C04, 0x1, 0x3, 0x7], [0x1C08, 0x1, 0x3, 0x7], [0x1C0C, 0x1, 0x3, 0x7],
    [0x1C10, 0x1, 0x3, 0x7], [0x1C14, 0x1, 0x3, 0x7], [0x1C18, 0x1], [0x1C1C, 0x1, 0x3, 0x7],
    [0x1C20, 0x1, 0x3, 0x7], [0x1C24, 0x1, 0x3, 0x7], [0x1C28, 0x1, 0x3, 0x7], [0x1C2C, 0x1, 0x3, 0x7],
    [0x1C30, 0x1, 0x3, 0x7], [0x1C34, 0x1]]],
  [0x9B000000, [[0x0, 0x0], [0x14, 0x700000], [0xA08, 0x0]]],
  [0x9B080000, [[0x0, 0x0]]],
  [0x9B180000, [[0x0, 0x0], [0x8, 0x2], [0x10, 0x11], [0x20, 0xFFFF], [0x28, 0x8A0000], [0x2C, 0x8A0000],
    [0x50, 0x33], [0x54, 0x1211100F], [0x58, 0x1]]],
  [0x9B200000, [[0x0, 0x0]]],
  [0x9B280000, [[0x0, 0x0], [0x10, 0x0], [0x20, 0x0], [0x28, 0x0]]],
  [0x9B300000, [[0x0, 0x0], [0x2C, 0x11], [0x320, 0x33], [0x324, 0x3A393837], [0x328, 0x3E3D3C3B],
    [0x32C, 0x4241403F], [0x800, 0x0], [0x82C, 0x11], [0xB20, 0x33], [0xB24, 0x3A454443], [0xB28, 0x3E3D3C3B],
    [0xB2C, 0x4241403F], [0x1000, 0x0], [0x102C, 0x11], [0x1234, 0x460033], [0x1800, 0x0], [0x182C, 0x11],
    [0x1A34, 0x470033], [0x2000, 0x0], [0x202C, 0x11], [0x2800, 0x0], [0x282C, 0x11], [0x3000, 0x0], [0x302C, 0x11],
    [0x3800, 0x0], [0x382C, 0x11], [0x4000, 0x0], [0x402C, 0x11], [0x4800, 0x0], [0x482C, 0x11]]],
  [0x9B380000, [[0x0, 0x0], [0x14, 0x11], [0x24, 0x494833], [0x1000, 0x0], [0x1014, 0x11], [0x1024, 0x4B4A33],
    [0x2000, 0x0], [0x2014, 0x11], [0x2024, 0x4C33], [0x2800, 0x0], [0x2814, 0x11], [0x2824, 0x4E4D33],
    [0x3000, 0x0], [0x3014, 0x11], [0x3024, 0x504F33], [0x3800, 0x0], [0x3814, 0x11], [0x3824, 0x525133],
    [0x4000, 0x0], [0x4014, 0x0], [0x4024, 0x5333]]],
  [0x9B400000, [[0x0, 0x0], [0x80, 0x11]]],
  [0x9B480000, [[0x0, 0x0], [0x54, 0x33], [0x58, 0x65646362], [0x5C, 0x69686766], [0x60, 0x6D6C6B6A],
    [0x64, 0x71706F6E], [0x68, 0x747372], [0x88, 0x101]]],
  [0x9B500000, [[0x0, 0x0], [0x8, 0x100], [0xC, 0x3], [0x10, 0x3], [0x20, 0x703F], [0x24, 0x103F], [0x180, 0x0],
    [0x184, 0x0], [0x348, 0x0], [0x358, 0x0], [0x380, 0x10000], [0x384, 0x0], [0x498, 0x0], [0x49C, 0x0],
    [0x4A0, 0x0], [0x4A4, 0x0], [0x4A8, 0x0], [0x4D8, 0x0], [0x4DC, 0x0], [0x4E0, 0x0], [0x4E4, 0x0], [0x4E8, 0x0],
    [0x518, 0x0], [0x51C, 0x0], [0x520, 0x0], [0x524, 0x0], [0x528, 0x0], [0x558, 0x0], [0x55C, 0x0], [0x560, 0x0],
    [0x564, 0x0], [0x568, 0x0], [0x598, 0x0], [0x59C, 0x0], [0x5A0, 0x0], [0x5A4, 0x0], [0x5A8, 0x0], [0x5D8, 0x0],
    [0x5DC, 0x0], [0x5E0, 0x0], [0x5E4, 0x0], [0x5E8, 0x0], [0x604, 0x0], [0x608, 0x0], [0x60C, 0x0], [0x610, 0x0],
    [0x614, 0x0], [0x800, 0x2000, 0x1, 0x2, 0x8, 0x10, 0x20, 0x400, 0x800, 0x1000, 0x80, 0x100, 0x200, 0x40],
    [0x808, 0x2000, 0x1, 0x2, 0x8, 0x10, 0x20, 0x400, 0x800, 0x1000, 0x80, 0x100, 0x200, 0x40],
    [0x810, 0x1, 0x2, 0x8, 0x10, 0x20, 0x400, 0x800, 0x80, 0x100, 0x200, 0x40],
    [0x818, 0x1, 0x2, 0x8, 0x10, 0x20, 0x400, 0x800, 0x80, 0x100, 0x200, 0x40], [0x820, 0xFFF], [0x828, 0x0],
    [0x830, 0x0], [0x838, 0xFFF], [0x850, 0x8, 0x400, 0x800, 0x1000], [0x858, 0x400, 0x800], [0x880, 0x2],
    [0x888, 0x2], [0x890, 0x1, 0x2], [0x898, 0x1, 0x2], [0x8C0, 0x1FE0FE1F], [0x8C4, 0x7FF003F], [0x8C8, 0x0],
    [0x8CC, 0x0], [0x8D0, 0x1FFFFFF], [0x8D8, 0x0], [0x8E8, 0x0], [0x8EC, 0x0], [0x8F0, 0x1FE0FE1F],
    [0x8F4, 0x7FF003F], [0x8F8, 0x0], [0x900, 0x1FFFFFF], [0x918, 0x7FFFFF], [0x920, 0x0], [0x928, 0x7FC000],
    [0x930, 0x3FFF], [0x940, 0x3], [0x944, 0x0], [0x948, 0x0], [0x94C, 0x3], [0x950, 0x1], [0x954, 0x0],
    [0x958, 0x1], [0x95C, 0x0], [0x980, 0xFFFFFF], [0x984, 0x7FFFF], [0x988, 0xFFFFFFF], [0x98C, 0x7FFFFFF],
    [0x990, 0x1FFFFFFF], [0x994, 0x3FFF], [0x998, 0x3FFF], [0x9C0, 0xFFFFFF], [0x9C4, 0x7FFFF], [0x9C8, 0xFFFFFFF],
    [0x9CC, 0x7FFFFFF], [0x9D0, 0x1FFFFFFF], [0x9D4, 0x3FFF], [0x9D8, 0x3FFF], [0xA00, 0x23], [0xA04, 0x0],
    [0xA08, 0x1]]],
  [0x9B580000, [[0x4, 0x1F], [0xC, 0x1F], [0x14, 0x1F], [0x1C, 0x1F], [0x24, 0x1FF], [0x2C, 0x1FF], [0x34, 0x1],
    [0x3C, 0x1], [0x204, 0x1], [0x20C, 0x1], [0x404, 0x1], [0x40C, 0x1], [0x604, 0x1], [0x60C, 0x1], [0x804, 0x1],
    [0x80C, 0x1], [0xA04, 0x1], [0xA0C, 0x1], [0xC04, 0x1], [0xC0C, 0x1], [0xE04, 0x1], [0xE0C, 0x1], [0x1004, 0x1],
    [0x100C, 0x1], [0x1204, 0x1], [0x120C, 0x1], [0x1404, 0x1], [0x140C, 0x1], [0x1604, 0x1], [0x160C, 0x1],
    [0x1804, 0x1], [0x180C, 0x1], [0x1A04, 0x1], [0x1A0C, 0x1], [0x1C04, 0x1], [0x1C0C, 0x1]]],
  [0x9B600000, [[0x4, 0x3FFFF], [0xC, 0x3FFFF], [0x14, 0x1], [0x1C, 0x1], [0x204, 0x1], [0x20C, 0x1], [0x404, 0x1],
    [0x40C, 0x1], [0x604, 0x1], [0x60C, 0x1], [0x804, 0x1], [0x80C, 0x1], [0xA04, 0x1], [0xA0C, 0x1], [0xC04, 0x1],
    [0xC0C, 0x1], [0xE04, 0x1], [0xE0C, 0x1], [0x1004, 0x1], [0x100C, 0x1], [0x1204, 0x1], [0x120C, 0x1]]],
  [0x9B680000, [[0x0, 0x0], [0x8, 0x1]]],
];
// A-CAMFE-1's read-before-write registers, A-CAMFE-2's poll word
export const RMW = [0x9A801C00, 0x9A801C04, 0x9A801C08, 0x9A801C0C, 0x9A801C10, 0x9A801C14, 0x9A801C1C, 0x9A801C20, 0x9A801C24,
  0x9A801C28, 0x9A801C2C, 0x9A801C30, 0x9B000000, 0x9B080000, 0x9B000A08];
export const POLL = 0x9B500A08;
// the values cam_seq_power.c's power-on writes to the clock block beyond the init's (the header's paragraph), and
// its two read-before-write registers (A-CAMFE-1)
export const POWER_ON = [[0x9B500000, [[0x8, 0x700], [0x870, 0x1], [0x9A0, 0x10], [0x9E0, 0x10]]]];
export const POWER_RMW = [0x9B5009A0, 0x9B5009E0];
// SSG1's command unit (the header's paragraph)
export const SSG = {
  base: 0x9B000000, irq: 18, ctrl: 0x9B000000, status: 0x9B000004, mask: 0x9B000014, dummy: 0x9B00060C,
  start: 0x9B000A00, mode: 0x9B000A04, reply: 0x9B000A10, ram: 0x9B003000, entries: 120,
  // the configuration words the driver writes (storage)
  config: [0xA04, 0xA08, 0xA0C, 0xA14, 0xA18, 0xA1C, 0xA20, 0xA24, 0xA40, 0xA44, 0xA48, 0xA4C, 0xA50, 0xA54, 0xA58, 0xA5C, 0xA60, 0xA64].map((o) => 0x9B000000 + o),
  ctrl_values: [0x0, 0x40],   // +0x000: the init's 0 and the driver's bit 6
  batch_end: 1 << 21, entry_end: 1 << 20, batch_mode: 0x100,
};
// A-CAMFE-3 (I): a run of n entries ends RUN_NS + n * ENTRY_NS of lab time after its start (the unit's serial rate
// and +0xa18 / +0xa1c's meaning are not known; the driver waits for IRQ 18 with no timeout of its own, D 0x5019deed..
// 0x5019e47c, so only the lab's pace depends on it)
export const RUN_NS = 10e3, ENTRY_NS = 1e3;
// the command runs whose entries are kept (the newest)
export const RUNS_KEPT = 64;
// SSG1's command unit's words, named in a refusal
const SENSOR_SERIAL = (a) => (a >= 0x9B000A00 && a < 0x9B000A68) || a === 0x9B00060C || (a >= 0x9B003000 && a < 0x9B004000);
const REFUSED = {
  serial: 'SSG1\'s command unit, the sensor\'s serial channel',
  reply: 'SSG1\'s command unit\'s reply +0xa10: what the sensor answers is not modelled',
  outside: 'not one the second init or the power-on\'s clock enables touch',
  value: 'a value neither the second init nor the power-on\'s clock enables write',
  write_only: 'a register the firmware only writes here',
};

export class CamFe {
  constructor(machine) {
    this.m = machine;
    this.allowed = new Map();     // address -> Set of the values the program writes
    for (const [base, regs] of PROGRAM) for (const [off, ...vs] of regs) this.allowed.set((base + off) >>> 0, new Set(vs.map((v) => v >>> 0)));
    // the power-on's clock enables: address -> Set of values, beside the init's (kept apart: the init's check counts
    // the registers of its own program)
    this.power = new Map();
    for (const [base, regs] of POWER_ON) {
      for (const [off, ...vs] of regs) this.power.set((base + off) >>> 0, new Set(vs.map((v) => v >>> 0)));
    }
    this.regs = new Map();        // address -> the value last written
    this.rmw = new Set([...RMW, ...POWER_RMW]);
    this.writes = 0; this.reads = 0;
    // SSG1's command unit: its status, the run in progress (due at that lab ns) and the command RAM
    this.clock = machine.devices.clock; this.intc = machine.devices.intc;
    this.ssg = { status: 0, due: Infinity, run: null, ram: new Uint32Array(SSG.entries * 2), runs: [], starts: 0, ends: 0, dropped: 0 };
    this.ssg_config = new Set(SSG.config);
    // one region per block, from the page of its first register to the end of the page of its last; a block that
    // overlaps a region the machine already has is refused
    for (const [base, regs] of PROGRAM) {
      const offs = regs.map(([off]) => off), lo = base + (Math.min(...offs) & ~0xFFF), hi = base + ((Math.max(...offs) + 4 + 0xFFF) & ~0xFFF);
      for (let a = lo; a < hi; a += 0x1000) if (findRegion(a) !== null) throw new Error(`S-CAMFE: ${hex8(a)} already has the region ${findRegion(a).name}`);
      addRegion({ base: lo, size: hi - lo, kind: K_MMIO, name: 'om1.camfe',
        dev: { read: (a, w, dbg) => this.read(a >>> 0, w, dbg), write: (a, v, w, dbg) => this.write(a >>> 0, v, w, dbg) } });
    }
    // the command RAM's page
    if (findRegion(SSG.ram) !== null) throw new Error(`S-CAMFE: ${hex8(SSG.ram)} already has the region ${findRegion(SSG.ram).name}`);
    addRegion({ base: SSG.ram, size: 0x1000, kind: K_MMIO, name: 'om1.camfe',
      dev: { read: (a, w, dbg) => this.read(a >>> 0, w, dbg), write: (a, v, w, dbg) => this.write(a >>> 0, v, w, dbg) } });
    this.intc.drive(SSG.irq);
    this.clock.add({ next: () => this.ssg.due, fire: (at) => this.ssg_end(at) });
  }
  // IRQ 18: high while SSG1's status and the mask +0x014 share a bit
  ssg_update() { this.intc.setLine(SSG.irq, (this.ssg.status & (this.regs.get(SSG.mask) ?? 0)) !== 0); }
  // a write of +0xa00: 0 after an end, count << 8 | 1 a start (A-CAMFE-3)
  ssg_start(a, value, size) {
    const g = this.ssg;
    if (value === 0) {
      if (g.due !== Infinity) return this.unknown('write', a, size, value, false, `${REFUSED.serial}: a stop while a run is in progress`);
      this.regs.set(a, 0); this.writes++; return;
    }
    const count = value >>> 8;
    if ((value & 0xFF) !== 1 || count < 1 || count > SSG.entries) return this.unknown('write', a, size, value, false, `${REFUSED.serial}: a start of count << 8 | 1 with 1..${SSG.entries} entries`);
    if (g.due !== Infinity) return this.unknown('write', a, size, value, false, `${REFUSED.serial}: a start while a run is in progress`);
    const mode = this.regs.get(SSG.mode);
    if (mode === undefined) return this.unknown('write', a, size, value, false, `${REFUSED.serial}: a start before +0xa04 is written`);
    const batch = (mode & SSG.batch_mode) !== 0;
    if (!batch && count !== 1) return this.unknown('write', a, size, value, false, `${REFUSED.serial}: a mode-1 start (+0xa04 bit 8 clear) of ${count} entries`);
    this.regs.set(a, value); this.writes++;
    g.starts++;
    g.run = { n: g.starts, t_ns: this.clock.t, count, mode: batch ? 0 : 1, pc: ctx.pc(), entries: Array.from(g.ram.subarray(0, 2 * count)) };
    g.runs.push(g.run);
    if (g.runs.length > RUNS_KEPT) { g.runs.shift(); g.dropped++; }
    g.due = this.clock.t + RUN_NS + count * ENTRY_NS;
  }
  // the lab clock: the run in progress ends (A-CAMFE-3)
  ssg_end(at) {
    const g = this.ssg;
    g.due = Infinity; g.ends++;
    g.run.end_ns = at;
    g.status = (g.status | (g.run.mode === 0 ? SSG.batch_end : SSG.entry_end)) >>> 0;
    g.run = null;
    this.ssg_update();
  }
  // SSG1's command unit's words, or undefined for an address that is not one of them
  ssg_read(a, size, dbg) {
    if (a === SSG.status) { if (!dbg) this.reads++; return this.ssg.status; }
    if (a === SSG.mask && this.regs.has(a)) { if (!dbg) this.reads++; return this.regs.get(a); }
    if (a === SSG.dummy) { if (!dbg) this.reads++; return 0; }                                   // A-CAMFE-4
    if (a === SSG.reply) return this.unknown('read', a, size, 0, dbg, REFUSED.reply);
    if (this.ssg_config.has(a) && !this.rmw.has(a)) {
      if (!this.regs.has(a)) return this.unknown('read', a, size, 0, dbg, `${REFUSED.serial}: a read before the first write`);
      if (!dbg) this.reads++;
      return this.regs.get(a);
    }
    if (a >= SSG.ram && a < SSG.ram + 0x1000) return this.unknown('read', a, size, 0, dbg, `${REFUSED.serial}: the command RAM is written only`);
    return undefined;
  }
  ssg_write(a, value, size) {
    if (a === SSG.status) { this.ssg.status = (this.ssg.status & ~value) >>> 0; this.writes++; this.ssg_update(); return true; }
    if (a === SSG.start) { this.ssg_start(a, value, size); return true; }
    if (a === SSG.ctrl && SSG.ctrl_values.includes(value)) { this.regs.set(a, value); this.writes++; return true; }
    if (this.ssg_config.has(a)) { this.regs.set(a, value); this.writes++; return true; }
    if (a >= SSG.ram && a < SSG.ram + 0x1000) {
      if (a >= SSG.ram + 8 * SSG.entries) return this.unknown('write', a, size, value, false, `${REFUSED.serial}: past the command RAM's ${SSG.entries} entries`);
      this.ssg.ram[(a - SSG.ram) >> 2] = value; this.writes++; return true;
    }
    return false;
  }
  unknown(kind, a, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: om1.camfe UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why ? ` (${why})` : ''}`);
    throw BUS;
  }
  read(a, size, dbg) {
    if (size !== 4 || (a & 3)) return this.unknown('read', a, size, 0, dbg);
    const sv = this.ssg_read(a, size, dbg);
    if (sv !== undefined) return sv;
    // A-CAMFE-2: the start bit has cleared
    if (a === POLL) { if (!dbg) this.reads++; return (this.regs.get(a) ?? 0) & ~1; }
    if (!this.rmw.has(a)) {
      const known = this.allowed.has(a) || this.power.has(a);
      return this.unknown('read', a, size, 0, dbg, known && !SENSOR_SERIAL(a) ? REFUSED.write_only : this.outside(a));
    }
    if (!dbg) this.reads++;
    // A-CAMFE-1: 0 before the first write, then what was written
    return this.regs.get(a) ?? 0;
  }
  write(a, value, size, dbg) {
    value >>>= 0;
    if (dbg || size !== 4 || (a & 3)) return this.unknown('write', a, size, value, dbg);
    if (this.ssg_write(a, value, size)) return;
    const vs = this.allowed.get(a), pv = this.power.get(a);
    if (!vs && !pv) return this.unknown('write', a, size, value, dbg, this.outside(a));
    if (!vs?.has(value) && !pv?.has(value)) {
      return this.unknown('write', a, size, value, dbg, SENSOR_SERIAL(a) ? `${REFUSED.serial}: ${REFUSED.value}` : REFUSED.value);
    }
    this.regs.set(a, value);
    this.writes++;
    if (a === SSG.mask) this.ssg_update();
  }
  // why an address outside the two programs is refused
  outside(a) { return SENSOR_SERIAL(a) ? `${REFUSED.serial}: a word its driver does not use` : REFUSED.outside; }
}
