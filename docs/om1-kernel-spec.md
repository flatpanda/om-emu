> Status (2026-10): implemented by `emu/src/lab/kernel.mjs` (`NativeKernel`, `LabTask`) and checked by `emu/checks/check_kernel.mjs` (the sessions of `emu/scenarios/kernel.mjs`); used by the menu lab (`emu/src/lab/menu.mjs`, M5) and, since M9, by every OSD/display/text lab (`OsdLab` with `kernel='native'`, the default, `emu/src/lab/osd.mjs`). Consolidated from an analysis report that is not part of this repository, plus what the M5 implementation found (sections 5.5 and 8). M9 adds native interrupts and lab time (section 9; `om1-intc-timer-spec.md`, `emu/checks/check_irq.mjs`).

# OM-1 uITRON kernel, run natively in the lab ("K-native")

Firmware = E143 v1.9 main block. Code addresses are disassembly notation (body offset + 0x50000000);
data addresses run-time (body offset + 0x60021020). "kcb[n]" is the 32-bit word at offset n of the
per-CPU kernel control block. Tags: **X** executed in the lab, **D** read from the code, **I**
inference, **?** unknown.

## 1. Result

The firmware's own kernel runs in the lab. Its CPU-0 init builds every static object, the firmware's `acre_tsk`/`act_tsk` create and start a lab task, and every harness call then runs inside that task. Blocking waits, interrupt wake-ups, timeouts and preemption are kernel code. The context switch is software only (`0x50017b87`: `mov sp,(a1)`, `mov (a0),sp`, `ret [d2,d3,a2,a3],16`) (X). Since M9 the kernel's interrupt entry/exit, its level handlers and RTI run natively too, at the lab's idle point (section 9).

check_kernel (`emu/checks/check_kernel.mjs`): flags, semaphores, mutexes, blocking waits woken by
`isig_sem`/`iset_flg` in interrupt context, timed waits driven by kernel ticks, preemption, `settle()`,
and negative controls. Error codes, task states and wake-up rules are expected as uITRON 4.0 gives them,
not read back from the firmware; object ids (lab task 160, task B 161, flag 297, semaphore 146, mutex 1)
and the first eight kcb[56] values are lab observations pinned as observed (section 8).

## 2. The kernel

### 2.1 Identification (D, X)

uITRON 4.0 API, one kernel instance per CPU. Error codes as in the specification: E_RSATR -11
(`0x5000f34e`), E_PAR -17 (`0x5000f7dd`), E_ID -18 (`0x50015ef5`), E_CTX -25 (`0x5000f2c5`), E_NOMEM -33
(`0x5000f850`, after `cmp -33,d0` at `0x5000f812` on the stack allocation's result); executed: E_RSATR, E_PAR, E_ID, E_CTX, E_ILUSE -28, E_NOEXS -42, E_QOVR -43, E_TMOUT -50.
Task states TTS_DMT 0x10 (`0x5000fc97`), RDY 2 (`0x50011693`), RUN 1 (`0x50014e3c`), WAI 4 (X).
Create packets are the uITRON structures: T_CTSK {atr, exinf, task, u16 itskpri, stksz, stk} copied
to TCB+68 (`0x5000f7f9..0x5000f80a`); T_CFLG {u8 atr, iflgptn}; T_CSEM {u8 atr, isemcnt, maxsem};
T_CMTX {u8 atr, u16 ceilpri}. Object ids are `cpu << 12 | index` (`0x50011c43`, `0x50011c9e..a0`; OlyTaSE
compares the caller with 1, 0x1001, 0x2001, 0x3001 at `0x5002c719..2d`).

### 2.2 Control blocks

`0x8050` holds the core index; `(0x97f00004)[core]` is the kcb pointer, stored by each CPU's entry
(`0x500118a7`, `0x5001279a`, `0x5001284a`, `0x500128fa`). The kcbs are static data `0x6004381c`,
`0x600439a8`, `0x60043b34`, `0x60043cc0`, 0x18c bytes each.

| kcb | meaning | evidence |
|---|---|---|
| +4 | -> pending tick count; `isig_tim` increments it | `0x5001107f..85` |
| +12 | -> saved PSW of the kernel lock | `0x50017c12..15` |
| +16 | -> byte, bit 0 set while an interrupt handler runs; dispatch returns while non-zero | `0x50017da4..ac`, `0x50014dcb..d4` |
| +28 | -> interrupt nest byte (+1: second context flag); task services need 0 (E_CTX), `i*` services non-zero | `0x50010f7a..97` |
| +36 | -> system time | `0x500156da..f7` |
| +56 | -> u16 pairs; the first pair is 160/159 after init with 159 static tasks and 162/162 after three creates, so what each half counts is not established; the lab scans task ids up to the larger | X, ? |
| +72 | -> sentinel of the timeout queue: a circular doubly linked list of TCB+28 nodes {next, prev}. A finite timeout (twai_sem `0x50016831..0x5001686e`) and dly_tsk (`0x500105a2..0x500105cd`) link the waiting task's node and store ticks + 1 at TCB+36; a forever wait (-1) does not (`0x5001682d`) | D, X (check_kernel 5b, 7) |
| +68 / +96 / +100 | -> ready queue / -> current TCB / idle TCB | `0x50014df3..0x50014e2a`, `0x50011aff` |
| +124 | static task table, 28-byte entries {u32 id, atr, exinf, task, pri, stksz, stk} | `0x50011c30`; X (section 5.5) |
| +204 | -> TCB pointer array, index id-1 | `0x50011c39..53` |
| +320, +324, +332 | cross-CPU request queue length / mailboxes at `0x8900+` / queue (64 words, -1 empty) | `0x500125b1..ec` |
| +336, +380 | multi-CPU mode 1 / CPU count 4 | `0x5001259b`, `0x50010c98` |

TCB: +12 u16 state, +16 id, +24 saved SP, +28 timeout node, +36 timeout ticks, +68 T_CTSK copy. A new
task's frame is built at `stk + stksz - 20` with the start stub `0x50011825` as return address
(`0x500116b1..d0`); the stub releases the lock (`0x50017c54`), CALLS the entry with d0 = exinf and then
calls `ext_tsk`.

### 2.3 Lock, dispatch, interrupts, tick (D)

Kernel lock `0x50017bdd(d0 = id)` / unlock `0x50017c54`; ids with bit 15 also take ISC semaphore bit 0 at `0x97000000` (`0x50015e20..4d`). Every lock drains the cross-CPU queue (`0x50010be8`); the global lock `0x50010c71` scans all CPUs' queue heads and retries while any is not -1. Dispatch `0x50014da8` switches through `0x50017b87`. `0x50017b86` is a `break`, the kernel's fatal trap (34 call sites, code in d0: forbidden dispatch -128, return from a context that must not return -118/-119/-127, static create failure -126/-120, self-test mismatch -112, PSW mask -108, lock re-entry -109, cross-CPU queue full -110, wrong CPU 0). The interrupt entry/exit `0x50017d41..0x50017e83` saves context with udf13, udf12, udf15 (`0x5000f259`), restores with udf21, udf20 (`0x5000f26e`) and ends in RTI; since M9 it runs natively (section 9). Around the handler it does nest++ and *kcb[16] |= 1, and on the last exit the tick loop, the clear, dispatch `0x50017e46..4b` and unlock. Tick: the timer ISRs `0x50031198`/`0x500311ce`/ `0x500311e8`/`0x50031202` (IRQ 138..141, `0x5003121c`) ack `0x98900400` and call `isig_tim` `0x50011043`; the exit then runs `0x500156c5` once per pending tick, nest still 1.

## 3. Service table (D; packets confirmed by check_kernel)

| service | address | name evidence |
|---|---|---|
| acre_tsk / act_tsk / ext_tsk / ter_tsk | `0x5000f76f` / `0x5000f879` / `0x500107e8` / `0x50015e87` | tag acre_Task1 after the call at `0x5002cb0c` (section 4), BTM_ACTTSK, OlyTaSE, BTH_TERTSK |
| chg_pri / sus_tsk / frsm_tsk / wup_tsk | `0x5000f9aa` / `0x50017718` / `0x50017242` / `0x50016bf0` | BTH_* tags, OlyTaWu |
| dly_tsk / get_tid | `0x50010561` / `0x5001091e` | BFA_DLYTSK; OlyTaSS = dly_tsk(d0) |
| acre_sem / del_sem / sig_sem / isig_sem / twai_sem | `0x5000f6d1` / `0x50010279` / `0x50014fcb` / `0x50010f6a` / `0x50016749` | tag "BSE_ACRTSK" (sic, section 7) / BSE_* |
| acre_flg / del_flg / set_flg / iset_flg / clr_flg / wai_flg / twai_flg | `0x5000f343` / `0x50010007` / `0x50014ec7` / `0x50017a6b` / `0x5000fbaf` / `0x500169d6` / `0x50017e85` | BEF_* tags, OlyEv* |
| acre_mtx / del_mtx / loc_mtx / unl_mtx | `0x5000f639` / `0x50017084` / `0x500112f2` / `0x500168fb` | BMT_* tags |
| acre_dtq / del_dtq / tsnd_dtq / trcv_dtq | `0x5000f3bb` / `0x50010129` / `0x50016578` / `0x5001625e` | acre_Queue1, OlyQeDl, OlyQeWr, OlyQeRd |
| sns_ctx / isig_tim | `0x50017b6a` / `0x50011043` | `0x50d9b07c` / timer ISRs |
| (dtq reference) | `0x50013ca7` | used by the DISPLAY OPEN poll `0x501c74e3`; its packet +2 is taken to be the receive-waiting task (I, a ref_dtq layout) |

## 4. Wrapper layers

1. Oly* `0x5002bc86..0x5002c701` (the 18 names `emu/src/lab/rtos.mjs` stubs) and the creates acre_Event1
   `0x5002c791`, acre_Queue1 `0x5002c866`, acre_Semaphore1 `0x5002c947` (its tag string is spelled
   "acre_Semapore1", `0x60086da4`, loaded at `0x5002c975`), acre_Task `0x5002ca1f` (priority remap 8->45,
   9->46, 10->54, 11->55, `0x5002ca3b..f0`). "acre_Task1" and "acre_Task2" are not functions: they are the
   error-check tags acre_Task passes to `0x5002cdb7` after acre_tsk (call `0x5002cb0c`, tag `0x60086e00`
   loaded at `0x5002cb13`) and after act_tsk (call `0x5002cc01`, tag `0x60086e0b` at `0x5002cc08`); act_tsk
   runs only when the byte at (12,sp) is 2 (`0x5002cbf9..fe`). Each of these first compares the
   object's CPU with the caller's (`0x5002cfb0`); another CPU takes a "...Cpu" variant.
2. OlyLow*.cpp `0x50ac5b00..0x50ac7100` (HLS_* tags).
3. Rhapsody OXF `itronos.cpp` `0x50d9af9c..0x50d9ba46` (BFA_/BSE_/BTM_/BEF_/BTH_/BMT_ tags); the recursive
   mutex takes its owner from `get_tid` through a virtual call (`0x50d9b800..0e`).

The GUI range `0x510a0000..0x51260000` has no direct CALL to any kernel service or wrapper: it reaches
them through OXF and C++ vtables, so the services a paint needs are known only by running it.

## 5. K-native in the lab (`emu/src/lab/kernel.mjs`)

### 5.1 Boot (`NativeKernel.boot`)

The core index is written, then the CPU-0 entry body `0x50011883` is CALLed; it never returns and the
harness stops when it enters the idle loop (`0x500159f3`/`0x500159f8`) with the idle TCB current.

| stand-in | what | evidence |
|---|---|---|
| K-OTHERCPU | kcb pointers of CPUs 1-3, their kcb[332] queues filled with -1 | what their entries do before init (`0x50012792`, `0x500127eb..0x5001280f`); the global lock spins otherwise |
| K-BOOTSYNC | skip `0x50015a61` | boot ring handshake with neighbour CPUs: the kick (kcb[316] = `0x5000f195`) writes the neighbour's INTC bank `+0x810`, the wait polls the own GxICR `0x8958` (cores spec 3.3, 8) |
| H-VECINIT (M9) | run `0x5000f068` before the entry | IVAR/GxICR init, called by reset at `0x500001ec` (a path the lab does not run) |
| K-SELFTEST | M9: runs natively (UDF unit, A-UNIT); skipped only with `boot(irq='calls')` | UDF context save/restore self-test, break(-112) on mismatch |
| K-IPI | skip `0x50012651`, replay its clears of *kcb[260]/[264]/(u16)[268] | it CALLS kcb[304], a `retf` stub on all four CPUs (`de 00 00` at `0x60085d99`/`db7`/`dd5`/`df3`, D); `0x5000f195` is kcb[316], the boot-barrier and cross-CPU ready kick, not reached from K-IPI (cores spec 8) |
| K-INTC | M9: runs natively on the controller model; skipped only with `boot(irq='calls')` | INTC `0x99200514`/`0x99200884`, low RAM `0x8940..0x8958` |
| no kernel start | `0x500119ab` not run | the harness owns the first dispatch |

With native interrupts (the default) the boot also checks that the IVARs point at the level slots and kcb[88] holds the level handlers, guards the default handler `0x5002eaf2` (an IRQ presented with nothing attached is an error) and opens the controller's gate at `0xA2300080` (H-IRQGATE).

### 5.2 Lab task (`LabTask.start`)

After init only the init task (id 1, entry `0x5002cca5`, the boot sequence) is READY. The harness ends
it with the firmware's `ter_tsk(1)` from idle context, creates the lab task with `acre_tsk` {TA_HLNG,
exinf 0x1ab, entry `0xA2300100`, priority, stack `0xA21A0000..0xA2200000`} and activates it; the kernel
switches to it through the start stub (X: id 160, the first dynamic id). Lab region `0xA2300000..
0xA2321000`: idle trampolines end at `0xA2300080`, the lab entry is `0xA2300100`, idle-context stack
`0xA2308000..0xA2318000`.

### 5.3 Run time

- Idle: when every task waits, the kernel dispatches to the idle TCB, whose parked call returns to
  `0xA2300080`, a hook. The harness runs its on_idle policy; if a task became ready it runs `clr d0;
  call lock; call 0x50014da8; call unlock` in idle context and the kernel switches back.
- Native interrupts (M9, section 9): at `0xA2300080` the hook first asks the controller whether an IRQ is presented; if so it gives the idle context its PSW 0x0f00 (IE 1, IM 7) and continues without a step, so the CPU accepts before the breakpoint check and the firmware's entry, level handler and exit run; the exit dispatches the tasks the handler readied, and when all block again the idle TCB resumes in the exit, whose RTI returns to `0xA2300080`, where a further presented IRQ is accepted at once. A stop there with an IRQ still presented after such a continue is an error; two levels presented together at idle are an error outside time mode (they never occur in the time-off checks).
- K-ISR (`in_interrupt`): *kcb[28] += 1 and *kcb[16] |= 1 around a harness-delivered handler, restored after. Handlers run on the harness interrupt stack. Without it `iset_flg`/`isig_sem` return E_CTX (check_kernel group 5 control). Since M9 it remains for S-SETTLE's `isig_sem`, for `boot(irq='calls')` and for the harness deliveries inside display steps (display steps run as harness calls with PSW 0, so native acceptance there would mean inventing a PSW). Those come from the harness's clock moves in `DisplayLab` (`emu/src/lab/display.mjs`): the OlyEvWt vsync stand-in (`_wait`), OlyTaSS's ADVANCE (`advance`, A10) and compose's next-frame step (`draw()` also calls it first). Each runs `Kernel.deliver()` (`rtos.mjs`), which enters the attached handler of every registered source whose line is high: the OSD engine (IRQ 310) as well as the VSC vsyncs 46/48/50. Measured handler runs on the default lab (X, counting `deliver()` after `go_native()`): check_text 310 x12 (vsync waits), 48/50 x14 in vsync waits, x7 in OlyTaSS advances, x2 in compose; check_menu 310 x229 (209 vsync waits, 20 compose), 48/50 x181 vsync waits, x81 advances, x21 compose. Settle's own `deliver` ran 0 times in both.
- K-TICK (`tick`): `isig_tim` natively, then `0x500156c5` per pending tick with the exit's frame; kept for time-off labs and check_kernel 5b. With lab time (M9, `om1-intc-timer-spec.md` section 4) the tick is native: `0x5003121c` programs channel 1 with reload 999 (1 ms under A-TMR-1/2, I), IRQ 138 runs `0x50031198` and the exit's tick loop; check_kernel 5c reproduces 5b's tick counts (dly_tsk(3) 4 ticks, twai_sem(5) 6).
- `settle(deliver, pending)`: the lab task waits forever on its own semaphore (acre_sem {TA_TPRI, 0, 1}); at idle the hook delivers pending interrupts first (K-ISR); when none is pending it checks the timeout queue (section 2.2) and stops with "time model needed" if any other task is in a timed wait, then signals the semaphore with `isig_sem` in K-ISR. E_QOVR from `isig_sem` means the lab task waits elsewhere: an error. This is what makes "the GUI finished painting" well defined (X: check_kernel 7, `MenuLab`). With native interrupts the settle log has one 'irq' per acceptance (as K-ISR had one per idle delivery; X: the menu entry's two settles log 6 each either way). In time mode a timed wait is logged, not an error; `elapse_until` moves lab time (section 9.5).

### 5.4 What stops with an error

| condition | where |
|---|---|
| kernel fatal trap, with its code | hook `0x50017b86` |
| cross-CPU mailbox wait | hook `0x5001258b` |
| a firmware task entry not on the allow list is started | hook on the start stub `0x50011825` (entry in a2) |
| all tasks blocked and nothing made one ready | `0xA2300080` |
| a presented IRQ not accepted at the idle point; two levels presented there (time off) | `0xA2300080` |
| an IRQ presented with no handler attached | hook on the default handler `0x5002eaf2` |
| a timed wait while settling (time off) | `settle()` |
| `on_idle` moved lab time more than `idle_again_limit` (1000) times in a row with nothing presented | `0xA2300080` |

### 5.5 Tasks M5 lets run (`MenuLab`)

| task | entry | started by | ends in |
|---|---|---|---|
| DISPLAY_CHANGE, static id 143 (table entry `0x50019048`, priority 54, stack 0x400) | `0x501c6d8c` | the harness, `act_tsk` (K-CHANGE; the camera's activator is not traced) | `trcv_dtq` on the CHANGE queue (OlyQeRd at `0x501c6dae`), forever (X) |
| static id 70 (table entry `0x5001884c`, priority 55) | `0x50023a0c` = `retf [],0` | display init `0x500239c9` (OlyTaSt `0x500239fb`), on every call | `ext_tsk` at once |
| Genifa timer, 161 | `0x510c1d01` | GUI creator `0x5108bc37` (OSAL `0x50b01412` -> acre_Task `0x5002ca1f`) | a forever wait (X) |
| GUI_TASK, 162 (priority 55, stack 0x4000) | `0x5115ba0c` | the same | GetEvent's flag wait (X) |
| HLS_EYEFI, 163 (priority 55) | `0x50aba579` | OlyHfwDevEyeFi.cpp singleton constructor `0x50aba112` (acre_Task `0x50aba1e1`, act_tsk `0x50aba1f6`), reached by the menu entry | its first event-flag wait, timeout -1 (`0x50aba5eb` -> `0x50ab2b9c` -> OXF `0x50d9b49d` -> wai_flg) (X) |

| task 16 (time mode only, H-DEFER) | `0x500530f7` | its init `0x5005304d` (OlyTaSt at `0x500530cb`) | OlyEvWt on flag `(0x60042fb6)`, pattern 3, forever (section 9.6) |

Without a kernel this EyeFi create failed and printed `[HLS]: HLS_EYEFI Task Create Error.`; under
K-native no kernel print remains on the M5 path.

## 6. Why not an HLE of the wrappers

It would cover three layers (about 60 entry points) with exact return conventions and re-implement
mutex ownership, TA_CLR/TA_WMUL, semaphore limits, CPU routing and timeouts; the GUI reaches them
through vtables, so the set needed is unknown until each is hit. K-native needs six boot stand-ins, two
context helpers and the idle hook.

## 7. Correction

The settings-store print tagged `BSE_ACRTSK` is semaphore creation: the tag follows the `acre_sem` call
at `0x50d9b014` (a copy-paste slip in the firmware's own tag table).

## 8. Open items

- Which CPU runs the GUI (the lab is CPU 0; the draw flag 0x79 is a CPU-0 object).
- Inter-CPU interrupts (M10B): play mode runs the IPI init `0x5002ce4d` natively (H-IPIINIT), which attaches IRQ 324 at level 2 for CPUs 0..3; CPU 0 then takes IRQ 324 at the idle point like any device interrupt, and CPU 2 is the stand-in S-CPU2 (intc/timer spec sections 2, 5). K-IPI (the boot-time `0x810` trigger) is still skipped.
- The lab task's identity: get_tid returns 160, not a camera task. On M5's path the DISPLAY caller check
  `0x501de7a3` gets the DISPLAY task id (0x36) from `DisplayLab`'s stand-in inside display runs, and so do
  the Oly* wrappers' CPU routing checks `0x5002cfb0` / `0x5002d003` (return addresses `0x5002cfd7` /
  `0x5002d029`); they compare `tid & 0x3000` (and bit 0x8000) with the object id's, which are 0 for both
  0x36 and 160, so the routing does not change.
- Tick length, the kcb+56 pairs, kcb fields not listed above.
- Interrupts arrive only at the idle point (H-IRQGATE, section 9.4): a task runs uninterrupted between two idle points, and inside display steps the harness still delivers every pending source (OSD engine 310 and VSC 46/48/50) by K-ISR calls (section 5.3, K-ISR).
- Software timers (M8): the timer service `0x5005899c` (create) / `0x500589d7` (delete) is firmware code above the kernel, with its own tables (`0xa32c5500`, 12 hardware-backed slots; `0xa32c5620`, 32 software slots) and an ISC lock; the boot step `0x50058959` (called at `0x5002cd82`) initialises them and every lab runs it natively (vsc spec sections 8 and 9.5, H-TIMER). In time-off labs the hardware-timer init `0x500642dd` is not run, so no timer fires; with lab time (M9) it runs and the tick timer fires every 2.001 ms (section 9.5).
- The meaning of the UDF unit words (A-UNIT), the IAGR register (A-IAGR) and the vector upper half (A-VEC).

## 9. Interrupts (M9)

### 9.1 Vector page and entry (D, X)

The vector page is run-time `0x60030000` (disasm `0x5000efe0`): +0..7 zero, +8 `jmp 0x5000f0f4` (NMI, not modelled), level 0 at `0x5000f000` (stores to ROM `0x50000008/0c/04`, then `jmp 0x50017d41`; not modelled), levels 1..6 at `0x5000f038/40/48/50/58/60`, each `jmp 0x50017d41`. The IVARs in low RAM `0x8000 + 4L` hold the slots' low halves (H-VECINIT, `0x5000f068`). The CPU pushes {u32 PSW, u32 PC} (ISA spec section 11).

Entry `0x50017d41`: `movm [a2,a3,other],(sp)`; `jmp 0x5000f259` with a3 = the return (context save, UDF unit, `om1-udf-spec.md` 2a); when *kcb[260] != 0, CALLS kcb[276] with d0 = PSW.IM (`0x50017d67..77`); when the nest byte is 0, switch SP to the kernel interrupt stack `kcb[116] + kcb[112] - 8` and store the interrupted SP at +4 (`0x50017d79..8f`); the level handler `kcb[88][PSW.IM]` (`mov psw,d1; lsr 6; and 28` at `0x50017d91..96`); nest++; *kcb[16] |= 1; `calls (a0)`.

Exit `0x50017db0..0x50017e83`: IE off; `0x50010cd8`; PSW = kcb[348] (0x800); nest--; nested: kcb[280] when *kcb[260], then the restore; last level: the tick loop `0x50017ddd..0x50017e0c` (PSW from the interrupted frame `movhu (56,a0)` around each `0x500156c5`), kcb[280]/[264] handling, nest byte and *kcb[16] bit 0 cleared (`0x50017e28..39`), *kcb[12] = 0xf00, SP back to the interrupted stack (`0x50017e42..44`), `0x50010be8`, dispatch `0x50014da8`, `0x50015e54`, `0x50013687` (and `0x500136aa` with the interrupted PSW when it returns non-zero), restore `jmp 0x5000f26e`, `movm (sp),[a2,a3,other]`, `rti` at `0x50017e83` (D; X in every K-native lab).

### 9.2 Level table and level handlers (D, X)

kcb[88] points at the per-level handler table the kernel builds from the image's registration table at `0x5001bdd0` (12-byte entries {level, 0, handler}, level 6 down to 0, then a zero entry; X: kcb[88][L] equals it, check_irq I3): level 0 `0x5002e7de`, 1 `0x5002e79b`, 2 `0x5002e758`, 3 `0x5002e715`, 4 `0x5002e6d2`, 5 `0x5002e68f`, 6 `0x5002e64c`. Each (level 5: `0x5002e68f`) reads the u16 at `0x8a00`; a value <= 52 takes the group path `0x5002e821` (A-IAGR makes it 64..88); otherwise `or 0x800,psw` (nested interrupts of higher levels allowed), then the loop on `v = (0x99200700 + 4L)`: `calls handler_table[v / 4 - 1]` (table `0xa32600c0 + 0x590 * cpu`), re-read, until 0; then the level's GxICR word (level 5: `0x5101` into `0x8954`). Attach `0x5002e84e` (wrappers `0x50053f76` with the core index from `0x8050`, `0x50053fcd` with an explicit cpu) and the controller: `om1-intc-timer-spec.md` section 2.

### 9.3 Kernel interrupt stack (X)

kcb[112] = `0x62e7fa00`, kcb[116] = `0x2000`: the first-level entry runs on `0x62e7fa00..0x62e81a00`. The menu entry's native OSD deliveries and a native TFT vsync delivery reach 132 bytes below the top (check_irq I4, which fails above 6 KiB, a margin, not a hardware fact).

### 9.4 Where interrupts are accepted (H-IRQGATE)

Only at the idle point `0xA2300080` (section 5.3; ISA spec 11.4). Display steps run as harness calls with PSW 0 and keep K-ISR for the deliveries at their clock moves (vsync-wait stand-in, OlyTaSS ADVANCE, compose's next frame), each of which services every pending source, the OSD engine's IRQ 310 included (section 5.3); S-SETTLE stays K-ISR. A task readied by a native handler runs before the RTI (X: check_irq I4, task B at priority 50 runs to `ext_tsk` inside the interrupt of the lab task's code; check_kernel 7b at idle).

### 9.5 Ticks and lab time

Tick ISR `0x50031198` (IRQ 138, channel 1): ack `(0x98900400) = 1`, `isig_tim` `0x50011043`, then `irot_rdq(55)` `0x50010f06` on every tick (the counter at `0x6034d3b4` is incremented, compared with 1 and reset, `0x500311aa..c2`, so the `bcs` never skips). The exit's tick loop runs `0x500156c5` per pending tick. IRQs 139..141 (channels 2..4) are attached for CPUs 1..3 only. The software tick (channel 21, IRQ 158, level 3, every 2.001 ms) runs `0x500647a1(21)`, which acks and calls the channel's ISR from `0xa32ca4c4[21]` = `0x50058bb0`, the timer service's slot processing. Every 5th software tick the Genifa timer's slot fires its callback `0x50ab8fe6`, which posts a deferred call (`0x50053505` from `0x50ab904b`); task 16 drains it (`0x50053157`) and runs `0x510c1ccf` (from `0x50ab8fdc`), which adds 10 to the Genifa ms clock `(0x603679d0)` and signals the Genifa timer task (`0x50b81c88`); that task then runs `0x510bb7df` (from `0x510c1d12`), the Genifa timer processing (X: observer trace over 12 ms of lab time; D: the code at those addresses). Lab time and ELAPSE: `om1-intc-timer-spec.md` section 4.

### 9.6 Task 16, deferred calls (D, X)

Static task 16 (entry `0x500530f7`, table run-time `0x60039290`) waits on flag `(0x60042fb6)` pattern 3 (OR, forever) through OlyEvWt; bit 0 runs `0x50053157`, which drains a 32-entry ring of 12-byte calls at `0xa32c3e14` (read index `0xa32c3e12`, write index `0xa32c3e10`) through `0x50036120`; bit 1 runs `0x50053199` and `0x500532b2` (not traced). `0x50053505` takes ISC lock `0x15131515` (error log `0x19001501` on failure) and appends to that ring (D, the poster). Its init `0x5005304d` clears the indices and the 32-entry table at `0xa32c429c` and starts the task (OlyTaSt `0x500530cb`). With lab time the Genifa timer chain needs it: without H-DEFER the Genifa ms clock never advances (X, check_nav mutant `b7-no-task16`).

### 9.7 Dispatch disable (I)

`0x50010501` stores 1 into the byte at nest + 2 (`0x50010543`), `0x50015497` returns that byte, and `0x500105e9` has `0x50010501`'s shape: read as dis_dsp/sns_dsp/ena_dsp from one call pattern (I, not checked). In the kernel-less lab the kcb pointer is 0, so `0x50010543` stores into low RAM 2 (and `0x50017c15` into low RAM 0): the cause of the kernel-less notes lines of check_text/check_display (text spec section 8).
