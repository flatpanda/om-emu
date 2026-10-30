// The board of the model this copy of the lab runs (src/fw/model.mjs): where the on-chip SRAM and the hardware
// semaphores sit, the interrupt controller's banks, IRQ count and register offsets, the timer block's channels and
// register layout, the SCPU interface's register offsets, the HDMI port's registers, the flash-library window, the
// interrupt vectors' page, the MMIO pages the lab's stub allows and the SD host's (sd). The machine (src/machine.mjs), the devices (src/dev/) and the lab's views of
// them read BOARD.
//
// A model's board is its family's (FAMILIES, named by its MODELS entry's board.family), then the facts bin/port.mjs
// reads from its firmware (src/fw/ports.mjs FACTS[code].board, by the rules of src/fw/facts.mjs), then the
// differences its MODELS entry gives by hand, each with its evidence; the sub-objects (isc, intc, timer, vsc, engine,
// scpu, hdmi) merge one level deep, so a model can give a single field such as intc.irqs. A fact both read from the
// firmware and given by hand is refused. A family fact no body has been read for is UNKNOWN: reading it throws, so a
// device that needs it fails where it first does instead of running on another board's value.
import { MODELS } from './models.mjs';
import { FACTS } from './ports.mjs';
import { MODEL } from './model.mjs';

export const UNKNOWN = Symbol('unknown board fact');

export const FAMILIES = {
  // E143 (OM-1), and E146/E147 on its board. Its reset head copies by another convention than the flash-copy rule
  // reads (0x500001ba: a0 the DRAM destination, a1 the source in the flash view, d1 = 0x10200, D): its facts are
  // given here.
  E143: {
    sram: 0x97F00000, sram_size: 0x2000,
    isc: { base: 0x97000000, stride: 0x40, groups: 8 },
    intc: {
      banks: [0x99200000, 0x99300000, 0x99B00000, 0x99B80000], irqs: 356,
      presented: 0x700, ipi_set: 0x808, ipi_clear: 0x80c, kick: 0x810, ctl: 0x884,
      // off: the word the power-off's 0x50039def writes 0x100 into in each of the four banks before its RAM log's
      // save (0x50039df2..0x50039e04, then a 10 ms dly_tsk; called by 0x518f7381, D); its meaning is ? (I: the
      // other CPUs' interrupts stopped), so the lab stores it
      off: 0x800,
      irq_ipi: 324, irq_osd_engine: 310, irq_vsc0: 46,
    },
    // groups: [first channel, last channel, IE offset, status offset, irq or null (one IRQ per channel: irq_base + n)]
    timer: {
      channels: 34, reload: 0x100, counter: 0x200, us_channel: 33, us_reload: 0x7fffffff, prescaler: 575,
      groups: [[1, 32, 0x300, 0x400, null]], irq_base: 137, status_readable: false,
      // the boot's use of them (display.mjs H-BOOTTIME, H-TIMER): the kernel tick channels the tick init starts, the
      // 2 ms software tick's channel, the channels the hardware-timer table covers [first, end), its entries
      kernel_ticks: [1, 2, 3, 4], soft_tick: 21, hw_channels: [16, 32], hw_entries: 32,
    },
    // the VSC display compositor (src/dev/vsc.mjs): kind 1 is E143's (3 channels of 0x8000, the mirror bank at
    // +0x2000, palettes and LUT, the output block as channel 3); the name tables' entry counts [channel, output]
    vsc: {
      kind: 1, base: 0x9BB80000, size: 0x20000, channels: 3, stride: 0x8000, reg_end: 0xE84, names: [503, 115],
      regs: { INTEN1: 0x00C, INTST1: 0x010, SYNC2: 0x728, SYNC4: 0x730, MONI3: 0xE80 }, irq_mask: 3,
      // the channel register blocks [first, last] the compositor (src/dev/vsccompose.mjs A21) composes without, noting
      // their values as assumed instead of checking them: none on E143, whose composite checks every feature register
      unapplied: [],
    },
    // the OSD draw engine (src/dev/engine.mjs): its base, the guard slots the lab's debug window holds, the LUT
    // registers (0x5c..0x6c, 0x88..0xff) and the list base register's unit (E143: 16-byte units)
    engine: { base: 0x9BC00000, guards: 8, lut: true, list_shift: 4 },
    // the SCPU interface (src/dev/scpu.mjs): its command word, its clock [seconds, phase], whether the lab lets the
    // clock tick with lab time (a lab choice; plain storage that stands still otherwise), its plain storage and its
    // event word, the first of its port words, their count and the IRQ they drive (the SCPU init 0x5004dc55 clears
    // 0x98 with 127 and attaches IRQ 320 to the handler 0x5004e1fd that reads it; the port byte reader 0x5004df3f
    // reads bit 31 of 0xa0..0xb8, D; the same on E146 and E147, D: their inits and readers); message: the port whose
    // level is the sub-CPU's message line, PC2 of the sub-CPU (PER_SCPU's IRQ 320 callback 0x5005c8d9 acts on event
    // bit 3 with port bit 3 low and polls the sub-CPU then, D; the sub-CPU drives PC2 low to post a message,
    // 0x8012c42, and high when it answers the poll, 0x8012e9e, D; docs/om1-scpu-spec.md 3.1)
    // storage 0x90 and 0x9c: the power-off's words (docs/hle-gaps.md 4.7.4, D): 0x5004e50a writes 0xffffffff to 0x90
    // (the wake / reset cause word, I) with its commit; 0x5004dffc writes 1 << n to 0x9c and 0x5004e02c reads its bit
    // n, and 0x5004dfd0 writes 127 there and commits, the sequence's last write (its meaning, a power cut, is I); no
    // reader of 0x90 runs in the lab
    scpu: {
      command: 0xf4, clock: [0xe8, 0xec], ticks: true, storage: [[0x00, 0x00], [0x08, 0x3c], [0x90, 0x90], [0x9c, 0x9c]],
      events: { pending: 0x98, ports: 0xa0, count: 7, irq: 320, message: 3 },
    },
    // The MN's GIO pins of the sub-CPU link (src/dev/linkpins.mjs, src/lab/scpulink.mjs; docs/om1-scpu-spec.md 3.1):
    // PER_SCPU's pin numbers (ready 102: its edge callbacks 0x5005c989 / 0x5005c9dc; request 103: 0x5005b72d(103, 0);
    // reset 107: the pulses at 0x5005cec5 and 0x5005b9ab, D) and each pin's GIO words from the driver's tables: the
    // pin word (0x60025ff8)[pin] (+0 the level in bit 4, the read 0x50002a35, and the output in bit 0, the write
    // 0x500521ff; +4 the configuration, 0x500520f4; +8 the word the handler registration 0x5005229f writes), and pin
    // 102's interrupt record (slot (0x60026788)[102] = 191, record 0x600268f4 + 32 x 191: a dedicated slot (+4 = 1)
    // with IRQ 119 and handler 0x50052a44, status and enable words, the type-0 bit 1 and the type-1 bit 2), D; E146 and
    // E147: the same pins (their PER_SCPU inits), words, slot, record and IRQ (their tables), D
    scpu_link: {
      ready: { pin: 102, word: 0x9B881B80, status: 0x9B883060, enable: 0x9B8831A0, bits: [1, 2], irq: 119 },
      request: { pin: 103, word: 0x9B881BC0 },
      reset: { pin: 107, word: 0x9B881CC0 },
    },
    // the HDMI port (src/dev/hdmi.mjs, built only with the machine's hdmi option; docs/hle-gaps.md 4.9): the
    // transmitter's byte registers (the driver's register reader 0x501d55d8 and writer 0x501d5645), the writer's lane
    // word, IRQ 239 (the HDMI init 0x501d15e8 attaches 0x501d508a at level 5); the hot-plug pin 77's level word and
    // bit (the pin read 0x50002a35: bit 4 of the word (0x60025ff8)[77]) and its GIO record (slot 124 of the slot table
    // 0x60026788, record 0x600268f4 + 32 x 124): its group's status and enable words, the pin's type-0 bit and the
    // group's IRQ 109 (D; E146 and E147: the same words, bit and IRQ in their tables, D)
    hdmi: { tx: 0x99C07000, lanes: 0x99C08000, irq: 239, hpd: { level: 0x9B881540, level_bit: 0x10, status: 0x9B883038, enable: 0x9B883178, bit: 0x40, irq: 109 } },
    // the lens mount (src/dev/lensssc.mjs; docs/hle-gaps.md 4.4.1, 4.4.2): the lens serial controller's registers
    // (every operand of LENS_SSC 0x502c0ea5..0x502c2193) and its IRQ 14 (the open 0x502c0e4e attaches 0x502c12c0 at
    // level 3); the units the lens path writes a few words of: the FCS unit, whose two words the open clears
    // (0x502c0e99, 0x502c0e9f; the unit's extent from FCS's operands, 0x50957687..0x5095799e), and the mechanism unit
    // (0x9b900000, 271 registers, docs/hle-gaps.md section 7), whose power-on the lens attach calls (0x5010b957,
    // 0x5010b978, 0x5010b9bb, 0x5010b9e8, 0x5010ba15); the lens-detect pin 172 (read by 0x502c0b0a, its word
    // (0x60025ff8)[172], the level in bit 4 as every GIO pin's, 0x50002a35). E143's (D); E146 and E147 sit on the
    // same board, their lens drivers not read (X: a scan of their main blocks finds the controller's base 7 and 9 times
    // from 0x502d8696 and 0x502e9f56, as E143's 8 from 0x502c0ea7, and the trigger words twice each; the devices are
    // passive until a lab connects a lens, which only E143's does)
    lens: {
      ssc: 0x9B980000, irq: 14, detect: { pin: 172, word: 0x9B882C80 },
      units: [{ name: 'fcs', base: 0x9BF00000, size: 0x770, words: [0x000, 0x068] },
        { name: 'mec', base: 0x9B900000, size: 0x1000, words: [0x000, 0x004, 0x020, 0x024, 0x028] }],
    },
    // the deferred-call triggers (src/dev/dpc.mjs): the six words the posts write 1 to and the IRQs their init
    // 0x50050279 attaches (53 and 54 on CPUs 0..3 through 0x50053fcd, 55..58 on the calling core through 0x50053f76;
    // the words 0x9b880044..0x9b880058, D; src/fw/facts.mjs deferredCalls reads the same on E143, E146 and E147, X)
    dpc: { triggers: 0x9B880044, irqs: [53, 54, 55, 56, 57, 58] },
    core_byte: 0x97F00254,
    // the interrupt vectors' page, the high half of the level slots' run-time addresses: E143's vector init loads
    // 0x60030020..0x60030080 (0x5000f09b, D; src/fw/facts.mjs vectorPage, which reads the same on E146 and E147)
    vector_page: 0x60030000,
    // the DRAM's size (src/machine.mjs): 384 MiB, where the GUI's first OSD bank ends (0xb8000000, src/fw/facts.mjs
    // dramSize, which reads the same on E146 and E147)
    dram_size: 384 << 20,
    // the flash library's run-time window: null (E143 runs it from its image) or {base, size, image: [file offset,
    // length, at]} (RAM holding that part of the main block at base + at)
    library: null,
    // the reset head's copies of image data past the image, rows [file offset, length, run-time address] the image
    // grows by (src/fw/expand.mjs): none; the lab runs E143's block as it is (its head's copies, 0x5000013d..
    // 0x500001dc, are not read into rows)
    preload: [],
    // the lab's own scratch RAM (stubs, stacks, call frames: E143 0xA2021000..0xA2340000, the uncached DRAM after the
    // image): null (it stays in the DRAM) or {from, size, base}, a lab RAM region at base standing for E143's
    // from..from+size, for a model whose firmware uses that DRAM (bin/port.mjs moves the lab's literals there)
    scratch: null,
    // which rule of src/fw/facts.mjs reads the reset head's copies (resetHead): none for this family
    reset_head: null,
    // the MMIO pages of devices the lab does not model that its stub page allows (src/lab/display.mjs H-STUB), and
    // [address, value] the stub presets: E143's, as the lab has listed them since before the board families
    stub_pages: [0x98200000, 0x98380000, 0x98480000, 0x98800000, 0x99380000, 0x99800000, 0x99C08000, 0x9A720000,
      0x9A900000, 0x9A901000, 0x9A902000, 0x9A903000, 0x9B881000, 0x9B882000, 0x9B883000, 0x9BA00000],
    stub_presets: [[0x9A900474, 0x15], [0x9A902C80, 0x1], [0x9A903480, 0x1], [0x9A9004B0, 0xA94], [0x9A9014B0, 0xA94]],
    // whether the lab answers the display code's per-frame wait and software-timer sleep with its stand-ins
    // (src/lab/menu.mjs S-FRAMEWAIT, S-TIMERSLEEP, at the facts display.frame_wait and timer_sleep): not on this
    // board. E143's lab runs both natively (its start reaches neither, X), and the frame wait's stand-in needs the TFT
    // and the EVF on one VSC channel, which kind 1 does not have (TFT 2, EVF 1); E146 and E147 run E143's path
    display_wait_stand_ins: false,
    // the SD host (src/lab/storage.mjs S-SDHOST): pages [address, size] the lab's stub keeps what the firmware writes
    // in, and idle [address, value] its presets. The two ports' register pages (port 0 0x99000000, port 1 0x9a300000,
    // from the table 0x6004773c the base getter 0x5002539c reads; the SD core at +0x2000, D) and the GPIO page of the
    // init's card pins and power (0x9b880000, 0x508b0121, D); the SD core's SD_INFO2 (+0x3c) reads its bit 13 set,
    // which the clock setter 0x508acf2b polls before it writes the clock (TMIO's SCLKDIVEN, the bus idle, I). E143's
    // addresses; E146 and E147 run on them (X: their cards mount)
    sd: {
      pages: [[0x99000000, 0x10000], [0x9A300000, 0x10000], [0x9B880000, 0x1000]],
      idle: [[0x9900203C, 0x2000], [0x9A30203C, 0x2000]],
    },
  },
  // E144 (OM-5). D: read from the E144 code (the evidence per field; disassembly notation). The same facts hold on
  // E139, E134, E137, E142, E140, E125, E145, E133, E130, E129 and E132 (X: each fact found by a byte pattern from the
  // site cited here, or by a census of the 32-bit addresses `fc xx imm32` loads), except the core byte's address,
  // which is read per body. The timer's bookkeeping fields (prescaler, status_readable, soft_tick, hw_channels,
  // hw_entries) and the VSC's and engine's behaviour beyond their register names were checked on E144 only.
  E144: {
    // kcb pointers 0x8ff00004, the board byte getter 0x5000276d `movbu (0x8ff00198),d0`; highest offset used 0xb94
    sram: 0x8FF00000, sram_size: 0x1000,
    // the kernel's lock 0x500158f8 `mov 0x8fe00000,a0`, groups at +8 .. +0x38
    isc: { base: 0x8FE00000, stride: 8, groups: 8 },
    intc: {
      // three banks (no 0x99b80000), irq < 182 (attach 0x50033fcf `cmp 182`); presented +0x300 + 4L (the level
      // handlers 0x50033dcc..), the IPI pending set/clear +0x408/+0x40c (IPI handler 0x5003312f, table 0x6007a7b8),
      // the kernel kick +0x410 (0x5000f08b..), K-INTC's +0x414 = 1 (0x500310f2, where E143 writes +0x884)
      banks: [0x99200000, 0x99300000, 0x99B00000], irqs: 182,
      presented: 0x300, ipi_set: 0x408, ipi_clear: 0x40c, kick: 0x410, ctl: 0x414,
      // IPI 169 (IPI init 0x500327ff); OSD engine 158 (attach at 0x50ca4a48); VSC 25 / 27 (0x500221a2..c1)
      irq_ipi: 169, irq_osd_engine: 158, irq_vsc0: 25,
    },
    // the channel table 0x600d00c4 {ctl, reload, counter, IE, status} and its masks 0x600cff74; the shared ISRs
    // 0x500561a6/bb read the status of channels 11..18 / 19..26 (IRQs 98 / 99, the {handler, level|irq} table
    // 0x600d02f4); the us free-run is channel 27, reload 0x3fffffff (0x5000362f), read at 0x50002397; ch 0 gets no
    // prescaler reload
    timer: {
      channels: 28, reload: 0x70, counter: 0xe0, us_channel: 27, us_reload: 0x3fffffff, prescaler: null,
      groups: [[1, 10, 0x150, 0x15c, null], [11, 18, 0x154, 0x160, 98], [19, 26, 0x158, 0x164, 99]], irq_base: 87,
      status_readable: true,
      // one kernel tick (channel 1, the tick init 0x50034a3e); the software-timer init 0x5004e695 re-attaches
      // indices 14..25 (channel = index + 1) and the guard sees 10..25 (0x5004e190, 0x5004e760); the 2 ms tick is
      // the first, channel 15, by analogy with E143's index 20 (I); the table covers 26 entries (cmp 26)
      kernel_ticks: [1], soft_tick: 15, hw_channels: [10, 26], hw_entries: 26,
    },
    // the VSC (D): base 0x9c000000, channel 0 for the TFT and the EVF and channel 1 for HDMI (0x5002361c); the
    // name table 0x6025b2f0 (422 entries, *_VL latched copies at +0x400); INTST1 0x014 (W1C), INTEN1 0x00c; the
    // vertical total in SYNC2 0x22c (TFT/HDMI) or SYNC8 0x380 (EVF: the device setup's timing writer 0x500231e5
    // stores SYNC8 for the EVF's device bit and SYNC2 otherwise, 0x500232ed / 0x500232fa); MONI3 0x2bc read at
    // 0x50187ae2; the ISR 0x50185b76 acts on INTST1 bits 0 (frame), 8, 15 (the serial engine's completion), 18, 19, of
    // which the model raises 0 and 15
    vsc: {
      kind: 2, base: 0x9C000000, size: 0x8000, channels: 2, stride: 0x4000, reg_end: 0x7EC, names: [422, 0],
      regs: { INTEN1: 0x00C, INTST1: 0x014, SYNC2: 0x22C, SYNC8: 0x380, MONI3: 0x2BC, INTEN2: 0x3C0, INTST2: 0x3C4 },
      irq_mask: 0x8001,
    },
    // the OSD engine (D): base 0x9c100000 (0x9bc00000 is a PWM block here), registers 0x00..0x50 only (every
    // immediate reference), no LUT upload, the list base a byte address; 12 layer records and the kind-3 one
    engine: { base: 0x9C100000, guards: 16, lut: false, list_shift: 0, enc: 2 },
    // the SCPU init 0x500478d0 against E143's 0x5004dc55: command 0xf4 -> 0xa4, clock 0xe8/0xec -> 0x98/0x9c
    // (0x50050cb7/bd); 0x8c (E143 0xdc) is a parameter word the command 0x20041001 sets the low 6 bits of first
    // (0x50001a37..4a); 0x48 (E143 0x90) a word the clock path sets to -1 before the same command (0x500480c0);
    // the compacted words 0x40..0x9c (E143 0x98..0xec: 0xa0..0xb8 -> 0x58..0x68, 0xbc -> 0x6c, 0xc4 -> 0x74, ...,
    // 0xdc -> 0x8c, D: the paired init sequences) are storage, but for the clock; the C-runtime window the lab's K-CRT-134D answers
    // (src/lab/menu.mjs SCPU_CLOCK) reads the clock 0x98: `mov (0x98e00098),d0; retf` at E144 0x516824a1 and E137
    // 0x51462486, where E143's 0x51a7034d reads 0x98e000e8 (D). The clock stands still on this family's bodies but
    // E139 and E134, the ones with S-SCPU (src/fw/models.mjs): E137's and E130's operating-time count writes its NAND
    // record once the counter has advanced (E137 0x5004d531 -> 0x50039157, D; docs/om1-settings-spec.md K-CRT-134D),
    // and their start then stops at the NAND controller the lab does not model (X)
    // The event and port words (E143's 0x98, 0xa0..0xb8) lie in the storage 0x40..0x94: events null (not modelled)
    scpu: { command: 0xa4, clock: [0x98, 0x9c], ticks: false, storage: [[0x00, 0x00], [0x08, 0x3c], [0x40, 0x94]], events: null },
    // the sub-CPU link's pins: not read for the family; E139 and E134, the bodies that run PER_SCPU, give theirs (pins
    // 77 / 76 / 57 in the family's GIO block, src/fw/models.mjs)
    scpu_link: UNKNOWN,
    // the HDMI port and the lens mount: not read on this family; the deferred-call triggers per body, read by
    // src/fw/facts.mjs (deferredCalls: the six words 0x9b800030..0x9b800044 and IRQs 29..34 on every body of the family)
    hdmi: UNKNOWN, lens: UNKNOWN, dpc: UNKNOWN,
    // per body, read by src/fw/facts.mjs (coreByte; resetHead's library and preload rows; vectorPage: 0x6003xxxx on
    // E144, 0x6041xxxx on the 0x60400020 bodies, X; dramSize: 256 MiB on E144, 512 MiB on the 0x60400020 bodies, X)
    core_byte: UNKNOWN, library: UNKNOWN, preload: UNKNOWN, vector_page: UNKNOWN, dram_size: UNKNOWN,
    // E143's scratch DRAM is dense E144 .bss (thousands of references in 0x620B..0x621B and 0x6231..0x6236): the
    // lab's scratch is a lab region outside the DRAM. The bodies at E144's base and at 0x60020020 load E143's scratch
    // DRAM as densely, the four at 0x60400020 (E133, E130, E129, E132) hardly at all (X: a census of `fc xx imm32`),
    // so the region is the family's (I: no session has run with it on them)
    scratch: { from: 0xA2021000, size: 0x31F000, base: 0x8A021000 },
    reset_head: 'flash-copy',
    // the stub's pages (as E143's), observed in E144 runs (X) and assumed for the family (I): the clock/reset block,
    // the block the display open writes 0x9a2000xx, the display interface 0x9b800000/0x9b801000 (TFT/EVF device
    // inits), the block 0x98f20000 the measurement 0x50003719 polls (its bit 1 of +0x40, 50 ms steps up to 700 ms),
    // and the PWM block 0x9bc00000 (E143's 0x9ba00000): its channel enable clears +0x00 on the first user and sets the
    // channel's bit in +0x04 (E144 0x5004ff9e, the store at 0x5004ffc6; E142 0x5004c892, at 0x5004c8ba, as E143's
    // 0x50059732 stores 0x9ba00000, D), which E142's camera application start reaches (X) and E144's does not; and
    // the encoder block 0x9bd00000, whose counter registers +0x00/+0x04 and +0x80/+0x84 E125's dial init clears for
    // each dial it sets up (0x500fedd1 -> 0x5010329c, the stores at 0x501032d8..0x501032f2; E139's encoder init
    // stores 0x9bd00000 at 0x50113c2b and E144's encoder position read reads +0x38/+0xb8, D), which E125's bring-up
    // reaches (X) and the others' do not; a body that needs more gives its board.stub_pages with its evidence
    stub_pages: [0x98800000, 0x98F20000, 0x9A200000, 0x9B800000, 0x9B801000, 0x9BC00000, 0x9BD00000],
    stub_presets: [],
    // the display waits' stand-ins (see FAMILIES.E143): E134's TFT open blocked natively in both (X)
    display_wait_stand_ins: true,
    // the SD host (see FAMILIES.E143): E143's two port bases (E144's SD driver reads them from 0x607d0de8, which holds
    // 0x99000000 and 0x9a300000, D), SD_INFO2 at +0x203c bit 13 polled as E143's (E144 0x506a1871, D); the card's pins
    // and power in the GPIO page 0x9b802000 (E144 0x506a3aec writes 0x9b802064; its other pin writes are in the stub
    // page 0x9b800000, D). Assumed for the family (I): the cards of E139, E137, E142, E140, E125 and E130 mount on them (X)
    sd: {
      pages: [[0x99000000, 0x10000], [0x9A300000, 0x10000], [0x9B802000, 0x1000]],
      idle: [[0x9900203C, 0x2000], [0x9A30203C, 0x2000]],
    },
  },
  // E118 (E-M5 II), E120 and E122, the 2015-16 bodies: the E144 family's MMIO bases, but another controller, timer and
  // VSC layout. Read from E122's code (D, its addresses below; disassembly notation) and checked on E118 and E120 by
  // the same census of the 32-bit addresses `fc xx imm32` loads (X) unless said otherwise.
  E118: {
    // the board byte getter 0x5000238d `movbu (0x8ff00188),d0`; highest offset used 0x3fc (the window: I, E144's)
    sram: 0x8FF00000, sram_size: 0x1000,
    // the lock's offsets 0x0..0x6
    isc: { base: 0x8FE00000, stride: 2, groups: 4 },
    // three banks, irq < 122 (`cmp 122,d3` at E118 0x5004c75f); the level registers +4 irq (0x1a8, 0x1e4 the last);
    // presented +0x200 + 4 level, (irq + 1) x 4, the level handlers 0x5004c5d6..0x5004c725 indexing the handler table
    // 0xa1bf3984 by it; the inter-CPU doorbell one step below E144's: pending set +0x308 and clear +0x30c (stores to
    // the three banks 0x5004b549..0x5004ba18), the kernel kick +0x310 (0x5000f07b..0x5000f0ca), K-INTC's +0x314 = 1
    // (0x50049d44, after the last level register's clear, where E144 writes +0x414 and E143 +0x884), the IPI IRQ 120
    // (attached at level 2 for each CPU, 0x5004ae89..0x5004aec2; fishcu/oly_fw_analysis found the doorbell first,
    // analysis/oly-fw-analysis/README.md 2.1); the OSD engine's IRQ 109 (attached at level 5 to 0x50a5a92c, the
    // engine ISR the map pairs with E143's, at 0x50a5a52b) and the VSC's 21 + 2 c for channel c (21 at 0x503035e7 to
    // the ISR 0x50305c16, which acts on channel 0's INTST1; 23 at 0x50306451 to 0x5030722b, channel 1's). +0x300,
    // +0x304 and +0x400 are written only on halt paths (0x5004f798, 0x5004f7a7, 0x5004f426) the lab does not run
    intc: {
      banks: [0x99200000, 0x99300000, 0x99B00000], irqs: 122,
      presented: 0x200, ipi_set: 0x308, ipi_clear: 0x30c, kick: 0x310, ctl: 0x314,
      irq_ipi: 120, irq_osd_engine: 109, irq_vsc0: 21,
    },
    // the channel table 0x6012fb5c: 10 records {ctl, reload, counter}; the IE word +0x78 and the write-1-to-clear status
    // +0x7c hold bit n - 1 of channels 1..8 (the mask records 0x6012fae4, the start 0x5006f284 and the ISR's clear
    // 0x5006f420; every reference to +0x7c stores, so the status is not read), one IRQ per channel, 57 + n (the IRQ
    // bytes 0x6012fc06 the attach 0x5006f146 reads: 58..65); the prescaler, channel 0's reload, 191 (0x50003094); the
    // us free-run channel 9, reload 0x3fffffff (0x500030af), read at 0x50001ecf. The tick init the boot calls for CPU 0
    // (0x5004d779) starts channel 1 at reload 999 on IRQ 58 (CPUs 1 and 2 start channels 2 and 3 from their own
    // inits, 0x5004d806, 0x5004d863). The software-timer init 0x50065e50 starts no channel (X: after it only channels 1
    // and 9 run): its timers count in 2 ms units (0x50066238) from a source not read (?), so soft_tick is null. The
    // hardware-timer init 0x5006ed9b walks 10 entries (the table 0x6012fa78) and its guard functions take an entry
    // index below 10 (`cmp 10,d2`, 0x5006eddb); hw_channels is the range the lab checks those indices against
    timer: {
      channels: 10, reload: 0x28, counter: 0x50, us_channel: 9, us_reload: 0x3fffffff, prescaler: 191,
      groups: [[1, 8, 0x78, 0x7c, null]], irq_base: 57, status_readable: false,
      kernel_ticks: [1], soft_tick: null, hw_channels: [0, 10], hw_entries: 10,
    },
    // the VSC (src/dev/vsc.mjs kind 3): two channels of 0x2000 (channel 1's INTEN1/INTST1 at 0x9c00200c/0x9c002014, its
    // ISR's status read 0x5030a80e); no name table in the image (no "INTEN1" string, X), so the register file is the
    // offsets the family's code names: the census of every `fc xx` 32-bit load in 0x9c000000..0x9c004000 on all three
    // bodies (X), and the scaler words the OSD scaler writers index (0x50308314, 0x50308389: words 82..85, 88..91 and
    // 94..97 for the three planes, D). The roles named are the ones the code shows: INTEN1 / INTST1 (W1C) from the ISRs,
    // SYNC2 0x22c from the timing writers 0x50308ed9 and 0x50309ab5 (the vertical total in its low half, I: the
    // latched copy's low 11 bits are compared with MONI3's, 0x503090cf..0x503090e4), MONI3 0x2bc, whose every reader
    // masks 0x7ff (0x502f94b2, 0x50308ec5, 0x503090d5). Latched copies at +0x1c00 (0x1c38 / 0x38 at 0x50308d92..d99,
    // 0x1c3c / 0x3c, 0x1c40, 0x1e2c / 0x22c, D; that they are the latched values is I, by E144's *_VL); palettes and
    // tables from +0x600 (the palette writer 0x50307aea's banks 0x600, 0x680, 0x800 / 0xa00 by bit 16 of 0x1b8, and
    // 0x700; the byte table 0x1600, 0x50308b50), plain storage up to the latched copies (I). The frame raises INTST1
    // bit 0, on which both ISRs set their channel's vsync flag (0x50305b9e, 0x503071b3); the others they test (bits 4,
    // 5) are not modelled
    vsc: {
      kind: 3, base: 0x9C000000, size: 0x4000, channels: 2, stride: 0x2000, reg_end: 0x314,
      registers: words([0x000, 0x020], [0x030, 0x088], [0x0A4, 0x118], [0x130, 0x130], [0x148, 0x154], [0x160, 0x16C],
        [0x178, 0x184], [0x190, 0x1C8], [0x1FC, 0x27C], [0x288, 0x2B0], [0x2BC, 0x2BC], [0x2C4, 0x2C8], [0x2E0, 0x2E8],
        [0x304, 0x310]),
      regs: { INTEN1: 0x00C, INTST1: 0x014, SYNC2: 0x22C, MONI3: 0x2BC },
      latch: 0x1C00, latched: [0x038, 0x03C, 0x040, 0x22C], store: [0x600, 0x1C00], line_bits: 11, irq_mask: 0x0001,
    },
    // the OSD engine at E144's base with E144's form: registers 0x00..0x50 only (the census, 0x50a5a5a7..0x50a5b166),
    // no LUT registers, the list base 0x18 a byte address (0x50a5b0ee stores the 64-aligned address itself, with the
    // end +0x8000 at 0x1c), a command's high address bits 29..30 in w0 (the fill builder near 0x50a5ab4f: `and
    // 0x60000000` into w0, the rest << 3 into w2, D: E144's kind-2 encoding); the guards are the lab's
    engine: { base: 0x9C100000, guards: 16, lut: false, list_shift: 0, enc: 2 },
    // the SCPU interface: E144's compacted map, command 0xa4 and clock 0x98 / 0x9c (the init 0x5005c1a3.. writes
    // 0x74, 0x6c, 0x78, 0x84, 0x80, 0x7c, 0x88, 0x40 in E144's order, 0x500478df..), storage 0x00..0x94: the word array
    // from 0x04 (the getter 0x5005c970 and setter 0x5005c95b index 15 words, E144's from 0x08) and 0x40..0x94 as E144's
    scpu: { command: 0xa4, clock: [0x98, 0x9c], ticks: false, storage: [[0x00, 0x94]], events: null },
    scpu_link: UNKNOWN, hdmi: UNKNOWN, lens: UNKNOWN, dpc: UNKNOWN,
    core_byte: UNKNOWN, library: UNKNOWN, preload: UNKNOWN, vector_page: UNKNOWN, dram_size: UNKNOWN,
    // E143's scratch DRAM holds E122's icons record (the loader's destination 0xa1fa6c00, 0x730a00 bytes decoded: X,
    // src/fw/facts.mjs resLoader and resources.mjs record): the lab's scratch is E144's lab region, which E118, E120
    // and E122 load no more of than E143 and E144 do (a few stray `fc xx imm32` matches per 64 KiB, X: a census)
    scratch: { from: 0xA2021000, size: 0x31F000, base: 0x8A021000 },
    reset_head: 'flash-copy',
    // the stub's pages, as E122's start writes and reads them (X: each one a denied access first): the GIO pin words
    // 0x9b800000 / 0x9b801000 and the pull / mux block 0x99e20000 of the early driver init's pin configuration
    // (H-DRVINIT, 0x50001be9..0x50001d38, D), the clock block 0x98800000 (the clock query 0x5006e243 reads 0x9880004c),
    // the five enabled serial channels' blocks 0x98200000, 0x98300000, 0x98500000, 0x98600000, 0x98400000 (the table
    // 0x6012e7c0 and its enables 0x6012e7a0; 0x500699a2 sets bit 8 of each), and the encoder block 0x9bd00000 the
    // dial init clears (0x5017c22f); and the PWM block 0x9bc00000 (the E144 family's), which E118's and E120's TFT
    // opens reach (X, 2026-10-30): its channel enable clears +0x00 for the first user and the channel's bit in +0x04
    // (E118 0x5006bf92, the stores at 0x5006bfb2 and 0x5006bfdf; E120's at 0x5006977a; E122's at 0x50067f1f, which its
    // start does not reach, D). The TV encoder block 0x99100000 (0x502fe38a) and the control word 0x98a00000
    // (0x5030b87a), which only the NTSC and PAL opens write (0x503037a8..0x503037b3), are not stub pages since the lab
    // opens the built-in EVF (device code 6, docs/model-survey.md finding 35; X: E122's EVF start without them)
    stub_pages: [0x9B800000, 0x9B801000, 0x99E20000, 0x98800000, 0x98200000, 0x98300000, 0x98500000, 0x98600000,
      0x98400000, 0x9BD00000, 0x9BC00000],
    // the serial channels' transmit level word +0x1c (the channel records 0x6011c034 + 0x60 x ch name it at +28, E118
    // D) reads each channel's FIFO depth, its transmitter idle: the driver's byte loop writes +0x18 while +0x1c is not 0
    // (E118 0x5006e24b), and its polled send then waits until +0x1c equals the depth word the channel's init keeps
    // (0x611515c0 + 4 x ch: 16, 16, 16, 16, 64 for channels 0..4 at E118's EVF open, X; 0x5006dff0..0x5006e008, D).
    // E118's EVF panel takes its command list over channel 2 (0x98500000) at 4 MHz in that polled mode, a GPIO pin
    // around each command (0x502d3b20.., D): a stub page's unwritten 0 kept that wait from ending (trap 7 at the
    // display run's limit, X). That +0x1c counts the transmitter's free entries is I
    stub_presets: [[0x9820001C, 16], [0x9830001C, 16], [0x9850001C, 16], [0x9860001C, 16], [0x9840001C, 64]],
    // the display waits' stand-ins: without them E122's display start blocks, every task waiting (X)
    display_wait_stand_ins: true,
    // the SD host (see FAMILIES.E143): one port, 0x99000000, whose DMA wrapper, SD core (+0x2000) and PHY (+0x6000)
    // E122's SD driver writes (0x505812c4..0x505813bd, 0x505814dc.., 0x50581563..), SD_INFO2 at +0x203c bit 13
    // polled before the clock is set (0x5058108c, D); the card's pin word 0x9b80018c lies in the stub page 0x9b800000.
    // The PEN-F's card mounts on it (X, 2026-10-30)
    sd: { pages: [[0x99000000, 0x10000]], idle: [[0x9900203C, 0x2000]] },
  },
};

// the word offsets of the closed ranges [first, last]
function words(...ranges) { return ranges.flatMap(([a, b]) => Array.from({ length: (b - a) / 4 + 1 }, (_, i) => a + 4 * i)); }

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// The board of family + derived + hand (see the head of this file): `what` names it in errors. A field that stays
// UNKNOWN becomes a getter that throws.
export function mergeBoard(family, derived, hand, what) {
  const out = {};
  for (const [k, v] of Object.entries(family)) out[k] = isPlain(v) ? { ...v } : v;
  for (const [k, v] of Object.entries(derived)) out[k] = isPlain(v) && isPlain(out[k]) ? { ...out[k], ...v } : v;
  for (const [k, v] of Object.entries(hand)) {
    if (k === 'family') continue;
    const d = derived[k], both = d === undefined ? [] : isPlain(v) && isPlain(d) ? Object.keys(v).filter((s) => Object.hasOwn(d, s)).map((s) => `${k}.${s}`) : [k];
    if (both.length) throw new Error(`${what}: board ${both.join(', ')} both read from the firmware (src/fw/ports.mjs FACTS) and given by hand (src/fw/models.mjs)`);
    out[k] = isPlain(v) && isPlain(out[k]) ? { ...out[k], ...v } : v;
  }
  const guard = (o, prefix) => {
    for (const [k, v] of Object.entries(o)) {
      if (v === UNKNOWN) Object.defineProperty(o, k, { enumerable: true, get() { throw new Error(`${what}: board fact ${prefix}${k} unknown (src/fw/board.mjs FAMILIES; give it in src/fw/models.mjs board with its evidence)`); } });
      else if (isPlain(v) && !prefix) guard(v, `${k}.`);
    }
  };
  guard(out, '');
  return out;
}

// The board of MODELS[code] (bin/port.mjs reads another model's than the lab's).
export function boardOf(code) {
  const hand = MODELS[code].board ?? {}, family = hand.family;
  if (!Object.hasOwn(FAMILIES, family ?? '')) throw new Error(`${code}: src/fw/models.mjs board.family ${JSON.stringify(family)} is not one of ${Object.keys(FAMILIES).join(', ')}`);
  const board = mergeBoard(FAMILIES[family], FACTS[code]?.board ?? {}, hand, `${code} (family ${family})`);
  board.family = family;
  return board;
}

export const BOARD = boardOf(MODEL);
// whether a top-level fact of BOARD is known (not UNKNOWN), without reading it: for a device the machine builds only
// on a board that gives its facts (src/machine.mjs the sub-CPU link's pins); a user that needs the fact reads it and
// throws with the board's message
export const boardKnows = (key) => Object.hasOwn(BOARD, key) && !Object.getOwnPropertyDescriptor(BOARD, key).get;
export const IRQS = BOARD.intc.irqs;
// the IRQ a timer channel raises (shared lines included), or -1
export function timerIrq(n) {
  for (const [lo, hi, , , irq] of BOARD.timer.groups) if (n >= lo && n <= hi) return irq ?? BOARD.timer.irq_base + n;
  return -1;
}
