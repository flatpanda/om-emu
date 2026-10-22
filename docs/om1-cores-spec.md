> Status (2026-10): static analysis only; the lab runs CPU 0 alone and implements none of this beyond what section 7 lists. Consolidated from four static-analysis reports that are not part of this repository (boot, tasks, inter-core traffic, strings) and an independent re-read of the disputed claims from the bytes; claims that re-read refuted are left out or listed in section 8. No check script covers this document.

# OM-1 CPU cores: who runs what

Firmware = E143 v1.9 main block. Code addresses are disassembly notation (body offset + 0x50000000); data addresses run-time (body offset + 0x60021020), so code at run-time R is at disasm R - 0x10021020. Object ids are `cpu << 12 | index` (kernel spec 2.1), so an id names its core. Tags: **D** read from code or data (address given), **I** inference (basis given), **?** unknown. "CPU n" is the 0-based core number read from `(0x8050)`.

## 1. Summary

The main block runs four instances of one uITRON kernel on four MN10300-family cores, each with its own kcb, static task table, stacks, interrupt-controller bank and tick (D, section 2). CPU 0 boots the others and starts nearly every application task on all four (D). A fifth processor, an ARM Cortex-A53, is managed from CPU 1 over the ISC shared-memory library (D, section 4), and the SCPU at `0x98e00000` and the lens MCU are further external controllers, not cores.

| Core | Role | Confidence | Static tasks / pool | Key evidence |
|---|---|---|---|---|
| CPU 0 | Boot core and application core: reset, flash and hardware init, releases CPUs 1..3, starts tasks everywhere; camera application, GUI, UI input, display, still-capture control (TAKE/REC/ISEQ), AF front end, lens, playback and movie edit, main audio task, files/DCF, USB/PTP, peripherals, SCPU link, power. Fixed server for ADCONV, ems1, the VSC "REQ" path and task 16's deferred ring | D for the task list and boot role; I (strong) for "GUI runs here" | 159 (12 are `retf` stubs) / 0xc4000 | reset head, OlyTaSt sites in USTART*, name table `0x6034d0d4` |
| CPU 1 | Communications and AV back end: Wi-Fi, BLE, PTP-IP tasks; the only core allowed to start the Cortex-A53 or use the ARM shell; AV codec back end (AVPI VDE/VEN BACD, VCLib master, AVMDL thread pool); DSP0-2 request service; AF second stage (FCS_*_2NDCPU), C3D_EXE, FACE_BEAUTY | D for tasks and the two core checks; I that the network stacks themselves run on the A53 | 97 / 0x80000 | `0x5003174f`, `0x5003bdab`, IRQ 303-306 attached to CPU 1 only |
| CPU 2 | Boot-time overlay loader (segments 1..10); movie recording (MVR_*), EXP_MOVIE2/3, WB_MOV, SDET; the CPU 2 half of still processing (REC_*_CPU2, REC_*_STLNML); AUD_LEVEL_MONITOR `0x200e` and AUD_WAKEUP; OSD_DRAW_CPU2, fed by the GUI on CPU 0 | D | 37 / 0x40000 | USTART_L2 `0x50024572`, name table |
| CPU 3 | Subject and face detection: MDET deep-learning and LAF tracking, FACE_FD/FACE_MAIN, FCS_IMG_4THCPU_MAIN, DISP_FRAME; three boot jobs CPU 0 waits for | D for tasks; "detection core" I from the task names | 18 / 0x14000 | IRQ 278/279/286/287 attached to CPU 3 only |

Firmware naming (D): "2NDCPU" = CPU 1 and "4THCPU" = CPU 3 (flags `FCS_IP_ISP_1STCPU`/`FCS_IMG_1STCPU` are CPU 0 objects), while the suffixes `_CPU2`/`_CPU3` are 0-based (REC_VIE_CPU2 = `0x2012`, MDET_*_CPU3 = `0x30xx`). `API_VERSION_SUB_CPU1`, `SUB_CPU2_1/2/3`, `SUB_CPU_FW_VER` and `[SCPU]` name external microcontrollers, so "SUB_CPU2" is not core 2.

## 2. What every core has (D)

| Item | CPU 0 | CPU 1 | CPU 2 | CPU 3 |
|---|---|---|---|---|
| kcb (also stored at `(0x97f00004)[core]`) | `0x6004381c` | `0x600439a8` | `0x60043b34` | `0x60043cc0` |
| static task table (kcb+124, 28-byte entries, zero-terminated at kcb+128) | `0x60039038`, 159 | `0x6003cef8`, 97 | `0x6003e65c`, 37 | `0x6003f0d0`, 18 |
| kernel stack kcb[64] | `0x62e83400` | `0x62ec3800` | `0x62ee9680` | `0x62f56480` |
| interrupt stack kcb[112] / size | `0x62e7fa00` / 0x2000 | `0x62e81a00` / 0x800 | `0x62e82200` / 0x800 | `0x62e82a00` / 0x800 |
| task-stack pool kcb[44] / size (contiguous) | `0x62ce0980` / 0xc4000 | `0x62da4980` / 0x80000 | `0x62e24980` / 0x40000 | `0x62e64980` / 0x14000 |
| cross-CPU ready queue kcb[332] / length | `0xa33f1800` / 64 | `0xa33f20cc` / 64 | `0xa33f2498` / 16 | `0xa33f28d0` / 16 |
| INTC bank | `0x99200000` | `0x99300000` | `0x99b00000` | `0x99b80000` |
| tick IRQ / ISR | 138 / `0x50031198` | 139 / `0x500311ce` | 140 / `0x500311e8` | 141 / `0x50031202` |
| IRQ 324 handler (IPI) | `0x5002d83a` | `0x5002d965` | `0x5002da94` | `0x5002dbc1` |
| init task BOOT_CPUn (pri 1) | 1, `0x5002cca5` | `0x1001`, `0x50008c36` | `0x2001`, `0x50008fbb` | `0x3001`, `0x50009347` |
| CPUCONN (pri 15, one body `0x5002ced4`) / flag | `0x99` / `(0x600431a4)` | `0x1024` / `(0x60043516)` | `0x2021` / `(0x60043668)` | `0x300f` / `(0x600436ec)` |
| CPUCALL, tag CPUSWn (pri 51) | `0x9a`, `0x50036353` | `0x1025`, `0x500363ee` | `0x2022`, `0x50036489` | `0x3010`, `0x50036524` |
| SYS_WDT | `0x16`, `0x5003cceb` | `0x1021`, `0x5003cdbc` | `0x2018`, same | `0x3003`, same |
| S_SHELL `0x5003154c` / U_SHELL `0x501e8de3`, prompt | `:-) ` | `[1]:-) ` | `[2]:-) ` | `[3]:-) ` |

Also D: CONTEST_CPUn (`0x94`/`0x1009`/`0x2004`/`0x3002`, entries `0x5002e2b7/c1/cb/d5`) calls OlyTaSE, which sends a non-init caller to the task-exit path `0x500107e8`, so it exits at once; its purpose is ?. `(0x8050)` is the core number: nothing in `0x50000000..0x513fffff` writes it, and each kernel entry checks it (section 3). Only CPU 0's tick ISR rotates the priority-55 ready queue (`0x50010f06(55)`, sole caller `0x500311c4`), so round robin at 55 happens on CPU 0 only (D). The default interrupt handler `0x5002eaf2` prints `!!Dummy IRQ from CPU0..3` by `(0x8050)`, and the NMI reporter `0x50039a12..5d` names the faulting core (D).

## 3. Boot, per core

### 3.1 CPU 0 alone runs the reset head (D)

1. Entry `0x50000000`: `and 0xf0ff,psw`, `(0x8070) |= 3`, `(0x98100008) = 16`, sp `0x500007fc`, `jmp 0x600210c5` (= `0x500000a5`); boot marks DSS, DSE, F0S, F0E, RCS, RCE, GIS, OIS into the log `0x500039f7`; "\n0" straight to the UART `0x98700018`.
2. Section loads through the flash driver `0x50002320`: src `0x5000f000`/`0x5032c000`/`0x50370800`/`0x50379000`/`0x51a70000` -> dst `0xa0030000`/`0xa034d000`/`0xa0391800`/`0xa039a000`/`0xa1a91000`; dst - src = 0x50021000 every time, so src = 0x50000020 + offset and dst is the uncached alias of the run-time address. The head itself (offset `0..0xefe0`) is executed but not copied by this code; which earlier stage places it is ?.
3. Pre-kernel inits, in order: UART (`0x50000355`), `0x500027e2`, `0x50002b84`, `0x50000bcf`, the copies, `(0x97f00080) = 0x77777777` (`0x5003b542(0)`), own IVAR/GxICR (`0x5000f068`), the local-window copy (3.4), `0x50023003`, `0x500518fa`, SCPU init `0x5004dc55`, clock/pin registers `0x5006055c`, `0x50025586`, `0x5002558e`, `0x500260aa`, `0x500260b2`, `0x5002532a`, `0x50004061`, then `0x50050279` (IRQ 53 level 5 and IRQ 54 level 3 attached on CPUs 0..3, then disabled on all four; who enables them is ?).
4. Release of CPUs 1..3 (`0x50000282..0x50000329`): `(0xa3258360) = 0`; entries written to `0x98d00140/144/148` = run-time `0x60029b9c`/`0x60029f21`/`0x6002a2ad` (disasm `0x50008b7c`/`0x50008f01`/`0x5000928d`); per CPU four bit-sets in `0x98800340..0x98800434`; `(0xa3258360) = 1`. I: `0x98d0014x` are start-address registers (the values are the CPU entries). The meaning of the `0x988003xx` bits is ?: the CA53 start `0x5003bd93` writes `0x9880034c = 2` and `0x98800360 = 0x200000`, the same bits used for "CPU 3"/"CPU 2", so they look like shared clock or power gates (I).
5. IPI init `0x5002ce4d` (called at `0x5000032b`), `0x50035af4`, "OIS", `(0x99200514) = 0x40`, then `call 0x5000f190` -> `jmp 0x5001184c` (kernel).

### 3.2 CPUs 1..3 (D)

| | CPU 1 | CPU 2 | CPU 3 |
|---|---|---|---|
| entry | `0x50008b7c` | `0x50008f01` | `0x5000928d` |
| `(0x8070)` = 0x30, then 3 | yes | yes | yes |
| `(0x98100000 + X + 8) = 16` | X = 0x400 | X = 0x800 | X = 0x1000 (CPU 0: X = 0) |
| early sp | `0x500027fc` | `0x500027fc` | `0x500027fc` (CPU 0: `0x500007fc`) |
| UART mark | "1" | "2" | "3" |
| own IVAR/GxICR `0x5000f068` at | `0x50008bb9` | `0x50008f3e` | `0x500092ca` |
| spin on `(0xa3258360) != 0`, then copy the window | `0x50008bbe..df` | `0x50008f43..64` | `0x500092cf..f0` |
| log mark | "ois" | "oIs" | "Ois" |
| own bank `+0x514 = 0x40` | `0x99300514` | `0x99b00514` | `0x99b80514` |
| kernel | `0x50008efc` -> `0x50011859` | `0x50009288` -> `0x50011867` | `0x50009688` -> `0x50011875` |

I (strong): `0x8000..0x8fff` is a per-core system-register page: all four cores write the same IVAR (`0x8000 + 4L`), GxICR (`0x8940..0x8958`) and `0x8070` addresses for themselves, `0x8070` behaves like AM33 CHCTR (0x30 invalidates, 3 enables I and D; K-CFLUSH clears bit 1 and waits on bit 3), and `(0x8040) = 8` is the idle halt.

### 3.3 Kernel entry and rendezvous (D)

| CPU | sp (= kcb[64] - 4) | body | `(0x8050)` check |
|---|---|---|---|
| 0 | `0x62e833fc` | `0x50011883` | `0x5001188b`, cmp 0 |
| 1 | `0x62ec37fc` | `0x50012776` | `0x5001277e`, cmp 1 |
| 2 | `0x62ee967c` | `0x50012826` | `0x5001282e`, cmp 2 |
| 3 | `0x62f5647c` | `0x500128d6` | `0x500128de`, cmp 3 |

On mismatch each goes to `0x50017b86`, whose first instruction is `break`. Then per core: store the kcb at `(0x97f00004)[core]`, `0x50012317`, copy 15 u16 pairs kcb[52] -> kcb[56], `*kcb[260] = 0`, release ISC mask 3, clear `(u16)(0x97f00000)`, boot barrier, fill the own kcb[332] queue with -1 under ISC `0x97000000` mask 2, and run the shared chain `0x50011933`, which is data-driven through `(0x97f00004)[(0x8050)]` with no per-core branches.

- **Boot barrier** `0x50015a9c` -> `0x50015a61` (n = kcb[380] = 4): CPU 0 waits on 1 then kicks 1; CPU 3 kicks 2 then waits on 2; CPUs 1 and 2 wait on c+1, kick c-1, wait on c-1, kick c+1. The kick `0x50017bab` jumps to kcb[316] (CPU 0 `0x5000f195`, CPU 1 `0x5000f1c6`, CPU 2 `0x5000f1f7`, CPU 3 `0x5000f228`), each writing 1 to the target bank's `+0x810`. The wait `0x5001258b` polls GxICR `0x8958` request bit 4 (kcb[324][x] = {group 22, bit 0, level 6} for every pair) and writes `(v & 0xff00) | 1`. I: a `+0x810` write raises the target's level-6 group-22 request.
- **Shared chain** `0x50011933` includes `0x50012651` (clears *kcb[260], *kcb[264], (u16)*kcb[268] and CALLs kcb[304], which is a `retf` stub on all four CPUs), `0x500125f6` (enables group-22 GxICR for each other CPU), `0x500122eb` (the kcb[196] init routine = per-CPU INTC init: CPU 0 `0x5002cc69`, CPU 1 `0x50008bfa`, CPU 2 `0x50008f7f`, CPU 3 `0x5000930b`; own bank `+0x514 = 0`, `+0x884 = 1`, GxICR = `(L << 12) | 0x101`), task activation, idle TCB, and the start `0x500119ab`.
- **Kernel-start barrier** `0x50012367` (runs when kcb[336] = 1, true on all four): under ISC lock 0x8000 each core ORs `1 << core` into `(u16)(0x97f00000)` and spins until it reads 0xf. No core dispatches before all four arrive.

### 3.4 Per-core local RAM window at `0x50000000` (D, role I)

CPU 0 fills `0xa1a91000` from offset `0x1a6ffe0` (at `0x500001dc`); every core then copies 4 KiB `0xa1a91000 -> 0x50002000` (CPU 0 at `0x500001fe`). A CALL target T = `0x3ffe1xxx` in disasm notation runs at run-time T + 0x10021020 and its code is at disasm T + 0x11a8f000: `0x3ffe18ea` = memcpy (130 call sites), `0x3ffe134d` = `mov (0x98e000e8),d0; retf` (1 site; reads the SCPU block, "clock" is I). I that the window is per core: CPUs 1..3 use the same early sp `0x500027fc` concurrently and all copy to the same `0x50002000`. I that it holds code which must not touch DRAM (standby or DRAM change): window entry `0x51a6ffe0` posts commands to CPUs 1..3 at `0x97f000c0..c8`, waits for acks at `0x97f000d8..e0`, kicks them via `+0x810` for command 0x20002, and PWR_STANDBY (`0x9d`, queue QPWRSTANDBY) has its stack at `0x50000080..0x50000880` and calls window code `0x3ffe10cd`. The window size, and whether the CPU 1..3 early stack (top `0x500027fc`) overwrites live window bytes `0x7e0..0x7fc`, are ?.

### 3.5 Init tasks and boot handshakes (D)

| Step | CPU 0 (`0x5002cca5`) | CPU 1 (`0x50008c36`) | CPU 2 (`0x50008fbb`) | CPU 3 (`0x50009347`) |
|---|---|---|---|---|
| marks | OIE, SCS, SCE | oie, scs, sce | oIe, sCs, sCe | Oie, Scs, Sce |
| ticks | `0x5003121c` attaches IRQ 138..141 to CPUs 0..3, starts timer channels 1..4 (reload 999), then `(0x97f00088)` = magic | wait for `(0x97f00088)` (`0x5003b5c3(2)`) | same | same |
| services | act_tsk `0x99`, `0x9a`, `0x94` | `0x1024`, `0x1025`, `0x1009` | `0x2021`, `0x2022`, `0x2004` | `0x300f`, `0x3010`, `0x3002` |
| done byte | IRQ 325 attach (handler `0x50003faf` writes own `+0x814`); set `0x97f00094`; spin until `0x97f00094..97` are all 1 (`0x500006ec`) | set `0x97f00095` | set `0x97f00096` | set `0x97f00097` |
| next | hardware and software timers (`0x500642dd`, `0x50058959`); USTART_L `0x2b` (`0x5002417a`); boot chain `0x50023eca` | wait for `(0x97f006fc)` = magic, written at `0x50024042` after CPU 0 starts the four SYS_WDT tasks | USTART_L2 `0x2013` = overlay loader (3.6) | AJ: flash read 0x20000 bytes `0x400a0000 -> 0xa34fd280`; MLS: mode-bank check `0x5003e0a1`; pis `0x50040aeb`; then `(0x97f00090)` = magic, which CPU 0's chain waits for at `0x500249d1`; USTART_L3 `0x300e` |
| before the first overlay call | - | wait segment 1 (`0x50024de8(1)`), call `0x501ea85c` | same, `0x501ea881` | same, `0x501ea8a6` |
| idle | OlyTaSE `0x5002c701`: chg_pri 70, then `(0x8040) = 8` loop `0x5002c756` | `0x50038715` -> `0x500387eb`: magic to `0xa3193680` (waited by CPU 0's USTART2 at `0x501e8ed6`), chg_pri 70, command loop on `0x97f0019c[0]` | same, `0xa3193684`, slot 1 | same, `0xa3193688`, slot 2 |

The CPU 1..3 command loop serves 0x10001 (ter_tsk of the id at `0x97f001a8[core-1]`), 0x20001 (`0x50010501`), 0x20002 (`0x500105e9`) and several 0x3xxxx cases; who writes the command words is ?. Their tick ISRs call `0x500387b9`, which, when `0x97f001b4[core-1] = 1`, disables the own tick, writes 1 to bank `+0x900`, halts, and on wake writes 127 to `+0x900` and re-enables the tick (D); I: a CPU-0-commanded sleep of CPUs 1..3.

### 3.6 CPU 2 loads the overlays (D)

USTART_L2 `0x50024572` reads segments 1..10 from flash (loader `0x50024e6b`, table run-time `0x60029b1c` of {dst, src, flag}, marks LSn/LEn, error "UserSub_FlashReadErr"). After each segment it sends a CREQ: `0x50036120(0, 0x50024eda, n)` for nine segments and `mov 1,d0` at `0x5002480d` for segment 8, which holds CPU 1's AV framework / VCLib code. `0x50024eda` does cache maintenance, runs per-segment init hooks `0x501e60xx` and sets bit n-1 of `(0xa32df1f4)` (`0x50024ffa`); `0x50024de8(n)` sleeps until that bit is set. I: the CREQ to the core that will run the segment's code exists because the cores' caches are not coherent.

| seg | range | seg | range |
|---|---|---|---|
| 1 | `0x50108fe0..0x502d3fe0` | 6 | `0x50aa6fe0..0x50f07fe0` |
| 2 | `0x5038f7e0..0x506f3fe0` | 7 | `0x51009fe0..0x515a67e0` (GUI) |
| 3 | `0x5072f7e0..0x507f1fe0` | 8 | `0x516697e0..0x517af7e0` (to CPU 1) |
| 4 | `0x507f2fe0..0x50a6e7e0` | 9 | `0x517d3fe0..0x5196d7e0` |
| 5 | `0x50aa2fe0..0x50aa67e0` | 10 | `0x519c7fe0..0x51a667e0` |

Byte flags: `0xa32df1ad` segment 1 loaded (set `0x500245a7`), `0xa32df1b6` (set `0x5002487f`), `0xa32df1b7` CPU 3's D1 step done (set `0x5002443e`); USTART_L waits on `1ad` then `1b7` (`0x5002418a`, `0x500241ac`), USTART_L3 on `1ad` (`0x50024488`).

### 3.7 CPU 0 starts the application tasks (D)

OlyTaSt `0x5002c546` calls `0x5002d003`, which compares `id & 0x3000` with the caller's; the same core goes to act_tsk `0x5000f879`, another core to OlyTaStCpu `0x5002d325` (cpu_conn kind 9). The boot code `0x50023eca..0x50024e00` (init task and USTART_L) makes 21 CPU 0, 2 CPU 1, 1 CPU 2 and 1 CPU 3 starts; USTART2..5 (CPU 0 tasks `0x28`, `0x2a`, `0x29`, `0x27`, sites `0x501e8f09..0x501ea7a9`) make 83 / 17 / 26 / 10. Subsystem owners also start helpers on other cores: AUD_MAIN (`0x52`, `0x50a62a05`) starts AUD_WAKEUP `0x2017` and AUD_LEVEL_MONITOR `0x200e` on CPU 2; the AV middleware init `0x50527bcf` (from USTART5 `0x501ea3c2`) starts AVM tasks on CPUs 0, 1 and 2. Dynamic tasks land on the creating core: acre_tsk `0x5000f76f` uses `(0x97f00004)[(0x8050)]` and the id allocator `0x500142a8` returns `(0x8050) << 12 | index`; only the cpu_conn proxy (`0x5002d494`) creates tasks on behalf of another core (D).

## 4. Task placement

The authoritative per-core list is the firmware's own object-name table: pointers at `0x6034d0d4 + 0x20 * type + 4 * cpu` to runs of `{char name[24]; u16 index}` (`0x61a3c700..0x61a45618`), read by `0x5002ebb4..0x5002ec2e` and the shell's `od` command (D). For tasks it matches the four static tables entry for entry, and the tags passed to the error checker after each OlyTaSt agree with it except for spelling (D, re-checked). Named objects per core (D): tasks 159 / 97 / 37 / 18, semaphores 145 / 18 / 15 / 0, event flags 296 / 43 / 28 / 18; for types 3..5 see section 9.

| Subsystem | CPU 0 | CPU 1 | CPU 2 | CPU 3 |
|---|---|---|---|---|
| Application, GUI | CA_MAIN `0x3a` (`0x51049ebb`, creates GUI_TASK), HIGHLEVEL_MAIN `0x39`; GUI_TASK created at `0x5108bc64` (I: on CPU 0) | | OSD_DRAW_CPU2 `0x2015` (`0x51015f1d`) | DISP_FRAME `0x300d` (`0x5100d05a`, role ?) |
| UI input, display | UI_IN `0x54`, TOUCHPANEL `0x53`, MULTISELECTOR `0x89`, USR_FAST `0x55`, UI_OUT `0x26`, DISPLAY `0x36`, DISPLAY_CHANGE `0x8f`, DISPLAY_DP `0x8e` | | | |
| Still capture | TAKE_EXPOSE/FOCUS/FUNC/FUNC_CP/MOV/POWER_MANAGER, STB_*, ZOOM, REC_PRE/IMA/FIL/VIE/SOU/MAI/EXT, ISEQ_*, IMG_PRECON, EFFECT(_EXE), C3D, C3D_EXE_BRIDGE | C3D_EXE `0x1002`, C3D_UPDATE `0x1004`, IMGPRO_MDL_WORK `0x1008`, FILEISCAM `0x100f` | REC_MAI_CPU2 `0x2011`, REC_VIE_CPU2 `0x2012`, REC_PRE_STLNML `0x2019`, REC_IMA_STLNML `0x201a` (entry `0x50541c45` shared with REC_IMA) | |
| AF, detection | FCS_MOVIE `0x59`, FCS_IP `0x6f`, FCS_IP_SUB `0x56`, FCS_IP_NOTIFICATION `0x92`, MDET_CALC_FLAME `0x45` | FCS_IP_2 `0x100b`, FCS_IP_2NDCPU_SUB `0x100c`, FCS_IMG_2NDCPU_MAIN `0x101e`, FCS_IP_RANGING_SUB `0x1022`, FACE_BEAUTY `0x100a` | SDET `0x2010` | MDET_DL_REQ `0x3004`, MDET_DL_LDL `0x3005`, MDET_CALC_MAIN/E_SEND/PDT/TRC_CPU3 `0x3006..0x300b`, FACE_FD `0x3008`, FACE_MAIN `0x3009`, FCS_IMG_4THCPU_MAIN `0x300c` |
| Movie record | EXP_MOVIE `0x58` | AVPI VEN BACD `0x1049..0x1050` (I from the name: video encode) | MVR_MAIN `0x2002`, MVR_MOVIE, MVR_IMG1/2/PRE/EXE/AFT/POST, MVR_CALC, MVR_ENC, MVR_WIFI, MVR_RECVIEW, MVR_EXEC, EXP_MOVIE2/3 `0x2009`/`0x200a`, WB_MOV `0x200f` | |
| AV middleware | AVM_COM_0, AVM_AUDIO_0, AVM_VIDEO_0, AVM0, AVM_FILE_CPUSW (`0x8096..0x809f`) | AVM_CPUSW `0x905b`, AVM_FILE `0x905c`, AVM_MEDIAPATH_1/2, AVM_MP4 `0x105a`, AVMDL_THREAD00..20 `0x102a..0x103e` (pool spawned by `0x51669f44`), MASTER_0 `0x1051`, CORE/CABAC `0x1052..0x1059`, AVPI VDE BACD `0x1041..0x1048` | AVM_COM_2, AVM_AUDIO_2, AVM_VIDEO_2, AVM2 (`0xa01e..0xa025`; AVM2 shares entry `0x50527ee1` with AVM0, exinf 1 vs 0) | |
| Playback, edit | PLAY_*, MOVP_MAIN/VIDEO/AUDIO, MOVE_*, ALBM_MAIN | (decode back end above) | MOVP_AUDIO_SUB `0x2014` | |
| Audio | AUD_MAIN `0x52`, A:IF* `0x07`/`0x2d`/`0x51` | Wi-Fi stream audio `0x1013` | AUD_LEVEL_MONITOR `0x200e` (`0x50aaa99e`), AUD_WAKEUP `0x2017` | |
| Lens, power, peripherals | LENS_*, PWR_MAIN `0x0a`, PWR_STANDBY `0x9d`, PER_IN/EYE/ROTATE/SLOPE/IOEXP/CCD_TEMP, accelerometer, PER_SCPU `0x7a`, FLASHMEM, FFPRM | SYS_CA53_PWR_MNG `0x101c`, ISC_RECV_WAIT `0x1029` | | |
| USB, PTP, network | PC_EVENT/HOSTCOM/PCMRECLINK/PTP/UAM/USB/USBSRV, PC_PD_COM, TSK_PTPCOM, DPS, TPC_*, WIFI_REMO `0x03` | WIFI_MNGR, WIFI_CGI/PUSH/REMP/STREAM(_PIC), WIFI_ISC_BSDAPI_RX/TX, WIFI_ISC_HTTPD_*, PTPIP/CDC/EVC, BLE_HDLR, BLE_MAIN_HDLR | | |
| Infrastructure | section 2, plus USRSTART2..5, USRSTART_LOAD, HPROC_PROC `0x10`, DBG_OUT `0x8095` | DBG_MESSAGE_CPU1 `0x9023`, ARM shell bridge `0x1027` | USRSTART_LOAD_2 `0x2013` | USRSTART_LOAD_3 `0x300e` |

CPU 0's 12 `retf`-entry tasks (D, bytes `de 00 00`): CAM_MAIN `0x0b`, `0x2c`, the Bluetooth-classic/OBEX set `0x2e..0x35` (`0x510175d7..ec`), `0x46`, `0x8a`; CPUs 1..3 have none. Bluetooth classic is therefore not a live CPU 0 role in this image.

CPU 1 core checks (D): the ARM shell path refuses other cores (`0x5003174f`: `mov (0x8050),d0; cmp 1,d0`, string `Only CPU1 is supported.`), and the CA53 start `0x5003bd93` goes to `0x5003be6f` ("Warning ca53 start cpu:") unless the core is 1 (`0x5003bdab`). The ISC library (`ISC_send/receive/alloc_mem/attach_mem`, `0x5003a06b..0x5003ad40`) and the CPU 1 objects WIFI_ISC_*, BLE_ISC make the A53 the far end of CPU 1's network tasks (I). Whether the A53 runs Linux in production is ? (Linux appears only in debug help text `0x5003c809..`).

Interrupt evidence (D): `0x50053fcd(irq, level, handler, cpu)` attaches IRQ 303-306 to CPU 1 only (AV init `0x50527be3..0x50527c2c`), 278/279 (`0x507f9127`, `0x507fa992`, MDET) and 286/287 (`0x50524c61`, `0x50524d02`, face) to CPU 3 only, 255 and 4 to CPU 0 only. Attach is exclusive: `0x5002e84e` writes the level into the target CPU's bank and 0 into the other three, keeping a per-CPU shadow at `0xa325ea80 + 0x590 * cpu` that enable `0x5002e9f3` writes back. So an IRQ attached "on all four CPUs" in a loop is routed to CPU 3 until some enable runs; which core finally takes 288-302, 307-309, 53/54 and 323-326 is ?.

## 5. Inter-core traffic

### 5.1 Mechanisms (D)

| Path | Doorbell | Carrier | Sender | Receiver |
|---|---|---|---|---|
| kernel kick | target bank `+0x810` = 1 | kcb[332] queue of the target (`break -110` when full) | `0x5000f195` / `0x5000f1c6` / `0x5000f1f7` / `0x5000f228` via kcb[316] (`0x50017bab`); the cross-CPU ready request `0x50010b6d` (callers `0x5000f980`, `0x50010a7f`, `0x500137e6`, `0x50013867`); window code `0x51a70011..1d` | the boot-barrier wait polls GxICR `0x8958`; the queue is drained by `0x50010be8` at every kernel lock and interrupt exit. IRQ 325 (level 0, all CPUs) writes the own `+0x814`; I that it acks the kick |
| sys_callrequest | target bank `+0x808` bit `8 << src` | 32 x {fn, arg} ring per (target, src) at `0xa32a6b18 + 0x408 * target + 0x100 * src`, indices `0xa32a6f18 + 0x408 * target + 2 * src` | `0x50035afd(d0 target, a0 fn, a1 arg)`, 74 sites | IRQ 324 handler bits 8/16/32/64 -> drainer `0x50035be0 + 0x54 * (4 * target + src)` calls fn(arg) in interrupt context |
| CREQ (task context) | as sys_callrequest, fn = dispatcher `0x50036293`/`2c3`/`2f3`/`323` | 32-slot {fn, arg} table per (target, src) at `0xa32a7b38..`; the dispatcher sends `idx | src << 16` to the target's DTQ ("I_CSWn") | `0x50036120(core, fn, arg)`; calls fn directly when core = `(0x8050)` | CPUCALL_CPUn runs fn(arg) in task context |
| cpu_conn call / return | `+0x808` bit 1 / bit 2 | 52-byte slots, 31 per core, pool `0xa3258364 + 0x64c * core` | the Oly* wrappers `0x5002bd01..0x5002c552`, whenever the object id's core differs from the caller's (`0x5002cfb0`, `0x5002d003`, `0x5002d03d`); kinds 1 tsnd_mbf, 2 trcv_mbf, 3 set_flg, 5 twai_flg, 6 clr_flg, 7 sig_sem, 8 twai_sem, 9 act_tsk; sender `0x5002d679` | bit 1 wakes CPUCONN (pattern 0x80000000), which creates a proxy task (entry `0x5002cf2d/4d/6e/8f` by source, pri 15; 27 on CPU 2 while `(0xa325e998)` != 0) running `0x5002d4d5`; its result goes back with bit 2 |
| cpu_conn iset_flg | `+0x808` bit 4 | table 16 + core | kind 4, `0x5002d1bb` -> `0x5002d7a9` | done inside the handler |

All four IRQ 324 handlers differ only in bank, flag id, log strings, core index and drainer set; the bit meanings are the same on every core (D). Each sys_callrequest post and each `0x5002d7a9` reads `(0x97f00000)` and drops the value before the doorbell write (`0x50035bbe`, `0x5002d7dc`); the attach path does the same; why is ? (I: an ordering read). Consequence of cpu_conn (I): any queue, flag, semaphore or task call on another core's object id is IPI traffic without an explicit post, so the object's owner core (its id) decides where the work runs.

### 5.2 Matrix

Rows send, columns receive. Constant-target sys_callrequest sites have a D target; the sender is D only where noted.

| from \ to | CPU 0 | CPU 1 | CPU 2 | CPU 3 |
|---|---|---|---|---|
| CPU 0 | - | task starts (D); focus requests `0x5090fc6d`, `0x5090fd18`, `0x5090fd75`, `0x5090fddb`, `0x5090fe3e` (I: the requester `0x5090fc5c` then waits on CPU 0 flag 0x92); FCS-IP jobs `0x50932401`, `0x509325b8`, `0x5093267a`, `0x50932823` (sender I); AF debug copy `0x5099e808` | task starts (D); audio commands to AUD_LEVEL_MONITOR's dtq `0x50aa9d4e` (Super Control Panel `0x50aa9d43`, I: CPU 0), `0x50aadc63`, `0x50aae020`, `0x50aaea9e`; OSD draw message to `0x2013` via cpu_conn (`0x510149a2`, caller GUI wrapper `0x50aea03a`; I: CPU 0) | task starts (D); `0x97f0019c` command block and window commands (reader D, writer ?) |
| CPU 1 | focus replies `0x5090fccc..0x5090fe62` (called from CPU 1 focus code `0x50966d8a`/`0x50966394`/`0x50966e08`, I); FCS-IP replies `0x5093246b`, `0x509325f7`, `0x509326be`, `0x5093294e` (D chain: the tail of the fns posted to CPU 1); boot done byte (D) | - | ? | ? |
| CPU 2 | overlay notices, 9 of 10 (D); AUD_LEVEL_MONITOR reply `0x50aaad5f` sets CPU 0 flag 0xba LEVEL_MONITOR_UPDATE (D); AUD_WAKEUP `0x50a62d6b` sets flag 0xf9 (D); rec `0x50573215` -> CPU 0 object 0x11 (I: CPU 2 rec code); boot done byte and magic (D) | overlay notice for segment 8, `0x5002480d` (D) | - | ? |
| CPU 3 | boot magic `(0x97f00090)` (D); no constant-target post found (?) | ? | ? | - |
| any core but the owner | PER_ADCONV `0x5004d57b`/`d74b`/`d776`/`d822`, ems1 `0x501a68a7`, VSC "REQ" `0x501c40af`, task 16 ring `0x508c7358` (D: `if (0x8050) == 0 call else post`) | DSP0-2 request service `0x50426749` (D: when requester != 1; serves flags DSP0/1/2 `0x1029..0x102b` and DSP_MSG0..2 `0x1023..0x1025` via tasks `0x105f..0x1061`) | AUD `[ser]` `0x50a63198`, `0x5050cfb6`, `0x505732c2` (sender ?) | DISP_FRAME flag 0x3001 `0x500258ca` (D: `if (0x8050) == 3 set else post`); mdet LAF events, 13 sites via `0x508017b4` d0 = 3, set flag 0x3007; mdet DL dispatch `0x5080aed5`, `0x5080b165`; LAF PDT/TRC `0x50841e85`, `0x5084866f`; face `0x50523ac3` (senders ?) |

Callbacks shipped home (D): the software timer service stores the creator's `(0x8050)` and posts the expiry callback back to it (`0x500586ef`, `0x50058d14`, `0x5005912d`); likewise PWRIC (`0x50059d71..e38`), ADCONV `0x5004d9c3`, PER_SIO `0x5005f3ab`, key special callbacks `0x5014c602`, ems1 `0x501a6ab3`, the DSP service reply (`0x5042683d`, `0x50426ba0`), MVR `0x5044ed8b` (sets CPU 2 flag 0x2003), rec_multiexp `0x5054dec7`, mdet `0x50801904`, `0x50801b03`, `0x5084271c`, `0x50848e82`, `0x50849284`. The debug command `dbg dmyp/nmip` posts to any core (`0x519d19f4`).

Overall shape (I, from the matrix): CPU 0 sends AF work to CPU 1, detection events to CPU 3, audio and OSD work to CPU 2, and collects the replies; CPUs 1..3 hardly talk to each other.

## 6. Shared resources

### 6.1 ISC hardware semaphores at `0x97000000` (D)

8 groups of 8 one-bit semaphores; group g is the byte at `0x97000000 + 0x40 * g`; lock = `bset mask,(addr)`, unlock = `bclr`. "ssc lock" `0x5003b31e`: group `(id >> 3) & 7`, mask `1 << (id & 7)`, d1 = 0 tries once, d1 = 255 waits (warning `!!!Nigiri sugi chan!!!`); unlock `0x5003b469`. The ISC library uses bit 0 of groups 0..7 (`0x50039fe4`, shell `isc trylock <id>`), the kernel group 0 bit 0 for bit-15 objects and masks 2/3 at boot; no SSC id in use is a multiple of 8 (I: bit 0 of every group is reserved). `0x5003b2eb/fe` spins on `0x97000100` mask 0x10 with interrupts masked (timer driver `0x500640d4..0x500642d2`, `0x5101724b`). The lock helpers are linked four times: `0x50039f4e` and in audio code `0x50aa31d6`, `0x50aa4b3e`, `0x50aa5015`.

| sem | resource (from nearby strings) | callers |
|---|---|---|
| 0x09 | clock/power register control | `0x5004dee2`, `0x50061b61`, `0x50061c6c` |
| 0x0a | power IC / adapter | `0x50059a67`, `0x508c72d5`, `0x508c73a8` |
| 0x0b | heap (`alloc ?cpu`) | `0x500033bd`, `0x50003668` |
| 0x0c | flash-memory service | `0x5004073a`, `0x500408c0`, `0x500415af` |
| 0x0d | PER_SLOPE | `0x5005f159`, `0x5005f2e0` |
| 0x0e | AD converter | `0x5004d43e..d910` |
| 0x0f | software timer service | `0x50058511..917a` |
| 0x11 | hardware free-run timer | `0x50064515`, `0x500645a0` |
| 0x14 | debug log output | `0x5012ac31..af3e` |
| 0x15 | deferred-call ring; AF tracking | `0x50053325/3518/3632`, `0x51a0fa0e` |
| 0x16 | GPIO expander | `0x50052be5`, `0x50052c81` |
| 0x17 | flash access guard | `0x50000829` |
| 0x1a / 0x1d | image buffer manager | `0x50536564` / `0x50536cad` |
| 0x1b | DISPLAY | `0x501c4117..4237` |
| 0x1e / 0x21 | DCF paths / log sectors | `0x508a4ea1`, `0x508a4ef0`, `0x508b36e1` / `0x508acd49` |
| 0x25 / 0x2a | rec_os.c / rec_precon.c | `0x5054e644..e875` / `0x5054eb14`, `0x5054ebe8` |

Which cores contend for each one is ?. CPU 0 also guards the OSD message to CPU 2 with its own kernel semaphore 117 OSD_SDRAM_WRITE (`(0x60042f42)`, `0x510149a2..0x51014a6c`).

### 6.2 Shared block `0x97f00000` (D for each use, nature ?)

| Address | Use |
|---|---|
| `(u16)0x97f00000` | kernel-start mask (3.3); also read and dropped before each doorbell |
| `0x97f00004 + 4 * core` | kcb pointer of each core |
| `0x97f00080`, `0x88`, `0x90`, `0x6fc` | boot magic words (`0x5003b542`/`0x5003b5c3`): CPU 0 early init, CPU 0 tick init, CPU 3 boot jobs, CPU 0 SYS_WDT starts |
| `0x97f00094..97` | per-core init-done bytes |
| `0x97f00098` | written 1 by CPU 0 UART init |
| `0x97f000c0..c8`, `0x97f000d8..e0` | window commands to CPUs 1..3 and their acks |
| `0x97f0019c..0x97f001d0` | command block CPU 0 -> CPUs 1..3 (command, task id at `+0x0c`, sleep request at `+0x18`) |
| `0x97f0027c` | DSP service shared bits |
| `(u16)0x97f00290` | VSC change word (`0x500251f3`) |

I: on-chip RAM visible to all four cores, since every rendezvous goes through it.

### 6.3 Caches

K-CFLUSH `0x5004e68a` clears bit 1 of the own `(0x8070)`, waits while bit 3 is set, then sets bit 4 of the per-core register `0x98100000 + X` selected by `(0x8050)` and waits for it to clear (D; X is the same per-core offset the boot code writes 16 to, 3.2). After CPU 2 loads each overlay, the consuming core runs cache maintenance in `0x50024eda` (D). I: the cores' caches are not kept coherent by hardware, so cross-core data hand-offs rely on these explicit steps and on the uncached `0xa0000000` alias (all rings and slot pools in 5.1 are at `0xa32...` / `0xa33...`).

## 7. What the emulator models today

The lab runs one MN10300 core as CPU 0 (`(0x8050)` written 0). Per kernel spec 5.1 and intc/timer spec sections 2 and 5:

| Label | What it does | What the real firmware does instead |
|---|---|---|
| K-OTHERCPU | writes kcb pointers of CPUs 1-3 and fills their kcb[332] queues with -1 | their own entries (3.3) |
| K-BOOTSYNC | skips `0x50015a61` | the 3-2-1-0-1-2-3 kick/wait ring (3.3) |
| K-IPI | skips `0x50012651`, replays its three clears | clears plus a CALL of the `retf` stub kcb[304] (section 8, item 1) |
| no kernel start | `0x500119ab` not run | the `(u16)0x97f00000` = 0xf barrier, then dispatch |
| H-IPIINIT, A-IPI | `0x5002ce4d` runs natively; `+0x808` pending bits OR / read, `+0x80c` clears; bank 0 drives IRQ 324, banks 1..3 drive nothing and are logged | four handlers on four cores |
| S-CPU2 | serves the GUI's one allow-listed post (`0x50aa9d4e`, return `0x50aa9d55`) as task `0x200e` command 3 and posts the reply to ring [0][2] | AUD_LEVEL_MONITOR on CPU 2 with live level data; its swap path `0x50aaad0e` |
| K-CFLUSH | returns at once | the handshake in 6.3 |

All overlay segments are present in the lab image, so CPU 2's loader role is not needed there (I).

What modelling each other core would take (I unless marked):

- **Common to any second core:** a second emulated CPU with its own `0x8000` page (`0x8050` core id, IVAR, GxICR `0x89xx`, `0x8070`), its own local RAM at `0x50000000` if that window is per core (3.4), its INTC bank driving that CPU's request line, `+0x810` raising its group-22 level-6 request, the ISC semaphore byte operations atomic across cores, and the `0x97f00000` block shared. With those, K-OTHERCPU, K-BOOTSYNC and the kernel-start barrier could run natively instead of being stood in for, and the boot could start at the CPU entries (3.2) with the other cores' init tasks.
- **CPU 2:** the only core the lab's GUI path already reaches (D: S-CPU2's post; the OSD message `0x510149a2` -> `0x2013` is reached from the GUI wrapper `0x50aea03a`). Running it needs its kernel (37 tasks, most of which wait for movie or audio hardware), the audio level source behind AUD_LEVEL_MONITOR, and the overlay loader skipped or given a flash model. This is the natural next core: it would replace S-CPU2 and serve OSD_DRAW_CPU2 natively.
- **CPU 3:** detection needs image data and the engines behind IRQs 278/279/286/287; for the GUI the visible part would be DISP_FRAME (woken by flag 0x3001 from `0x5002588e`), whose output is ?.
- **CPU 1:** Wi-Fi, BLE and PTP-IP end at the A53 over ISC, which is not modelled; the AV back end needs the codec hardware. Little GUI value.

## 8. Corrections to other documents (applied after PLAYFIX)

1. Kernel spec 5.1, the K-IPI stand-in: `0x50012651` CALLs kcb[304], which is a `retf` stub on all four CPUs (`de 00 00` at `0x60085d99`/`db7`/`dd5`/`df3`). `0x5000f195` is kcb[316] (run-time `0x600301b5`), the kick used by the boot barrier and the cross-CPU ready request; it is not reached from K-IPI (D).
2. Kernel spec 5.1 K-BOOTSYNC "through `0x8900+`": the kick is a write to the neighbour's INTC bank `+0x810`; the wait polls the own GxICR `0x8958` (D, 3.3).
3. Task `0x200e` is named AUD_LEVEL_MONITOR in the name table (CPU 2 task 14); its reply sets CPU 0 flag 186 LEVEL_MONITOR_UPDATE, and CPU 0 semaphore 86 is AUD_LEVELMONITOR (D). "Audio sequencer" (intc spec, ROADMAP) describes its aud_seq code strings, not its name.
4. K-CRT-134D (settings spec): `0x3ffe134d` is `mov (0x98e000e8),d0; retf` at window code `0x51a7034d` (D).
5. ROADMAP "which core runs the GUI": CPU 0 (I, strong): the GUI creator is in CA_MAIN's code, CA_MAIN, the draw flag 0x79 OSD_CONTROL, DISPLAY, UI_IN and TOUCHPANEL are CPU 0 objects (D), and `scOsIsTaskContextCPU0` `0x50b020c2` exists in the GUI SDK (D, 2 callers). `OSDDRAW_CPU2` is a CPU 2 object fed by the GUI, not a sign the GUI runs on CPU 2.

## 9. Open questions, ranked

1. **Which core takes each shared IRQ.** Attach is exclusive (section 4), so the enable calls (`0x50054012`, `0x5002ea93`) for 288-302, 307-309, 53/54 and 323-326 decide delivery; not scanned.
2. **Which task executes the GUI creator `0x510609ce`.** Every candidate (CA_MAIN, HIGHLEVEL_MAIN) is a CPU 0 task, so "GUI on CPU 0" is I, not D.
3. **What OSD_DRAW_CPU2 command 1 computes** (per-pixel arithmetic over a rectangle) and which GUI paths reach `0x50aea03a`; this decides whether a lab GUI session needs CPU 2.
4. **The CPU 0 -> CPUs 1..3 command channels** (`0x97f0019c..`, `0x97f000c0..`): who writes them and when (standby, DRAM clock change), and what memory `0x97f00000` is.
5. **Hardware meaning of the per-core registers:** `0x98d00140..148`, the `0x988003xx`/`0x988004xx` bits (shared with the CA53 start), bank `+0x810`/`+0x814`/IRQ 325, `+0x514`/`+0x884`/`+0x900`, and `0x98100000 + X`.
6. **What places the image head** at run-time `0x60021020` before reset, and what the flash driver's `0x50000020 + offset` addresses refer to.
7. **Object types 3..5** in the name table (`*_RECEIVE`, `MPF*`, `TAKE_UTIL_INTR_Q`, OSDDRAW_CPU2): OlyQeRd's cross-core path is kind 2 trcv_mbf, so type 5 is probably message buffers (I); the type-3 table has a duplicate index (`0x1004`), so the type numbering past 2 is unreliable. The audio dtq `0x2001` is a raw kernel dtq (`0x500150fc`, `0x50010e06`); its name is ?.
8. **What DSP0-2 is** (CPU 1 service `0x5042670a`, error base 0x3d01xxxx) and what the A53 runs in production.
9. **Sender core of most sys_callrequest sites:** the posting functions are library code; the static object-id table plus each caller's task would settle it per site. CREQ callers above `0x51400000` were not scanned.
10. **Local RAM window size** and whether CPUs 1..3's early stack overlaps live window code; whether each overlay segment's post-load hook runs on the core that uses it; who calls `0x5002d355` (CPU 2's proxy priority 27).
