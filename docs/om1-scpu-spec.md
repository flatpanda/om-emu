> Status (2026-10-23, survey only): nothing here is built. The firmware was read statically on the host (byte scans, a host-side disassembly in a scratch directory); it was never executed. The lab's SCPU today is HLE: S-SCPU at the request API (`emu/src/lab/scpuserver.mjs`) and the window device (`emu/src/dev/scpu.mjs`), hle-gaps.md 4.7, 4.7.1-4.7.3. Section 8 is the plan this survey recommends.

# OM-1 sub-CPU (SCPU) firmware

Firmware = the E143 v1.9 `.BIN`'s block at file offset `0x0e560000` (`unpacked/E143/...blk0e560000.OE.0107.bin`, 262,080 bytes). Addresses are SCPU addresses (flash `0x08xxxxxx`, SRAM `0x2000xxxx`, peripherals `0x4xxxxxxx`) unless they carry an MN prefix (`0x5xxxxxxx` code, `0x6xxxxxxx` / `0xaxxxxxxx` data, as in the other specs). Tags: **D** read from the code or data, **I** inference, **X** experiment (none in this round), **?** unknown.

## 1. Core and MCU

| Item | Finding | Evidence |
|---|---|---|
| Instruction set | ARMv7E-M Thumb-2 | D: 32-bit Thumb encodings throughout (`orr.w`, `b.w`, `tbb`, `udiv`, `ldrex`), DSP `smulbb` in ordinary code (e.g. `0x800b5ce`) |
| FPU | present and enabled, not used by the application | D: the reset path's first call `0x8027df0` ORs `0xf00000` into CPACR (`0xe000ed88`) and writes FPSCR; the RTOS's context switch restores `s16-s31` when EXC_RETURN bit 4 is clear (`0x80212c2`) and touches FPCCR (`0xe000ef34`, `0x8017878`). Only three VFP instructions exist in the whole code (that restore, one `vmrs`, one `vmsr`), so no task ever has an FP context |
| Core | Cortex-M4F | I from the two rows above (M4 = v7E-M + single-precision FPU; an M7 would bring caches, which nothing configures) |
| Vector table | 99 entries (16 system + 83 IRQs) at `0x08000000`, VTOR written `0x08000000` | D: table `0x000..0x18b` of the block, strings start at `0x18c`; VTOR / AIRCR (`0x05fa0300`) / CCR.STKALIGN written at `0x80244dc..f4` |
| Peripheral map | the STM32L4 map | D: GPIOA..H at `0x48000000 + 0x400n` (A, B, C, D, H used), RCC `0x40021000` with AHB1ENR `+0x48`, AHB2ENR `+0x4c`, APB1ENR1 `+0x58`, APB2ENR `+0x60`, CCIPR `+0x88`, BDCR `+0x90`, CSR `+0x94`; FLASH `0x40022000`; PWR `0x40007000` (+0, +4, +8, +0x10, +0x18, +0x20); EXTI `0x40010400`, SYSCFG EXTICR `0x40010008`; DMA1 / DMA2 `0x40020000` / `0x40020400` with channel registers at `+0x08 + 0x14 (n - 1)`; ADC `0x50040000` (common `0x50040300`); TIM2 `0x40000000`, TIM1 `0x40012c00`, TIM15 / TIM16 `0x40014000` / `0x40014400`; SPI2 `0x40003800`; USART2 `0x40004400`, USART1 `0x40013800`, LPUART1 `0x40008000`; I2C1 / I2C2 `0x40005400` / `0x40005800`; USB FS device `0x40006800`; RTC `0x40002800`. ADC at `0x50040000` excludes the G4 (whose RCC is the same) |
| Library | STM32Cube HAL | D: "Error_Handler" (`0xa02c`), "RTC SET HAL ERROR!!" (`0xb43b`); HAL handle layouts (SPI Init at handle +4..+52, DMA Request at +4) match the code's stores |
| Part | STM32L43x / L44x class, 64-pin package; exact part ? | I: 83 IRQs (`0..82`, CRS last) is that subfamily's vector table; IRQ 67 (USB FS) is used, which L431 lacks; SRAM top `0x20010000` = 64 KiB (L43x/L44x: 48 KiB SRAM1 + 16 KiB SRAM2); a 256 KiB slot (section 2); the GIO table's 52 pins are PA0-15, PB0-15, PC0-15, PD2, PH0, PH1, PH3 (D, section 4.1), the LQFP64 pin set with PH3 the BOOT0 pin. L433 versus L443 (AES) is not decided: no AES (`0x50060000`) or LCD (`0x40002400`) reference was found, which does not prove absence |
| Toolchain | IAR EWARM | I: CSTACK / HSTACK naming in the fault dump strings (`0x24b58`, `0x24b80`), IAR's packed `.data` initialiser (section 2), `printf_s` constraint strings |
| RTOS | eForce uC3 (uITRON 4 style) | D: "eForce co.,ltd." at `0x211c8`; the kernel start `0x80174dc` walks a static object table switching on a type nibble (`0x20..0xa0`); that the types are tasks, semaphores, flags, data queues and cyclic handlers is I from the object names (section 5) |

## 2. Image, load address and the other bodies

- **Load address (D):** `0x08000000`, the container head's load field (`docs/firmware-container.md` field `0x08`), the vector table's own handlers (`0x0802xxxx`), the VTOR write and every literal pool. Head version 0, flags `0x0107`; the body checksums.
- **Layout (D):** code and constants `0x08000000..0x08028801` (162 KiB); `0xff` from `0x08028802` to the block's end `0x0803ffbf`. The block is 256 KiB with head and tail, so the slot is 256 KiB minus 64 bytes; whether the last 64 bytes of a 256 KiB flash are reserved for something else is ?. The IAR initialiser table `0x8028700..0x802871f` (walked by `0x8027e38`) has two entries: zero `0xc880` bytes at `0x200002c0` (`.bss`, to `0x2000cb40`), and decompress 226 bytes from `0x8028720` into `0x20000000` (`.data`, `0x2bd` bytes; routine `0x8028686`, an LZ-style packer: token byte, literal count in bits 0-1, match length in bits 4-7, offset high bits in 2-3). `.data` holds the console prompt "SUB> " (`0x20000004`), SystemCoreClock = 4,000,000 at `0x20000018` (the CMSIS default before the clock set-up), and the debug console's command table pointers. Stacks: reset sets MSP = `0x2000fc00`, PSP = `0x20010000` and CONTROL.SPSEL (`0x80277a4..c2`), then jumps to `0x8028665` (IAR start: `0x8027df0` FPU, `0x8027e14` data init, `0x8027e64` main: NVIC / SCB init `0x80244a8`, then the kernel `0x80174dc`).
- **Firmware update:** commands `0x07` / `0x87` reach `sys_firmup_comp.c` (table in section 3.3); the FLASH controller is touched at `0x800a530`, `0x800c1ba`, `0x800c3e2`. Whether the application rewrites its own flash or hands over to the ROM bootloader (PH3-BOOT0 plus the MN's reset pin 107 would allow the latter) is ?. A 162 KiB image in a 256 KiB part leaves no room for a second copy.

| Body | SCPU block | Notes (D unless tagged) |
|---|---|---|
| E143 OM-1 v1.9 | `0x0e560000`, sha1 `991b06cf676d...` | this spec; source tree "...\S0095\Scpu\dev_pack\source\..." |
| E146 OM-1 Mark II v1.3 | `0x0e520000`, byte-identical to E143's | the same binary |
| E147 OM-3 v1.1 | `0x0e520000`, sha1 `89b94842759c...`, reset `0x80253d9`, SP `0x20010000` | a different build of the same module set (tree "S0123_NZ03-002", the same 16 source files); not in `unpacked/E147`, which holds two blocks only; read from `fw/` |
| E139 E-M1 III v1.6 | `0x06880000`, 256 KiB slot, SP `0x20020000` (128 KiB SRAM) | another lineage ("S0118_S0092"): key.c, jogdial.c, joystick.c, sleep_key_monitor.c beside the battery, charge and USB PD modules; a different MCU (I, SRAM size). Not in `unpacked/E139` |
| E134 E-M1X v2.4 | `0x07400000`, 384 KiB slot, SP `0x20040000` (256 KiB SRAM) | another lineage ("S0116_S0080"): GPS, logger, compass, pressure, gyro/acc, rotate; a different MCU (I) |
| E144, E145, E142, E140 and the 23 older bodies in `fw/old` | none | no Cortex-M vector table in any block |

So an SCPU LLE built for E143 serves E146 unchanged and E147 with its own image; E139's SCPU owns keys and dials, which E143's does not (section 4.6).

## 3. The MN link, SCPU side

### 3.1 Transport (D unless tagged)

- **SPI2 as slave, with DMA.** MX init `0x800b482`: SPI2, slave, NSS software (`0x200`), 8-bit. MSP `0x800b4c4`: SPI2 clock, PB13 / PB14 / PB15 alternate function 5 (SCK, MISO, MOSI), DMA1 channel 4 (receive) and channel 5 (transmit), request 1 (the L4's SPI2 mapping). The per-SIO layer (`0x80123b6`, from the comm init `0x8012abc`) reopens the channel with the comm task's settings: slave, CPOL 0, CPHA 0 (mode 0), MSB first, 8-bit, completion callbacks for receive and transmit, DMA mode (bit 7 of the settings byte `0x83`). Only one SIO channel exists (`0x800b750` maps channel 0 to the handle `0x2000bcf8`). The MN is the master (its PER_SIO channel 2 with clock word 6,000,000, hle-gaps 4.7.1); the SCPU's own rate field is unused as a slave.
- **Pins.** The comm code uses three GIO ports (section 4.1): 28 = PB12, an EXTI input it registers, enables and disables around each transfer (`0x8012a6c..0x8012ab8`, `0x80131d6`); 34 = PC2 and 35 = PC3, outputs it drives 0 and 1 at the steps of a transaction (34: `0x8012c46`, `0x8012ea2`, `0x801322c`; 35: `0x8012be6`, `0x8012f9c`). I: PB12 is the MN's request line, MN pin 103 (PB12 is SPI2's NSS pin on this part and the SPI runs with software NSS); one of PC2 / PC3 is the MN's pin 102 (the edge the MN waits for before each phase) and the other the "SCPU has a message" line that reaches the MN as port bit 3 of the `0x98e00000` window (hle-gaps 4.7.2). Which is which is ?: deciding it needs the order of the writes against the MN's states 3..10.
- **Reset.** The MN's pin 107 pulses the SCPU's reset (hle-gaps 4.7.1, I from the MN side). The SCPU side has no code for it (hardware NRST, I).

### 3.2 The command manager (`com_cmdm_task.c`, D unless tagged)

- Task ID_TSK_CMD_MANAGER with data queue ID_DTQ_COM_CMDM_RECEIVE. A table state machine of the same shape as the MN's (`{handler, next state}`, 254 = the handler sets it, 255 = invalid; invalid handler `0x80132f1`): table `0x8004ea8`, 36 entries (I: 6 states x 6 events, from the period of the repeated `{0x80131dd, 0}` entry). State byte at `0x2000xxxx + 21` of the context the code reaches through the pools at `0x801358c` / `0x80135c8`; 1000-tick and 5000-tick timeouts (MASTER_MON_TIMER: "[CMDM] MASTER_MON_TIMER_TIMEOUT state:%d, cmd:%02xh, ...").
- **Frame classes** (`0x8012fa0`): `0x8f` = 0 (the MN's poll), other bit-7-set commands = 2 (read: the SCPU sends a reply frame), `0x0f` = 3 (a chunk of a long transfer), others = 1 (write). Class 0 and 2 go to `0x8012e84` (build the reply), 1 to `0x8012f74`, 3 to `0x8012f1a`. Replies are framed `[length, command, data]` with length = data + 2 and padded to at least 4 bytes (`0x8018af8..0x8018b06`); a reply that would exceed 255 bytes goes out as a long transfer (`0x8012ed4`, 253-byte chunks). This matches the MN's framing and its 10 / 253-byte chunk limits (hle-gaps 4.7.1).
- **Power-on gate** (`0x8012d72`): until the first `0x85 {2}` arrives (flag byte at `0x80135c4`'s object +0), only `0x85` and `0x02` are accepted; any other command, a second `0x85 {2}`, or `0x85` with a mode other than 1 before power-on, prints "[CMDM] Not recieved [POWER ON] Command ..." or "Receive in double [POWER ON] Command" and takes the error path `0x8012e04`: it calls `0x8016fd4(5)` and spins on itself (I: a deliberate stop that a watchdog or the MN's reset ends; the MN side resets the SCPU after its own timeouts). The MN's PER_SCPU indeed sends `0x85 {2}` first and blocks everything else until it completes (hle-gaps 4.7.1).
- **Command dispatch** (`0x8018a18` / `0x8018a70`): a two-level table, `0x8004abc[cmd >> 4]` -> 16 handlers indexed by `cmd & 15`. A handler gets `{data pointer, length}`; a read handler fills a reply descriptor (`0x20007ef4`; the handler gets +4, the length is at +12 and the buffer pointer at +16). A command with no handler is logged ("DBG_PER_SCPU_RCV_UNDEFINED_CMD:0x%02x", "[CMDM] Undef cmd:"); an undefined read still answers a zero 4-byte frame (`0x8018a48..66`).
- **The SCPU's own messages** go out in the reply to the MN's poll `[2, 0x8f]` (`0x8012e84` with class 0, `0x8018be2`); posting one drives the message line (section 3.1). The message bytes per source (`0x08`, `0x11..0x13`, `0x40`, hle-gaps 4.7.1 inbound) are built by the power manager, port scan and USB PD tasks; their layouts are ?.

### 3.3 Handlers, mapped to the MN's table (hle-gaps 4.7.1)

| Command | SCPU handler (D) | What it does on the SCPU |
|---|---|---|
| `0x01` / `0x81` | `0x80116ab` / `0x8011709` | set / get the date; the RTC driver ("RTC WAIT SYNCHRO TIMEOUT!!", "RTC GET HAL ERROR!!") and the debug block `sctime` (settime, gettime, setalarm) sit beside them (D strings, I role) |
| `0x02` / `0x82` | `0x800cfe7` / `0x800cfef` | GIO write `{port, value}` -> `0x800cdea(port, value)`; GIO read `{port}` -> `0x800cdc4(port)`, 1 byte. Ports are the logical numbers of section 4.1 (0..51). This settles the MN table's "GPIO extension (I)": D |
| `0x04` / `0x84` | `0x8018b2f` / `0x8018b67` | memory write `{u32 address, n, n words}` (each word through `0x801c250`) / read `{u32 address, n}` -> 4n bytes (`0x801c27a`). The debug blocks `sysmem` / `mdump` print a range check ("Out of range address!!"; whether the link handler applies it is ?) |
| `0x06` / `0x86` | `0x8017b05` / `0x8017b27` | backup register write / read (debug block `bkup`: "bkup w [reg_num] [data] [num]"); I: the RTC backup registers |
| `0x07` / `0x87` | `0x80125a1` / `0x80125a7` | firmware update start / completion state (task ID_TSK_FIRMUP_COMP_EXEC); the image's path into flash is ? (section 2) |
| `0x80` | `0x8015ec3` | version: a u32 build time ("Build: %02d/%02d %02d:%02d" at `0x15f5c`) |
| `0x85` | `0x8016217` (read) and the pre-dispatch in `0x801305c` | system control. Mode = tx[0]; modes 1..5 post a message to the system-control task with id 6, 5, 5, 9, 7 (`0x80130c0..0x8013112`); mode 2 also sets the powered flag and calls `0x8016116(2, 0)`; modes 1, 4, 5 set a context byte (+22) to 1, modes 2, 3 clear it; mode 6 posts nothing. The system-control task's states are named "steady", "steady_wait", "bkground", "pwr_save", "hibernation", "standby" (`0x16d40..0x16db0`); which message leads to which state is ?. So the MN's modes: 2 = power on (D both ends), 1 / 3 = the power-off variants the MN picks by camera state, 4 / 5 = two more requests without an MN caller |
| `0x88` | `0x80126d7` | port scan (`per_port_scan.c`, task ID_TSK_PORT_SCAN_MAIN, flag ID_FLG_PORT_SCAN_TASK_MAIN); what the 2 bytes hold is ? |
| `0x11`, `0x12`, `0x13`, `0x14` | `0x80150a5`, `0x801570b`, `0x801535f`, `0x8015345` | power manager writes (`pwr_mng_func.c`); the MN sends `0x12..0x14`, `0x11` has no MN sender found. Formats ? |
| `0x40` | `0x8015b81` | USB PD (`usbpd_if.c`) |
| `0x90` | `0x8021aed` (read) | not in the MN's table; no MN sender known (?) |
| `0x03`, `0x05`, `0x08..0x0f`, `0x83`, `0x89..0x8e` | none | undefined; `0x0f` / `0x8f` are framing, not table entries |

The handler addresses are D (the tables of section 3.2). The roles of `0x02`, `0x82`, `0x04`, `0x84` and `0x85` are D from the handlers' code; the others are I: the MN side's meaning (hle-gaps 4.7.1) agrees with the source file or debug block whose code and strings sit beside each handler.

## 4. Everything else it talks to

### 4.1 GIO, the logical pin layer (D)

The table `0x8005f00` (pointer stored at `0x20009cf0` by the GIO init `0x800cd54`) has 52 entries `{u32 GPIO port, u16 pin mask, u16 EXTI line mask or 0xffff}`: ports 0..15 = PA0..PA15, 16..31 = PB0..PB15, 32..47 = PC0..PC15, 48 = PD2, 49 = PH0, 50 = PH1, 51 = PH3. EXTI-capable: 0 (PA0), 28 (PB12), 37 (PC5), 39 (PC7), 40 (PC8), 41 (PC9), 45 (PC13); a 16-entry line table at `0x80060a0` names their NVIC IRQs (6..10 for lines 0..4, 23 for 5..9, 40 for 10..15). API: read `0x800cdc4`, write `0x800cdea`, register an edge callback `0x800ce12(port, {mode 1/2/3, callback, arg})`, enable `0x800ceae`, disable `0x800cf04`. On hardware phase < 4 (`0x800e79e`; "[SC_INFO] HW PHASE ERROR", "develop pahase") ports 37 and 39 swap (`0x800cfc8`). The debug block `gio` reads and writes ports by number ("gio w 35 1", "gio r 18"). Ports used with constants elsewhere: reads of 0, 18, 24, 28, 36, 37, 41, 45; writes of 18, 24, 34, 35, 36, 44; edge callbacks on 0, 28, 37, 41, 45 (call sites in the comm, power manager, charge and USB PD code). Their signals beyond the comm lines are ? ("PER_GIO_SCUSBMUXSEL" names one, I: a USB mux select).

### 4.2 Peripherals and what an emulator would model

| Function | Peripheral (D) | Evidence and the model it would need |
|---|---|---|
| MN link | SPI2 slave + DMA1 ch 4 / 5, PB12 EXTI, PC2 / PC3 | section 3; model: SPI slave shift with DMA, EXTI edge, GPIO out to the MN's pins |
| Debug console | LPUART1, 115200 8N1, PC0 / PC1 AF8, IRQ 70 at priority 10 (`0x800ae1c`, MSP `0x800aea4`) | the console oracle (section 5.3); model: a UART with RX / TX interrupts |
| Battery packs | USART1 and USART2, 9600 baud, 9-bit word with even parity (8E1), both with DMA (USART1 on DMA2 ch 6 / 7, USART2 on DMA1 ch 6 / 7, request 2) (`0x800ae4a`, `0x800ae66`, MSP `0x800aea4..0x800b028`) | I: one port per pack, Body and PBH ("binfo ... [0:Body/1:PBH]", "Body T:%04X V:%04X C:%04X %:%d", "BLX-1" at `0x14500`); `binfo_drv.c` sends command bytes ("Error send data command. <cmd>:0x%02X"). The pack protocol is ? |
| Chargers, PBH IO expander, USB PD controller | I2C1 / I2C2 (`0x40005400` / `0x40005800`, IRQs 31..34) | "[PWRCHG] IIC Open ERROR", "chg read [REG(hex)] [IC No.(0/1)]" (two charger ICs, 16-bit registers: "chg write 3F 014C 0"), "[PBH IOEDRV] ... per_iic_mem_read", "pd_i2c_write", "USB_PD_STATE_VBUS_NO_DETECT"; the bus and address of each device is ?; part numbers are not in the strings |
| Battery temperature, other analog | ADC1 (`0x50040000`), IRQ 18 | "[BATTERY] AD convert error [CH]:", "AD average : %x", debug block `adconv r [ch num]`; channels ? |
| Date, backup words, alarm | RTC (`0x40002800`), BDCR / CSR | section 3.3; model: an RTC with calendar, backup registers and wake-up |
| USB | USB FS device (`0x40006800`, IRQ 67), init `0x800a9f2` (8 endpoints, full speed, embedded PHY) | no USB device stack strings; its use (I: VBUS or charger detection) is ? |
| Timers | TIM2, TIM1, TIM15, TIM16 (IRQ 24 = TIM1 break / TIM15) | uses ? (I: PWM or capture for the charge or LED control) |
| Low power | PWR CR1..CR3, SR, SCR | sys_ctrl's "pwr_save", "hibernation", "standby" states (I: stop / standby modes) |
| System | NVIC, SCB, SysTick (kernel tick, `0xe000e010`), DWT cycle counter (`0xe0001000`, `0xe000edfc`), FLASH ACR, RCC clocks | model as a Cortex-M system block; RCC needs ready flags that come true |

### 4.3 Not on this SCPU

- **The accelerometer:** no string, task or I2C client for it in this image; the MN reads it itself (hle-gaps 4.7: ACC_MAIN on the MN's PER_SIO) (D for the absence of strings, I for the conclusion).
- **The eye sensor:** no trace either (?, not on this MCU as far as the image shows).
- **Keys, levers, dials:** no key module (compare E139's key.c, jogdial.c); the only input module is the port scan. Whether the MN window's port bits 0..2 (power lever, Fn lever, S1; hle-gaps 4.7.2) come from this MCU at all is ?: the window is an MN-side block and nothing in this image names those inputs.

## 5. RTOS, interrupts, console

### 5.1 Objects (D, the name table `0x5168..0x55d4`)

- Tasks (13): CMD_MANAGER, SYSTEM_CTRL, FIRMUP_COMP_EXEC, PORT_SCAN_MAIN, PWR_MNG, MAIN, USB_PD_MAIN, USB_PD_INTR, CHARGE, BAT_INFO, POWER_SUPPLY, USB_PD_EXEC, DBG_MAIN.
- Semaphores: PD_CMD_SYNC, PD_GET_CMDBUF_SYNC. Event flags (20): USB_PD_I2C, USB_PD_INTR, BAT_TEMP_AD_EVENT, BAT_INFO_DATA_DONE, USB_PD_SEND, USB_PD_CMD_WAIT, USB_PD_DEVCMD_WAIT, CHARGE_DBG_I2C_ACCESS_DONE, CHARGE_USB_PD_PWR_INFO, the four *_SYSTEM_STOP_REQ_DONE, CHARGE_VSYS_CONTROL_DONE, PORT_SCAN_TASK_MAIN, PWRMNG_BINFO_GET_DONE, PWRMNG_USB_PD_PWR_INFO, BAT_INFO_DBG_DATA_DONE, PER_IOEXP_PBH_REG_SET_DONE, PWRMNG_REQ_BINFO_EXEC_DONE. Data queues (8): COM_CMDM_RECEIVE, USB_PD_MAIN, CHARGE_RECEIVE, SYSTEM_RECEIVE, BAT_INFO_RECEIVE, POWER_SUPPLY_RECEIVE, USB_PD_EXEC, PWR_MNG_RECEIVE. Cyclic handlers: CYC_SYS, CYC_SYSTIMER, CYC_PWR_MNG_EXEC.
- Wrappers with the MN's names: OlyTaSt / OlyTaSp / OlyTaSS / OlyTaSL ("[OlTa]Err..."), OlyQueueRead / OlyQueueWrite / i_OlyQueueWrite, OlyEventSet / Wait ("[OlEv]"), semaphores ("[OlSm]"), a two-pool heap (SCHEAP small / middle, debug block `heap`).

### 5.2 Interrupts (D, the vector table)

Distinct handlers: NMI, HardFault (a fault dump: "In Hard Fault Handler", "SCB->HFSR", "SCB->CFSR", stack dumps), MemManage, BusFault, UsageFault, SVCall `0x8021543`, DebugMon, PendSV `0x8024e37`, SysTick `0x8024e39`; IRQs 6 (EXTI0), 14..17 (DMA1 ch 4..7), 18 (ADC1), 23 (EXTI9_5), 24 (TIM1 break / TIM15), 31..34 (I2C1 / I2C2 event and error), 40 (EXTI15_10), 67 (USB FS), 68 / 69 (DMA2 ch 6 / 7), 70 (LPUART1). The IRQ entries are 28-byte stubs (`0x8024e71 + 0x1c k`; I: each passes its IRQ to a common dispatcher); every other vector is the default `0x8027e61` ("[DBG] Int Abort occurred! <irqn> :"). DMA channels at NVIC priority 10 (`0x800a960`).

### 5.3 The debug console (D)

LPUART1 at 115200 (section 4.2), prompt "SUB> ", a line editor ("rx_buffer FULL!!", ANSI clear), "Usage: SUB> {blockname} {command} ...". The block table `0x5098` (`{handler, name}` pairs): mem_put, mdump, mdump2, mdump4, phase, olyq, sctime, heap, sysctrl, sysmem, comm, psupp, bkup, adconv, pbhioe, pbhioedrv, binfo, help, plus one more whose name is a short string at `0x5020` (?); `gio`, `chg` and the USB PD commands (send, check, dump, write, read, notify) have their own usage texts. Useful as an oracle: `comm trace on` logs every link frame ("[CMDM] TX <<<:", "RX >>>:"), `comm gettx` / `getst` dump the request and state histories, `sysctrl get` the system state, `binfo r all 0` a pack's readings. An emulator that models LPUART1 gets these for free; on a camera the port is test pads at best (?).

## 6. What an LLE would retire

| Today | With the SCPU running natively | Why |
|---|---|---|
| S-SCPU (the request API hook) | retired: the MN's PER_SCPU runs natively against a device at PER_SIO channel 2 and pins 102 / 103 / 107 | the frames, gate and dispatch are D on both ends |
| PER_SCPU's start (`0x85 {2}`, reset pulse, watchdog), the inbound poll path (`0x08`, `0x11..0x13`, `0x40`), `0x88` | native | today's "not covered" list of 4.7.1 |
| H-POWER's immediate close | partly: the SCPU answers PWR_MAIN's `0x12..0x14` and `0x85 {1 / 3}` | the power manager still needs its own MN-side bring-up (hle-gaps 4.7 step 5) |
| S-NVRAM's date and backup word | the SCPU's RTC and backup registers | kept across lab sessions only if the RTC model persists them |
| H-SCPUPORT, H-SCPUIRQ, H-UIINPORT | not retired | the window's port and event words are an MN-side block; no evidence that this MCU drives the key bits (section 4.3) |
| S-ACCINIT, S-ACCREG, S-ACCSAMPLE | not retired | the accelerometer is the MN's (section 4.3) |

## 7. Labels

| Label | Statement | Evidence |
|---|---|---|
| A-SCPU-MCU | an STM32L43x / L44x class part, Cortex-M4F, 256 KiB flash, 64 KiB SRAM | section 1 (map D, part I) |
| A-SCPU-PINS | PB12 = MN pin 103 (request); PC2 / PC3 = MN pin 102 and the message line, order ? | section 3.1 (I) |
| A-SCPU-BAT | USART1 / USART2 talk to the two battery packs | section 4.2 (I) |

## 8. Feasibility and plan

**Cost of an LLE (I, sizes from the emulator's existing MN core and devices).**

- A pure-JS ARMv7E-M core: the Thumb / Thumb-2 integer set (data processing, loads and stores with all addressing forms, LDM / STM, IT blocks, TBB / TBH, CBZ, multiply and divide, the DSP multiplies the image uses, LDREX / STREX, MRS / MSR / CPS, SVC, BKPT), exceptions with the 8-word frame, tail-chaining not needed for correctness, two stacks, PRIMASK / BASEPRI, and the three VFP instructions the image has (no FP arithmetic). About 2,500-3,500 lines with a decoder table; the image's instruction mix is checkable statically before writing it (a host-side census in `tools/`).
- System block: NVIC (enable, pending, priority, the 83 IRQs), SCB (VTOR, AIRCR, SHPR, CFSR read as 0), SysTick, DWT CYCCNT. About 400 lines.
- STM32L4 peripherals that must behave: RCC (ready flags, clock tree only as needed for HAL's timeouts), FLASH ACR, PWR, GPIO A/B/C/D/H, EXTI + SYSCFG, SPI2 slave + DMA1 channels 4 / 5, LPUART1, RTC, the DMA request mux. About 1,500 lines. Peripherals that can start as stubs that never complete (and are then made to answer by evidence): USART1 / USART2 + DMA (packs), I2C1 / I2C2 (chargers, IO expander, PD controller), ADC, TIM1 / 2 / 15 / 16, USB. The I2C devices are the risk: tasks that poll a charger that never answers may log errors and retry, or may hold the power manager in an error state that changes what it reports to the MN (?).
- The seam: a device on the MN side at PER_SIO channel 2 (the MN's SIO transfer descriptor `0xa32c6f0c`, hle-gaps 4.7.1) and the three MN pins, moving bytes between the MN's SIO model and the SCPU's SPI2 shift register, PB12 driven from MN pin 103, MN pin 102 and port bit 3 from PC2 / PC3, MN pin 107 to the SCPU's reset. Both CPUs step on the lab clock; the SCPU needs no instruction-accurate timing, only that its DMA is armed before the MN clocks a frame (the pin handshake guarantees it, D on both ends).

**Recommendation.** Not next. An LLE would replace S-SCPU and make PER_SCPU's start, the inbound path and the power manager's link native, but it retires none of the input or accelerometer stand-ins, and it brings unknown I2C and battery devices whose silence may change the answers the MN sees. The same coverage of the MN side comes cheaper from a transport-level HLE first: an SCPU device at PER_SIO channel 2 and pins 102 / 103 / 107 that speaks the frame protocol of section 3 with handlers written from the D table in 3.3. It runs PER_SCPU natively (its start, gate, watchdog and poll path), is the seam the LLE later plugs into unchanged, and its frame log is the oracle the LLE is checked against. The LLE then becomes a contained track whose first milestone is "the image boots to its console prompt and answers `0x85 {2}`".

**Steps (sizes I):**

1. Settle the open items of section 3 statically: which of PC2 / PC3 is pin 102, the inbound message layouts, the `0x85` message-to-state map, the `0x88` reply. 2-3 days.
2. Transport HLE (S-SCPUDEV): MN-side SIO channel 2 model as far as PER_SCPU uses it, the pin handshake, `0x85` gate, the four commands S-SCPU serves today, polls answered with "no message"; retire S-SCPU behind a flag and compare the store-init session against today's (same three requests, same results). 1-1.5 weeks.
3. A Thumb-2 census tool (`tools/`): every instruction form the image uses, from a recursive-descent walk of the code from the vectors and the pointer tables (the tables of section 3.2 and 5.3). 1-2 days.
4. The Cortex-M4 core in `emu/src/core/` with its own test vectors (QEMU's `-M netduinoplus2` or a similar M4 board as the oracle inside the VM, per the repo's rule that QEMU is only an oracle). 2-3 weeks.
5. The STM32L4 system and the must-behave peripherals, then boot the image to the console prompt (X target: "SUB> " on LPUART1, the 13 tasks created). 1-2 weeks.
6. Plug the SCPU into the step 2 seam: `0x85 {2}` answered by the real firmware, `comm trace on` frames equal to the HLE's for the store-init session. 1 week.
7. Device models only as the firmware's own errors demand (packs, chargers, PD controller), each from code evidence. Open-ended.

Total to step 6: about 6-8 weeks, of which steps 1-2 (1.5-2 weeks) deliver most of the MN-side value on their own.
