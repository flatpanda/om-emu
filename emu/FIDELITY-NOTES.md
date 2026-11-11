# emu emulation fidelity notes

These notes list where emu departs from real OM-1 hardware and firmware, or where it probably does: approximations, stubs, skipped behaviour and suspected inaccuracies. Several gaps below (2.2, 2.3, 3.2, 3.6) are choices of emu's own model with no basis in the hardware or the manual. They are work items, not constraints: the CPU and interrupt items are planned as "ground the CPU and interrupts in the manual" and the time and delivery items as "time and the HLE boundary" in `docs/ROADMAP.md` "Emulator architecture", and only camera captures can settle the display-side notes (5.x) and the panel and stub answers (4.2, 7.4). The order of authority is in `emu/ARCHITECTURE.md` "Ground truth".

Each note was checked against the cited code. Paths are relative to the repository root. The confidence level is how sure we are that the note describes a real gap or inaccuracy. It does not say how much the gap matters.

## 1. Time and device timing

### 1.1 Device time does not advance with CPU execution

**Where:** `emu/src/dev/timer.mjs:10-32`, `emu/src/dev/vsc.mjs:300-326`, `emu/src/dev/vsc.mjs:122-127`, `emu/src/dev/timer.mjs:113-123`, `emu/src/lab/display.mjs:467-471`

**Emulator:** The shared lab `Clock` moves only through the VSC doorbell commands ADVANCE, RUN_TO_FRAME and RUN_TO_EVENT. These are the only `clock.advance` calls in the tree (`vsc.mjs:303,309,325`), and the harness reaches them through `display.mjs:467-471`. Executing instructions never moves `clock.t`. As a result, timer channels 1-32 never expire, frame boundaries never happen and MONI3 (`vsc.mjs:122-127`) never changes between doorbells. Every channel started between two doorbells gets the same `t0 = clock.t` (`timer.mjs:118`).

**Expected / concern:** On hardware, timers, raster position and frame interrupts run in step with CPU time. A firmware loop that busy-waits on a timer status bit or on MONI3 cannot end unless the harness steps in. The relative timing between the CPU and devices, such as how many instructions run per frame, is not represented. One exception is the us clock (channel 33's counter at 0x284 on E143): within one lab instant each CPU read still takes one count, so a busy wait on it ends without lab time moving (see 1.2).

**Confidence:** high

### 1.2 Timer period and channel-33 counter are lab assumptions

**Where:** `emu/src/dev/timer.mjs:125-135`, `emu/src/dev/timer.mjs:136-162`, `emu/src/dev/timer.mjs:56-64`

**Emulator:** A channel's period is fixed at `(reload + 1) * 1000` ns, which is a 1 MHz tick (A-TMR-1/A-TMR-2). There is no prescaler or clock-select register, and CTL accepts only bits 0xC0 (`timer.mjs:173`). Only channels 1-32 have periods and interrupt lines. Channels 0 and 33 are started at reset (H-RESETTIMER) but never expire. Since 2026-10-31 the us clock (channel 33's counter 0x284; the board's `us_channel` on the other families) counts the lab microseconds since its load from the reset on every lab (A-USLAB, USMODE 1, `usCount`), and a CPU read gets at least one count more than the read before (H-USCOUNT's old rule, kept so that a busy wait inside one lab instant ends); USMODE 0 is H-USCOUNT alone (one count per read, lab time ignored), the player's `--us-clock reads`. Until then every lab counted reads only until the player's bring-up switched A-USLAB on, and A-USLAB added the reads to the lab microseconds. Channels 1-32 have no readable current-count register.

**Expected / concern:** The real timer block very likely has clock-source and divider selection. The us clock now follows lab time as a free-running counter follows time, but lab time does not move with CPU execution (1.1): a busy wait on the clock runs ahead of lab time by its reads, and an interval measured inside one lab instant is the number of reads, not the time the instructions would take. Before 2026-10-31 a wait with sleeps between its reads lasted as many reads as its microseconds: the E144 family's open-time wait of 150 ms took 300 s of lab time (`docs/model-survey.md` findings 63, 64).

**Confidence:** medium

### 1.3 OSD draw engine finishes inside the CPU store that starts it

**Where:** `emu/src/dev/engine.mjs:1-3`, `emu/src/dev/engine.mjs:302-313`

**Emulator:** Writing 1 or 2 to register 0x24 runs the whole command list or FIFO synchronously (`runList`/`runFifo`) inside that store. The done bit (`regs[1] |= 1`) and IRQ 310 are raised before the store returns.

**Expected / concern:** A real blitter takes time that depends on the work. Firmware never sees a busy state, and it gets the completion interrupt at the instruction right after the start. Ordering bugs or races that depend on engine latency cannot occur.

**Confidence:** high

### 1.4 Display output is produced only on harness request

**Where:** `emu/src/dev/vsc.mjs:154-167`, `emu/src/dev/vsc.mjs:311-316`, `emu/src/lab/display.mjs:1078-1084`, `emu/src/lab/play.mjs:980-983`

**Emulator:** A frame boundary only latches the mirror bank and sets INTST1 bit 0 (`boundary`), and bit 8 where it ends a histogram run (`docs/om1-vsc-spec.md` section 13). Pixels are produced only when the harness rings the COMPOSE doorbell, which is the only caller of `compose()`. The visible image is a snapshot of the latched registers and memory at a time the harness picks.

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

One such divide is met in the lab (2026-10-29): E144 with an exFAT card divides by 0 at `0x5032574f` (its movie parameters, with the blank settings store's 4K 60p mode, `docs/hle-gaps.md` 4.8.7), and the quotient then decides a compare (the quotient kept, or 0). The manual gives that divide V=1 and leaves Dn, MDR, N and Z undefined (`docs/mn10300-isa-spec.md` 4.6 and 8 item 1), so there is no value to model and it stays a stop; a hardware capture of DIVU by 0 would settle it.

A second is met on E118 (2026-10-31): its movie record time divides by the movie recorder's frame rate without a test (`0x50535c40`), and the rate is 0 until a movie take or a movie's playback sets it up, on the camera too (`docs/model-survey.md` finding 59). There the quotient goes only to a field two of the query's seven callers read, none on the lab's paths, so S-MOVRATE stands in for that divide alone: not executed, its quotient taken as 0. The value is the lab's; the same capture would settle it.

**Confidence:** high

### 3.3 Page-crossing non-prefix instruction: wrong fault address and fault counted (fixed 2026-10-29)

**Where:** `emu/src/core/cpu.mjs` step and limitFault, `emu/src/core/interp.mjs` decode

**Emulator:** Until 2026-10-29 the up-front code fetch of a non-prefix form in `step()`, `decode()` and `limitFault()` read byte 0 and then bytes 2 onward, leaving byte 1 to the execution. With pc+1 the first unmapped byte, a 2-byte form then faulted in its execution and was counted (with an exec-trace line in the one-instruction mode only), and a longer form reported pc+2 as the fault address. All three now read every byte once, in order, as the MMIO refetch path already did: the fault is the uncounted fetch fault 2 at the instruction's pc with the first byte that cannot be read as its address, before the insn limit's fault 7, in every mode (`emu/test/test_debug.mjs` traceRuleUnits fetchFault). No session of the golden workload meets the case.

**Expected / concern:** None left of the note; the hardware sees the fault on the first byte it cannot fetch.

**Confidence:** high (the fix), as for the note before it

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

**Emulator:** Any address in 0x80000000-0x9FFFFFFF with no device region goes to the lab stub. If the harness has allowed the address, the stub returns an enabled preset value, else the bytes the CPU last wrote there, else 0. All other addresses are DENIED, which is a bus error. Several lab-only windows are mapped as CPU-readable K_ROMD regions inside that range: VSC output, debug and doorbell at 0x89000000-0x89810003, the stub window at 0x89900000, the INTC and timer debug windows and doorbell at 0x89A00000-0x89A20003, HLE at 0x89A30000-0x89A33FFF, and the OSD debug window at 0x8E000000. On the E143 board the SCPU's lab doorbell at 0x89A40000 is MMIO that refuses reads and every store but the lab's command. With the machine's hdmi option the HDMI port's sink window at 0x89A50000 (K_ROMD) and its doorbell at 0x89A51000 are added (4.5). Region lookup comes before the stub fallback.

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

### 4.5 HDMI port: the driver's path through the transmitter, one GIO pin and a lab sink (`--hdmi on` only)

**Where:** `emu/src/dev/hdmi.mjs`, `emu/src/fw/board.mjs` (hdmi), `emu/src/machine.mjs:126`, `emu/src/lab/display.mjs` (H-GIOSLOTS, hdmi_line), `emu/src/lab/play.mjs` (hdmi_input), `emu/src/lab/camapp.mjs` (S-OUTDEV), `emu/src/lab/edid.mjs`

**Emulator:** Only when the machine's hdmi option is on (the play option `--hdmi on`, on E143, E146 and E147); otherwise every address below stays the lab stub's. The transmitter's registers at 0x99C07000 are a byte file reached by aligned words: register 8 reads the sink's hot-plug detect and receiver sense (bits 3, 4), 0x90 reads a summary of the three interrupt groups (bit 2, 4, 6 while 0x92 & 0x9A, 0x94 & 0x9C, 0x96 & 0x9E), 0x92 / 0x94 / 0x96 clear the bits written to them, and IRQ 239 is high while 0x90 & 0x98. A write applies only to the byte lanes the lane word at 0x99C08000 (form (keep << 16) | 1) does not keep. Command 130 to 0xA83 copies 0xA82 + 1 bytes of the sink's EDID from 256 x 0xA80 + 0xA81 into the buffer at 0xC00 (byte and word reads) and sets 0x94 bits 7 and 5 at once. Command 128 is taken only as the HDMI open's SCDC write (slave 0xA8, offset 0x20, one byte), which the lab sink, having no SCDC, does not acknowledge: 0x94 bits 7 and 6 at once. A write of UPDCTRL (0x11) with bit 7 sets 0x96 bit 7 at once. The other registers of the 38 words the init, the plug and the open use are storage, reset 0, and so are the six PHY / PLL words beside the lane word (0x99C08004, 0x40, 0x44, 0x48, 0x54, 0xFC; the lab stub's until 2026-11-08). Any other word, width, command or DDC write, a read past the EDID, a write to 0x08 or 0x90, or another lane word or word of the lane page is a bus error. The doorbell's unplug drops the sink's lines and the pin and sets 0x92 bits 0..3 (A-HDMI-1). The hot-plug pin's words: the level word 0x9B881540 reads the pin in bit 4 (writes refused), the GIO group's status 0x9B883038 gets bit 0x40 when the pin rises and clears the bits written to it, the enable word 0x9B883178 is storage, and IRQ 109 is high while status & enable. The sink is a lab fixture (S-HDMISINK): a 1080p60 EDID with a CTA-861 block composed for the lab; the input hdmi plug writes it into the window and rings the doorbell. Before the display init the lab runs the GIO init's slot reset (H-GIOSLOTS), without which the display init's pin registration is refused.

**Expected / concern:** The register semantics are read from the driver (D) but for these inferences: the summary's bits and IRQ 239's condition, write-1-to-clear, 0xA82 as count - 1, command 130 as an E-DDC read completing at once with done and success (a real DDC read of 128 bytes takes milliseconds at 100 kHz and can be NACKed; neither is modelled), the reset values, and that the GIO status bit follows a rising pin. A falling pin sets nothing (A-HDMI-1; the firmware has turned the pin's interrupt off by then, D). At an unplug the model sets 0x92 bits 0..3, both bits of the hot-plug detect pair and of the receiver sense pair (A-HDMI-1): which bit of a pair a falling line sets, and whether a rising one sets any, is not read; the driver enables all four, takes and clears each pair whole and runs the same hot-plug handler for either pair, which reads the lines from 0x08 (D), so the choice does not change its path, but a transmitter that flags only one pair, or delays the flag, is not modelled. The SCDC write's NACK and the update's completion at once are inferences (I: the IRQ handler's patterns, the open's "Update Done" after the wait); the open's other registers (PHY, infoframe and packet words) are stored without effect, so a picture the TV would show is not derived from them. A cable in at power-on is not modelled (whether the pin's interrupt type 0 is an edge or a level is unknown). The GIO init's board pin setup does not run, so the pin block's other configuration is the stub's. The HDMI open is reached on E143 through S-OUTDEV, a stand-in for the component's part of TRA 588 (`docs/hle-gaps.md` 4.9); VSC channel 0 runs at the line time the firmware's format table gives and composes under A13 extended to the HDMI open's state (5.2). The sink's EDID is not a real monitor's, so a firmware quirk keyed to a vendor (0x501D3DB9 compares the parsed manufacturer with one id) is not exercised.

**Confidence:** medium

### 4.6 Accelerometer: stood in at its sample cache; its consumers run natively (E143, E146)

**Where:** `emu/src/lab/acc.mjs`, `emu/src/lab/play.mjs` (`acc_bring_up`, `tilt_input`), `emu/src/fw/models.mjs` (`acc`)

**Emulator:** At the play bring-up the ACC module init runs natively with its device part stepped over, and so does PER_SLOPE's init; ACC_MAIN (the probe, then every 80 ms the cache copy and the correction) and PER_SLOPE (every 20 ms while the GUI has started it) run as firmware tasks. The sensor's register API answers the probe from a register file: WHO_AM_I 0x6A and the two set-up writes; any other register access stops the session. The sensor itself, its data-ready pin, the sampler task ACC_SENS_MAIN and its PER_SIO transfer are not modelled: before each of ACC_MAIN's copies the lab stores one new sample where the read's completion would (the three accelerometer halfwords, the temperature word, the counter + 1). The sample is the firmware's pose-0 reference (0, -16384, 0) for a level camera, turned by the play input tilt (roll, pitch in degrees, within 45); the temperature reads 25.0 degC. With `--rotate on` (off by default) PER_ROTATE's init runs natively after PER_SLOPE's (H-ROTINIT), PER_ROTATE runs every 100 ms from the same samples, and the tilt takes any attitude (roll within 180, pitch within 90 degrees). The bring-up also runs one copy and correction from the lab task, as the samples a camera has had since its boot. The heap's pool-2 block get and release that Level Adjust calls are served by S-HEAP (7.1).

**Expected / concern:** The real sensor samples on its own clock (12.5 Hz by the probe's CTRL1_XL value, I) and reports noise, a temperature and the camera's actual attitude; here every sample is noise-free, exactly one arrives per ACC_MAIN cycle (A-ACC-2) and the temperature is fixed (A-ACC-1). Which physical direction a positive roll or pitch is has no camera evidence (A-ACC-3): the input is defined by what the gauge's getter reads back. Without `--rotate on` PER_ROTATE does not run, so the camera's orientation stays 0 (landscape) and larger tilts are refused; with it the orientation, its hysteresis and its event are the firmware's and the GUI lays the gauge out for portrait natively, but the picture's orientation tag is not reached (TAKE and REC_FILE do not run); PER_ACC_PWRMGR_MAIN, the gyroscope and the data-ready pin's interrupt are absent (the probe's enable of the pin writes two GIO words the lab stub keeps). The lab's factory calibration data are the image templates, whose gate keeps the correction off: Level Adjust's Adjust completes and writes the user table, but the gauge does not change, where a calibrated camera would zero it. Not modelled on E147 (different accelerometer code) or the other bodies.

**Confidence:** high for the consumers' code paths (native); medium for the sample (its form and scale are the firmware's, its timing and content the lab's)

### 4.7 Audio: a TX model of the audio serial port, a register file for the sound IC (E143, `--audio auto` or `on`)

**Where:** `emu/src/dev/audio.mjs`, `emu/src/fw/board.mjs` (audio), `emu/src/machine.mjs:142`, `emu/src/lab/audiohw.mjs` (H-AUDSTART, S-AUDCPU2, H-AUDTIME, the sink), `emu/src/lab/wm8946.mjs` (S-WM8946), `emu/src/lab/camapp.mjs` (`install`: AUD_EXEC left to AUD_MAIN), `emu/src/fw/models.mjs` (E143 audio)

**Emulator:** Only when the machine's audio option is on: the play option `--audio auto`, the default, turns it on for a body with MODELS `audio` (E143) and off for the others, `--audio on` asks for it and `--audio off` leaves it off (then every address below stays the lab stub's and AUD_MAIN does not run). The audio port at 0x9B700000 is a word register file with TX behaviour (A-AUDIO-1): a write of bit 10 / 11 to +0x44 arms slot A / B at the address << 4 and the length in +0x34 / +0x38 and +0x3C / +0x40; TX enable rising (+0x30 bit 2) sets status bit 4; TX run rising (+0x00 bit 5) plays slot A, then the other armed slot in turn, each fetched from memory as it starts and lasting its length / (48000 x 4) s of lab time (768 bytes: 4 ms); each slot's end sets its done bit (0 / 1) and bit 5, and IRQ 43 is high while the status & +0x50; a slot ending with the other not armed is an underrun and the port stops; a slot armed with length 0 is empty, and when its turn comes TX ends there, the port clearing TX enable (+0x30 bit 2) itself; clearing TX run lets the playing slot play out with no interrupt, and a new start while it plays cuts it there (the frames played so far kept); the status bits are write 1 to clear; +0x20 bit 24, which the port enable writes when +0x00 bit 0 is clear, is storage. The format must be one of the two TX configurations the driver writes for a 48 kHz 16-bit stereo WAV, the copy task's and the direct play's (+0x30 bits 3..6 0x8 or 0); any other, RX use, an arm outside memory or an SCA start (+0xA0) is a bus error. The SCA page at 0x9BB00000 is storage. The sound IC (a WM8946 on PER_SIO channel 14) is a 16-bit register file served at PER_SIO's channel API; a read of a register not written in the session is refused. AUD_MAIN starts natively at the bring-up (H-AUDSTART, with the image's stage 6 bit set), its two CPU 2 starts are answered and AUD_WAKEUP's reply posted (S-AUDCPU2). While the port plays, the lab's one-jump time moves (the vsync wait's run_to_frame, the sleeps' advance) go event by event and run IRQ 43's handler at each slot's end through the kernel's lab-delivered sources (H-AUDTIME). The played slots go to the host as PCM events of source `native`.

**Expected / concern:** The register offsets and the order of the driver's accesses are read from the code (D); what the bits mean is inferred from how the ISR `0x50AA90E2`, the re-arm `0x50AA8EF3`, the open `0x50AA9379` and the start `0x50AA95BE` use them (I): bit 4 as "TX ready" raised at enable, one interrupt per slot with bits 0 / 1 and 5 together, write-1-to-clear, +0x50 as the TX interrupt enable, lengths in bytes, a stop finishing the slot in progress (inferred from the firmware's end clearing TX run at the interrupt that starts the sound's last period), and no status bit at an underrun. That the port ends TX at an empty slot and clears TX enable is I, inferred from the driver's direct play, which arms slot B with length 0, does not reach the driver's one TX disable (the period callback's stop, which it takes only for a play slot whose byte +133 is not negative; aud_seq_play sets it to -1, D), and has command_play_end wait for the TX done callback that only the ISR's stop at a cleared TX enable calls (D, docs/hle-gaps.md 4.5); with it the AF beep's release runs every time (X). The two templates differ in two words, whose effect in the port is ? beyond +0x30 bits 3..6; the direct play's samples are taken as the same 16-bit stereo. The port fetches from the slot address register's value << 4, so a sample start off a 16-byte boundary plays from the boundary below it (D: the registers hold address >> 4); the lab-made beep's samples are 16-byte aligned for that reason (7.15). The rate is not read from the port: its clock words come from the system clock record, and 48 kHz is the rate the play path pairs with 16 bits (D). The real port's FIFO, its clock's drift against the CPU, its RX side and the 24-bit / 96 kHz path are not modelled. The sound IC's reset values are unknown, and AUD_WAKEUP's power-on list, which would write it from CPU 2, does not run; the codec's volume is not applied to the PCM, so the host hears the samples the port sends at full scale. H-AUDTIME delivers IRQ 43 inside a stand-in that holds the CPU for another task, as the kernel's lab sources are; AUD_COPY_DATA then copies up to one frame late, within the ring's 32 ms of lead (a sleep stand-in longer than about 28 ms would replay stale periods). With the vsync wait's jump left whole the port underran (X). Through the copy task, a sound's post_end (the usr_wave descriptor's +68, UI_OUT's release) and the end flag command_play_stop waits on come only from a period callback after the one that disables TX, which the ISR's stop in that same interrupt leaves none of for a sound playing alone (D): in the lab they come at the next sound's first IRQ 43, and a command_play_stop of a finished sound blocks AUD_MAIN (X; docs/hle-gaps.md 4.5). Which of the code's own alternatives avoids that on the camera is ? (another player keeping 0x62af27d5 above 0, the SCA mix, setting 0x5051); the AF sound avoids it by its direct play (0x62af27d6 = 1), whose one callback ends it at once (D, X). The debug API's advance and run-to-frame ring the VSC's doorbell directly and are not stepped by H-AUDTIME: one of them past several slot ends while the port plays underruns it. Three plays in one session, each released with command_play_end and the player's close, come out sample for sample (X).

**Confidence:** medium (the path is the firmware's own and runs end to end on a lab WAV; the port's bit semantics and timing are inferred, and no camera recording checks the output)

## 5. Display (VSC) and OSD engine

### 5.1 VSC register validity comes from the firmware image under test

**Where:** `emu/src/dev/vsc.mjs:80-93`, `emu/src/dev/vsc.mjs:155,194,257,313`, `emu/src/dev/vscregs.mjs:1-10`, `emu/src/core/mem.mjs:226-235`

**Emulator:** The first access to the VSC register file, a frame boundary or a COMPOSE reads the register-name tables from fixed offsets in the E143 v1.9 image (0x331DA0 and 0x332D60). On any other image the read fails and `tables()` throws a plain `Error` inside the CPU store or load. A plain `Error` is a host failure, which leaves the machine HostStopped instead of raising a bus fault.

**Expected / concern:** The hardware register map does not depend on the firmware. The model only works with this one image, and on another image it fails as an emulator crash, not as a guest-visible error.

**Confidence:** high

### 5.2 COMPOSE checks a fixed configuration and supports few formats

**Where:** `emu/src/dev/vsccompose.mjs:30-33`, `emu/src/dev/vsccompose.mjs:116-149`, `emu/src/dev/vsccompose.mjs:239-299`, `emu/src/dev/vsccompose.mjs:173-228`

**Emulator:** COMPOSE accepts only channels 1 and 2, and on E143 channel 0 in the HDMI open's A13 state (FEATURES_HDMI, since 2026-11-08). It requires progressive mode (`:244`). Each FEATURES register must equal one fixed observed value per channel, and any other written value gives FEATURE_UNOBSERVED (`:273-291`). The mix registers are checked against fixed values (`:262-270`). PLANC must be 0 or 0x100, and the IMG format must be 0 (YC 4:2:2). With the A19 opt-in IMG3 may instead be format 2 at PLANC 0x1000 or 0x1100, the face/AF frame plane (bit 12 the
format setter's per-pixel alpha bit, the level at 0 or at the full 128; `docs/om1-vsc-spec.md` section 9 item 12). A
level between 1 and 127, such as the EVF menu's 0xb2 (DISPLAY cmd 30), is refused: how the chip blends it is not
known. OSDFMT1/OSDFMT2 must be 0x111/0x11. SPOS is supported only in a restricted form, and resize only for the RSZ1 bits 0x11 with no extra resize registers. PEAK/BC must have the observed values. Both IMG planes (`drawImg`, two-tap linear) and OSD planes (8-bit index, nearest sampling, blending through the palette) are implemented.
With the A-VSCHIST-3 opt-in (camapp 3) the histogram unit's six registers, in the forms of their only writers, are
accepted as leaving the picture unchanged, an assumption (`docs/hle-gaps.md` 4.2.4).

**Expected / concern:** In practice this is a check that the firmware set up the configuration seen so far. It is not a general compositor. Any other mode the firmware uses (other formats, scaling, peaking, channel 0) produces an error and no image.

**Confidence:** high

### 5.4 Kind-2 VSC (the E144 family): one channel for the TFT and the EVF, and an OSD scaler by analogy

**Where:** `emu/src/dev/vsc.mjs:169-179`, `emu/src/dev/vsc.mjs:195`, `emu/src/dev/vsc.mjs:411-413`, `emu/src/lab/display.mjs:946-954`, `emu/src/dev/vsccompose2.mjs:81-99`, `emu/src/dev/vsccompose2.mjs:133-139`, `emu/src/dev/vsccompose2.mjs:163-173`

**Emulator:** Channel 0 drives the TFT and the EVF, each with its own vertical-total register (SYNC2, SYNC8). The channel runs from the one the firmware wrote last, at the line time the harness derives for that device from its frame period word, and a change of bank starts a new frame at once. The compositor scales an OSD plane when the control word of its six resize words is 0x11, reading the next words as E143's OSD steps (source pixels per output pixel in 1/4096) and sampling as E143's OSD planes do (columns rounded half up, rows floor). IMG planes are not composited (FMT_UNMODELLED). The OSD planes are stacked by the word at 0x1a4 (OSD1), the order code the plane open writes and the layer-custom path replaces (2026-11-10, `docs/model-survey.md` finding 96): code k's three planes from the top as the GUI's GPISetOsdOrder table lists them, 3 (OSD1, OSD3, OSD2 from the top) on most bodies, 2 (OSD3, OSD1, OSD2) on E144 and E148, GUI layer 1 at the bottom on both; a word that is not a code 0..5 is refused (2026-11-02: 3 drew OSD1 at the bottom and 2 OSD3 at the bottom).

**Expected / concern:** Which register selects the bank on the chip, and what the panel shows while the firmware switches, are not read; the bank rule rests on the firmware's timing writer storing one of the two registers per device. The scaler's layout rests on the values the EVF start writes (control 0x11, steps 0x9FC for a 640 x 480 source on a 1024 x 768 area, which E143's step form gives for those sizes), not on E144's step setter, so another scale factor or filter would show here as a wrong picture, not an error. The order word's meaning is read from the code that writes it (the GUI's table of six orders, D), its reading as the planes from the top inferred: the builds that write 2 put GUI layer 0 in OSD3 and layer 2 in OSD1 (their commit, D), which only that reading makes the same order as the others', and the GUI's layer 1 holds the menus' background under layer 2's rows (X); the chip's own definition of the word is not read.

**Confidence:** medium

### 5.5 OSD bitmap formats 9 and 1 decoded from the data

**Where:** `emu/src/dev/engine.mjs` (`cmdBitmap`, cases 0x09 and 0x01), `emu/refs/osdfmt.mjs` (`TOKEN`)

**Emulator:** A bitmap of format 9 is a byte stream of 8-bit tokens, a 2-bit colour index over a 6-bit run (run = low six bits + 1), mapped through the command's inline table as formats 2 and 0x0A are. The layout comes from the E144 family's resource blocks, where every format-9 bitmap found decodes so to exactly its width x lines, and from E140's AF frame, which draws them with a four-colour inline table.

A bitmap of format 1 (2026-10-29) is a stream of 4-bit tokens, low nibble first, a 2-bit colour index over a 2-bit run, through the inline table: E145's capture display draws two such bitmaps from DRAM, and both decode so to exactly width x lines, ending where the descriptor after each begins, with no run across a row end (high nibble first, 12 runs cross one; `docs/model-survey.md` finding 20).

**Expected / concern:** No format-9 bitmap is wider than 32 or has a run over 32, so bit 5 could as well be a third colour bit that is always 0; the engine's own definition of either format is not read. Format 1 rests on two bitmaps and a noisy scan of the resource blocks (303 places on E145 decode so, where a format no bitmap has finds 27), not on the engine's documentation; that format 1 is not the 8-bit twin of 9 (as 2 is of 0x0A) is shown by those two bitmaps only.

**Confidence:** medium

### 5.6 Kind-3 VSC (the E118 family): the line compare raised as the scan reaches the line

**Where:** `emu/src/dev/vsc.mjs` (`nextLine`, `clockFire`), `emu/src/fw/board.mjs` (the family's `vsc.line_irq`, with the evidence)

**Emulator:** While INTEN1 holds bit 4, the channel raises INTST1 bit 4 (and its IRQ) at the lab time its scan reaches the line in +0x260's low half (masked to the line count's 11 bits), once a frame; a line the scan has passed when the bit is enabled waits for the next frame, and a line past the frame's end never comes. The EVF panel's command scheduler runs on it (E120, E122), which their display task waits for before an EVF mode change such as playback's (`docs/model-survey.md` finding 70).

**Expected / concern:** That the compare counts MONI3's lines from the frame's start, and fires once as the scan crosses the line, is inferred from the driver's arm and ISR, not from the chip. Bit 5, which the ISRs test with bit 4, has no source the code read enables, so it is never raised. The scheduler then times the panel's command on hardware timer 3 from MONI3 and the latched vertical total, which the lab's line clock answers; whether the panel's command lands in the line the camera's does is not checked.

**Confidence:** medium

### 5.3 OSD engine opcodes 0x41 and 0x60 not executed

**Where:** `emu/src/dev/engine.mjs:218-231`, `emu/src/dev/engine.mjs:340-349`

**Emulator:** `commandLength` gives lengths for 0x41 (2 words) and 0x60 (5 words), so lists that contain them parse. `execute` handles only 0x10 (fill), 0x20 (copy), 0x30 (bitmap) and 0x40 (LUT), and reports OPCODE_UNMODELED for the others.

**Expected / concern:** Hardware performs those operations. Firmware paths that use them produce no drawing.

**Confidence:** high

## 6. Other CPUs and the sub-CPU

### 6.1 Only CPU 0 runs; the other cores are faked or rejected

**Where:** `emu/src/lab/kernel.mjs:46-53`, `emu/src/lab/kernel.mjs:107-109`, `emu/src/dev/intc.mjs:98-117`, `emu/src/lab/play.mjs:495-530`

**Emulator:** `NativeKernel.boot` refuses any CPU other than 0. It fills the other three KCB-table entries and fills each of their queues with 256 bytes of 0xFF. Setting IPI pending bits in banks 1-3 only appends to the xcpu ring. The inter-CPU handshake 0x5001258B raises a FirmwareError. In play mode, S-CPU2 serves exactly one allowed post (function 0x60ACB193, argument 0, from core 0 with the expected bank-2 bit). It copies a fixed snapshot and posts a reply. Command 3, the swap path at 0x50AAAD0E, raises an error. With `--audio on`, S-AUDCPU2 answers AUD_MAIN's two cross-core starts (OlyTaStCpu 0x5002D325 for 0x2017 and 0x200E) with E_OK and posts AUD_WAKEUP's reply call on ring [0][2]; AUD_WAKEUP's power-on list and AUD_LEVEL_MONITOR's work do not run (4.7). CPU 3's DISP_FRAME (S-DISPFRAME) and, on E143 while subject detection is on, its MDET_DL tasks (6.3) run on the lab CPU at single call sites; S-CPU3 serves ring [3][0]'s posts of those two and refuses any other. Behind `--cpu2 native` (E143, off by default) CPU 2 runs its own firmware on a second core instead of S-CPU2: its boot and kernel through H-CPU2RELEASE, H-CPU2CACHE, H-CPU2UART, K-BOOTSYNC2 and K-STARTBITS, its idle loop with H-CPU2POLL, interrupts at any instruction (H-CPU2GATE), CPU 0's CPUCONN (H-CPUCONN0), USTART_L2 stood in (H-CPU2LOADER) and the queue tasks CPU 0's boot stages start (H-CPU2TASKS), under A-CPU2RESET, A-COREPAGE, A-COREID, A-INTERLEAVE and A-KICK (`docs/hle-gaps.md` 4.6.1, 4.6.2).

**Expected / concern:** The real system has four cores working together through IPIs, shared queues and the ISC locks. Any work handed to the other cores happens only where the harness copies its effect, and races between cores are never exercised.

**Confidence:** high

### 6.2 SCPU (sub-CPU): window storage, a ticking clock, the port words and the sub-CPU's link

**Where:** `emu/src/dev/scpu.mjs`, `emu/src/dev/linkpins.mjs`, `emu/src/lab/scpudev.mjs`, `emu/src/lab/scpulink.mjs`, `emu/src/lab/menu.mjs` (`store_init`), `emu/src/lab/play.mjs` (`scpu_port_bring_up`, `port_group`)

**Emulator:** In the window 0x98E00000, offsets 0x00 and 0x08-0x3C are plain storage. The clock 0xE8 (seconds) and 0xEC (the 1/1024 s phase in bits 14..5) ticks with the lab clock; a write of 0xE8 keeps the phase, a write of 0 to 0xEC restarts it and any other value there is a bus error (A-SCPU-3). On the E144 family's bodies other than E139 and E134 the clock stands still, because a ticking counter sends E137's and E130's start into a NAND write the lab does not model. A write to the command register 0xF4 is stored, counted and printed, and a read of 0xF4 returns 0 (A-SCPU-1). On the E143 board (E143, E146, E147) the event word 0x98 and the port words 0xA0-0xB8 are modelled: port k reads the level the lab sets in bit 31 and 0 in its other bits (A-SCPU-4), and a write to it is a bus error; a change of a level, either way, sets the port's bit in 0x98, a write to 0x98 clears the bits it has set, and IRQ 320 is high while a bit is pending. The lab sets the levels through a doorbell; it attaches IRQ 320 and registers UI_IN's callback itself, as the SCPU init and UI_IN's port init (neither runs) would, and refuses any later callback; PER_SCPU registers its own natively at its start. Any other access raises a bus error. Port 3 is the sub-CPU's message line: its level is the sub-CPU model's (high, nothing posted), and the lab's doorbell may not pull it low. The task PER_SCPU runs natively (started at the store init) and talks to a model of the sub-CPU (S-SCPUDEV) over PER_SIO channel 2 and the GIO pins 102 (ready), 103 (request) and 107 (reset). The pins are modelled at the register level: their pin words and pin 102's status, enable and IRQ 119. PER_SIO is not: its channel API is answered for PER_SCPU's channel (S-SIO2), the bytes of a transfer reach the model at once and the transfer's end is delivered, in interrupt context, at the next idle point. The model follows the sub-CPU firmware's code for the transport (the 10-byte receive, the power-on gate, the reply frames, long transfers) and for the handlers of 0x85, the date (0x01 / 0x81, with the RTC's valid flag in backup register 1) and the backup words (0x06 / 0x86), plus a body's listed writes without an answer (E134's 0x21). Any other command, and any frame the sub-CPU's gate refuses, stops the session.

**Expected / concern:** The real sub-CPU reacts within microseconds of each edge or transfer; the model reacts only when the MN idles, one action per idle point and in zero lab time (A-SCPUDEV-1), so only the order of the edges is the camera's, and a busy poll of pin 102 in task code (the power-off path's) would never see a change. That pin 102's interrupt is level-sensitive (A-LINKPINS-1), the zeros the sub-CPU shifts out while it receives, its state across a reset and that it has booted at once are inferences. Its memory is blank (backup registers 0, no RTC date) at the start of every session unless S-NVRAM restores it, which the players do by default since 2026-11-08 on E143, E146 and E147 (the tools and tests run blank). Under S-NVRAM the RTC takes the host's local time once, as the session starts, and then advances with lab time, so the camera's clock falls behind the host's wherever the lab runs slower than real time (`--idle off`, a busy lab; I) and is right again at the next session's start; before 2026-11-08 it followed the host's clock throughout, which made a kept session impossible to replay. The window's clock then counts from 1970, which the camera's clock read (E143 0x5005a59e, run natively at a capture since 2026-11-02) takes for no date: a picture's record, and INFO's date, carry the build's default (E143 2022-01-01 00:00, status 10501) where a camera with its clock set would carry the date. The sub-CPU posts no message, so the poll and the inbound messages (the port scan, the power manager's messages, USB power delivery) do not run; the request bits 0x9C, the transfer channels and their IRQ 321 are not modelled. On E139 and E134, whose sub-CPU firmware is another lineage, the model answers as E143's sub-CPU; only their MN side (pins, channel, frames) is read. The power lever, the Fn lever and S1 reach UI_IN through the port words and IRQ 320 natively, but only from the lab's inputs: the sub-CPU's three request lines (ports 3 to 5) stay high, so nothing the sub-CPU would report on its own arrives. That an event bit is set on either edge, that a write to 0x98 clears bits, and the port words' other bits are inferences; the CPU takes IRQ 320 only at the idle point (2.1), which is where a key arrives in the lab. Off the E143 board the event and port words are storage and group 0 is pushed as the other groups (S-KEYBITS).

**Confidence:** high

### 6.3 CPU 3's MDET_DL on the lab CPU, the DML engine, the PDT / TRC unit and the EMS1 engine register files (S-MDETDL, S-TAKEMDET, S-LEARNDATA, S-DML, S-PDT, S-EMS1, H-FCSAF, H-MDETINIT; E143)

**Where:** `emu/src/lab/mdet.mjs`, `emu/src/dev/dml.mjs`, `emu/src/dev/pdt.mjs`, `emu/src/dev/ems1.mjs`, `emu/src/lab/camapp.mjs` (`drain_cpu3`), `emu/src/fw/models.mjs` (`mdet`), `emu/src/fw/board.mjs` (`dml`, `pdt`, `ems1`)

**Emulator:** While the subject-detection setting names a kind and S-SCENE's live view runs, S-TAKEMDET makes the requests TAKE and take_mov would make (start, change of kind, end, at most one YC frame offer per tick and per S-SCENE frame step, with a 640 x 480 record carrying DISP_FRAME's aspect code), natively from the lab task. At the poster's return S-CPU3 serves the post to CPU 3 at once: MDET's ring function in interrupt context, then a turn of each MDET_DL task (MDET_DL_REQ, MDET_DL_LDL) whose flag it set, run from the task's entry on a harness stack until it waits for its flag with the flag clear. CPU 3's four flags 0x3003..0x3006 are kept by the lab (OR in, wait OR or AND, clear ANDs). The offer's wait for the engine takes the driver's deferred call (IRQ 53) lab-delivered, runs the lab clock 10 ms to S-DML's completion (A-DML-1) and delivers IRQ 285 to the handler the firmware attached. The engine is a register file at 0x9c180000: a start keeps the register image written since the last one, zeroes the output records (9 classes x 32 x 16 bytes), writes the lab's records and completes with status bit 14. The network is not run: the records are S-SCENE's subjects of the offer's kind, placed in MDET's 640 x 480 frame through DISP_FRAME's transform taken back (`subject.mjs`), each a body record of class 0 and each part the scene names (the race preset's helmets) a record in class 2 at its own box, all with one score (0x0e00); MDET's own stabilisation reports them from the seventh run on and its combination pairs each part with its body. The learning data's 9.4 MB copy to 0x9511ca00 is answered without copying (S-LEARNDATA). The YC buffer the offer names is S-TAKEMDET's, from S-HEAP, unwritten. MDET's own post-processing, subject records and LAF then run natively: LAF derives the frame getter's aspect pair from the offer's aspect code, writes the frame table and posts UP_FACE, which S-CPU3 serves with one DISP_FRAME turn as the offer returns, and DISP_FRAME draws MDET's own table. S-TAKEFRAME adds the frame mode's subject bit (TAKE's request 1) while MDET runs on the live scene. S-SUBJECT, which wrote the table itself before, does not run on E143; it remains for a body that gives the subject facts without the mdet ones (none today). At MDET's first request S-TAKEMDET registers TAKE's LAF status-change callback, as TAKE's start does, and H-FCSAF runs three steps of the AF library's init natively (the AF target record from the camera's AF target settings, the info record CPU 3's FCS call fills for LAF), so LAF's AF area is the AF target's cells in the AF library's grid and a subject under it becomes LAF's candidate with its tracking status. S-MDETDL also runs MDET_E_SEND_CPU3 and MDET_CALC_MAIN_CPU3 (flag 0x3007 and queue 0x3005 kept by the lab) when S-CPU3 serves one of LAF's event setters; no lab session posts one yet (docs/om1-subject-spec.md 5.7). After H-FCSAF, H-MDETINIT runs the boot chain's MDET steps natively (MDET's message queues, the PDT and TRC drivers' inits, which attach IRQs 279 and 278 on CPU 3 and open and close the unit). S-MDETDL also runs MDET_PDT_CPU3 and MDET_TRC_CPU3 when S-CPU3 serves their dispatch, with the core register (0x8050) at 3 for them, and then CPU 3's deferred calls (their drivers' opens, closes and starts) through CPU 3's IRQ 53 handler; a post from CPU 3 through an IPI ring stops the session. S-PDT is a register file at 0x9be00000: the resets, control words, parameters and results the drivers use, a start of either engine keeping its parameter image, setting its result registers from the lab's words (none in a session) and completing after 2 ms of lab time (A-PDT-1) with status bit 0 and IRQ 279 (PDT) or 278 (TRC), which the lab delivers through CPU 3's handler table (docs/om1-subject-spec.md 5.8). A CPU 0 wait for LAF's answer (mdet_laf_end's) is preceded by S-CPU3's service of ring [3][0], and a CPU 3 turn's wait for PDT's and TRC's ends (MDET_CALC_MAIN's in mdet_laf_stop_trc_pdt, flag 0x300f, kept by the lab) runs their turns nested on a second harness stack. S-EMS1 is a register file at 0x9bd80000, the camera front end's EMS1 engine: the driver's state, start, control and channel words, its common and five area channels' parameters, power words, clock tables and four look-up tables (read back as written), a start keeping its parameter image and completing after 1 ms of lab time (A-EMS1-1) with each run channel's status bit (5k + 4) and IRQ 276; its result RAMs read 0 (no lab words). No session makes an EMS1 job; the firmware's driver runs on it in a test. TAKE's message 81 stays in TAKE's queue in a session; the test serves it to show take_mov's LAF mode, TAKE_MOV's start and LAF's end natively (docs/om1-subject-spec.md 5.9).

**Expected / concern:** On the camera CPU 3 runs these tasks under its own kernel, beside DISP_FRAME, FACE, PDT / TRC and the AF library's CPU 3 part, with real waits and preemption; here a request completes before the CPU 0 call returns, in zero lab time but for the engine's run, and nothing else of CPU 3 runs between the turns. The engine's run time, its interrupt mask (+0x008) and anything it writes besides the records are not known. The YC frame's content, size and the offers' cadence are the stand-in's: at most one offer per tick, so a session whose lab time moves in long slices offers fewer frames than the live view would, and MDET's seven-run delay before the first frame stretches with it. The frame mode's subject bit is the stand-in's too (when TAKE's live-view request clears it is not read). The records are where the scene's subjects are, not what a network would find: no misses, no false detections, no sub-kind groups, one score; parts only where the scene names one, and which class a part takes (the helmet as part 2) is inferred, no string names the parts. The table's main and part records stay empty: the state that fills them is set at LAF's end-frame event, which only LAF's chase cycle (take_mov's chase requests, EMS1 / EMS2, PDT / TRC) posts, and that does not run (spec U9, 5.7). CPU 3's code runs with the core register (0x8050) at 0, so the firmware's tests for core 3 take their cross-core branch (the EMS2 clear comes through ring [3][0] after the turn). Of the AF library only three init steps run: a later change of the AF target is not followed, and the AF library's other state is its init's. TAKE's message at a change of tracking status stays in TAKE's queue (TAKE does not run). The face engines are not exercised. LAF's start runs PDT's and TRC's tasks (both drivers opened) but no engine run: LAF's chase cycle, the only TRC user the lab could reach, needs take_mov's LAF parameters and chase requests, built from TAKE_MOV's EMS1 state the lab does not have, so no end frame, main or part record is produced (spec 5.8, U9). S-PDT's completion bit (bit 0) and run time (A-PDT-1, 2 ms) are the lab's; neither engine computes anything, and what their results mean is not read. PDT's and TRC's code sees the core register at 3 while MDET's sees 0, and their deferred calls run after the task's turn rather than preempting it. The nested turns run in an order the lab picks (the dispatches' order on the ring), on a stack of 48 KiB, one level deep. On the camera a subject under the AF target makes TAKE hand take_mov the LAF mode bit 0x10 through its message 81 (spec 5.9, D); the lab does not serve the message in a session, because the chase requests take_mov would then make every live-view frame come from TAKE_MOV's frame events, which the image pipeline's live-view sequencer delivers and the lab does not run, and LAF started without them writes no frame table (X): so the lab stays in the pre-tracking state the camera passes through. S-EMS1 computes nothing (no motion, statistics or correlation by DMA, results 0), its run time (A-EMS1-1) is the lab's, and its block trigger (+0x018) is refused unless 0.

**Confidence:** medium

## 7. Firmware behaviour replaced by the host (HLE)

### 7.1 Heap replaced by host allocators

**Where:** `emu/src/lab/hle.mjs:178-203`, `emu/src/lab/play.mjs:353-384`

**Emulator:** The base HLE replaces malloc with a bump allocator that rounds to 16 bytes and never reuses memory, and free does nothing. Play mode (S-HEAP) uses exact-size free lists in 16-byte size classes, with a 16-byte minimum. It keeps blocks freed from before play mode and detects double frees. On E143 and E146 S-HEAP also serves the heap's pool-2 block get and release (16512 bytes; `models.mjs` heap_pool), which Level Adjust's sampling loop calls instead of malloc and free: the pool's memory is S-HEAP's, and the native get handed out a block S-HEAP had already given out.

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

### 7.7 Switch levels at power-on are the lab's choice

**Where:** `emu/src/lab/play.mjs:270-305` (S-KEYBITS idle image), `emu/src/lab/play.mjs:367-369`

**Emulator:** The idle image gives every UI_IN switch a level at the start: bit 0 for most switches on E143 (its pinned tables), and on a ported body the power lever on and the USB connection 0x0400 with no cable, each set by its state under that body's polarity, except in the group the firmware's group-4 producer pushes from its own image, where the E143 family's 0x0400 lies. No producer of the real levels (the sub-CPU's port scan, the USB detection) runs.

**Expected / concern:** A real camera starts with whatever its switches read. The lab models one start, power lever on and no cable; a USB start, a charge start or another switch position is not represented. On the E143 family 0x0400 stays at state 0, which the E144 family's firmware reads as a cable; their starts do not act on it, but other paths that read it may.

**Confidence:** medium

### 7.8 The touch task's synchronous commands from a display run (S-TPSEND)

**Where:** `emu/src/lab/play.mjs` (`_sync_send`), `emu/src/lab/display.mjs` (`task_message`, its flag wait)

**Emulator:** A synchronous send to the touch task's queue from a display run (E134's and E130's first EVF open sends cmd 5) runs the touch task's loop for that message on a lab stack: its wait on its event flag returns the queue's bit, its receive gets the message with no reply queue, and the run ends at its next wait. The send returns 0 at once. The camera application's own synchronous requests to the touch task are not display runs and stay S-MODACK's: they return 0 without running the task.

**Expected / concern:** On the camera the display task waits while the touch task, a task of its own, runs the command and replies. In the lab the start's EVF open runs before the touch task is started, so the command runs before the touch init, and the touch panel's power-up then waits 40,001 lab sleeps for an interrupt the lab does not raise. The order of the command against other tasks' work is not the camera's.

**Confidence:** medium

### 7.9 The card: a real block device on E143 below the SD command layer; S-CARD's card elsewhere

**Where:** `emu/src/lab/storage.mjs` (H-FILEINIT, H-FILECLBK, S-SDHOST, S-SDCARD, S-FSNAND, S-ALBM, S-RECFILE and the insertion), `emu/src/lab/rec.mjs` (E143, E146, E147: H-EXIFINIT, H-RECINIT, H-RECFILE, S-EXIFPRM, S-JPEGENC, H-RECSHARED, H-RECIMGPRO, H-RECIMAGE, S-RECREQ; their addresses by `recFile` and `recImage` in `emu/src/fw/facts.mjs`), `emu/src/lab/media.mjs` (S-MDACTRL, S-MEDIA), `emu/src/lab/sdcard.mjs` (the card), `emu/src/fw/facts.mjs` (`fileSystem`, STORAGE_E143, STORAGE_LIB, with the evidence), `emu/src/fw/models.mjs` (`card_fs`, E143's HLS side), `emu/src/fw/board.mjs` (`sd`), `emu/src/lab/camapp.mjs` (S-CARD), `emu/src/fw/facts.mjs` (`shotsQuery`, `cardDetect`), `emu/bin/modelcheck.mjs` (the count probe)

**Emulator:** On E143 the file system runs natively on a card. Before the application starts, the lab runs the file system's bring-up from the boot task (`0x5088fc8d`, its NAND area through S-FSNAND, which reads erased) and starts FILECLBK; the card's insertion is the media control's requests sent to the file module's queue (the FAT mount; on a blank card the format and the mount again; the DCF card-in and list commands; the DCF numbering mount), after which the drive status has its mount bit (`0x1000`). The card is an 8 GiB SDHC card answering at the SD command layer (`0x508ad03c`): each command's response, data and status are written at once and its completion called, as the layer does itself for a busy port. Everything above runs natively: sd_mount's card init (CMD0, CMD8, ACMD41, CMD2, CMD3, CMD9, CMD7, ACMD51, ACMD6, CMD6, ACMD13, ...), sdmem's transfers, the format (MBR, a FAT32 volume labelled `OM SYSTEM` at LBA 8192), dosfat, the DCF modules, the remaining-shots count and the movie time (DCF remain, from the card's free space: 803 shots and 5:25 on the 8 GiB card, fewer on 4 GiB, X). At a release's END_SHOOTING_PICTURE, S-RECFILE hands over the picture REC_FILE would record, a JPEG of S-SCENE's frame at the capture with each 8 x 8 block its mean, and records it as REC_FILE's recorder does (since 2026-11-02, `docs/hle-gaps.md` 4.8.9): the camera's clock read for the time stamp and REC's five requests to the file module, each run natively (the fnode of the next DCF number, which makes the folder and names the file `P` + the stamp's month and day + the number, `C:\DCIM\100OMSYS\P1010001.JPG` and on while the clock is not set; the cluster reservation; the chain write; the directory entry; the fnode's registration), so the firmware's image count and next number follow the picture in the same session and playback's pictures are the DCF database's (X); on E143, E146 and E147 since 2026-11-08 (`docs/hle-gaps.md` 4.8.10) REC_FILE's own task records it from the packet REC_IMAGE posts it (S-RECIMAGE): REC_IMAGE's rec_jpeg_exec runs natively on the packet, its buffer from REC's pool, the image pipeline's encode and fill stood in (S-JPEGENC: the lab's JPEG after the 41984-byte header), and its header maker builds the file's header from the shot's EXIF parameters (S-EXIFPRM: the EXIF module's template, the clock read and the dates formatted natively, the crop areas and digital zoom as the full frame and 1/1), so the file carries the firmware's Exif (Make, Model, dates, the Olympus maker notes, IFD1's thumbnail slot) and XMP (X, read by `emu/refs/exif.mjs`); on E143 since 2026-11-10 (`docs/hle-gaps.md` 4.3.3) REC_IMAGE's own task (task 28, H-RECIMAGE, after H-RECSHARED and H-RECIMGPRO) takes the packet S-RECREQ posts to its queue 70 as REC_PREPRO would, the header clear's fill runs natively on the imgpro unit (one kind-14 mode-4 run of 41984 bytes of 0, its end 1 ms later by A-IMGPRO-1) and S-JPEGENC stands in for rec_jpeg_make_image (the encode) only, S-RECIMAGE retired there (X); on E146 and E147 the same, at the addresses and layouts a rule reads (their packet and REC_IMAGE's image record, `docs/hle-gaps.md` 4.8.10; REC_IMAGE's task since 2026-11-10, 4.3.5, S-RECREQ posting in REC_RAWNR's place; their Model `OM-1MarkII` and `OM-3`, X); on E144 and E148 S-RECFILE's DCF steps, on the other bodies with a native card through fileif (mkdir, fopen, fwrite, fclose), found by the DCF numbering mount at the next session (X). Card Formatting from the menu formats the card through api_media's own format call (S-MDACTRL, `emu/src/lab/media.mjs`), and the card can be taken out and put back while the camera runs (the input card remove / insert: the card switch through UI_IN natively, S-MEDIA's unmount and mount); the application's media control receives the HLS components' notifications as the firmware's own event objects through its reception natively (`docs/hle-gaps.md` 4.8.3). E146, E147, E144, E139, E137, E142, E140, E125 and E130 run the same on the same card, at the seams a rule reads in their firmware (`emu/src/fw/facts.mjs` fileSystem), with the E144 family's SD driver's request for the card's supply answered at its send (S-SDPOWER), but without the menu's format and the card input (the HLS side stays E143's); the E142 lineage then shows the card's movie time, the E144 family's E144, E139, E137 and E125 still an orange `0:00:00` (X, `docs/hle-gaps.md` 4.8.4). On the other bodies (E134, E145, E133, E129, E132, the E118 family; each with its reason in `emu/src/fw/models.mjs` card_fs) S-CARD keeps its card without a file system: the detect state of the first slot set to 2, the count query answered with 999 less the images, the movie time 1:00:00 (X).

**Expected / concern:** The SD host is not modelled: its register pages keep what the firmware writes, one polled bit reads set, and no SD interrupt is raised, so the UHS-II PHY's link-up wait times out (about 120 ms of lab time) before the firmware falls back to the SD interface, as with a card without UHS-II. The command layer completes at once, inside the submitting call, where the camera completes from the SD host's interrupt; the firmware's own busy path does the same, but timing-dependent code would see no transfer time. The insertion's requests and their order are the lab's (I): the HLS media layer that would send them does not run. The mounts take lab time (a 740 ms wait in logsec's card mount, the UHS-II timeout), about 2.5 s at every session's start on a blank card. The album manager is not started (S-ALBM: its first request is a fill on the imgpro unit `0x9c600000`, whose model S-IMGPRO is served only under camapp 3 and, on E143 since 2026-11-10, from a session's first picture (H-RECIMGPRO, `docs/hle-gaps.md` 4.3.3), both after the mount, and the movie module it asks does not run; `docs/hle-gaps.md` 4.3.1). The picture file's image stands in for the capture pipeline's: it is not the camera's development. On E143 its header is the firmware's, but TAKE does not run, so the shooting values in Exif (exposure, aperture, ISO, focal length, the lens, the image size) are the template's 0 (but ISO, 25 since 2026-11-10: rec_bracket_after_trig computes it from the packet's Sv, which S-RECREQ leaves 0, `docs/hle-gaps.md` 4.3.3, X) and IFD1's thumbnail is empty; the shot's crop areas and digital zoom ratio are the lab's identity values (I), the packet's fields the lab's for a single-slot JPEG, and REC_FILE's end logs warnings for the stages that do not run (no pending entry at the checkout, REC_MAIN's resources not taken, the header maker's record refused); REC_FILE's completion to a requester (`Free`) is not exercised. Elsewhere REC's requests are the recorder's (`0x519f9dd7`), sent by the lab outside REC_FILE's task: its lock is not taken and its error path (the fnode's cancel) is not modelled, a status not 0 stops the session. Where the rule reads no recorder (13 bodies) the file goes through fileif with the DCF module's initial names and the DCF database learns of it only at the next mount, so S-CARD's image count still answers the session's pictures there. The movie time query's time-code conversion logs `0x39000903` (the movie module's frame rate, which a movie take sets up, is 0 before one, on the camera too, `docs/model-survey.md` finding 60; display.mjs EXPECTED_ERRLOG). The second slot stays empty. The HLS function component and media manager do not run: S-MDACTRL and S-MEDIA stand in for their part of a format and of a card's change (their notifications' layouts and senders are read, which ones a change brings and in which order is I), the reception's synchronous slot stands in for the OXF main thread's dispatch of the component's notifications, and the sdmem card-info clear at a removal has no known sender (I). The card switch's level meaning is I.

**Confidence:** medium

### 7.10 The touch controller's INT on the E118 and E144 families (S-TPINTWAIT)

**Where:** `emu/src/lab/menu.mjs` (`route_rtos`), `emu/src/fw/facts.mjs` (`touchIntWait`, with the evidence)

**Emulator:** The touch drivers of E120, E122 and the E144 family wait for the touch panel controller's INT, a GIO pin (E120's 30, E144's 120), in 2 ms sleeps until a word is 1, which the pin's callback stores while the driver waits; the device open's command list ends in such a wait of 150 ms (on the EVF 40 or 100 ms more), and the touch task's power-up commands wait 40 or 100 ms. The lab models neither the controller's INT nor a GIO interrupt on those boards: at the wait's poll it stores 1 in the word, as the callback would, so each wait returns after its first sleep. A rule reads the wait by either of its two forms (`docs/model-survey.md` finding 74). E118's waits are inline in its touch task's power-up command list (its first entry's, the one after the firmware download and the calibration's), polled through a getter of the word; the rule's third form reads the getter, and the lab stores 1 at its call (finding 86).

**Expected / concern:** On the camera the INT comes when the controller is ready; how long that takes is not known, so the open's time is the lab's (about 0.2 s on the TFT, 0.3 to 0.4 s on the EVF on E120 and E122; the E144 family's starts reach the play bring-up 150 ms sooner on the TFT and 190 to 250 ms on the EVF than with the waits run to their timeouts, X). Without the stand-in every wait runs to its timeout: 150 ms of lab time since the us clock runs on lab time from the reset, 300 s before, while it counted CPU reads up to the play bring-up. The callback's other branch (the touch task's flag, a touch's data ready) is taken from the lab task instead (S-TPINT: the session's touch sets the flag's bit 1).

**Confidence:** medium

### 7.11 The E144 and E118 families' touch controller (S-TPREG at slave 0x48, S-TPREGLIST)

**Where:** `emu/src/lab/touchpanel.mjs`, `emu/src/lab/play.mjs` (`_s_tpreg`, `touch`, H-TPINIT in `kernel_display`), `emu/src/lab/display.mjs` (S-TPREGLIST)

**Emulator:** The E144 family's driver reads its controller at slave `0x48` with 16-bit register addresses: after the INT a 10-byte report at `0x0000` (the number of touches, the event, the points' touch ids, point 0's 12-bit x and y) and, for event 0, a status byte at `0x1c0a`. S-TPREG answers those from the session's touch: a down as event 2 with one touch at the pixel, a move as 3, an up as event 1 (a tap) within 150 ms of lab time of its down and as event 0 with the status byte's bit 1 set after that; every other register reads 0. The driver's touch init runs before the start's display open on those builds, as the boot runs it (`docs/model-survey.md` finding 75). The E118 family's drivers read the same report from the same controller (findings 85, 88); E118's power-up list also reads the controller's firmware version at `0x1c14`, which the model answers with `0xc400`, and writes ten registers over the touch I2C write's transport inline (its op 9), which S-TPREGLIST records as writes and returns from, the transport not run, as the lab stands in for the touch I2C write itself (findings 86, 87).

**Expected / concern:** The layout of the report is the driver's parser's (D); the event codes are the codes the driver itself gives the same transitions when its control area is on (I), and which codes the controller sends, what the status bit means, and how the controller reports two touches are not known (?): the model gives one touch. The control area stays off in the lab (the application's Set_Touch_Panel_Ctrl_Area is not called; on the E118 family its start's close clears the area, finding 89), so the driver passes the controller's events on; on the camera, with an area set, the driver would filter the points by it. The controller's other registers (calibration, self-run, the power-up's writes) read 0. E118's version `0xc400` is the one its list goes on from without downloading the controller's firmware (D); which version an E-M5 II's controller reports at power-up is ?. In the lab another value runs the download through the write's stand-in (recorded, not executed by a controller) and S-TPINTWAIT, reads the same value again and skips the calibration, and touch still works (X with 0, finding 86); a controller whose version changes with the download, which the calibration's path needs, is not modelled. The other drivers at `0x48` read the same register in their opens as b1 << 8 | b0, so the model's bytes `c4 00` are `0x00c4` there, below their parsers' `0xd700` as 0 is (finding 85). The 117-byte block E118's list writes at `0x1400` is all 0 in the lab (X), the record it comes from not read.

**Confidence:** medium

### 7.12 The shutter's sound: synthesized at the release stand-in (S-SHUTTERSND)

**Where:** `emu/src/lab/shuttersnd.mjs`, `emu/src/lab/camapp.mjs` (`key`, `tick`), `emu/src/lab/audio.mjs`, `emu/src/lab/player.mjs` (`publish_audio`), `emu/web/play.html` and `emu/web/index.html` (`sndPlay`)

**Emulator:** Where the host plays sound (the players' pages), each release S-RELSEQ makes emits two synthesized clicks on the lab's audio output: an open click at the lab time of START_EXPOSE and a close click, with a short charge-motor whir and a latch, at END_EXPOSE's due time, the shutter time in use later (S-SCENE's, else 1/125 s). The clicks are 48 kHz mono, 30 and 95 ms long, made from seeded noise through decaying resonators. Every release sounds, whatever the drive setting; a movie makes none; a `--replay`'s releases emit their clicks but the Player drops them (the replay runs outside the tick loop and faster than wall time, so they would reach the page as one burst). The page plays each event at its lab time from the first event of a run, 0.15 s ahead of its audio clock, and starts a new run when an event would be late or more than 2 s ahead; it polls `GET /api/audio` only while its audio context plays.

**Expected / concern:** On the camera the sound is the mechanism's own: the curtains, the magnets and the charge motor of the shutter block at `0x9b900000`, which the lab does not run (`docs/hle-gaps.md` section 7). The stock firmware plays nothing at a release and the electronic shutter is silent (I): the patch tool azqeurio/om-c-firmware, on the same base images, has to add both a call of the sound engine's play method before the capture's begin `0x50b8467c` and its own WAV through the resource lookup's type 2, and the menu items for it (`docs/om1-shutter-spec.md` section 7 item 61). The lab's trace does not show it: in the lab's S2, where S-RELSEQ stands in for the release and `0x50b8467c` does not run, the play method is not called and the audio blocks `0x9bb00000` and `0x9b700000` are not touched (X, of the lab only). Which drive settings select the electronic shutter (EFS / EFS, `docs/hle-gaps.md` 7.3) is not decoded (?): the Super Control Panel's Drive cell writes store 3265, whose values the lab does not map to a shutter, so a release in a silent or electronic drive mode sounds here and would not on the camera. The clicks' sound, their timing within the exposure (the first curtain's travel, the charge after the second curtain) and their level are the lab's choice, not measured from a camera (I). The page's schedule follows lab time only while the lab runs at about wall time (`--idle wall`); with lab time running faster or held, clicks start new runs and their spacing is lost.

**Confidence:** high

### 7.13 The resource tables: the update's blocks at their load addresses, the sound area factory data (H-RESINIT, S-RESNAND)

**Where:** `emu/src/lab/resnand.mjs` (H-RESINIT, S-RESNAND), `emu/src/fw/nand.mjs` (the NAND view, the browser's extract, the sound area's format), `emu/src/fw/models.mjs` (`res_nand`, E143), `emu/src/fw/labfw.mjs` (`labNand`), `emu/checks/lib/env.mjs` (`loadNand`), `emu/host/firmware.mjs` (provisioning), `emu/web/worker.mjs`, `emu/web/opfs.mjs`

**Emulator:** On E143, where the host gives the NAND (`env.nand`: the extract of the update's NAND blocks, which provisioning writes to `unpacked/<code>/` for the node hosts and the browser player keeps in its cache), the play bring-up runs USTART_L's resource loader `0x501a8ca0` natively in USTART_L's place, before the lens data cache load. S-RESNAND, layered over S-FSNAND as S-LENSNAND is, serves the loader's reads through the generic NAND access `0x500022c2` from the update's blocks, each at its head's load address as head + descrambled body + tail (the resource block's body from the lab's own copy, `env.resBlock`), so the resource API's tables are the firmware's: the resource block's (types 0 and 1), the images block's (3), the large-data block's (`0x8000`) and its twelve sub-tables (`0x8001..0x800f`), with res_size and res_version answering the shipped indexes (X: `test/test_resnand.mjs`). The sound area (type 2, `0x4e420000`) is the host's image (`env.soundArea`), else, where the audio hardware runs, S-SOUNDRES's lab-made one (7.15), else erased (0xff); a read anywhere up to the RAM log at `0x4e820000` is served from it, erased past the guard window and the image, and the firmware's writes and erases inside the flash guard's window `0x4e420000..0x4e460000` are kept for the session. USTART_L's load of sound 0 (`0x50024353`) runs too, right after the loader (on the camera after the lens data cache load, res_read(11, 0) and a wait on a byte whose meaning is ?: the lab's order, H-RESINIT's); with the area erased its size argument wraps, res_read sets its last entry and takes its error path, logging `0x1f000003` once at the bring-up and leaving the descriptor `{0, 0}`, which a later load into `0xa4000000` answers without a read (D; X). The lens data lookup then reads its lens's record (type `0x8002`) where it read nothing; golden's play sessions keep their screens and their interrupts (each IRQ, its level and its pc, in order; only the rows' instruction counts move), X by an item-by-item comparison of their traces, and with the area erased their error logs gain that one bring-up entry (X). The extract holds the heads and tails, the index areas and the records of at most 64 KiB (3.4 MB on E143, pinned by its digest in MODELS); a read beyond it stops the session. A host that gives no `env.nand` runs without H-RESINIT and its bring-up record says so.

**Expected / concern:** That the camera's NAND holds the update's blocks at their load addresses in their stored form is I, strongly supported: the loader reads each index at its block's load address and takes the table past a 32-byte head, the tables' version is the heads' (0x0100), and the large-data block's sub-blocks begin with OE heads at their own addresses (X); the NAND's other contents (the file system's area, the lens caches, the RAM log) are kept apart as before. The OM-1's own sound area is factory data that no update carries (D: no block covers `0x4e420000`; X: the TG-7's update is the only one of the 33 that ships one), so its entry count, its sounds, their format and its extent are unknown (?): the erased area of `--audio off` is a camera without it (its `0x1f000003` a log a camera with its factory area does not make, I), S-SOUNDRES's is the lab's (7.15), and an image the host gives is the host's (the builder makes the TG-7's format, which is E145's, I for the OM-1). That the area ends at the RAM log is I; an access past it goes on to S-FSNAND, and one across its start or its end is refused (S-RESNAND names it; the firmware's own reads are 512-aligned and inside, X). A sound 0 larger than `0x3d000` bytes overwrites the GUI's icons record when USTART_L loads it (X: the application's start then stopped), and one larger than `0x3b800` the copy task's ring at `0xa403b800` when a sound plays through it (I: none does in the lab). Records above 64 KiB in the large-data block (subject-detection networks among them) are not in the extract: a session that reads one stops (none of the current workload does, X). E146 and E147 do not have it yet (their sound index at `0x4e3e0000`, X), nor the E144 and E118 families: their tables stay 0.

**Confidence:** medium

### 7.14 The AF beep: the AF lock fed at the release stand-in (S-AFLOCK, H-UIOUTSTART)

**Where:** `emu/src/lab/camapp.mjs` (`TAKE_STATUS_SET`, `CBS_AF_LOCK`, `af_lock`, `af_lock_post`, `key`, `install`), `emu/src/lab/play.mjs` (`ui_out_bring_up`), `emu/src/fw/models.mjs` (E143 `ui_out`), `emu/test/test_audio.mjs` (`afBeepSession`)

**Emulator:** On E143 UI_OUT, the module of the lamps and the operation sounds, runs from the play bring-up as on E134 (its init, then its task, which waits on its queues), and its second queue UI_OUT_EXEC, which its task answers itself, leaves S-MODACK's queues. S-AFLOCK writes the AF lock's state at S-RELSEQ's focus callbacks: at S1 down the still sequence's READY bit (2) in the shared take status's word 0, at END_FOCUS(OK) its READY_FINISH bit (4) and the take information's isFocus, both bits through the status's own setter; while the lock holds, the AF module's state getter answers indicator 1. S1 up clears the two bits and isFocus. S-AFLOCK also posts the AF lock's callback CBS_AF_LOCK through S-RELSEQ's post, 1 after END_FOCUS(OK) and 0 at S1 up while the shooting service runs. The application's changedFocus then plays the AF beep natively: playAfSound reads settings id 18, which the Setup item (menu mode 1037) writes with its own value, the sound control's playTarget passes its "ready" test, and api_sound's request reaches UI_OUT's sound request with sound 0 and volume 60, which plays it through the audio driver (4.7, 7.15) on the host's audio output; with `--audio off` the sound area is erased and nothing sounds. CBS_AF_LOCK(0) becomes the GUI event whose handlers clear the GUI's afSound flag, so each half press in focus beeps once (X). S-AFLOCK is not installed under control camapp 2, where the HLS components run.

**Expected / concern:** On the camera the sequence parts and the take capability write the take status, and the AF module its own state. READY and READY_FINISH are 2 and 4 (D: the sequence parts' READY and READY_FINISH entries call the setters of those bits), so the lab's word 0 holds 2 from S1 on and 6 from the lock on, without STANDBY's bit 1, which the sequence's STANDBY entry would set and the lab never had. That READY_FINISH is the AF lock's state, and that the AF module's getter and its OSD upload share the in-focus code 1, are I. The take capability's other writes at the lock (word 3's bit 4, the indicator copy at +272) and the AF module's other fields are not written. The GUI plays the beep once per AF lock until its own afSound flag is cleared: a release's END_EXPOSE clears it (D, X), and so does CBS_AF_LOCK(0)'s GUI event (D). That the camera's sequence posts CBS_AF_LOCK(1) at the lock and CBS_AF_LOCK(0) at its release is I: the shooting reactive posts it with 1 or 0 by its event's field (D), but which module raises that event, and when, is not traced, and the order against END_FOCUS is the lab's. A NG focus result leaves only READY's bit and posts no CBS_AF_LOCK.

**Confidence:** medium

### 7.15 The operation sounds: a lab-made sound area, played by the firmware's own driver (S-SOUNDRES)

**Where:** `emu/src/lab/soundres.mjs` (S-SOUNDRES), `emu/src/lab/play.mjs` (`resnand_bring_up`), `emu/src/lab/resnand.mjs` (S-RESNAND), `emu/src/dev/audio.mjs` (A-AUDIO-1), `emu/test/test_audio.mjs` (`afBeepSession`)

**Emulator:** Where the audio hardware runs (E143 by default) and the host gives no sound area, S-RESNAND serves a lab-made one at `0x4e420000` in the TG-7's format, holding one sound: id 0, the AF confirmation, two 52 ms bursts of 2.7 kHz 24 ms apart at a quarter of full scale, 48 kHz 16-bit stereo, synthesized by the lab's code at each session (no audio asset), its WAVE file named lab-made in an INFO chunk and keyed `PRM_AUD_AFOK_VOL`. The firmware does the rest: UI_OUT looks it up and copies it to `0xa4000000`, and the driver, which picks how to play a sound by that key, plays it directly from that buffer (no copy task, no software gain stage) through the audio port to the page. Ids 1..5 (background music) are not in the area.

**Expected / concern:** What a listener hears at S1 is the lab's beep, not the camera's: the OM-1's own sounds are factory data at that address that no update carries, and nothing about this one (pitch, length, level, the double burst) is measured from a camera (I). The key is the TG-7's AF sound's (X); that the OM-1's own AF sound carries it is I, from the OM-1 driver's table holding it (D). The level is the WAV's: the codec's volume registers are written but not applied (4.7), so the camera's volume setting and its speaker's response are absent. The samples start 16-byte aligned because the port fetches from the address >> 4 (4.7); the camera's own files' layout is ?. The BGM entries' absence is harmless only while nothing asks for them (X: no lab input does). A sound 0 larger than `0x3d000` bytes would overwrite the GUI's icons record at the boot (7.13).

**Confidence:** medium (the chain is the firmware's own end to end and its samples are checked sample for sample; the sound itself is the lab's)

## 8. What the tests establish

### 8.1 Above the ISA, the tests are emu's own regression data

**Where:** `emu/test/fixtures/isa_vectors.json`, `emu/test/test_vectors.mjs`, `emu/golden.json`, `emu/checks/fixtures/`

**Emulator:** Only the ISA layer is checked against data from outside emu. Of the 5,322 ISA vectors, 3,392 come from GDB 15.2's `sim/mn10300`, 468 from that simulator corrected per the ISA manual, 712 from the manual alone and 750 from the project's UDF spec (`emu/test/fixtures/isa_vectors.json`, `out.src`). PSW comparison masks out the bits a vector marks as undefined, so values of undefined flags are not checked. For devices, interrupt timing and the lab, `golden.json` and the checks' pinned fixtures were recorded from emu itself: they catch a change, but wherever emu is wrong, the tests agree with it.

**Expected / concern:** Instruction semantics are anchored outside the project. Device behaviour, interrupt acceptance and everything above them are anchored only in emu's own model and the firmware's own code; no test reads data captured from a camera.

**Confidence:** high

## 9. Host differences (node vs browser)

### 9.1 Behaviour differs between hosts

**Where:** `emu/web/worker.mjs:94-96`, `emu/host/labworker.mjs:35-42`, `emu/src/lab/play.mjs:1371-1375`, `emu/web/driver.mjs:73-90`, `emu/src/fw/labfw.mjs:32-41`, `emu/checks/lib/env.mjs:51`, `emu/src/machine.mjs:54-68`, `emu/bin/debug.mjs:122`, `emu/bin/debug.mjs:159-162`

**Emulator:** The node worker posts every status as `JSON.stringify` text, while the browser worker posts the document object, which goes through structured clone; a value JSON and structured clone carry differently (a class instance with `toJSON`) would read differently in the two pages. The WINDOWS debug token needs `env.deflate`, which only the node host supplies, so the browser player rejects it. The browser driver has no `--replay`. Node loads the whole resource block (`loadBlock`), while the browser uses the checked prefix returned by `labFirmware`. Both read the NAND blocks the resource tables come from in the same extract (`labNand`, 7.13; node from the provisioned `unpacked/<code>/<bin>.nand.bin` through `loadNand`, the browser from its cache), which holds the records of at most 64 KiB only; what differs is the resource block's body behind `withBody` (node: the whole block, the browser: the prefix). By default the machine's stderr is a 2000-line ring that drops 1000 lines at a time. The `bin/debug.mjs` CLI builds its `Simulator` without `keepStderr`, and on a fault it calls `stderrSince(0)`, which throws if any lines were dropped.

**Expected / concern:** The two hosts can show different results for the same session. A long faulting CLI run reports a host error where it should print its trap lines.

**Confidence:** medium

