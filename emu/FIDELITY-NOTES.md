# emu emulation fidelity notes

These notes list where emu departs from real OM-1 hardware and firmware, or where it probably does: approximations, stubs, skipped behaviour and suspected inaccuracies. Several gaps below (2.2, 2.3, 3.2, 3.6) are choices of emu's own model with no basis in the hardware or the manual. They are work items, not constraints: the CPU and interrupt items are planned as "ground the CPU and interrupts in the manual" and the time and delivery items as "time and the HLE boundary" in `docs/ROADMAP.md` "Emulator architecture", and only camera captures can settle the display-side notes (5.x) and the panel and stub answers (4.2, 7.4). The order of authority is in `emu/ARCHITECTURE.md` "Ground truth".

Each note was checked against the cited code. Paths are relative to the repository root. The confidence level is how sure we are that the note describes a real gap or inaccuracy. It does not say how much the gap matters.

## 1. Time and device timing

### 1.1 Device time does not advance with CPU execution

**Where:** `emu/src/dev/timer.mjs:10-32`, `emu/src/dev/vsc.mjs:300-326`, `emu/src/dev/vsc.mjs:122-127`, `emu/src/dev/timer.mjs:113-123`, `emu/src/lab/display.mjs:467-471`

**Emulator:** The shared lab `Clock` moves only through the VSC doorbell commands ADVANCE, RUN_TO_FRAME and RUN_TO_EVENT. These are the only `clock.advance` calls in the tree (`vsc.mjs:303,309,325`), and the harness reaches them through `display.mjs:467-471`. Executing instructions never moves `clock.t`. As a result, timer channels 1-32 never expire, frame boundaries never happen and MONI3 (`vsc.mjs:122-127`) never changes between doorbells. Every channel started between two doorbells gets the same `t0 = clock.t` (`timer.mjs:118`).

**Expected / concern:** On hardware, timers, raster position and frame interrupts run in step with CPU time. A firmware loop that busy-waits on a timer status bit or on MONI3 cannot end unless the harness steps in. The relative timing between the CPU and devices, such as how many instructions run per frame, is not represented. One exception is the channel-33 counter at 0x284: it does move without lab time, because each read decrements it (see 1.2).

**Confidence:** high

### 1.2 Timer period and channel-33 counter are lab assumptions

**Where:** `emu/src/dev/timer.mjs:113-123`, `emu/src/dev/timer.mjs:135-145`, `emu/src/dev/timer.mjs:52-55`

**Emulator:** A channel's period is fixed at `(reload + 1) * 1000` ns, which is a 1 MHz tick (A-TMR-1/A-TMR-2). There is no prescaler or clock-select register, and CTL accepts only bits 0xC0 (`timer.mjs:155`). Only channels 1-32 have periods and interrupt lines. Channels 0 and 33 are started at reset (H-RESETTIMER) but never expire. Each non-debug read of 0x284 decrements the channel-33 count by 1 (H-USCOUNT). With USMODE=1 the value also includes lab microseconds since the last reload (A-USLAB). Channels 1-32 have no readable current-count register.

**Expected / concern:** The real timer block very likely has clock-source and divider selection. A free-running counter decrements with time, not with the number of reads. Firmware that measures intervals with the counter therefore gets results that depend on how often it polls.

**Confidence:** medium

### 1.3 OSD draw engine finishes inside the CPU store that starts it

**Where:** `emu/src/dev/engine.mjs:1-3`, `emu/src/dev/engine.mjs:302-313`

**Emulator:** Writing 1 or 2 to register 0x24 runs the whole command list or FIFO synchronously (`runList`/`runFifo`) inside that store. The done bit (`regs[1] |= 1`) and IRQ 310 are raised before the store returns.

**Expected / concern:** A real blitter takes time that depends on the work. Firmware never sees a busy state, and it gets the completion interrupt at the instruction right after the start. Ordering bugs or races that depend on engine latency cannot occur.

**Confidence:** high

### 1.4 Display output is produced only on harness request

**Where:** `emu/src/dev/vsc.mjs:154-167`, `emu/src/dev/vsc.mjs:311-316`, `emu/src/lab/display.mjs:1078-1084`, `emu/src/lab/play.mjs:980-983`

**Emulator:** A frame boundary only latches the mirror bank and sets INTST1 bit 0 (`boundary`). Pixels are produced only when the harness rings the COMPOSE doorbell, which is the only caller of `compose()`. The visible image is a snapshot of the latched registers and memory at a time the harness picks.

**Expected / concern:** Real hardware scans out continuously, fetching plane data by DMA while the frame is displayed. Tearing, mid-frame register or buffer updates, and anything else that depends on scan-out timing are not represented.

**Confidence:** high

## 2. Interrupt delivery

### 2.1 No interrupts by default, and only at one gate PC when enabled

**Where:** `emu/src/dev/intc.mjs:20`, `emu/src/dev/intc.mjs:119-125`, `emu/src/lab/kernel.mjs:89-99`, `emu/src/lab/irq.mjs:55`

**Emulator:** `GATE_MODE` sits in a zero-filled debug window, so a new machine starts at GATE_OFF and `irqLevel` returns -1 for every request. The native boot path sets GATE_PC with the idle-loop address IDLE_DONE (`kernel.mjs:98`). After that, an interrupt is accepted only when a look happens with the PC exactly at that address. GATE_ANY exists in the INTC model, but nothing in `src/lab` sets it.

**Expected / concern:** Real hardware accepts an unmasked interrupt at any instruction boundary where PSW IE and IM allow it. Interrupts that arrive in the middle of task code, as well as nesting and preemption races, are never exercised. Firmware runs as if interrupts happen only while it is idle.

**Confidence:** high

### 2.2 Interrupt looks follow a translation-block model, and undecidable cases end the continue

**Where:** `emu/src/core/interp.mjs:6-22`, `emu/src/core/interp.mjs:75-166`, `emu/src/core/interp.mjs:407-459`, `emu/src/machine.mjs:158-163`, `emu/src/machine.mjs:249`

**Emulator:** In the default mode (not one-instruction), pending interrupts are checked only at "main-loop visits", the points where a translation-block (TB) executor would return to its main loop, roughly at TB exits. They are not checked at every instruction boundary. A plain sequential arrival at the gate PC less than TB_MIN (16) instructions after the last known TB start gets no look (`interp.mjs:88-90,130`). When the timing depends on a TB layout emu does not model (refusals a-e), it throws `TbUndecidable` (an `Unported`) at an instruction boundary: the continue ends with a stop of kind `undecidable` and the error reaches the caller (`machine.mjs:158-163,249`).

**Expected / concern:** These sampling points are not hardware behaviour. Hardware takes the interrupt at the next instruction boundary. Some legitimate firmware states also end the run instead of continuing.

**Confidence:** high

### 2.3 Undefined-flag tracking delays interrupt acceptance

**Where:** `emu/src/core/cpu.mjs:75-82`, `emu/src/core/cpu.mjs:300-305`, `emu/src/core/cpu.mjs:526-530`, `emu/src/core/cpu.mjs:550`, `emu/src/core/interp.mjs:422-431`, `emu/src/core/interp.mjs:534`

**Emulator:** Shifts, MUL, the UDF multiply form and interrupt entry mark some PSW flags as undefined (`R[UNDEF]`). If any undefined bit is set when an interrupt would be accepted, `execInterrupt` sets `irqWait` and declines. The run loop then single-steps and looks again after each instruction until all flags are defined. Interrupt entry sets `R[UNDEF] = 15` (`cpu.mjs:550`), so the start of every handler also cannot be preempted until the flags are written.

**Expected / concern:** Hardware does not track whether flags are defined. Acceptance is delayed by a number of instructions that has no hardware equivalent, which changes which instruction is interrupted.

**Confidence:** high

### 2.4 Interrupts delivered by the HLE harness skip the firmware's interrupt entry

**Where:** `emu/src/lab/rtos.mjs:48-61`, `emu/src/lab/kernel.mjs:328-345`, `emu/src/lab/display.mjs:480-501`

**Emulator:** In the HLE paths, `_deliver` polls host-side "sources" and calls the attached handler directly with `CALLS` through a trampoline on a harness stack (`rtos.mjs:57`). This skips the vector, the IVAR level slot and the kernel's level handler. `in_interrupt` and `isr_call` mark interrupt context by writing the KCB nest and flag bytes from the host. The OlyTaSS stand-in advances lab time and then runs `kernel.deliver()` synchronously (`display.mjs:494-500`). The vsync OlyEvWt stand-in does the same (`display.mjs:480-492`). Handlers therefore run inside the sleeping or waiting call, not at the point where the CPU would have been interrupted.

**Expected / concern:** On hardware the ISR runs through the firmware's own entry and exit code, with PSW and stack changes, at an arbitrary preemption point. Bugs in kernel interrupt bookkeeping, and any ISR effect that depends on the preempted context, are not exercised.

**Confidence:** high

## 3. CPU core

### 3.1 CPU faults stop the emulator and are never delivered to firmware

**Where:** `emu/src/core/cpu.mjs:523-554`, `emu/src/machine.mjs:144-145`, `emu/src/machine.mjs:207-228`

**Emulator:** `execInterrupt` vectors only maskable interrupts. Every guest `Fault` (illegal instruction, misalignment, bus error, divide fault, UDF fault, limit) ends the continue and prints a trap line (`machine.mjs:217,219,227`). The firmware's own exception handlers never run.

**Expected / concern:** The MN10300 delivers such conditions to exception vectors, if it raises them at all (see 3.2). Firmware that relies on exception handling, such as recovery, logging or lazy setup, cannot be emulated.

**Confidence:** high

### 3.2 Strictness faults the hardware does not raise

**Where:** `emu/src/core/cpu.mjs:60`, `emu/src/core/cpu.mjs:115-142`, `emu/src/core/cpu.mjs:306-324`, `emu/src/core/cpu.mjs:337`, `emu/src/core/cpu.mjs:344`, `emu/src/core/cpu.mjs:465-467`, `emu/src/core/interp.mjs:257`

**Emulator:** Several faults are checks the emulator adds. Fault 6 is raised for reading a flag marked undefined (`readFlags`, the inline `cond`), for reading or writing PSW inside the PSW-write hazard window, and for setting reserved PSW bits 0xC0F0. Fault 6 is also raised for a zero divisor or a quotient overflow in DIV/DIVU. Fault 1 is raised by the UDF float unit for NaN, Inf or subnormal inputs or results, for division by zero, and for underflow.

**Expected / concern:** These are not ISA behaviours. Real hardware produces some flag or result value and carries on, or for division takes a defined exception path. Code that is legal on hardware, such as testing a flag after a shift or dividing by zero in a guarded path, stops the emulator.

**Confidence:** high

### 3.3 Page-crossing non-prefix instruction: wrong fault address and fault counted

**Where:** `emu/src/core/cpu.mjs:158-166`, `emu/src/core/interp.mjs:261-272`, `emu/src/core/cpu.mjs:570-579`

**Emulator:** For non-prefix forms, the up-front code fetch in `step()`, `decode()` and `limitFault()` reads byte 0 and then bytes 2 onward. Byte 1 (pc+1) is not read until execution (for example `cv(next, …)`). Only the `refetch` path reads byte 1 in order (`cpu.mjs:161-162`). Suppose pc+1 is the first unmapped byte. For a 2-byte form the fault then happens during execution and is counted, as a fault of the instruction. For forms of 3 or more bytes the fetch fault reports pc+2 as the address, not pc+1.

**Expected / concern:** Hardware sees the fault on the first byte it cannot fetch, so this case should give an uncounted fetch fault at pc+1.

**Confidence:** medium

### 3.4 Lcc re-fetches the loop head from memory instead of using LIR

**Where:** `emu/src/core/cpu.mjs:232-234`, `emu/src/core/interp.mjs:495-496`

**Emulator:** SETLB stores the next 4 bytes in LIR and pc+5 in LAR, and the inline SETLB re-reads them from memory on every execution. A taken Lcc jumps to `LAR - 4` and fetches from memory again. LIR is never executed.

**Expected / concern:** If the loop instruction buffer works the way LIR suggests, hardware executes the latched bytes. The two differ only when the loop head is modified after SETLB.

**Confidence:** low

### 3.5 Debugger and harness register writes define all flags; insns is 32-bit on write

**Where:** `emu/src/core/cpu.mjs:556-567`, `emu/src/machine.mjs:157-167`, `emu/src/lab/sim.mjs:171-180`, `emu/src/lab/sim.mjs:216-225`, `emu/src/lab/hle.mjs:99-127`

**Emulator:** `setRegs` clears `R[UNDEF]` and `R[HAZ]` and sets `S.insns = r16[15] >>> 0`. The harness rewrites the full register set with 'G' after every HLE stub return (`finish` / `finish_calls`), in `Simulator.reset` and around `cpu_store`. Each of these makes any undefined flags defined, with whatever bit values they held, and keeps only the low 32 bits of the instruction count.

**Expected / concern:** It does not move guest-visible state away from hardware, which has no undefined-flag concept. It does mean every HLE boundary silently turns off the undefined-flag checker. The truncated count also affects the insn-limit and TB-position bookkeeping, both of which depend on `S.insns`.

**Confidence:** low

### 3.6 Flash-view stack stores, the trap-line prefix and unmodelled fetches

**Where:** `emu/src/core/cpu.mjs:540-546`, `emu/src/core/cpu.mjs:580-583`, `emu/src/dev/bus.mjs:114-118`, `emu/src/core/mem.mjs:289-301`

**Emulator:** On interrupt entry, stack stores that land in the flash view 0x50000000-0x51FFFFFF are silently dropped (`cpu.mjs:552`). Ordinary stores there raise fault 2 (`mem.mjs:203`). Trap lines are printed with the prefix `om-emu:` (`cpu.mjs:592-593`). Two kinds of code fetch throw `Unported` instead of being modelled: a fetch through the bus window from a live-view range (`bus.mjs:115-118`), and a fetch from device registers other than the lab stub (`mem.mjs:300`).

**Expected / concern:** Nothing documents the dropped stores; the hardware might fault or write somewhere else. The `Unported` cases stop the machine on paths the firmware might really take.

**Confidence:** medium

## 4. Memory, bus and address map

### 4.1 Cache and DMA coherence not modelled

**Where:** `emu/src/machine.mjs:95-96`

**Emulator:** The cached DRAM alias at 0x60000000 and the uncached alias at 0xA0000000 are two K_RAM regions with the same physical offset, `mem.DRAM_OFF`. There is no cache.

**Expected / concern:** On hardware, CPU writes through the cached alias may not be visible to DMA masters (VSC, OSD engine) until a flush, and DMA writes need an invalidate. Missing or wrong cache maintenance in firmware cannot be detected, and timing that depends on cache behaviour is absent.

**Confidence:** high

### 4.2 Unmodelled peripheral space answered with synthetic values; lab windows hide stub denials

**Where:** `emu/src/core/mem.mjs:164`, `emu/src/core/mem.mjs:173-185`, `emu/src/dev/stub.mjs:1-81`, `emu/src/dev/vsc.mjs:63-74`, `emu/src/dev/stub.mjs:22`, `emu/src/dev/intc.mjs:51-54`, `emu/src/dev/timer.mjs:62`, `emu/src/machine.mjs:127`, `emu/src/dev/engine.mjs:32`

**Emulator:** Any address in 0x80000000-0x9FFFFFFF with no device region goes to the lab stub. If the harness has allowed the address, the stub returns an enabled preset value, else the bytes the CPU last wrote there, else 0. All other addresses are DENIED, which is a bus error. Several lab-only windows are mapped as CPU-readable K_ROMD regions inside that range: VSC output, debug and doorbell at 0x89000000-0x89810003, the stub window at 0x89900000, the INTC and timer debug windows and doorbell at 0x89A00000-0x89A20003, HLE at 0x89A30000-0x89A33FFF, and the OSD debug window at 0x8E000000. On the E143 board the SCPU's lab doorbell at 0x89A40000 is MMIO that refuses reads and every store but the lab's command. Region lookup comes before the stub fallback.

**Expected / concern:** If firmware reads one of these addresses by mistake, it gets lab bookkeeping data instead of the stub's denial, and nothing reports it. The allowed stub ranges return values that come from the harness, not from hardware.

**Confidence:** high

### 4.3 ISC lock block is plain byte storage at a 64-byte stride

**Where:** `emu/src/machine.mjs:99-106`

**Emulator:** In 0x97000000-0x970001FF, only byte accesses at offsets that are multiples of 64 are accepted, and they read back the last value written. Any other width or offset is UNKNOWN and raises a bus error.

**Expected / concern:** The name suggests hardware locks between the CPUs, with test-and-set or ownership semantics. A read-back store is correct only because a single CPU is modelled (see 6.1), and other access patterns from the firmware would fault.

**Confidence:** high

### 4.4 Self-modifying-code tracking gaps

**Where:** `emu/src/core/mem.mjs:263-272`, `emu/src/core/mem.mjs:377-384`, `emu/src/dev/bus.mjs:146-154`, `emu/src/dev/vsccompose.mjs:175-220`, `emu/src/core/mem.mjs:167-170`, `emu/src/core/mem.mjs:246-262`, `emu/src/core/interp.mjs:215-228`, `emu/src/core/interp.mjs:258-260`

**Emulator:** `codePhys` allows instruction fetch from any non-MMIO region, K_ROMD lab windows included. Devices write those windows through their own typed-array views, for example COMPOSE writing `v.out`, without calling `invalidateRange`. The only callers of `invalidateRange` are `dbgWrite` (`mem.mjs:368`) and bus DRAM writes (`bus.mjs:152`), so code run from such a window could execute stale decoded slots. The `CODEPG` page mark is set during decode (`interp.mjs:259`) and is never cleared when a page's slots are dropped. Every later store to that page still goes through `cpuStore`, which records it in the CST ring that refusal (c) checks.

**Expected / concern:** Executing from lab windows has no hardware meaning, so the stale-slot case is mostly theoretical. The CODEPG mark that never clears can make spurious refusal-(c) stops more likely.

**Confidence:** low

## 5. Display (VSC) and OSD engine

### 5.1 VSC register validity comes from the firmware image under test

**Where:** `emu/src/dev/vsc.mjs:80-93`, `emu/src/dev/vsc.mjs:155,194,257,313`, `emu/src/dev/vscregs.mjs:1-10`, `emu/src/core/mem.mjs:226-235`

**Emulator:** The first access to the VSC register file, a frame boundary or a COMPOSE reads the register-name tables from fixed offsets in the E143 v1.9 image (0x331DA0 and 0x332D60). On any other image the read fails and `tables()` throws a plain `Error` inside the CPU store or load. A plain `Error` is a host failure, which leaves the machine HostStopped instead of raising a bus fault.

**Expected / concern:** The hardware register map does not depend on the firmware. The model only works with this one image, and on another image it fails as an emulator crash, not as a guest-visible error.

**Confidence:** high

### 5.2 COMPOSE checks a fixed configuration and supports few formats

**Where:** `emu/src/dev/vsccompose.mjs:30-33`, `emu/src/dev/vsccompose.mjs:116-149`, `emu/src/dev/vsccompose.mjs:239-299`, `emu/src/dev/vsccompose.mjs:173-228`

**Emulator:** COMPOSE accepts only channels 1 and 2 (`:271`). It requires progressive mode (`:244`). Each FEATURES register must equal one fixed observed value per channel, and any other written value gives FEATURE_UNOBSERVED (`:273-291`). The mix registers are checked against fixed values (`:262-270`). PLANC must be 0 or 0x100, and the IMG format must be 0 (YC 4:2:2). OSDFMT1/OSDFMT2 must be 0x111/0x11. SPOS is supported only in a restricted form, and resize only for the RSZ1 bits 0x11 with no extra resize registers. PEAK/BC must have the observed values. Both IMG planes (`drawImg`, two-tap linear) and OSD planes (8-bit index, nearest sampling, blending through the palette) are implemented.

**Expected / concern:** In practice this is a check that the firmware set up the configuration seen so far. It is not a general compositor. Any other mode the firmware uses (other formats, scaling, peaking, channel 0) produces an error and no image.

**Confidence:** high

### 5.3 OSD engine opcodes 0x41 and 0x60 not executed

**Where:** `emu/src/dev/engine.mjs:218-231`, `emu/src/dev/engine.mjs:340-349`

**Emulator:** `commandLength` gives lengths for 0x41 (2 words) and 0x60 (5 words), so lists that contain them parse. `execute` handles only 0x10 (fill), 0x20 (copy), 0x30 (bitmap) and 0x40 (LUT), and reports OPCODE_UNMODELED for the others.

**Expected / concern:** Hardware performs those operations. Firmware paths that use them produce no drawing.

**Confidence:** high

## 6. Other CPUs and the sub-CPU

### 6.1 Only CPU 0 runs; the other cores are faked or rejected

**Where:** `emu/src/lab/kernel.mjs:46-53`, `emu/src/lab/kernel.mjs:107-109`, `emu/src/dev/intc.mjs:98-117`, `emu/src/lab/play.mjs:495-530`

**Emulator:** `NativeKernel.boot` refuses any CPU other than 0. It fills the other three KCB-table entries and fills each of their queues with 256 bytes of 0xFF. Setting IPI pending bits in banks 1-3 only appends to the xcpu ring. The inter-CPU handshake 0x5001258B raises a FirmwareError. In play mode, S-CPU2 serves exactly one allowed post (function 0x60ACB193, argument 0, from core 0 with the expected bank-2 bit). It copies a fixed snapshot and posts a reply. Command 3, the swap path at 0x50AAAD0E, raises an error.

**Expected / concern:** The real system has four cores working together through IPIs, shared queues and the ISC locks. Any work handed to the other cores happens only where the harness copies its effect, and races between cores are never exercised.

**Confidence:** high

### 6.2 SCPU (sub-CPU): window storage, a ticking clock, four answered requests and the port words

**Where:** `emu/src/dev/scpu.mjs`, `emu/src/lab/scpuserver.mjs`, `emu/src/lab/menu.mjs` (`store_init`), `emu/src/lab/play.mjs` (`scpu_port_bring_up`, `port_group`)

**Emulator:** In the window 0x98E00000, offsets 0x00 and 0x08-0x3C are plain storage. The clock 0xE8 (seconds) and 0xEC (the 1/1024 s phase in bits 14..5) ticks with the lab clock; a write of 0xE8 keeps the phase, a write of 0 to 0xEC restarts it and any other value there is a bus error (A-SCPU-3). On the E144 family's bodies other than E139 and E134 the clock stands still, because a ticking counter sends E137's and E130's start into a NAND write the lab does not model. A write to the command register 0xF4 is stored, counted and printed, and a read of 0xF4 returns 0 (A-SCPU-1). On the E143 board (E143, E146, E147) the event word 0x98 and the port words 0xA0-0xB8 are modelled: port k reads the level the lab sets in bit 31 and 0 in its other bits (A-SCPU-4), and a write to it is a bus error; a change of a level, either way, sets the port's bit in 0x98, a write to 0x98 clears the bits it has set, and IRQ 320 is high while a bit is pending. The lab sets the levels through a doorbell; it attaches IRQ 320 and registers UI_IN's callback itself, as the SCPU init and UI_IN's port init (neither runs) would, and refuses any other callback. Any other access raises a bus error. The requests the firmware sends to the sub-CPU through the task PER_SCPU (which does not run) are answered at the request API by S-SCPU: set and get the date, write and read the backed-up word, plus a body's listed writes without an answer (E134's 0x21). The reply is written and the completion called before the API returns, so the requester's wait finds its flag already set. Any other command stops the session.

**Expected / concern:** The real sub-CPU answers over a serial channel some time later, while the requester waits and other tasks run; here no task runs in between. What the sub-CPU keeps is inferred: the date as last set, status included, advancing with time, and one word per index, all blank (no date, words 0) at the start of every session unless S-NVRAM restores them. PER_SCPU's own start, the sub-CPU's inbound messages (the port scan, the power manager's messages, USB power delivery), the request bits 0x9C, the transfer channels and their IRQ 321 are not modelled. The power lever, the Fn lever and S1 reach UI_IN through the port words and IRQ 320 natively, but only from the lab's inputs: the sub-CPU's three request lines (ports 3 to 5) stay high, so nothing the sub-CPU would report on its own arrives. That an event bit is set on either edge, that a write to 0x98 clears bits, and the port words' other bits are inferences; the CPU takes IRQ 320 only at the idle point (2.1), which is where a key arrives in the lab. Off the E143 board the event and port words are storage and group 0 is pushed as the other groups (S-KEYBITS).

**Confidence:** high

## 7. Firmware behaviour replaced by the host (HLE)

### 7.1 Heap replaced by host allocators

**Where:** `emu/src/lab/hle.mjs:178-203`, `emu/src/lab/play.mjs:353-384`

**Emulator:** The base HLE replaces malloc with a bump allocator that rounds to 16 bytes and never reuses memory, and free does nothing. Play mode (S-HEAP) uses exact-size free lists in 16-byte size classes, with a 16-byte minimum. It keeps blocks freed from before play mode and detects double frees.

**Expected / concern:** The firmware heap has its own placement, headers, fragmentation and failure behaviour. Addresses, and any bug that depends on heap layout or reuse (use after free, overruns into neighbouring blocks), differ from hardware.

**Confidence:** high

### 7.2 Boot steps skipped or guarded; expected firmware errors whitelisted

**Where:** `emu/src/lab/kernel.mjs:66-77`, `emu/src/lab/display.mjs:51-58`, `emu/src/lab/display.mjs:603`, `emu/src/lab/display.mjs:620-676`

**Emulator:** Kernel boot skips K-IPI (and replays its KCB effect), the kernel start and K-BOOTSYNC. In `calls` mode it also skips K-SELFTEST and K-INTC. In native mode H-VECINIT is run by the harness before the kernel entry. The software-timer init runs under H-TIMER: calls into the hardware-timer helpers get fixed return values, and reaching the hardware-timer programming functions is an error. The hardware timer init 0x500642DD is not run. Two firmware error-log codes are expected and filtered out (`EXPECTED_ERRLOG`). One is the empty camera state store; the other is a mode from that store being 0.

**Expected / concern:** On hardware these steps run and program real peripherals. The two allowed errors show that the emulated environment lacks state the real camera has.

**Confidence:** high

### 7.3 RTOS event-flag services are partly host stand-ins

**Where:** `emu/src/lab/rtos.mjs:62-88`, `emu/src/lab/display.mjs:368-374`, `emu/src/lab/display.mjs:401-411`, `emu/src/lab/display.mjs:480-507`

**Emulator:** The base observer keeps event flags on the host. OlyEvSt ORs bits in. OlyEvWt first delivers pending HLE interrupts, then raises "would block forever" if the bits are still not set. On success it clears the waited bits (`rtos.mjs:86`). OlyEvCl raises "semantics not established". The display and play labs replace OlyEvCl with a stand-in that ANDs the flag with the given pattern (`display.mjs:502-507`). They also turn vsync waits into RUN_TO_FRAME and OlyTaSS into lab-time advances.

**Expected / concern:** Real waits block the task and let the scheduler run others. They never fail just because no interrupt has happened yet. Clearing the waited bits automatically assumes a flag attribute that may not match each real flag. The AND semantics of the OlyEvCl stand-in are an assumption.

**Confidence:** medium

### 7.4 Peripherals behind firmware drivers answered by stubs

**Where:** `emu/src/lab/display.mjs:516-533`, `emu/src/lab/play.mjs:405-411`, `emu/src/lab/text.mjs:77-82`

**Emulator:** I2C reads return zeros. The exception is play mode's touch-panel register, which returns a harness-supplied image of up to 11 bytes. `prop_get` returns only properties the harness provides and otherwise raises an error. S-SET supports only the language setting and raises an error for any other setting ID.

**Expected / concern:** Real sensors, touch controller and settings store return live, varied data. Code paths that depend on other values are not reached.

**Confidence:** high

### 7.5 Camera application replaced by host rules; ten controls not wired

**Where:** `emu/src/lab/play.mjs:145-150`, `emu/src/lab/play.mjs:755-792`, `emu/src/lab/play.mjs:903-933`, `emu/src/lab/playui.mjs:16-17`

**Emulator:** The firmware's camera application layer is not run. S-CAMSEQ sends fixed GUI events depending on GUI state and key: 125 on closing, 135 for MENU in the shooting state, 133:1 for PLAY and 185:0 for OK on the shooting panel. The OK row's note calls the 185:0 mapping an inference. S-KEYMAP maps UI_IN codes to GUI indices through hand-written `gui` triples. AEL/AFL, Fn1-3, ISO, exposure compensation, C-AF, Drive, BKT and the lock lever are marked not-wired.

**Expected / concern:** The real application interprets keys in its own state machine, and much of it is not represented. Behaviour beyond these few rules, and any control that is not wired, does nothing or behaves differently.

**Confidence:** high

### 7.6 HLE stub budget ignores folded builtins; default instruction limit

**Where:** `emu/src/lab/hle.mjs:140-172`, `emu/src/lab/hle.mjs:206-207`, `emu/src/machine.mjs:45`, `emu/src/lab/sim.mjs:60-62`

**Emulator:** `_loop` sets `this.drained = 0` and adds it to `used`, but nothing increments it: the host-folded builtins (PERF2) are not implemented. Folded memset/memcpy work therefore never counts toward the per-call stub limit. `createMachine` defaults to `insnLimit = 1000000`, and `Simulator` maps `null` to the same value. A continue with default arguments ends in a limit fault (fault 7) after one million instructions.

**Expected / concern:** These are harness limits, not hardware behaviour. They can still stop a long but correct run.

**Confidence:** medium

## 8. What the tests establish

### 8.1 Above the ISA, the tests are emu's own regression data

**Where:** `emu/test/fixtures/isa_vectors.json`, `emu/test/test_vectors.mjs`, `emu/golden.json`, `emu/checks/fixtures/`

**Emulator:** Only the ISA layer is checked against data from outside emu. Of the 5,311 ISA vectors, 3,392 come from GDB 15.2's `sim/mn10300`, 468 from that simulator corrected per the ISA manual, 728 from the manual alone and 723 from the project's UDF spec (`emu/test/fixtures/isa_vectors.json`, `out.src`). PSW comparison masks out the bits a vector marks as undefined, so values of undefined flags are not checked. For devices, interrupt timing and the lab, `golden.json` and the checks' pinned fixtures were recorded from emu itself: they catch a change, but wherever emu is wrong, the tests agree with it.

**Expected / concern:** Instruction semantics are anchored outside the project. Device behaviour, interrupt acceptance and everything above them are anchored only in emu's own model and the firmware's own code; no test reads data captured from a camera.

**Confidence:** high

## 9. Host differences (node vs browser)

### 9.1 Behaviour differs between hosts

**Where:** `emu/web/worker.mjs:94-96`, `emu/host/labworker.mjs:35-42`, `emu/src/lab/play.mjs:1371-1375`, `emu/web/driver.mjs:73-90`, `emu/src/fw/labfw.mjs:32-41`, `emu/checks/lib/env.mjs:51`, `emu/src/machine.mjs:54-68`, `emu/bin/debug.mjs:122`, `emu/bin/debug.mjs:159-162`

**Emulator:** The node worker posts every status as `JSON.stringify` text, while the browser worker posts the document object, which goes through structured clone; a value JSON and structured clone carry differently (a class instance with `toJSON`) would read differently in the two pages. The WINDOWS debug token needs `env.deflate`, which only the node host supplies, so the browser player rejects it. The browser driver has no `--replay`. Node loads the whole resource block (`loadBlock`), while the browser uses the checked prefix returned by `labFirmware`. By default the machine's stderr is a 2000-line ring that drops 1000 lines at a time. The `bin/debug.mjs` CLI builds its `Simulator` without `keepStderr`, and on a fault it calls `stderrSince(0)`, which throws if any lines were dropped.

**Expected / concern:** The two hosts can show different results for the same session. A long faulting CLI run reports a host error where it should print its trap lines.

**Confidence:** medium

