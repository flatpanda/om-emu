# Shutter, movie key and image sensor: findings and plan

What happens when S1 (half press), S2 (full press) and the movie key REC are pressed on the OM-1 (E143 v1.9), what the
firmware waits for behind them, where live-view pixels enter, and a plan for making emu respond with a stand-in for
the image sensor. Sections 1-5 were researched on emu as of 2026-10-14, before the camera application ran natively;
sections 6 and 7 record the work since. Code addresses are disassembly notation (body + 0x50000000), data
addresses run-time (body + 0x60021020). Tags: **D** read from code or data, **X** executed in emu, **I** inference,
**?** unknown.

Summary: the three keys already reach the firmware's UI_IN task and the GUI, which ignores them on the shooting
screen. Everything a camera does on them lives in the camera application (CA_MAIN, task 58) and the capture, AF, lens
and record modules below it, none of which runs in the lab; the forward from UI_IN to the application is switched on
by the same boot chain that starts them. A picture in the live view does not need any of that: the firmware's own
through-image API already attaches a live-view bank to the VSC's IMG1 plane in check_liveview, so a sensor stand-in
can write frames there. Section 6 describes the stand-in emu now has (S-SCENE).

## 1. Key input today

### 1.1 The chain (docs/om1-input-spec.md §1-§4, confirmed in emu)

```
page key (F / Space / R)
  -> player.mjs input {type:'key', id:'s1'|'s2'|'rec', action}
  -> PlaySession (play.mjs:812-813, shutter_seq play.mjs:1039-1043 orders S1/S2 bits)
  -> S-KEYBITS: whole group image pushed into UI_IN's ring (0x5014cb74) + set_flg
  -> UI_IN task 84 (0x5014b736) decodes natively: 0x5014c919 -> 0x5014c956 (shutter sequencing
     with bytes 0xa32dada0/1) -> 0x5014c3eb forward
  -> 0x5014c3eb: if (0xa32daba4) != 0 -> publish 0x50025095(code) -> event broker (0x503eb25c,
     0x503eb0c5, 0x503eaf75, 0x503eb190, post 0x503eaf3b) -> camera application
     In the lab (0xa32daba4) = 0: goes nowhere.
  -> S-KEYMAP (lab stand-in) observes the forward and calls GuiCallerImp::sendEvent with the
     paired GUI index.
```

Codes (UI_IN group tables at 0x60224774, D; playui.mjs:12-14, play.mjs:114-116):

| Control | UI_IN group.byte.bit | code | EV (table 0x60e48e60) | GUI sendEvent on/long/off |
|---|---|---|---|---|
| S1 (half) | 0.0.2 | 0x0100 | 0x2c EV_PRESS_1ST_RELEASE / 0x2d release | 4 (0x9000) / - / 5 (0x9001) |
| S2 (full) | 1.0.1 | 0x0101 | 0x30 EV_PRESS_2ND_RELEASE / 0x31 | 6 (0x9002) / - / 7 (0x9003) |
| REC | 3.0.0 | 0x120a | 0x50 EV_PRESS_MOVIE_KEY / 0x51 | 28 (0x9012) / 29 (0x9041) / 30 (0x9013) |

EV ids from the name table at body 0xdb2130 (D; also EV_LONG_PRESS_1ST_RELEASE 0x2e,
EV_REPEAT_* 0x2f/0x33, EV_PRESS_WIFI_1ST/2ND_RELEASE 0xee/0xf0).

### 1.2 Who would enable the forward (new, D)

- `0x5014c3c8(d0)` is the only writer of `(0xa32daba4)` (refs 0x5014bf9a init-clear, 0x5014c3ca,
  0x5014c404). Its only caller is `0x502a49a9` (a 2-instruction wrapper).
- `0x502a49a9` is called from `0x502a48bd`, inside `0x502a48b6`, which also stores 119 into
  `(0xa31f1d26)` at `0x502a4945` (the publish gate checked at `0x5002509e`; the input spec calls
  it "application init") and reads S2's switch state `0x5014c015(0x101)` at `0x502a495b`.
- `0x502a48b6` <- `0x502a48a0` <- `0x501e9059`, inside the USTART boot chain
  (USTART2..5 tasks 0x28/0x2a/0x29/0x27, sites `0x501e8f09..0x501ea7a9`, cores spec §3.7).
  H-AEINIT's `0x50560b29` is reached from the same chain (`0x501e90c4`).
  => The key forward and the event publish are switched on by the same boot chain that starts
  ~136 camera tasks; neither runs in the lab.

### 1.3 What happens today when they are sent (X, `--idle off`)

A bin/play.mjs session over HTTP (`--idle off`), keys pressed on the shooting screen and in the menu:

```
start gui 0x0108 (SS_COMMON/ID_ST_CA_REQ_DISP), tft
s1 down  uiin 0x02000100 EV_PRESS_1ST_RELEASE  -> GUI msg 0x9000 (index 4)  eng 0 panels [] writes 0  frame unchanged
s2 down  0x02000101 EV_PRESS_2ND_RELEASE       -> 0x9002 (6)                 eng 0 ...  frame unchanged
s2 up    0x02010101                             -> 0x9003 (7)
s1 up    0x02010100                             -> 0x9001 (5)
rec down 0x0200120a EV_PRESS_MOVIE_KEY          -> 0x9012 (28)               eng 0 ...  frame unchanged
rec up   0x0201120a                             -> 0x9013 (30)
menu down -> 23, GUI 0x0b02 (menu), frame changes
s1 down  -> 4, GUI back to 0x0108 (S1 closes the menu natively), frame changes
```

The WINDOWS token on
the shooting screen draws OSD1..OSD3 only; IMG1 (live view) is not drawn (X). So: S1/S2/REC
reach the GUI, which ignores them on the shooting screen (no engine command, no state change);
everything a camera does on them is in the camera application, which does not run.

---------------------------------------------------------------------------------------------------

## 2. Firmware side: who reacts, what they wait on

### 2.1 Tasks (static task tables, D; cores spec §4)

CPU 0 (all application tasks, the lab's only core):

| Role | Tasks (id, entry) |
|---|---|
| Camera application | CA_MAIN 0x3a=58 `0x51049ebb` (reader of queue 6 API_EVENT; "static task 58" of the input spec), HIGHLEVEL_MAIN 0x39 `0x50ab2293`; CAM_MAIN 0x0b is a `retf` stub |
| Still capture | TAKE_MAIN 0x6b `0x503996c3`, TAKE_MAIN_CP 0x72, TAKE_FUNC 0x69 `0x502cd1ca`, TAKE_FUNC_CP 0x6a, TAKE_EXPOSE 0x67 `0x5059145d`, TAKE_FOCUS 0x68 `0x509a0ebe`, TAKE_MOV 0x70, TAKE_PROXY 0x78, TAKE_POWER_MANAGER 0x83 |
| Image pipeline | ISEQ_MAIN 0x44 `0x5086516f`, ISEQ_ASIC 0x81, ISEQ_IMG_PROC/COMP/COMP2, IMG_PRECON 0x11 |
| Record/card | REC_MAIN 0x1d `0x505396d1`, REC_IMAGE 0x1c, REC_FILE 0x1b, REC_PREPRO 0x1e, REC_VIEW 0x64, REC_EXT 0x6d, REC_PROGRESS 0x7b, REC_SOUND 0x1f |
| AF | FCS_IP 0x6f `0x5090c644`, FCS_IP_SUB 0x56, FCS_IP_NOTIFICATION 0x92, FCS_MOVIE 0x59 |
| Lens | LENS_MAIN 0x5c `0x502a5e37`, LENS_COMMAND 0x5b `0x50115a08`, LENS_ASKDATA 0x5a, LENS_FLASH/FIRM_UP |
| Movie | EXP_MOVIE 0x58 (CPU 0); MVR_* and EXP_MOVIE2/3 on CPU 2 |
| Peripherals | PER_SCPU 0x7a, PER_IN, PER_EYE_SENSOR, PER_CCD_TEMP, STB_* (strobe) |

Other cores (not modelled, cores spec §7): CPU 1 FCS_IP_2 / FCS_IMG_2NDCPU_MAIN / FCS_IP_RANGING
(AF second stage), IMGPRO_MDL_WORK; CPU 2 REC_MAIN_CPU2, REC_VIEW_CPU2, REC_PREPRO/IMAGE_STLNML,
MVR_* (movie record), EXP_MOVIE2/3; CPU 3 subject detection (MDET_*, FACE_*, FCS_IMG_4THCPU).

### 2.2 Module request queues (D, new)

The application talks to the modules through an API sender: `0x503eb960` (async) /
`0x503eb86c` (sync) take a target id and look up its queue in the table at run-time
`0x606214a0` (input spec §7 used target 35 = DISPLAY). Decoded with the firmware's object-name table
(type 5 = queues):

| target | queue | name | | target | queue | name |
|---|---|---|---|---|---|---|
| 0 | 0x76 | XTC_APP_EXEC | | 18 | 0x2e | LENS_EXEC |
| 3, 21, 31 | 0x3f | PLAY_EXEC | | 24 | 0x01 | ADJ_EXEC |
| 4 | 0x64 | TFT_EXEC | | 25 | 0x5e | TAKE_FUNC |
| 6, 11 | 0x5a | TAKE_EXEC | | 26 | 0x7d | ZOOM_EXEC |
| 12, 13, 30 | 0x47 | REC_EXEC_MAIN | | 27 | 0x1b | FCS_EXEC |
| 14, 15, 17, 23 | 0x1f | FILECLBK_UEXEC | | 28 | 0x7c | PWR_EXEC |
| 33 | 0x03 | ADJ_SLF_EXEC | | 35 | 0x88 | DISPLAY |
| 34 | 0x09 | BC_EXEC | | 37 | 0x08 | AUD_EXEC |
| 39 | 0x71 | UI_OUT_EXEC | | 40 | 0x31 | LENS_COMMAND |
| 41 | 0xae | MOVE_MAIN | | 42 | 0x98 | C3D |

Queue 6 = API_EVENT (replies/events to the application; S-DISPQ already sees DISPLAY replies
going to queue 6). Queue 207 = 0xcf PC_PD_CMD_EXEC: the input spec's "task 58 stops at its
queue-207 send from 0x5102b58c" is a send to the USB-PC command queue (send `0x5002e39d` at
`0x5102b585`, D). OlyQeRd = `0x5002c067` (timeout -1 at the DISPLAY loop `0x501c308b`, D);
TAKE_EXPOSE reads its queue at `0x505914eb`, LENS_MAIN at `0x502a5e5f`, LENS_COMMAND at
`0x50115a34` (D); TAKE_MAIN waits on an event flag first (`0x5002bdd8` at `0x503996f7`).

### 2.3 The application's release state machine (strings D, structure I)

IBM Rhapsody OXF-generated classes (`./../../../../base_framework/include/rhapsody/oxf/...`):

- `CmpShc_ShootingSequenceBase` and `CmpSqp_SequenceParts*` (ZeroLag, MultiExposure,
  AfFineTune, ...): states STANDBY, READY, READY_TRIG2, PRECEDENCE_END_WAIT, SECOND_WAIT,
  END_WAIT, TAKE_PICTURE, TAKE_PICTURE_CONT, TAKE_PICTURE_AUTO, TAKE_PICTURE_END_WAIT,
  SELFTIMER_WAIT, CUSTOMSELFAF_WAIT, MOV_READY, MOV_RECORDING, MOV_READY_FINISH.
  Guards/transitions: `(CMP)guardTrig1KeyIn_STANDBY(%d)` (0x60eac7b4, refs 0x50c8d474/8d),
  `[ASSERT]guardTrig1KeyIn_STANDBY_To_READY false`, `entryREADY_TRIG2`, `execReadyTrig2after`,
  `guardTrig2KeyIn_SECOND_WAIT_To_READY_TRIG2`, `(CMP)rcvMovieKeyOnIn_STANDBY(%d)`,
  `(CMP)checkMovieKeyOnExec Fn1:%d ... Mov:%d ...`.
- Completion notifications the state machine waits for (observer classes):
  `CmpSts_ObserverNotifyTakeReadyFinish`, `...TakePictureDone`, `...TakePictureNr`,
  `...TakePictureComplete`, `...TakePictureFail`, `CmpShc_ObserverNotifyAELockDone(Sync)`,
  `CmpShc_ObserverNotifyAFL`, `CapTak_NotifyStopTakeReadyDoneObserver`,
  `CapTak_NotifyTakeReadyEndDoneObserver`, `RecordController::recordReady`,
  `rcvRecordReadyIn_MOV_RECORDING`, `rcvRecordingDoneIn_active`, `[RecView]Create_Done STANDBY`,
  `rcvTakePictureDoneIn_TAKE_PICTURE`, `TakeReadyFinishIn_READY`, AF result
  `CapTre_TakeReady::notifyAFOK()` / `CapTak_Take::notifyAFNG()`.
- S1 -> TakeReady: `CapTre_TakeReady` logs `[TakeReady](L %d) Take_Start_Shoot_Ready
  control[%d], button[%d]` (0x60e667ec, refs `0x50bc7a0c..0x50bc7d8a`) and calls the API
  `0x50417cd9` (8 callers, all in `0x50bc7a2a..0x50bf176c`), which builds requests with
  `0x503e22aa/0x503e26c1` and sends them through `0x503eb86c` / `0x503eb960` / `0x503ec094`
  (queue var `0x60043278`) (D). Which target each request goes to, and the message layout: ?.
- SDK path (D): `OlyHfwOpeShoot::ctrlRelease` `0x50ad71cb` (log `releaseGo takePicture
  takeMovie key_1st key_2nd key_movie`, callers `0x50b51b43`, `0x50ad7fd1`) polls a status
  `0x50ab5716(3)` with a 100-tick sleep `0x50420173` until bits 0x30000020 clear (a busy wait,
  `0x50ad71fd..0x50ad7217`); there is a shell command `sdk api ... releaseGo takePicture
  takeMovie key_1st key_2nd key_movie` (0x60e17a20, ref 0x50b0fa2a). Wi-Fi remote release enters
  the same state machine (`EV_PRESS_WIFI_1ST_RELEASE`, `rcvWifiReq*`, I).
- GUI-side messages the application sends while shooting (sendEvent index table 0x614b5a14,
  names 0x6159a3a4, D): 171 EVT_ST_CHANGE_FOCUS_ICON (0x971e), 153 EVT_REQ_DISP_BLACK_SCREEN
  (0x9626), 154/158 EVT_REC_DISP_2ND_RELEASE (0xf00e), 157 EVT_REC_DISP_RECVIEW (0xf005), 191
  ..._ASYNC, 129 EVT_ST_CHANGE_CARD_ACCESS, 327 EVT_REQ_TAKE_BUFFER_UPDATE (0xf011), 333
  EVT_END_RECORD, 182 EVT_START_SHOOTING, 125/169/172/176 EVT_REQ_REC_DISP_INFO. Which ones are
  sent on which transition, and with what data: ? (would come from running/reading CA).
  Focus rectangles/blink (EVT_ST_CHANGE_FOCUS_RECT, EVT_ST_CHG_FOCUS_BLINK) have names but no
  sendEvent index in the table (?); the AF frame may be the DISPLAY face/AF IMG3 path
  (`0x501dcb1a`, registers +0xD00.. stored but not modelled, vsc spec line 164).

### 2.4 Lower layers and what each needs from hardware

| Layer | Hardware / other core | Evidence | emu today |
|---|---|---|---|
| Sensor readout timing | SSG1/SSG2 sync generators (VD/HD, VLATCH, counter IRQs, INTEN), SLVS/LVDS/MIPI receivers, sensor serial SIO (`cam_sio.c`, flag 0xe0 SENSOR_COMM_RESP) | `CAM_KEEP_FLAG_SSG1_*`, `_SLVS_*`, `_SIO_SETTING` (0x6023d9c8..0x6024016a, 312 names: VDC 90, SSG1 62, RAP 53, SSG2 40, BN 28, ...), debug `cam rapinput`, `cam clkon [pfp ssg1 pro af ae rap vdc cwd crd]` (0x602c6b3d) | unmapped: lab stub DENIES -> bus error |
| ISP front end | PFP (LV, AF1-3), BN (binning/OBC/DMA), PRO1/PRO2 (`cam_prepro.c`, MMIO 0x9b300000..0x9b304fff), RAP, VDC, CWD/CRD (compressed write/read DMA?), EMS1/2 | clock gates 0x9b500800/0x850/0x870 (`0x5015fd21`, `0x50160d7b`, `0x501609a0`, D); region map in 2.5 | unmapped |
| AE statistics | AE1/AE2, AWB1-4 blocks; `cam_bright.c` code `0x50158000..0x5015a800` writes 186 registers in 0x9b380000..0x9b384fff and reads 10 (0x9b3803d0, 0x9b382040, ...) | D for the accesses; that results come by DMA into DRAM is I (few reads) | unmapped |
| AF contrast | `cam_contrast.c` `0x50161000..0x50163000`: 0x9b400000..0x9b401fff (122 refs) + 0x9b5008xx | D accesses, role I | unmapped |
| AF phase / ranging | PFP_AF1..3 subblocks, PDMIX (`CAM_KEEP_FLAG_SSG1_PDMIX_SETTING`), FCS_IP on CPU 0 posts jobs to CPU 1 (`0x5090fc6d..`, `0x50932401..`) and waits on CPU 0 flag 0x92 FCS_IP; FCS code uses MMIO 0x9bf00000 (24 operands at `0x50957687..0x5095799e`, plus `0x5002563b` and `0x502c0e99/9f`), a unit with its own IRQ 281 | cores spec §5.2 (D/I), MMIO D | CPU 1 not modelled: any AF request that needs CPU 1 waits forever |
| Exposure calc | EXP / TAKE_EXPOSE (software; TAKE_EXPOSE region 0x50570000..0x505a0000 has ~no MMIO), cam_expcal/cam_ev; flags EXP_APERT, EXP_EXPOSE, EXP_START, EXP_UPDATE, TAKE_EXPOSE_SYNC | D names | not run (H-AEINIT runs only the interpolation table init) |
| Lens | LENS_MAIN/COMMAND/ASKDATA on CPU 0; lens record (L_ID, L_FT_VERSION, FuncFlag[], L_VERSION +0x488, MAG_CNG, L_PRIVATE_ID_DATA; cmd 0x50 page/item requests, analysis/lens-gates); the lens serial device 0x9b980000 (IRQ 14) and the IRQ-60 edge unit 0x9b883e40..0x9b883e6c in the pin block, both driven by the lens serial and sync layers, not LENS_COMMAND (2.5); flags LENS, LENS_APERTURE, LENS_FOCUS, FCS_IP_LENS, EXP_LENS sem | D | not run; no lens attached (lens record empty, ?) |
| Mechanical shutter | `SHUTTER_MOTOR_ON/OFF/CLOSE_CHARGE_CONDITION_A`, `SHUTTER_MAGNET_*`, `INITIAL_SHUTTER_READY` (0x6020ddfd..0x6020e21a), debug tags `mec`, `sht`, `mot`; driver block 0x9b900000 (271 registers), IRQs 11-13 | D; the block, its driver and the `mec` shell in `docs/hle-gaps.md` section 7 | not modelled |
| Capture sequence | ISEQ_* (`iseq_*.c`), ISEQ_ASIC (flags ISEQ_ASIC_WAIT_PIXSHIFT, ISEQ_MAIN_WAIT), `cam_still_seq.c` (`0x5085fb13..`) | D | not run |
| Record | REC_* CPU 0 + REC_*_CPU2 / STLNML on CPU 2; DCF/file (`dcffnode.c`), card (UHS-II strings, `SD Card Media 1st SLOT`), EV_MEDIA_MOUNT_REC | D | no card, no CPU 2 (S-CPU2 serves one GUI post only) |
| Movie | TAKE_MOV, EXP_MOVIE (CPU 0); MVR_* on CPU 2; AV encode on CPU 1 (AVPI VEN BACD) | cores spec §4 | not modelled |
| Display of the result | DISPLAY TH API for live view and rec view (rec_misc `0x5054c1ad` builds the 1:1 rec-view request) | vsc spec §10 | TH API runs natively in check_liveview, not in play |

### 2.5 MMIO regions referenced by camera-side code (D refs, owner I from the nearest source-file string)

| region | refs | first code site | nearest string / owner |
|---|---|---|---|
| 0x9b000000 | 166 | 0x5019d881 | cam_seq_movie.c, `[SLVS ERR COUNT]` |
| 0x9b080000 | 25 | 0x501a2db4 | (cam driver) |
| 0x9b300000..0x9b304fff | ~620 | 0x5019173b | cam_prepro.c |
| 0x9b380000..0x9b384fff | ~800 | 0x501578a3 | cam_bright.c |
| 0x9b400000..0x9b401fff | 150 | 0x501616fc | cam_contrast.c |
| 0x9b480000 | 40 | 0x5018d3f6 | cam_param.c |
| 0x9b500000 | 563 | 0x50033865 | camera clocks (0x9b5008xx, D) |
| 0x9b580000, 0x9b600000 | 23, 28 | 0x50166fdc, 0x5016629b | (cam driver) |
| 0x9b883e40..0x9b883e6c | 12 | 0x50122331 | IRQ-60 edge-interrupt unit in the pin block (same block as the touch pins 0x9b880e00, input spec §5), configured by the lens sync layer (`0x502c47fd`, `0x502c4820`, `0x502c4e5f`); not LENS_COMMAND |
| 0x9b980000 | 121 | 0x502c0ea5 | lens serial controller (LENS_SSC strings), IRQ 14, handler `0x502c12c0` |
| 0x9bf00000 | 24 + 3 | 0x50957687 (FCS) | AF: a DMA-driven unit, IRQ 281 |

Corrected 2026-10-22 (D; `docs/hle-gaps.md` section 9): `0x99990000`, listed here before as "215 refs, lens OIS / IS
info", is not a device. 214 of its 215 operands are `0x9999999a` loaded by `mov imm32`, the low word of a double (at
`0x50128f0f`: d0:d1 = 0.2 passed to a soft-float routine), and the remaining hit at `0x5188337a` is not a load or
store. The lens serial device `0x9b980000` was missing from this table; the 12 operands first filed under
LENS_COMMAND sit at `0x50122331..0x501225b7` and address the IRQ-60 edge unit.

In emu every one of these is lab-stub space: `src/dev/stub.mjs:1-8` -- with empty allow/preset
tables every access is DENIED and raises a bus error (fault 2). That is the project's ground rule
(ROADMAP: behaviour without firmware evidence is an error, never guessed).

### 2.6 Blocking points without device models (D where cited, rest I)

1. CA_MAIN itself: blocks on its queue-207 send at `0x5102b58c` (input spec §1, X).
2. Any sync API request to a module queue whose task does not run (TAKE_EXEC, REC_EXEC_MAIN,
   LENS_EXEC, FCS_EXEC, TAKE_FUNC): tsnd/trcv with timeout -1 -> the guard the player already has
   for tsnd_dtq (input spec §7, "tsnd_dtq with timeout -1 waits on a full queue") would report
   it, or the application waits for a reply on queue 6 that never comes.
3. The release state machine waits for TakeReadyFinish / TakePictureDone / RecordReady
   notifications (2.3); without them it stays in READY / TAKE_PICTURE.
4. If the TAKE tasks run natively: first MMIO access to 0x9b3x/0x9b4x/0x9b5x -> bus error; any
   AF via CPU 1 -> wait on flag 0x92 forever; lens commands -> LENS_COMMAND waits on SIO/GPIO
   (flags LENS_*); capture -> ISEQ waits on ISP/ASIC completion flags; record -> CPU 2 tasks and
   the card.
5. `OlyHfwOpeShoot::ctrlRelease` busy-waits on `0x50ab5716(3)` status bits (2.3).
6. Level Adjust showed the pattern: the GUI task slept in `0x5004ad13`'s dly_tsk loop for
   12 sensor samples that never came, until the accelerometer's stand-in delivered them (2026-10-23, hle-gaps.md
   4.7.3).

---------------------------------------------------------------------------------------------------

## 3. Live view in emu

- M7 path (check_liveview only): frame -> live-view bank element through the firmware's own bus
  window (`display.mjs:916 load_lv_frame`, native `0x50036da4`/`0x50036d95`, handle -> address
  `0x50534dd1`, cross-checked against the bank table `0x602c2d61`); through permit
  `0x501c40d0` (`display.mjs:928`); TH API `0x501c3f4d` with a 224-byte `ThRequest`
  (`display.mjs:938 live_view`), which programs VSC IMG1 (DMASADR, RSZ, AREA, FMT).
  Banks (`display.mjs:73-74`): 0x0a and 0x18 at bus 0x98d4d800 (5 x 0x16f0800), 0x0e at
  0x95f6c800 (2), 0x75 at 0xee087500 (5); buffer 5568 x 2160, YCbCr 4:2:2 (IMG format 0, Y0 Cb
  Y1 Cr, full-range BT.601, A8), stride 11136 (`LV_FROM_AREA`, `LV_STRIDE`).
- Request geometry is harness-chosen (H-REQ, `display.mjs:151-152 ThRequest.scaled`): the
  camera's own builders `0x50453c2e`/`0x50453d88` (mvr) are not decoded; who drives the stills
  live view on the camera is open (ROADMAP "Open follow-ups by milestone", live view; vsc spec section 8).
- Compose: `vsccompose.mjs` draws IMG1 when DMAEN bit 0 is set, fetching `DMASADR << 4` from bus
  memory; A6 edge guard (IMG_EDGE_UNKNOWN unless the attach was recorded), A15 opt-in (CTRL3
  0x41) is needed on the TH path.
- play: none of this is wired (`play.mjs`/`player.mjs` never call load_lv_frame/live_view; X:
  WINDOWS token lists only OSD1..3); a `--liveview` play option (A15, H-REQ) was never
  implemented (S-SCENE later took that role, section 6).
- On the camera the pixels arrive from the ISP (SLVS -> BN -> PRO/RAP/VDC -> YC in a bank) and
  DISP_SYNC (`disp_sync_drv_param`, code ~0x507f68dd, MMIO 0x9c18xxxx, 990 refs) moves the
  through image per frame (I). The VSC IMG1 plane is the only firmware-visible point emu
  already models, so a mock sensor should write post-ISP YC into a bank element and let the TH
  API attach it.

---------------------------------------------------------------------------------------------------

## 4. Exposure, lens, AF: computed vs reported

- User settings are store properties written by the GUI natively: ISO = store 1671 (ISO
  dial-direct 217 writes it, menu spec line 423); the item bar `0x0414` edits shutter speed (store
  819 = 5), aperture (4), exposure compensation (3), ISO (6) (menu spec line 392). The store ids
  of Tv and Av themselves are not identified here (?). In M/S/A the front/rear dials go through
  the camera application (not running), so in play the dials post only GUI indices 59/60.
- Firmware-computed: the AE program (EXP / TAKE_EXPOSE, `[exp]`/`[TEXP]` logs, Tv/Av tables used
  by ND128 at body 0x2d0372..), exposure conflict resolution (`conflict_result: composite bulb time
  shutter shutter_min shutter_max`, 0x602f4c3d), AE lock state (`setAELockSync`), AF decisions
  (`judge_caf/chk_af_exec`, `IAF_START`), ND frame counts. Its input BV comes from the AE1/AE2
  hardware statistics (I: cam_bright programs them; the stats format and where they land are ?).
- Hardware-reported: lens identity and capabilities (L_ID, FuncFlag, open F-number `fno_open`,
  focal length `APPEVENT_STATE_FOCALLEN`, focus ring `EV_CHANGE_FOCUS_RING`, MF clutch
  `EV_LENS_MF_SW_ON/OFF`, actual aperture `[exp]:actual_aperture_open`) over the lens link;
  AF contrast values (cam_contrast block) and phase-detect data (PFP_AF, PDMIX, ranging on CPU 1);
  sensor temperature (PER_CCD_TEMP); IS state (in the lens record and the BC module; `0x9999xxxx` is not a device,
  2.5).
- The GUI reads shooting values through the HFW / LowApi getters (`OlyHfwLowApiWrap::
  getShutterSpeedLimit`, `Shooting::getApparentShutterSpeed`, strings D); their backing state is
  kept by the modules that do not run (I).

---------------------------------------------------------------------------------------------------

## 5. Plan

Constraints from the repo: every stand-in is labelled (S-*/H-*/A-*) with evidence; behaviour
without evidence is an error; checks/golden must stay byte-identical, so everything new is
opt-in (`--camera`, `--scene`) and logged as inputs so `--replay` reproduces it.

### Tier 0 (days): show a picture, no firmware change in behaviour

- Wire M7 into play behind `--liveview`: after bring-up, through permit + TH API (H-REQ scaled
  request) on the shown device, frames from a scene renderer written with `load_lv_frame` each
  frame boundary (or each N ms of lab time). Needs A15 on (the TH path sets CTRL3 0x41) and the
  A6 attach record; the existing a15 bracket guard already handles 'auto'.
- Cost per frame: a 900 x 600 crop at 2 B/px through the bus window is ~1 MB; fine in node, may
  need a direct bus write in the Worker.
- Re-attach after display switches (S-OUTSEQ re-entry) and after any DISPLAY cmd 5/17 that clears
  img[0] (vsc spec §9 item 1, item 7).

### Tier 1 (weeks): S1/S2/REC complete with fake completions at the module seam

Run the camera application natively and stand in below it, the S-DISPQ pattern:

1. Bring-up: run the application part of the USTART chain that the lab skips, at least
   `0x502a48b6` (gate 119 at `0x502a4945`, forward enable via `0x502a49a9` -> `0x5014c3c8`)
   and CA_MAIN's own init, then `act_tsk(58)`. Drop S-KEYMAP for codes the application now
   receives through `0x50025095` (keep it behind a flag for the old checks).
2. Serve every module queue the application sends to and whose reader does not run: first
   PC_PD_CMD_EXEC (207, the known stop at `0x5102b58c`), then TAKE_EXEC (0x5a), TAKE_FUNC (0x5e),
   FCS_EXEC (0x1b), LENS_EXEC (0x2e), REC_EXEC_MAIN (0x47), ZOOM/PWR as they appear. Each
   served command is allow-listed by (queue, command word, return address); anything else is an
   error, exactly like S-DISPQ / S-CPU2.
3. Replies: post the completion events to API_EVENT queue 6 in the format the observers expect
   (TakeReadyFinish with AF OK/NG, AELockDone, TakePictureDone/Nr/Complete, RecView create done,
   record ready / recording done). Formats: ? -- this is the RE work of the tier; find the
   observers' `rcv*` handlers and the module tasks' reply sends (e.g. DISPLAY's reply builder
   `0x501c48bf` is the model). Data values (AF OK/NG, Tv/Av/ISO actually used) come from Tier 2.
4. Then the GUI reactions (focus icon 171, black screen 153, 2nd-release 154, rec view 157,
   card access 129, REC display) are sent by the native application, not guessed.
   Expected next blockers: the application querying lens state (no lens record), card state
   (no card: likely a "no card" refusal path, ?), and battery/power (PWR_EXEC).

Shortcut alternative (cheaper, weaker): extend S-CAMSEQ with GUI-only rules (S1 -> 171, S2 ->
153/154/157 ...). Every index and data word would be an inference with no runtime check; only
worth it as a demo.

Not recommended for now: running TAKE_*/ISEQ/REC natively. That needs the ISP register blocks
(0x9b0x..0x9b6x, ~2000 register refs), SSG timing interrupts (IRQ numbers ?; IRQs attached by
`0x50053fcd` in the image cover 237/238/255/278-309/323-326, the camera ones were not found by
a constant-argument scan), the sensor SIO protocol, the lens link, CPU 1 (AF) and CPU 2
(record), and a card: full-boot-LLE scale ("months", ROADMAP "Longer term: full-boot LLE").

### Tier 2: scene / sensor mock

One model, two consumers:

- Scene: N layers {depth z (m), texture (procedural or image), opacity mask, velocity / path},
  e.g. background at 50 m, midground 5 m, foreground 1.5 m; static or moving (lab-time driven,
  so replays are deterministic). Illuminance as scene EV100 per layer.
- Lens: focal length f, current aperture N (from the camera's Av when Tier 1 runs, else the page),
  focus distance s (from AF result or MF). Defocus blur: circle of confusion on the sensor
  c = (f^2 / (N (s - f))) * |z - s| / z; convert to pixels with the 17.4 x 13.0 mm Four Thirds
  sensor width over the rendered width; per-layer Gaussian/disc blur of radius c/2, layers
  composited back to front (cheap and good enough for DoF).
- Exposure: pixel value = scene luminance * t * (S / 100) / N^2 * k, clipped, then gamma and
  BT.601 YCbCr 4:2:2 for the bank; ISO noise ~ sqrt(ISO) shot noise; motion blur by averaging
  sub-frames over the shutter time t for moving layers (live view uses the frame time, capture
  uses the real Tv).
- Outputs: (1) the YC frame for the live-view bank (Tier 0); (2) AE result for the Tier-1
  stand-ins: scene BV (average or centre-weighted log2 luminance), then the camera's P/A/S/M
  logic needs Tv/Av/Sv -- at the module seam the stand-in has to compute these itself
  (labelled), since the firmware's AE program sits below the seam; (3) AF result: contrast of
  the layer under the AF point vs. focus position, or simply "in focus at layer depth" -> AF OK
  with distance, AF NG when the AF area is textureless or too close (minimum focus distance).
- Feeding the firmware's own AE/AF code (stats in cam_bright / cam_contrast / PFP_AF format)
  is only needed if the TAKE tasks run natively; formats unknown, so not part of this plan.

### Tier 3: web UI

- New input type `{type:'scene', ...}` through `/api/input` (player.mjs `control()` / play
  session), logged in the session log so `--replay` reproduces it; malformed values refused like
  the existing inputs (input spec §7).
- Panel next to CONTROL_ROWS (web/index.html `fill()`, web/play.html): scene preset
  (static / moving), per-layer depth and speed sliders, AF point (click on the frame when no
  touch AF), focus mode MF/AF with a focus-distance slider, lens focal length and max aperture,
  scene brightness EV; read-outs for the Tv / Av / ISO in use, BV, AF state, CoC per layer.
- When Tier 1 runs, Tv/Av/ISO come from the camera (GUI + store), not from sliders; before that,
  the sliders drive the renderer directly and the page says so.
- Captured frames: on TakePictureDone render one full-resolution still with the capture Tv and
  offer it as a download (the card/file path stays unmodelled).

### Order and size (rough)

1. Tier 0 live view in play: 2-4 days (all firmware calls already exist in display.mjs).
2. Scene renderer + page controls driving it directly: 3-5 days.
3. Tier 1 bring-up of CA_MAIN to its first unserved queue, then queue-by-queue stand-ins with
   reply formats RE'd from the firmware: several weeks, open-ended; each queue is its own RE item.
4. Hook renderer results into the Tier 1 replies (AE/AF/capture): 1 week after 3.

### Known / guessed / unknown summary

- Known (D/X): key codes, EV ids, GUI indices; UI_IN forward gate and its enabler chain;
  task list and entries; module queue table; state-machine and observer names; MMIO regions
  used by the cam driver files; live-view bank layout and TH API (executed in check_liveview).
- Inferred (I): which block is AE/AF from file names; stats via DMA; CA_MAIN as the
  state-machine host; the seam replies going to queue 6.
- Unknown (?): message layouts of TAKE/REC/LENS/FCS exec requests and their replies; how many
  further blockers CA_MAIN hits after queue 207; camera IRQ numbers for SSG/ISP; sensor SIO
  protocol; lens wire protocol beyond the lens-gates findings; AE/AF stats formats; Tv/Av store
  ids; the camera's live-view TH request (mvr builders); card-less release behaviour.

---------------------------------------------------------------------------------------------------

## 6. What emu has now: S-SCENE (Tier 0 with the Tier 2 model and the Tier 3 page)

`emu/src/lab/scene.mjs` renders the scene; `PlaySession.scene_*` in `emu/src/lab/play.mjs` feeds it to the live
view; the page's "Scene and image sensor" panel (`emu/web/play.html`) drives it. Everything is off until a
`{type: 'scene', change: {...}}` input turns the live view on, so every existing session, check and golden recording
is unchanged.

- **Live view (X).** The first scene input with `liveview: true` opens the through permit (`0x501c40d0`), writes a
  frame into live-view bank 0x0A element 1 through the firmware's bus window, and calls the TH API `0x501c3f4d` with the
  harness-chosen scaled request of check_liveview (crop 1984,540, 1620x1080 to the panel, H-REQ). Before each composite
  the frame is written again when the scene changed, or every 1/15 s of lab time while a layer moves. A display switch
  attaches again on the new device. The composite needs A15 (CTRL3 0x41 on the TH path); the player's default `--a15 auto`
  assumes it, because the TH call leaves the 0x501e04b7 brackets closed (X), and the status line says so. With
  `--a15 off` the frame is refused with FEATURE_UNOBSERVED, as check_liveview shows.
- **The model (harness's own, not firmware evidence).** Three layers (sky and hills at 200 m, trees or a cyclist at
  8 m, a signpost or a ball at 1.5 m; or a test chart), a thin lens on the 17.4 mm wide Four Thirds sensor, defocus
  blur from the circle of confusion, motion smear over the exposure time, exposure 2^EV * t * (ISO / 100) / N^2 against
  mid-grey with auto (shutter priority on the set aperture and ISO, held to 1/8000..1/30 s) or manual, ISO noise,
  gamma 2.2 and full-range BT.601 YCbCr 4:2:2. Rendered at half resolution and doubled (about 150 ms a frame).
- **S1, S2 and REC (harness's own).** With the live view on, S1 down focuses on the nearest layer under the AF point
  (AF ok) or reports AF ng, S2 down records a capture (shutter, aperture, ISO, exposure offset, focus) in the status,
  and REC down starts a clip, the next REC down ends it (its lab-time length in the status). The keys still go to the
  firmware exactly as before (UI_IN, the GUI's indices); the camera application's own AF and release and movie
  recording (sections 2 and 5, Tier 1) are not run, so the GUI does not show the focus confirmation, the black-out,
  the rec view or the recording display, and the OSD's shutter, aperture and ISO values are the GUI's, not the
  scene's.
- **Replay.** Scene inputs are session-log inputs: `--replay` of a session renders the same frames (test_scene.mjs).
- **Open.** Whether the camera keeps the live view under the menu (the GUI's menu layers are drawn over IMG1 here) is
  not known. The live view's real geometry and frame cadence on the camera (the mvr request builders, DISP_SYNC) are
  not decoded; the scaled request is check_liveview's.

---------------------------------------------------------------------------------------------------

## 7. Tier 1 probe: the camera application running natively (X)

A probe tool, `emu/bin/camapp-probe.mjs` (removed on 2026-10-15, when every play session came to run the application), ran the first step of Tier 1 in a play session and printed what the firmware does. It
widens two lab guards for its own process only (the task entries the application starts, the module-9 readers of
S-TAKEOVER); nothing in the lab's behaviour changes. What it shows on E143 v1.9:

1. **CA_MAIN runs.** `act_tsk(58)` after the play bring-up: the application starts tasks of its own (entries
   `0x50ab83f4`, `0x5108ba1b` twice; with them tasks 161 to 168 exist), reads module 9's state from five places
   (`0x50abe026`, `0x50af63f3`, `0x50abb039`, `0x50aba912`, `0x50ae0fa3`; S-TAKEOVER's guard lists only the GUI's two
   readers), attaches IRQ 310 at level 5 (`0x51011636`), sends one message to queue 8 (AUD_EXEC in the target table,
   from `0x50a642b4`), writes six errlog records (`0x08010002` x3, `0x17002009..0x1700200b`, `0x1700000d`,
   `0x1700000e`; their meaning is ?) and moves the GUI from `0x0108` (shooting screen) to `0x0102`
   SS_COMMON/ID_ST_POWER_ON. Then every task waits: the lab settles; the queue-207 stop of the input spec is not hit
   on this path (?: that observation came from another bring-up).
2. **The event broker.** `0x502a48b6` is the application's event broker init: it clears the broker's tables (at
   `0x62a5f4a0` and `0xa31f1f80`), sets UI_IN's forward gate through `0x5014c3c8` (to 6) and the publish gate
   (`0xa31f1d26`) to 119. While CA_MAIN starts, it passes a list of event codes through the broker's filter
   `0x503eb190` (from `0x50b632f1`: among them `0x0200120a`, the movie key's, and `0x02001209`, `0x0200000b`,
   `0x02002302`, ...; S1's `0x0100` and S2's `0x0101` are not among them). What the application does with the result
   is ? (the filter compares a code against a 75-entry table at `0xa31f1d28` and returns 0 or the code).
3. **The keys reach the application's queue natively.** With the gates set, every S1, S2 and REC press and release
   runs UI_IN's forward `0x5014c3eb` -> publish `0x50025095` -> broker `0x503eb25c`, `0x503eb0c5`, `0x503eaf75`,
   `0x503eb190` -> post `0x503eaf3b`, which sends a 12-byte message (code `0x0200xxxx` down, `0x0201xxxx` up) to
   queue 6, API_EVENT, through `0x5002c151` with timeout -1 (D for the code, X for the calls). S2 down sends S1 down
   first (UI_IN's own shutter sequencing).
4. **Nobody reads them yet.** CA_MAIN does not wait on queue 6: it and task 165 wait in kernel service `0x50017856`
   (not in the service table of the kernel spec) called from `0x50ac5ddb` (the application framework's OS layer, I),
   from CA_MAIN's loop at `0x51049fda` via `0x512a1064` and `0x50b01dad`; the DISPLAY task, which does read a data
   queue, waits in `0x500163dd` instead. So the messages stay in queue 6 while the application sits in its power-on
   state.
5. **What the application waits on (D, X).** `0x50ac5bca`, `0x50ac5d4d`, `0x50ac5ddb`, `0x50ac5e9d` are the
   application framework's queue operations (create, delete, receive, write; pointers at `0x60de4d90..9c` beside the
   tags HLS_CRQ, HLS_DLQ, HLS_REQ1/2 and HLS_WRQ1/2, OlyLowQueue): `0x50017856` is the kernel's receive without
   timeout behind HLS receive (`0x50014181` with a timeout). CA_MAIN receives on framework queue 2 (kernel object 3),
   task 165 on object 6, task 164 waits on an event flag (`0x500169d6` through the framework's `0x50d9b49d`); no
   framework write to these queues happens in the probe.
6. **Who reads queue 6 (D).** The receive from queue 6 is `0x503eaabd` (a 12-byte message, timeout 0: a poll), reached
   from `0x503ea2a6`, which the framework call `0x50abc38e` wraps; `0x50abc38e` is only reached through a function
   table at `0x60dccb80` (the last slot after fifteen `0x50d9bxxx` OS-layer entries), so its caller is not found
   statically. No task calls it in the probe. HIGHLEVEL_MAIN's static entry `0x50ab2293` is a teardown (it deletes the
   object at `0x6035e7dc` and returns); the HighLevel run loop is `0x50ab2d1c`, started elsewhere (?).

7. **The HighLevel dispatcher (X).** The boot chain creates the HighLevel object (`0x50ab222a`, called at
   `0x501e9dbc`; it is stored at `0x6035e7dc`) and initialises it (`0x50ab22bc` -> `0x50ab2d1c`, at `0x501e9dd1`),
   which starts tasks with entries `0x50d9b388` and `0x50abbf0c`. The lab skips this; the probe runs both natively before
   the broker init and CA_MAIN (`camapp-probe.mjs`, default; `--no-highlevel` leaves them out). With them, the first
   poll of queue 6 happens at once (`0x503ea2a6` -> `0x503eaabd`, OlyQeRd(6) with timeouts 0 and -1), and every key
   message is taken from queue 6 by the HighLevel side and handed to CA_MAIN, which wakes, runs, and waits again on its
   framework queue.
8. **The application handles the keys (X).** `--trace-keys` counts what each key action runs: about 26,000 to 28,000
   instructions per press or release, through the HighLevel dispatcher (`0x50ab2900..0x50abc9ff`), the framework OS
   layer (`0x50ac5500..0x50ac70ff`), the framework (`0x50b01c00..0x50b7a2ff`, `0x50d76a00..0x50d9d2ff`) into
   CA_MAIN's own code, and the paths differ by key: REC runs `0x5104cd00..0x5104deff` (418 instructions in
   `0x5104de00` alone), S1 runs `0x51064e00` and `0x51086b00`. So the camera application receives the shutter and the
   movie key and dispatches them to key-specific handlers natively. Nothing visible follows: the application is in
   its power-on state (GUI `0x0102`), sends no module request on a key, and moves no GUI state.
9. **What power-on waits for (X, partly).** At start the application sends one request to queue 8 (AUD_EXEC). With AUD_MAIN
   (task 82, `0x50a62a05`) started natively as well, the next idle slice stops on an inter-CPU doorbell to CPU 2 (bank
   2, set from `0x5002d6be`) that the lab does not serve (no CPU 2); that AUD_MAIN read the request and rang it is I. Whether power-on waits for that reply, and for which
   other modules (lens, sensor, card), is ?.

10. **Back on the shooting screen (X).** `--shooting` sends S-CAMSEQ's request 125 after the idle slice, which returns
   the GUI to `0x0108`; then S1, S2 and REC still produce no GUI message, no engine command and no panel. With UI_IN's
   forward gate set, the GUI no longer gets the key indices S-KEYMAP used to send either: the keys go to the
   application only, as on the camera, and the application, in power-on, does nothing visible with them.
11. **The size of the rest (D).** After the HighLevel steps the boot chain (`0x501e9dd8..0x501ea18e` and on) runs
   dozens of further steps, most of them a wait on a module's ready flag (`0x5002c546`, `0x5002cdb7`) around a module
   start (lens, sound, wireless, display, ...). Leaving power-on means serving those: the full-boot milestone of the
   ROADMAP rather than a key-by-key stand-in.

12. **The firmware's own log (X).** `--fwlog` reads every string the firmware formats through vsprintf `0x50029f08`
   (at its return), with the GUI's log level (`0x603758b8`) raised to 3 and the HighLevel logger's threshold (`+24` of
   the object at `0x6035e7e0`) set to 0. The two main print paths are the HighLevel logger `0x50ab23ef` (13,349 call
   sites; it also takes the output sink `0x50aff9a4`) and `0x50029534` (sprintf). With it the keys show up in the
   firmware's own words: `RECV APP_EVENT [0x0200120A]`, `CALLBACK(CBC_SYSTEM_EVENT, EV_PRESS_MOVIE_KEY, ...)` for REC,
   `Release event forward 0x02000100` and `EV_PRESS_1ST_RELEASE` for S1. CA_MAIN's start prints its power-on steps:
   `CameraCommon::initializeApi`, `PowerSupplyControl::startMonitor`, `CameraCommon::ctrlAutoThrough(1)` (live view on),
   `KeyCtrl::setExclusion` (priority table `0x120a, 0x000b, 0x1209, 0x2302, ...`), `CameraCommon::startMount`, the GUI's
   transfer `TRA SEND [480]` (`0x50b78c75`, which takes the GUI to `SsCommon_StPowerOn`), and `WAKEUP ISSUE = 3` from the
   HighLevel init. Its getters (`0x51060ffd` wakeupIssue, `0x51061006` / `0x51061028` bootService) read 1, 1, 1.
13. **Module events (X).** `--inject` publishes codes through `0x50025095` as a module would. Module events are
   `0x04MMxxxx` (publishers: DISPLAY `0x0402xxxx`, REC `0x040800f0`, ...); the application maps them to EV ids itself:
   `0x040b0080` -> EV_DAMAGE_OCCURRED, `0x04060000` -> EV_LENS_DOWN, `0x041d0001` -> EV_CCD_TEMPERATURE_OVER, each
   reaching its CBC_SYSTEM_EVENT callback (`0x50ab86eb`, category 0x23); others are received and not mapped. None of
   them moves the power-on state.

14. **Where startShootingService waits (X, D).** Without stand-ins the shooting sub-application gets as far as
   `Shooting::startShootingService(11)` -> `EXEC API [0xF0020000, 0x6042F951]` and blocks. The API `0x5040e931` sends
   request `0x2000a` (16 bytes: reply queue 6, token `0xf0020000`, 0, a parameter block) to TAKE_FUNC (target 25, queue
   `0x5e`) through `0x503eb86c` -> `0x503eb960` -> OlyQeWr, and its caller `0x50ae0fd4` -> `0x50b7e1d6` waits on a
   semaphore until the HLS executor (`0x62afc698`, task 166) is handed an event whose top half is `0xF002`
   (`0x50b7e192`). A 12-byte reply `[0, 0xf0020000, word 3]` written to queue 6 (`--qsend 6:0:0xf0020000:<word 3>`,
   the layout of DISPLAY's replies, `0x501c48bf`) wakes it: `RECV APP_EVENT [0xF0020000]`. Running TAKE_FUNC
   (`0x502cd1ca`) natively instead only moves the wait down: it forwards to TAKE_FUNC_CP (`0x502cd604`, queue `0x5f`),
   which waits on event flag 66 (`0x502cd49f`) and then sends to BC_EXEC and LENS_EXEC. Corrected 2026-10-23 (D,
   hle-gaps.md 4.1.1): `0x2000a` is the API's id, and the message's third word, 0, is TAKE_FUNC command 0. Flag 66 is
   TAKE_CAM_EVENT (0x42), set by the completion `0x502cd4d0` of the camera driver's request 148, which TAKE_FUNC_CP's
   ready sequence makes before its BC_EXEC and LENS_EXEC messages; their replies come back on TAKE_FUNC_CP_POST (0x61).
15. **A generic module seam (X).** `--ack-modules` answers every request the API sender posts to a module queue (the
   target table of 2.2, plus PC_PD_CMD_EXEC 207) with that reply after the step, and returns E_OK for every
   synchronous send (`0x5002e39d`) the lab's own stand-in refuses (TAKE_FUNC cmds 13 and 18, PC_PD_CMD_EXEC cmd 8,
   TOUCHPANEL `0x92` cmd 8). It writes nothing a module would write back. With it the application leaves power-on
   (`S-AppBoot` states `0x1000 -> 0x1002 -> 0x1003`, then SHOOTING, `state = 0x5000`), but
   `OlyHfwOpeShoot::startShootingService` still ends `0xf0000001` and the shooting service stays off.
16. **The transaction layer (D, X).** That error is TRA 990 (`0x3de`): the HLS transaction dispatcher (`0x62afd244`,
   vtable `0x60dffa80`) looks for a local handler (`0x50af8019`; its list is empty: handlers are added by TRA 485 and
   removed by TRA 486, `0x50af8b3f..`), then hands the request to a remote channel that answers `0xf0000001` at once.
   TRA ids seen in the probe: 415, 598, 614, 691, 958, 990, 1503. `--ack-tra` makes the synchronous exec (`0x50af7cb9` by
   calls, `0x50af7cbe` by call) return 0 without touching the request; then `startShootingService end = 0x00000000`
   and the application reaches `state = 0x5100`. Corrected 2026-10-23 (D, hle-gaps.md 4.1.2): no code builds a TRA 485
   or 486 request (their vtables `0x60dcb54c` / `0x60dcb594` occur nowhere in the main block), so the local list is
   empty on the camera too and the remote channel, through the State Mediator to the components, is the normal path.
17. **The GUI driven by the application (X).** The lab's play bring-up builds the shooting screen itself (S-CAMSEQ
   request 125), which takes `0x3c320` bytes of the GUI's window pool `0x106` (descriptors at `0x62b3e6b8`, 16 bytes
   each: id, base, size, high-water mark; pool `0x106` is `0x60b00` bytes). The application's own rebuild on S1 then
   needs `0x246c0` more, the pool allocator `0x510c0e78` returns NULL inside the window factory `0x510e21cb` (part
   `0x8003`, the 27th of the loop at `0x5114b8f3`), and the GUI calls through a null object (pc `0x8940`). With
   `--start none` (the GUI left at power-on, `0x0102`) and `--native-keys` (S-KEYMAP and S-CAMSEQ off) the application
   alone takes the GUI to the shooting screen (`REQ_CHG_OUTPUT_DISPLAY`, `STATE_CHANGE_BATTERY_INFO`,
   `REQ_REFRESH_PANEL`, `REQ_REC_DISP_INFO` = index 176, `STATE_CHANGE_MODE_UPDATE`) and nothing overflows.
18. **What a camera with a reset clock shows (X).** That shooting screen is first covered by the date prompt: a clock
   icon and `Y/M/D` over the live view (`DateCtrl::checkInitSettingDisplay`; the lab's clock is unset). S1 down runs
   the shooting sub-application's `OLY_PRESS_1ST_RELEASE` handler (`func add = 0x6109e826`), which cancels the prompt
   (`checkCancelDateSetupDispMdlDateSetup`), asks the GUI for the rec info (index 176), and the GUI draws the shooting
   information over the live view (mode P, `1"`, `-.-`, exposure scale, ISO Auto, `MF` with no lens, `4K 60p`,
   `LF`, card count). This is the first visible response to the shutter button that comes from the firmware's own
   logic rather than from a stand-in. `--scene static --a15 on --shots DIR` writes the frames.
19. **S2 and REC (X).** S2 down is received (`OLY_PRESS_2ND_RELEASE` reaches CamApp) after the S1 it implies, and
   handled as `command ShootingCommon` with no release; S2 up runs `OLY_RELEASE_1ST_RELEASE` (`0x6109eed7`). REC is
   `OLY_PRESS_ORIGINAL_CUSTOM_KEY` then `OLY_PRESS_CUSTOM_KEY`, which starts function direct 123 (`0x7b`,
   `startDirectSubAppStateShootingFuncDirect EV:16777222`) and ends it on release. The HLS forwards each release event
   (`Release event forward 0x0200010x`) below the application; `getAvailableShootCount` reports 0 (both slots
   unmounted, `errFactor 0x0009`). No frame changes after S1. What the release waits for (TakeReady, AF result,
   a card) is the next seam.

20. **Module notifications become callbacks (D).** The HLS shooting reactive (a Rhapsody statechart; vtable
   `0x60dff400`, one heap object; state at `+216`) takes the modules' notifications as events whose id (vt[3]) is a
   TRA id in 424..1507, looked up in a hashed table at `0x60dfec00` (`[id - 423, handler]`, index `(id - 423) & 255`)
   from `0x50af46d7`; each handler posts a CBC_SHOOTING_COMMON (`0x21`) callback through `0x50af4451(a0 = the reactive,
   d0 = CBS, d1 = param)`, which builds the callback message (`0x50ab8621`) for the callback task (165). Names from the
   firmware's tables (CBC `[code, name]` at `0x60dce0cc`, CBS at `0x60dcfb68`). The handlers' first callback, read
   from their code: 1319/1360/1363 CBS_START_READY (208), 1320/1335/1337 CBS_END_READY (209), 1323 CBS_START_FOCUS (213), 1321
   CBS_END_FOCUS (214, param 1 when the notification's `+28` is 1), 1308 CBS_START_EXPOSE (136), 1324/1374/1379
   CBS_START_SHOOTING_PICTURE (210), 1274/1286/1306/1311/1322 CBS_END_SHOOTING_PICTURE (211), 1296
   CBS_REQUEST_DISPLAY_RECVIEW (294), 1328 CBS_START_READY_MOVIE (205), 1329/1330 CBS_END_READY_MOVIE (206),
   1298/1326/1350/1351/1376/1382 CBS_START_RECORDING_MOVIE (216), 1327 CBS_END_RECORDING_MOVIE (217), 1314 CBS_AF_LOCK (155),
   1325 CBS_UPDATE_SHOOTING_TIME (108) (an earlier version of this list gave the table's entries, the ids less 423).
   Which module sends which id is ? (the senders do not run). Corrected 2026-10-23 (D, hle-gaps.md 4.1.3): no module
   sends them. Their classes (gap@0x50af1ebd) are built by the HLS itself, most of them by CmpSqp_SequencePartsBase
   (1308, 1319..1329 among them), others by Cmp_StillShootingComponentBase, CapTak_Take and CmpSts_RecordController;
   S-RELSEQ stands in for the sequence parts, which act on the capabilities' observer events.
21. **The release sequence on screen (X).** `--seq` posts those callbacks between key actions as the reactive would.
   With `key:s1:down, cbs:213:0, cbs:214:1, key:s2:down, cbs:210:0, cbs:136:0, cbs:21:0, cbs:211:0, cbs:89:0`, the
   application answers each one itself: END_FOCUS(1) -> `STATE_CHANGE_FOCUS_ICON` (no change on screen with MF and no
   lens), START_SHOOTING_PICTURE -> `REQ_REC_DISP_INFO` (part of the information goes), START_EXPOSE ->
   `REQ_REC_DISP_2ND_RELEASE` and `TAKE_BUFFER_UPDATE` (the screen is cleared to the live view with only the buffer
   count `[ 0]` top left, the capture display), END_EXPOSE and END_SHOOTING_PICTURE -> `REQ_REC_DISP_INFO`,
   START_RECVIEW (89) -> `REQ_REC_DISP_RECVIEW` (the information goes; no recorded image exists to show). The callbacks
   are stand-ins for the modules; everything after them, including what is drawn, is the firmware's.
22. **REC (X).** The movie key's `0x0200120a` reaches the application as `OLY_PRESS_ORIGINAL_CUSTOM_KEY`, then
   `OLY_PRESS_CUSTOM_KEY`, and starts function direct 123, which the application's own check names `HIGHRES`
   (`B-FuncChk`); the check fails at `CHECK_MEDIA_IS_NOT_ACCESS` (`isMediaAccess`; no card is mounted) and the
   function does not run. Why the key is a custom key with function 123 in the lab's settings is ?.

23. **In the play session (X).** The probe's stand-ins are now an opt-in mode of bin/play.mjs (`src/lab/camapp.mjs`; the
   control op `camapp` with value 1 starts a new session in it, 0 returns; both pages have a "Camera app" button):
   S-CAMAPP (the HighLevel steps, the broker init and CA_MAIN at bring-up, in place of S-CAMSEQ's start request;
   S-CAMSEQ and S-KEYMAP off), S-MODACK (item 15), S-TRAACK (item 16) and S-RELSEQ (item 21's callbacks posted on
   S1 down and S2 down, END_RECVIEW 500 ms of lab time later). The session starts on the application's own screen
   (the date prompt) in about 3 s; S1, S2 and the rec view behave as in items 18 and 21, the session log replays
   (`--replay`) to the same frame, and `test_camapp.mjs` checks it. With the live view on (S-SCENE) the scene shows
   under the application's display.

24. **REC (X).** Item 22's refusal is not the card: the check lists what passed after `CHECK OK >` and what failed after
   `CHECK NG >`, and the failed item is `CHECK_LLPSW_KEY_IS_NOT_PRESS`; the lab's idle image reads LLPSW (`0x121c`) as
   pressed (input spec). With LLPSW released (the firmware key `fw_121c`) the check passes; in P the movie key's
   function 123 is the application's HIGHRES toggle (setting 770, `setSetting_Toggle`; the rec info loses ISO and the
   card count). Releasing LLPSW also cancels the date prompt. At mode-dial position 7 (the application reads dial
   state 5) the movie key's function is 27, RECORDING_MOVIE: its check passes, it starts past its checks at
   `0x51068e37` (`(28,sp)` = the id), and with the movie callbacks (`START_READY_MOVIE`, `END_READY_MOVIE`,
   `START_RECORDING_MOVIE`) the application enters its recording state `0x5301` (`BS-Movie startRecordingShootingMovie`,
   `record_movie = 2`, the GUI builds `GCPnl_Rec_Movie`) and clears the information from the screen; END_RECORDING_MOVIE
   returns it to the movie-mode information (S-AF, metering, `F80`, ...). While recording, the movie key starts no
   function in the application (the stop is below it, I). No REC indicator or time is drawn while recording; why is ?
   (`GCPnl_Rec_Movie_ALL G_FALSE`). Mode changes cost the application more than the lab's 40,000-stop step budget, so
   S-CAMAPP raises it tenfold (`settle_hooks`). Position names of the dial are not known.
25. **S-RELSEQ from the scene (X).** In the play session the release callbacks take S-SCENE into account when its
   live view is on: END_FOCUS(0) when nothing focusable is under the AF point, END_EXPOSE after the shutter time in
   use (a manual 2 s shows the capture display for 2 s), and RECORDING_MOVIE starts and the next REC press ends a
   recording, with UPDATE_RECORDING_TIME every second. Checked in a browser on the node host (Chrome, `play.html`):
   Camera app on, the date prompt over the moving scene, F cancels it and shows the information, Space with a 2 s
   manual shutter shows `[ 0]` for the exposure, LLPSW released and the dial at 7, R records (14.5 s by the status) and R
   stops. One difference from the node runs is not explained: in the browser the frame was white during the recording
   (the live view came back after it).

26. **The white frame (X, fixed).** The white frame during the browser recording was the S-SCENE live view at a manual
   2 s shutter (Y = 255) left on screen: the Player published a frame only when a GUI step or an engine command
   happened, and a recording clears the GUI, so the overexposed frame stayed after the exposure was changed back.
   The Player now also publishes when the live view changes (`Player.scene_moved`, false without a live view, so
   nothing recorded changes).
27. **A card (X).** The application's media state comes from HLS variables the media reactive sets on a mount
   (`0x50aca6b1`: SD `0x60360bfc`, `0x60360c08`; setter log `set SD MOUNT STATUS is 0x%08x`), read by getMountState
   (`0x50ac968e` -> `0x50aca51d`; the application's media interface is the vtable at `0x60e03180`, getMountState its
   slot 18). With both at 8 the application's card check passes (`errFactor 0x0000`), the GUI's count check
   (`0x511ffcc9`, two getMountState calls that must both be 8) passes, and the shooting screen shows the movie time
   left (orange `[00:00]`). The shot count comes from the module query `0x50419164` (getAvailableShootCount,
   `0x50ad8a58`), which S-MODACK answers 0; answered 999, `available 999`. S-CARD in camapp mode does both. The movie
   time left is another module query (`0x503f3cf5` / `0x503f3e4e` in getMovieCountdownTime, not stood in), so it
   stays 0.
28. **No REC indicator (X, D).** When a recording starts the firmware writes the TFT channel's OSD1 base register
   (+`0x39c`) as 0 and moves OSD2 and OSD3 (+`0x3a0`, +`0x3a4`): the information plane is switched off, which is why
   nothing is drawn while recording; the GUI computes its recording information (pattern 22, `record_movie=2`)
   for planes that hold none of it. The buffers come from the GUI itself: at the recording start its display manager
   sends DISPLAY cmd 17 (from `0x507f66d1`, run by S-DISPQ) with the OSD1 buffer 0, OSD2 `0xb7493000` and OSD3
   `0xb7c31000`, which the DISPLAY loop writes (`0x501e23a0` / `0x501e23b2` / `0x501e23e4`). OSD2 then holds index 255
   everywhere but one 600-byte column of 125 (the GUI draws nothing on it); where the camera's recording display
   (the REC mark and the time) comes from is ?. Two further observations: in movie mode
   CBS_START_SHOOTING_MOVIE (92) moves the application to `0x5302` and the screen to the movie layout (the time left,
   the movie mode icon), and START_RECORDING_MOVIE after it is not taken (`command ShootingCommon`); posted the other
   way round, the application loops on `OLY_LENS_MF_SW_ON` until the lab's instruction limit. S-RELSEQ keeps the
   order of item 24.
29. **The scene in a browser (X).** Checked in Chrome on the node host with the camera application running and the
   card in: aperture f/16 against f/2.8 sharpens the signpost at 1.5 m (depth of field); f/1.2 focused at 1.55 m keeps
   the signpost sharp and blurs the trees at 8 m and the background; manual f/8 1/500 s ISO 200 is dark and ISO 6400
   at the same aperture and shutter is clipped white (the exposure triangle); the moving preset moves (item 25).
   END_FOCUS's OK / NG from the scene has no visible effect here: the application is in MF without a lens.

30. **Notifications into the HLS reactive (X).** The probe's `tra:ID[:OFF=VAL]` builds an event (vtable `0x60de2788`,
   whose vt[3] `0x50ab28a2` returns the halfword at +4), makes it the reactive's current event (+104) and calls its
   dispatchEvent (vt[33] `0x50af4584`). TRA 1323 takes the reactive from state 12 to 11 and posts START_FOCUS; state
   11 waits for the null transition the OXF thread would run next (`0x50af468d`: `0x50d9bdfd`, then `0x50af46c2` back
   to 12), which the probe runs. 1321 with +28 = 1 then posts END_FOCUS(1) and the application sends
   STATE_CHANGE_FOCUS_ICON; 1328, 1329 and 1326 post the movie callbacks and the application enters `0x5301`. The HLS's
   own shooting state does not follow: `ope::getShootingState` reads a phase from the object at `0x6035f024`
   (`0x50ab57e9` -> `0x50c5880b`; 106..108 count as shooting), which is null in the lab (phase 100, idle). S-RELSEQ still
   posts the callbacks directly.
31. **Movie time (X, D).** `getTime` (`0x50adaff7`) reads the recorded frames (`0x503f1bcd`) over the frame rate
   (`0x503f1d35`, 0 in the lab, which ends it early) and, when asked for the time left, a 24-byte reply of the module
   query `0x5042da58` (from `0x503f3e4e`; the time at +16). Filled in by the probe (`--fill`), the value reaches the
   movie countdown time code (`timeCodeSec 4000`, 1:06:40), not the `[00:00]` on screen; which query feeds that is ?.

32. **Where the recording display could come from (D, X).** The phase object at `0x6035f024` is stored by
   `0x50ab687d`, called from `0x50d715c4` / `0x50d71641` in an initialisation in the shooting-control classes
   (`0x50d714a1`, reached only through a function table, not called in the lab): the HLS component that runs the
   release sequence is not started, which fits item 30's idle phase. The static task table also has
   OSD_DRAW_CPU2 on CPU 2 (`0x51015f1d`: plane 1-3 palettes, IMG3 target frames, `OSDDRAW_CPU2 illegal command`), an
   OSD drawer the lab does not have; no inter-CPU post was seen during a stood-in recording, so whether it draws the
   recording display is ? (I at most).

33. **Creating the shooting component by hand (X).** The phase object belongs to Cmp_ShootingComponent, a singleton
   (`0x50d712e4`, object `0x62b1fc78`, constructor `0x50d7130f`; `0x50d714a1` stores the phase object). Its creator logs
   `Create Cmp_ShootingComponent id[%d]` (`0x50d971aa`, vtable slot `0x60ef82b4`), reached from a component factory's
   create(id) (`0x50d9609b`, id 1, slot `0x60ef7f6c` of a large reactive class whose own construction is not found by a
   constant scan). The probe's `call:0x50d712e4` runs the singleton natively after the application has started: it
   needs one more stand-in (the sub-CPU status read `0x5012b8b7`, SCPU `0x98e000c0` / `0xd0`, which the lab's SCPU model
   does not have; stubbed 0) and then builds the component (`createActiveRelations 62b20140`, about 20 `hls 3 13 2`
   steps). It starts no thread of its own and S1 does not reach it: `Release event forward` and getShootingState are
   unchanged. The component is started by the HLS's own component bring-up, of which the factory is a part; that
   bring-up is the part of the boot chain the lab skips (item 11).

34. **The movie time left (X, fixed).** The `[00:00]` at the top of the shooting screen is the GUI's own call of
   getMovieCountdownTime (`0x50ae29c5`, HLS vtable slot 200, from `0x511f16f4`; the GUI stores hours, minutes and
   seconds at +480 of its object and redraws through `0x511fc783`). Its time left is the first output of
   `0x503f3cf5`, which reads the 24-byte reply of the module query `0x5042da58`: +0 (or +4, by a flag) the time left
   in ms, +12 the recording's time in ms, rounded up to seconds; +16 and +20 are the time code `0x503f3e4e` reads
   (item 31's +16). Item 31's getTime (`0x50add9c5`) is the application's media-full check, not the display. With the
   reply filled (forced to 3723 s first, the screen showed a white `[1:02:03]`), S-CARD now answers the query: an
   hour less the time recorded so far, so the screen shows `[1:00:00]` and `[59:57]` after a 3.5 s recording.
35. **The recording display, continued (X, D).** During a recording the GUI draws nothing: in 2.5 s after REC its
   draw log has one clearing rectangle per plane, three full-plane copies and timer messages (518), no text or
   bitmap. Reporting a shooting phase of 106, 107 or 108 from `0x50ab57e9` once the recording has started (a probe
   hook) changes nothing (OSD1 still goes off); reported before REC, the application refuses the recording. So the
   REC mark and the recording time are not the GUI's on CPU 1. OSD_DRAW_CPU2 (item 32) reads its commands from queue
   `0x2013` (the halfword at `0x60043698`, read by its loop through `0x5002c067`); in 2 s of a stood-in recording CPU 1
   writes nothing to it (OlyQeWr went to queues 6 and `0x88` only), so what would make it draw is ? as well. A
   module notification the lab does not send (the movie module's own start of recording) is as likely (I).
36. **OXF start of the shooting component (X).** OMReactive's vtable (`0x60ef9654`) has startBehavior at slot 9
   (`0x50d9bf67`: rootState_entDef through slot 32, then the start event embedded at +24 of the reactive, id -5),
   setThread at slot 21 and handleEvent at slot 30 (consuming the -5 event). Cmp_ShootingComponent overrides
   startBehavior (`0x50d7143f`) and setThread (`0x50d715ce`, which passes the thread to its parts at +112, +308,
   +1224, +3304, +7288). Called by hand after the singleton is built, startBehavior returns 1 and changes nothing
   seen: the sequence object of item 32 (`0x62b20960`, CmpShc_ShootingSequenceBase, already flagged started) stays
   in its state 3 (idle; state 4 is the running sequence whose controller at +2784 gives phases up to 118), the TRA
   dispatcher's handler list stays empty and no task is added. The sequence leaves state 3 on HLS events (415, 423,
   786, 1082, ...) that the component's TRA handlers would send it. The component manager
   (Cmp_ComponentManagerWithBoot, its startTransition `0x50c2f2fd` and capability start) is never reached in a
   camapp session.

37. **A lens (X, S-LENS).** getLensConnection (HLS vtable slot 98 of the camera-common object, `0x50afef0c` ->
   `0x504106f8`) is 1 when lens 0's record exists: `0x502ac58c` returns the pointer at `0xa32caa8c` when the attach
   flag byte `0xa32d4b9a` (read by `0x50126a20`, written by `0x50126a14`) is 1. Both are 0 in the lab, so the
   application shows MF. S-LENS sets the flag and points the record at a zeroed 4 KiB block before CA_MAIN starts:
   the screen shows S-AF and the AF target, and the aperture reads F1.0 (from the zeros; the record's layout is ?).
   Superseded by item 60: the record is now a filled 12-40 record at the driver's own static address.
38. **The focus confirmation (X, D).** After END_FOCUS the application's handler (`0x5105260a`) leaves the GUI the
   focus icon state STATE_CHANGE_FOCUS_ICON (171) with 2 (the GUI's live-view handler `0x511e7799` takes it as message
   `0x971e`: 1 confirm (with a 500 ms timer), 3 and 4 icons, 2 none). It leaves 1 only when the HLS AF information
   (`0x50b502f8` -> `0x50ad8b37`) says +12 = 1 and +16 = 1. In the lab that call fails (`0xf0000058`) because the
   module-ready bit 0 of `0x62a3f148` is 0 (`0x506d96df(13)`); with it set, +12 follows the AF result word
   `0x62af6e28` (copied by `0x50ab5576`; the CapTak component holds the pointer to that block, `0x50bc68f3`), and +16
   comes from the AF module's own state (`0x50413486` -> `0x509b06f6`: the byte `0xa33d955c` and the structure at
   `*0xa33d9560`, its "afstatus"). The module and the component do not run in the lab, so all three are stood in or
   none: forcing the GUI's parameter to 1, 3 or 4 by hand drew nothing either, so what else the drawing needs is ?.
   Injecting the TRA notifications 1323 / 1321 (item 30) in place of S-RELSEQ's callbacks changes none of this.

39. **The HLS components run (X, S-BOOTDONE).** Every HLS reactive (the shooting reactive, Cab_CameraBase, the
   components) has the thread object `0x62b24f14` at +100, the OXF main thread; its event loop OMThread::execute
   (`0x50d9cb90`) runs in the static task 57 HIGHLEVEL_MAIN (`0x50ab2293`), which the lab never started: events sent
   to these reactives (OMReactive::send -> the thread's queue, `0x50d9c456`) were queued and never handled (task 163,
   `0x50d9b388`, is the OXF timer thread: a 100-tick timed wait, then the timer manager `0x50d9af04`). With task 57
   started (S-CAMAPP), the chain of item 36 runs natively once two events arrive. Cab_CameraBase (vtable
   `0x60ef0b88`, state at +256, dispatchEvent `0x50d744fc`) waits in state 3 for event 415 (the class with vtable
   `0x60dca154`; isTypeOf compares class ids, so an event is an object of its class, not an id at +4 alone), then
   enters state 5 and sends itself 285, reaching state 11, where 420 (vtable `0x60dca2bc`; OlyHfwOpeComRsbChangeMode
   makes it for the mode 0x10000, `0x50ac7c56`) makes it leave standby for shootModeState: it creates ModSht_ShootMode
   (`0x50d96019`), which creates CtgStl_StillImageShooting (`0x50d97078`, vtable `0x60ef81d0`), which waits in its state
   3 for 415 as well, then creates Cmp_ShootingComponent and starts the components (Cmp_ComponentManagerWithBoot's
   startTransition runs 7 times). Who sends 415 on the camera (the capabilities' start once the modules report ready)
   is not served in the lab: S-BOOTDONE dispatches 415 to each of the two in state 3 and 420 once to the camera base
   in state 11. Running, the component makes the shooting sequence object of item 32 leave its idle state (state 4,
   phase 101), and posts remote calls to CPU 3 through the display API (`0x503e8bff` -> `0x50035b28`, function
   `0x5002587a`), which S-CPU3 takes off the ring. The constructor's sub-CPU status read (`0x5012b8b7`) returns 0.
   S1, S2 and REC still go through S-RELSEQ's callbacks; the REC mark (item 35) and the focus confirmation (item 38)
   are unchanged: the AF information call still fails on the module-ready bit, and nothing is drawn while recording.
   (Item 40: the components are opt-in, control camapp 2.)

40. **The components and the screen (X, D).** With the components running (control camapp 2) the GUI's live-view
   app gets STATE_CHANGE_MODE_UPDATE (CA 0x14b -> GUI message `0x940d`, six times in the bring-up), its rec info
   reads disp_shooting 1 (and dust_reduction 0, against 0 and 1 without the components), and the shooting screen
   becomes the shooting panel over a black image area (Rec_Info_Viewer disp_type 0 where it is 1 otherwise; the
   decision is at `0x511eb485`, from field +24 of the rec info the app copies at `0x511e7967`). It is not the
   shooting phase: the component's sequence sets phase 101 at its STANDBY entry (`0x50c89d9f`), and reporting 100
   from `0x50ab57e9` leaves the panel; nor the remote calls to CPU 3, which only set an event flag there (bit 0x40
   of flag `0x600436cc` after an ASIC register write, `0x5002588e`). What sets disp_shooting is ?. So the components
   are off by default (camapp 1) and run with camapp 2. With them running, standing in for the module data the
   focus check needs (the ready bit 0 of `0x62a3f148`, the AF result word `0x62af6e28` set from END_FOCUS, and the AF
   status query `0x50ac3fb9` answering 1) makes the application's getCondition give isFocus 1 and indicator 1 and
   the GUI receive focus icon state 1; nothing is drawn for it in the panel.

41. **Long timers (X, S-LONGTIMER).** disp_shooting is the application's "show the shooting information for 3 s"
   state (its handler `0x51084c7e` sets it to 1 at 0x51084e9f on the mode update, and starts its timer 3 for
   3000 ms through the HLS timer service, callback `0x510860bb`, which posts 0x03000057 and clears it). Timer 3 never
   ran out: the HLS timer service (`0x50ab8d1b`) runs timers under 1000 ms itself, and hands longer ones (its timers
   1..16 as 0x03010030..0x0301003f) to the system timer module through api_system.c (`0x5041fd71`: number, ms; 0 ms
   stops), which publishes event 0x03010000 | number when one runs out. That module does not run in the lab, so no
   application timer of a second or more (timers 1, 3, 4: 3000, 3000, 1000 ms) ever ran out, in camapp 1 as well.
   Publishing 0x03010032 through `0x50025095` clears disp_shooting; S-LONGTIMER does it when the lab time is due.
   With the components running, the shooting screen then comes back after the next mode update (a mode-dial move),
   not by itself after the power-on one (the GUI evaluates the new rec info, disp_type 1, and does not redraw the
   image area: why is ?). With the AF stand-ins of item 40 the GUI gets focus icon state 1 and draws nothing, also
   with a focus position filled in the AF block (count `0x62af6d18` = 1, a rectangle at `0x62af6d20`); the recording
   draws nothing either. That the AF frame and the recording mark are drawn by OSD_DRAW_CPU2 (item 35) would fit
   both, but no post to its queue was seen (I).

42. **Not OSD_DRAW_CPU2 (X).** OSD_DRAW_CPU2's queue (`0x2013`, the halfword at `0x60043698`) is written only by
   `0x51014a5d` (a synchronous send, `0x5002e39d`), reached from the HLS OSD control (API 0x11117,
   OSDControl::drawHistogram, `0x50ae9f8b` -> `0x510149a2`): the histogram. Corrected 2026-10-22 (X): the send does
   run, at idle, S1 and S2, after each TRA 944 (getHistogramData); the log shows queue 8211 (`0x2013`), command 1,
   from `0x51014a64`. It never reaches cpu_conn, because S-MODACK answers every synchronous send whose receiver does
   not run with E_OK (D), so no inter-core traffic shows: the histogram is a CPU 2 consumer answered by that blanket
   rule, not a listed site. While recording (camapp 1) the GUI's draw log has the three
   layer clears (layer 1 index 255 with one column of 125, layer 2 index 31) and their copies to OSD2 / OSD3 only;
   GESetEvent sets 0x1002 about every 70 ms and the dispatch observer sees none taken, while the GUI task waits in
   SystemCommon::scOsWaitEvent (API 0x11026, `0x50b01ac7` from `0x50b81c7b`) and returns from it about 30 times a
   second. What the GUI's recording display waits for is ?.

43. **The application's requests to the components (X).** S1 reaches the HLS natively: the event manager (task 166)
   receives 0x02000100 / 0x02010100 and Com_EvSenderManager forwards them (`0x50af926e`, "Release event forward"),
   but the component does nothing with them: at S1 and REC the application makes no TRA request; it relies on what it
   asked for at its start (TRA 598, 614, 990 startShootingService, 958, ...), which S-TRAACK answers 0 without
   delivering. Run natively, a TRA exec (`0x50af7cb9`) sends through OlyHfwReceiverSubstance (`0x62441a20`, its
   vt[41] `0x50af8487`), which the menu lab's own stand-in S-RPC (menu.mjs RPC_ENTRIES) answers 0 without sending,
   so every request came back with the receiver's status 0xf0000001. With S-RPC off as well (components running, the
   receiver started), the State Mediator (`0x60361994`) routes them and 598 and 614 complete natively (status 0);
   990 startShootingService is sent and never answered, so the application stays in it and the display is never set
   up. The still-shooting category is created only after the application's requests (two seconds of lab time before
   CA_MAIN create nothing past the camera base's state 13), and the component's answer to 990 waits on the modules
   (their notifications are not served: S-MODACK answers requests only). That is the module boundary of item 39's
   next steps, now the one blocker for the native S1 / REC path. In that run the HLS log (observed at `0x50ab23ef`)
   shows the main thread serving 598 and 614 ("TRA REQ ... >> [0x256]", "[0x266]", their responses), mounting both
   card slots natively through CapMed (mount status 8), and Shooting::startShootingService(0xb); 990 itself never
   shows a "TRA REQ" line: the State Mediator (`0x50d81c97`) hands it to its current state object (vt[1]) and nothing
   serves it, while the application's sub-task 167 (entry `0x5108ba1b`) waits for the response in the receiver's
   1000-tick loop (`0x50af8563`) and task 57 waits on an empty queue. Which state object should take 990 at that point
   is ?. The Mediator's target is the deepest active state (`0x50d817db`, +148 down the chain): ModSht_ShootMode
   (state 13) for 598, 614 and 990 alike. Creating the still-shooting category before CA_MAIN through ModSht's
   factory (`0x50d9609b`, id 1) and giving it 415 brings it to state 11 and the component up before the application
   starts, but ModSht's active child stays unset (the factory call bypasses its transition), 990 still ends at ModSht
   and is never answered; 415 to ModSht in its state 13 is ignored. Without the pre-creation, tracing the components'
   handleEvent (`0x50d7fcb9`) shows 990 does go in: ModSht -> CtgStl -> Cmp_ShootingComponent and a dozen of its
   parts (the sequence object, controllers) run on it once S-BOOTDONE's 415 lets the category start; none answers the
   request. The module requests made meanwhile (synchronous sends to queue 94, commands 13, 18, 29, 22; queue 207
   command 8 repeatedly) are answered E_OK by S-MODACK and no module notification follows, which is the likely wait (I).
   Corrected 2026-10-23 (D, hle-gaps.md 4.1.2): the object that takes 990 is the shooting component. The hashed
   dispatcher of CmpSht_ShootingComponent_NEW (`0x50d725f0`, ids 414..1492, the one a camapp 2 session runs, X) answers
   990 at once at case `0x50d72a2d` through Com_ResponserUnit (`0x50d7f197`) and only then sets the service up, and 991
   at case `0x50d72eb5` before it starts or stops the through capability; "the component's answer to 990 waits on the
   modules" is withdrawn. Why that run saw no answer is ?.

44. **What the recording asks the HLS (X).** During a camapp 1 recording the application and GUI call (by the HLS API
   name lookup `0x50abc82f`) getSettingDetail, getFlashInfo, getAfAreaType, getModeDialState, getRecViewState (30..26
   times in 2.5 s), Shooting::getMovieState (19), getShootingState, getCondition, CameraCommon::setDispSync and others.
   getMovieState (`0x50adae0f`) is 1 when the shooting phase (`0x50ab57e9`) is 113..116, the movie phases (item 30's
   106..108 are not them). Reporting 113, 114, 115 or 116 from the phase once the recording has started changes
   nothing on screen either. The GUI asks for display sync (setDispSync) at the recording start and its event filter
   then draws on sync updates (guiEventFilter::check_Sync_Osd_update, events 0x900c / 0x900d); which display-side
   event drives those, and whether its absence is why nothing is drawn, is ? (I). The module side of item 43 is the
   capture module TAKE (queue 0x5e TAKE_FUNC): of the 69 module event publishes in the image it makes only 0x04020215
   and 0x040800f0, so its results reach the HLS through the callbacks the HLS registers with it, not module events (I).

45. **The sync OSD update (X).** The GUI's event filter (`0x5124d3bc`, a hashed table at `0x6159ca14` keyed by
   event - 36867) sends GUI event 0xa401 to guiEventFilter::check_Sync_Osd_update (`0x5124e2c9`). Posting 0xa401
   through GESetEvent (`0x510ba2c2`, d0 0, the 8-word event on the stack) every 100 ms during a camapp 1 recording
   makes the GUI redraw once per event (16 times: three full-layer clears, layer 0 index 127, layer 1 index 255,
   layer 2 index 31, their copies to the display buffers, gpiUpdateDisplay), and still draw nothing between the
   clears and the copies, also with the shooting phase reported as 107 or 114. The S-DISPQ stand-in's swallowing of
   DISPLAY replies to queue 6 is not involved: no asynchronous DISPLAY request is made in camapp mode. So the sync
   update is not what is missing; what the recording display's items wait for is ?. During the recording the GUI's
   live-view rec info reads record_movie 2 (offset +12 of the application's rec info, getRecInfo `0x51085db9` copying
   +4..+208 of the application object) and tft_display 0; writing record_movie 0, 1 or 3 there before each 0xa401
   changes nothing drawn.

46. **The recording display (X, S-RELSEQ).** The application takes an HLS callback only through its translation
   table (`0x5108226d`: category 33, CBC_SHOOTING_COMMON; a hashed table at `0x613062e0` keyed by the id less 2, each
   entry jumping to a case that posts the application event 0x03000000 | n, whose names are the CBK_ list from
   `0x6130f858`). UPDATE_RECORDING_TIME (234), which S-RELSEQ posted every second, is not in it: the application
   dropped it. The movie entries are START_READY_MOVIE (205), END_READY_MOVIE (206), START_RECORDING_MOVIE (216),
   END_RECORDING_MOVIE (217), START_SHOOTING_MOVIE (92 -> CBK 31), UPDATE_SHOOTING_TIME (108 -> CBK 32) and
   STOP_SHOOTING_MOVIE (97 -> CBK 33). Without START_SHOOTING_MOVIE the GUI's rec info reads record_movie 2 and its
   recording screen (it switches itself to screen 11, GUI event 0x1100) draws nothing (items 35, 45); posted before
   START_RECORDING_MOVIE (or before the ready pair), record_movie reads 1 and the GUI draws its movie recording screen:
   the card, the time left, the movie P mode, shutter and aperture, and the ISO and its value blinking (drawn and
   cleared about twice a second; with the lab's zero exposure data, a warning, I). S-RELSEQ now posts START_READY_MOVIE,
   END_READY_MOVIE, START_SHOOTING_MOVIE, START_RECORDING_MOVIE, UPDATE_SHOOTING_TIME(seconds) every second, and at the
   end STOP_SHOOTING_MOVIE, END_RECORDING_MOVIE; the order is a guess from the names (I). The application handles
   UPDATE_SHOOTING_TIME (its rec info handler `0x51084c7e` runs) and sends the GUI nothing for it. During the
   recording the GUI's time part (`0x511f161f`) reads getMovieCountdownTime 17 times and stores the time left at +480
   of its object as it falls (1:00:00, 0:59:59, 0:59:58), but every redraw, also a full one forced with 0xa401, still
   draws `[1:00:00]`; after the recording it shows `[59:58]`. The value is overwritten right after: `0x511f172e`
   (when the display pattern at +6244 is in its table or +6264 is set) asks Shooting::getMovieState (API 0x201a3,
   HLS vtable slot 145) and, at 1, stores the two times of getMovieCountdownTime at +480 (time left) and +484 (the
   recording's time); at 0 (the lab: the phase is not 113..116) it copies back the GUI database's item 28
   (`0x51090e89`), so the shown time stays as it was. The live-view app then compares the 28 bytes at +480 with its
   copy (`0x511eac6b`) and, when they differ, sets database item 28 (`0x51090ea1` -> `0x51091013`, the database at
   `*0x60366f28`, 16-byte entries: +4 setter, +8 data), which marks the item dirty in each listener's bitmap (+16;
   two listeners, `0x62b81ce4` and `0x62b832e4`, vtable `0x6132318c`, `0x51091629`) and posts GUI event 0x1900.
   Reporting the phase as 114 while recording makes item 28 follow the recording (0:59:55 with 0:00:06, 0:59:54 with
   0:00:07, ...), and still nothing is redrawn: no draw in the top row in 5 s of recording, and a forced full redraw
   draws `[1:00:00]` again. The database's dirty test (`0x5109168c`) and clear (`0x510916c2`, `0x510916fa`) never run
   in the session. GUI event 0x1900 is handled at `0x510a271b`: it commits the listener's pending bits to its current
   bitmap (`0x51091551`, +16 to +12), sends 0x1902 to the screen root `0x62b80e24` (vtable `0x613392fc`, slot 102,
   `0x510e80cc`) and 0x1901 to each of the root's children, of which there are none, at power-on as well; the
   current-bitmap test (`0x5109151b`) never runs either. Item 28 holds 0:59:56 and 0:00:04 after 4 s of recording
   (read back with `0x51090e89`), so the part keeps the text it took when the screen was laid out, and the time left
   changes only when the GUI goes back to screen 10. Posting the mode update 0x940d during the recording changes
   nothing. Who updates a laid-out part from the database is ?. There is no REC mark and no recording time on the screen:
   which part draws them, and what it waits for, is ?. Reporting the shooting phase as 107 or 114 while
   recording (getShootingState then answers 1) changes nothing. The application's GUI notifications during the
   recording are its timer (0xb0) only (GuiCallerImp::GESetEvent, `0x5115b96b` / `0x5115b9c1`, the CA state id at
   (a2)).

47. **The REC mark and the recording time (X, S-RELSEQ, S-GUIOUT).** Two things kept them off the screen.
   The phase: getMovieState (item 44) is 1 only at shooting phases 113..115, and with no sequence controller in
   camapp 1 the phase query (`0x50ab57e9`, the controller at `*0x6035f024`) answers 100. The shooting component's
   sequence (CmpSqp_SequencePartsBase, phase setter `0x50cc6121`) enters 113 at `0x50c87a17` (MOV_READY, I),
   114 MOV_READY_FINISH (`0x50c87bf7`), 115 MOV_RECORDING (`0x50c87c86`), 116 MOV_SELFTIMER_WAIT and 117 MOV_END
   (its log names). S-RELSEQ now answers those phases with the movie callbacks (113 at START_READY_MOVIE, 114 at
   END_READY_MOVIE, 115 from START_SHOOTING_MOVIE, 117 at STOP_SHOOTING_MOVIE, its own phase again after
   END_RECORDING_MOVIE). The GUI then lays out its recording screen with the REC mark: an orange dot, `REC` and the
   recording's time, from the controller `0x62bc71a4` (vtable `0x61438044`, string ids 4446, 4454, 149, 3955; its
   database-change handler is vtable slot 100, `0x5114f4e3`). Reported only from the start of the recording, as
   before, the mark is not laid out: the screen switch (GUI event 0x1100, screen 11) happens with the first callbacks.
   The time: the mark showed `00:00` and the time left stayed. The GUI's database item 28 (item 46) does follow the
   recording, but a part updates only on a database change event 0x1902/0x1901 down its root's tree, and the shown
   display's root never got one. Every database listener (one per GUI root, `0x510910e1`) posts event 0x1900 to its
   root through GESetEvent with the unique flag, and GESetEvent (`0x510ba2c2`) drops an event whose id is already
   in its queue (`0x510ba39d`, 500 entries of 32 bytes, the id at +4); the lab's GUI has two roots, `0x62b80e24`
   (output 0 at +44, window 0x10006, an empty current screen) and `0x62b82424` (output 2, TFT, window 0x10106, the
   shown one), in that order in the database's listener list (`*0x60366f28` +16), so every 0x1900 for the TFT root
   was dropped (both posts come from the GUI task 170, so no task switch takes the first one off the queue in
   between). With the 0x1900 for the root of output 0 not posted (S-GUIOUT, camapp mode only), the TFT root gets its
   database changes and the screen shows `REC 00:04` and `[59:57]` after four seconds, counting each second, and the
   idle shooting screen gains items it never updated before (the image stabiliser, white balance, the aspect ratio).
   Why a camera's GUI would not have the root of output 0 listening is ? (I: it would be removed, or never created,
   when no output uses it). The 0x1900 handler (`0x510a271b`) also returns early when its window's child list is
   empty (`0x510a2772`), skipping the 0x1901 to the current screen; the root of output 0 has an empty one.

48. **The focus confirmation, continued (X, D).** With S-GUIOUT the GUI's database changes reach the shown root,
   and the focus chain of items 38 and 40 can be followed into the GUI. The live-view app takes message 0x971e
   (`0x511e77fa`): state 1 sets its focus flag (+172 of the app, `0x511e780f`) and posts 0x971d after 500 ms, which
   clears it again (`0x511e77f3`, unless setting 569 is 2); 3 and 4 set the focus icon byte of database item 32. The
   AF frame's update (in the function around `0x511f2cd6`, run on every rec-info update, about every 120-220 ms)
   reads the flag and leaves early unless the rec info it is given (`0x62469348`, filled by the HLS AF information
   call `0x50b502f8` at `0x511ea40c`) has +160 = 1 and the halfword at +56 non-zero. That halfword is the number of
   AF points of the CapTak AF result block (`0x62af6d18`, copied by `0x50ab5576` with the 16 points of 16 bytes at
   `0x62af6d20`, the result word `0x62af6e28` and the words at `0x62af6e20..2c`), 0 in the lab. With the AF stand-ins
   of item 40 and the count set to 1 the update reaches the focus branch (`0x511f31da`): it then chooses the frame's
   colour from `*0x62c97950` in place of its normal one (`0x511f31fd`) only when the GUI setting 25 (read at
   `0x511f2bfe`) is 1 or 4; in the lab it is 0, and both colours are index 15. Nothing changes on screen. What setting
   25 is, which AF points and states a camera's AF module writes, and whether the confirmation is this colour or a
   separate mark, are ?. Forcing the GUI's focus icon state to 3 or 4 (the icon byte of item 32) changes nothing on
   screen either: the draw log of the half press is identical to the one at state 2, although eight parts read
   item 32 after the change. Rec_Info_Viewer::Focus (`0x511ed4f0`, the movie screen's) maps the AF mode to its
   label (S-AF) and is not the confirmation. The names CTRL_AFMARK, draw_afmark and display_frame_ctrl_af_focus_mark
   belong to the GUI OSD library's debug shell (`0x510105c0`, a mask byte `0x62b26420`), not to a path the
   application takes. With the AF stand-ins, an AF point count of 1, setting 25 forced to 1 and the focus colour
   `*0x62c97950` forced to 3, the AF frame is not even redrawn at the half press (it is without the stand-ins).

49. **Who draws the focus confirmation (X, D): CPU 3's DISP_FRAME.** On the still live-view screen the GUI draws
   the AF target's corners only; the confirmation is the AF module's. Its OSD part (`0x508c8xxx`, log names
   osd:set_af_status, osd:set_indicator_on, osd:set_superimpose_frame_info, osd:upload_af_info; `0x60a1e99f..`)
   sets the indicator byte (`*0xa33b25b8`: 1 or 9 by the AF status at `*0xa33b25b0`, `0x508c9238`), and
   upload_af_info (`0x508c8554`) hands it with the frames to `0x500257ce`: that logs the request in the frame
   control's debug ring (`0x50025e4c` -> `0x51010e56`, enabled by `0xa33eb4c0`, which the boot sequence sets at
   `0x501ea067` -> `0x5100d04a`; the names CTRL_TYPE, UP_AF, draw_afmark, ... at `0x50344834` are this log's), copies
   the frames to shared memory (`0xa320901e`, count at `0xa320b106`, the indicator at `0xa3209011`) as the flag
   byte `0xa3209010` allows, and wakes flag 0x3001 (`0x5002588e`). The task woken is DISP_FRAME (id 0x300d, entry
   `0x5100d05a`, on CPU 3: om1-cores-spec), which loads three frame bitmaps (resources 12417, 61473, 35185), waits on
   the flag (`0x5100d153`), and draws through the display controller (`0x5100d1b8`, `0x501c3b1e`, `0x501c453b`). The
   lab has no CPU 3 and the AF module does not run, so neither side happens. Called by hand at the end of focusing,
   the upload writes nothing (the flag byte is 0: DISP_FRAME sets its configuration at its own start,
   `0x50025e20(5, ..)`), and one draw of DISP_FRAME stops at the lab's cache-flush guard (K-CFLUSH, `0x5100d2a7`).
   The GUI's own focus paths (items 38, 48) stay as they are: the frame colour at setting 25 in 1 or 4, the AF
   points at setting 682 = 1, both 0 by the firmware's defaults (refs/settings), and Rec_Continuous_Shooting_Viewer's
   Focus_Mark for the continuous-shooting screen only. A focus confirmation drawn natively needs CPU 3's DISP_FRAME
   (its task, flag and display-controller frame layer) in the lab, and the AF module's data for it: not done.

50. **The focus confirmation drawn (X, S-DISPFRAME, S-TAKEFRAME, S-AFOSD, A19).** Item 49's CPU 3 side runs on the lab
   CPU (same image). DISP_FRAME's loop (`0x5100d0a5..0x5100d150`) takes the flag bits, keeps the mode bits of
   `0xa3209010` less the mask byte of `0xa3209012` as pending (`0x62f4fe57`), asks the display state (`0x5100dfbc`) and
   erases (`0x5100d19e`) or draws (`0x5100d1b8` -> `0x5100df9c` -> `0x5100d99e`): it draws the buffer it filled on the
   turn before (two buffers of 12788 bytes at `0x62f4fe6c`) and fills the other, the indicator only when the display
   channel's frame-state byte (`0xa32ddaf4` + channel; the TFT's is +2) is 0 (`0x501c441d` -> `0x501dccfc`; the display
   setup writes 0 when its configuration word is 0xFACE, `0x501da477`, else 1, which the lab's TFT bring-up left) and
   the lens state (`0x502a9b68`, `0x50127ba2`) lacks bit 0x20, i.e. the lens-ready byte `0xa32d4b94` is 1. The frames
   come from shared memory: per frame centre x, centre y, width, height (`0x5100d8aa`, converted by `0x50025c79`), drawn
   in colour 6; the indicator kind is a setting (`0x5100d469`), its value the upload's. It draws with its own routines
   (`0x51016a41`, `0x51016d11`, ...) into its 8-bit plane, which it shows as the TFT's IMG3: format 2, PLANC 0x1000,
   900 x 600 at 98, 8, stride 1024, DMAEN bit 3 (the face-frame plane of om1-vsc-spec). Its colours are the eight words
   at +0xD00 (Cr Cb Y), which the display setup converts from DISP_FRAME's colour table (`0x501db1b4`, `0x51016e3e`;
   black, black, grey 102, grey 170, 254, 255, green 0,255,0, orange 255,105,0); the lab's TFT bring-up wrote them while
   the table was still zero (all 0x808000). The CPU 1 side: the frame display mode (`0x500256d9`, 4 = frames and
   indicator, from the TAKE module's `0x5039f583`, which maps its request bits 1, 2, 4, 8|16, 32, 128 to the mode) and the
   AF module's upload (`0x500257ce`, upload_af_info `0x508c8554`; the indicator byte is 1 or 9 by the AF status,
   `0x508c9238`). Each post reaches CPU 3 as a remote call of `0x5002587a` on ring [3][0] with the flag bits as argument
   (S-CPU3's posts, item 39, were these). The stand-ins: S-DISPFRAME (DISP_FRAME's start: colour table `0x51016eb1`,
   bitmaps 12417, 61473, 35185; the TFT face colours from the table; the TFT frame-state byte 0; a turn of the loop per
   drained post; the cache-flush stand-in K-CFLUSH lets its flush at `0x5100d2a7` through), S-TAKEFRAME (mode 4 after
   CA_MAIN starts), S-AFOSD (at END_FOCUS in focus: indicator 1 and one frame at 400, 300, 60 x 60, the AF target;
   not in focus: indicator 9, no frame; at the S1 release: none), S-LENS's lens-ready byte, and the VSC model's opt-in
   A19 (IMG3 format 2: 8-bit indices, 0 transparent, 1..7 the words at +0xD00), on for the TFT in camapp mode. A half
   press now shows a green frame on the AF target and the green focus mark at the lower left; the release clears them.
   What the TAKE module asks for in S-AF, the AF module's frame coordinates (chosen so the drawn frame lies on the GUI's AF
   target corners, 417..483 x 265..335), the indicator value for no focus and the display setup with 0xFACE are
   inferences (I). The pixels are the firmware's: the stand-ins give DISP_FRAME the inputs the TAKE and AF modules and the
   display setup would (the lab runs no module), and DISP_FRAME's own code draws them.

51. **The full press shows the capture (X, S-RECVIEW).** At S2 down the application's release runs on S-RELSEQ's
   callbacks; the GUI clears its information for the capture and the rec view (START_RECVIEW .. END_RECVIEW, 500 ms)
   and then brings it back. The camera would show the developed image in the rec view through its playback path; the
   lab develops nothing, so S-RECVIEW (camapp mode, with S-SCENE's live view) holds S-SCENE's frame rendered at the
   capture (the exposure in use, the focus of the half press) on the live-view plane from START_RECVIEW to END_RECVIEW,
   then the live scene runs on (I: the camera's rec view shows the developed image, scaled to the screen, on the same
   plane). With the moving preset the rec view stays on the captured frame while the scene moves, and the live view
   after it shows the scene moved on; the AF frame and focus mark of item 50 stay on during the rec view (whether the AF
   module clears them at the release is ?).
52. **OK, MENU and PLAY with the application running (X, D).** Three refusals the lab raised, none a firmware fault.
   OK: the application's Super Control Panel request makes the GUI post to CPU 2 while bank 3 still lists a doorbell
   S-CPU3 had already served (DISP_FRAME's flag), and S-CPU2 accepted only a post with no other bank set since its last
   one; bank 3 is S-CPU3's in camapp mode, so S-CPU2 now leaves it out. MENU closing: the application saves the
   settings store (`0x503f019d` -> `0x500421cd`, which copies a dirty store to the next flash slot, K-CFLUSH, then
   programs the flash controller `0x98d01800`); S-SETSAVE returns 0 there, the value of the path for a store that is
   not dirty, as S-FLASHSAVE does for the DB init (settings spec). PLAY: playback's entry writes the VSC's HILIGHT1 with
   highlight and zebra off, and the composite refused any write of that register, so the screen stayed on the last
   good frame; vsc spec A20 (opt-in, on in camapp mode) accepts the value 0 (D). Playback then shows No Picture (S-CARD has no files).
53. **The EVF switch with the application running (X, open).** The lab's live switch (S-OUTSEQ, H-CONNECT 131 with
   lOutput 7) is the stand-in for the application's request; with the application running, the GUI's notification
   of the change reaches it, its getOutputDisplay (`0x5104fd44`) still answers the TFT (2) against the current 6, and
   it sends 131 with lOutput 2 (`0x5105053c`, from `0x5104fb9b`), which the GUI notifies again: the two alternate until
   the step's budget runs out. The eye-state setter `0x50050efd(2)` publishes EV_EYESENSOR_STATUS (`0x02022301`, param
   2) to the application natively, whose eye query (HLS operation 65844 -> `0x504251a5` -> the getter `0x50050e5a`)
   then answers "eye at the finder"; getOutputDisplay's INTERNAL_EVF branch (-10, `0x5104fee9`) needs
   `0x510517a1(monitor position)` = 1, and the position the lab's switches give (4, `0x510516d7` from the three flags of
   `0x51051493`'s HFW query: the UI_IN switch codes `0x2402`, `0x2403`, `0x2401`) refuses it. In camapp mode the lab's
   switch therefore keeps its DISPLAY OPEN, H-RESEND, H-EYESTATE and H-CONNECT but drops S-OUTSEQ's end and re-entry
   requests (the application, told of the change, ends and re-enters the screen itself: shooting, menu, Super Control
   Panel, direct WB and playback land where they were), and S-OUTDISP answers getOutputDisplay with 6 (INTERNAL_EVF)
   while the EVF is open (I). Which monitor position the camera reports in normal use, and so whether its eye sensor
   switches on its own here, is open.
54. **The menu stops the through image (D, S-THROUGH).** As the menu opens the application calls
   OlyHfwOpeShoot::ctrlAutoThrough (`0x50abd373`) with 0 and as it closes with 1 (its own log). S-SCENE's frames
   followed neither, so the menu stood over the live scene; S-THROUGH stops them and shows black meanwhile (I: what the
   camera's live-view plane shows while the through image is stopped).
55. **The TFT layout at the application's start (X, S-ROOTLAYOUT).** The GUI's WinMain runs for every GUI root it
   creates and sets the root's layout with SetLayoutMode(1) (`0x510c2db4`, from `0x510c29cf`), which applies a mode
   (vt+252 `0x510a27c9`, the root's +82, which picks the widgets' 800- or 900-wide rects) only when the global byte
   `0x60368ba4` changes. The lab's bring-up creates root `0x62b80e24` first (layout 1, output 0); the application's
   start (131 lOutput 2, then 183 EVT_REFRESH_PANEL, both from the application, X) brings up a second root
   `0x62b82424` for the TFT, whose WinMain call found the byte at 1 already and left it at layout 0: the shooting
   information was laid out 800 wide on the 900-wide screen until an EVF round trip changed the byte. S-ROOTLAYOUT
   lets that WinMain call apply. Without the application the lab's stand-in showed the screens on the first root, so
   the case never arose. That the camera creates no root before the TFT's is the inference S-GUIOUT rests on (I).
   Also fixed: S-MODACK hooked OlyQeWr in place of S-DISPQ's hook, so in camapp mode the display manager's DISPLAY
   requests were queued instead of run at once; it now wraps S-DISPQ.
56. **The EVF with the application running (X, open).** After a switch to the EVF the shooting information is not
   repainted (only items the application updates later appear), and the EVF channel's OSD1 (the unscaled 1600 x 1200
   plane that carries the EVF's bottom bar in the stand-in's sessions) is switched on and off from one frame to the
   next: the DMA enable (`+0x060`, written at `0x501dfb0f`) is computed from the display state's buffer address per
   plane (`0x501e236a..`: a plane whose address is 0 stays off), and OSD1's address alternates with 0 across the
   double buffer. In the stand-in's sessions the TFT root is `0x62b80e24` and a second root has output 1 (the EVF);
   with the application the TFT root is `0x62b82424`, `0x62b80e24` keeps output 0 and no root has output 1. Next:
   why the application's start brings up a new root instead of the first one, and which root and buffers the EVF's
   OSD1 needs.
57. **The lab's stand-in for the application removed (2026-10-15).** Every play session now runs the camera
   application from its bring-up; S-CAMSEQ (the start request 125 and Q1-Q4), S-KEYMAP (EV name -> GUI index), S-OUTSEQ
   (the display switch's end and re-entry requests), the request input and the page's Camera requests tab are gone, and
   so are the lab's play check (which checked those stand-ins) and
   `camapp-probe.mjs`. The control op `camapp` now only chooses whether a new session runs the HLS components (2). A
   long press is the key held: the application decides it (the `long` action that posted the GUI's LONG_ON index is
   refused). The application's start needs A15: its live-view setup leaves CTRL3 at 0x41.

58. **Pictures on the card played back (X, S-CARD, S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW).** S-CARD keeps each picture
   taken (END_SHOOTING_PICTURE) as an image of folder 100, numbered from 1, with S-SCENE's scene and exposure at the
   capture; the media API's image count (`0x503feea4`, slot and type; getImageCount `0x503d2230` sums it over the types
   1, 2, 3, 5, 9, 8, 14) answers their number for type 1, and the remaining shots go down. With a count, PLAY takes the
   GUI to SS_PLAY_SINGLE/ID_ST_PREPARE (`0x0501`), whose FSM row (descriptor `0x6157bc1c`, handlers read through
   `0x510bb960`) takes only EVT_GUI_END_PLAY_SINGLE_READY (`0x9a00`), EVT_GUI_PLAY_ERROR, EVT_GUI_END_GENIFA_DRAW and
   EVT_START_SLOT_SWITCH. The GUI's callback handlers post `0x9a00` for CBC_PLAY_COMMON (23) / CBS_END (17)
   (`0x5123bd97`) and EVT_GUI_END_PLAY_SINGLE_DISPLAY (`0x9a01`, what ID_ST_DRAWING waits for) for
   CBC_PLAY_SINGLE_FRAME (27) / CBS_FINISH_DRAW (39) (`0x5123bdd2`). Those come from the play module: each HLS play
   request is an RSB (OlyHfwOpePlyComAsyncRsb, execute `0x50ad26fb`) whose request block (+236) holds the request's id,
   the notify function `0x50ad2bc2` and the RSB; the module calls the notify with (a0 data, a1 RSB, d0, d1 kind):
   kind 1 is the synchronous answer (its result word to `*(RSB+244)`, the data copied to the waiting result's buffer
   through `0x60360c64`), any other kind calls the RSB's callback (+228, this at +224) with d0 and d1. With kind 2,
   d0 is the finished request's id: PlyCom's callback (`0x50aceb5f`) posts CBS_END for 0 (startPlayService; 301 is
   erase), the single-frame one's (`0x50b7118d`) CBS_FINISH_DRAW for 8 (startSingleFrame) and 9 (moveCurrent). S-PLAYSEQ
   finishes every asynchronous request that way after the step, and writes the module's synchronous answers while
   the transaction runs (S-TRAACK): canMoveCurrent (PlyComSyncRsb id 344, set at `0x50ad4166`; the response block
   `*0x60360c88`, +8 can move, +16 page change) and moveCurrent's move result (+4 of its data). The single move's
   state `0x60362a7c` (set to 1 by moveCurrent through the hook `0x50ce4c65` registered at `0x50ce46f6`; while it is not 0 the next move is refused) is cleared
   when the move completes, as the play single component's start_single_move_current does (`0x50c299f6`).
   The GUI then asks the play component (Cmp_PlayComponentBase) for the image: OlyHfwOpePlyCom's wrappers
   (`0x50acf156`..`0x50acf356`) find it through the camera base's current mode (`0x50d7570b`), which only the HLS
   components create (without them the lookup reads a null pointer and the CPU traps at `0x8940`). S-PLAYCOMP answers
   them: getNumber (index, file number, folder: the screen's 100-0002), getStillInfo (the component's vt+240: the
   struct's fields at the offsets OlyHfwOpePlyCom's dump at `0x50acd02d` prints, found by filling it with a pattern;
   the exposure time, f-number and bias as rationals and the ISO show as 1/1045 F2.8 ISO200), the type, protect and
   recording 0. The GUI shows ID_ST_DISP_SIMPLE (`0x0508`), INFO ID_ST_DISP_DETAIL (`0x050b`), left and right move with
   the wrap-around (direction 3 left, 4 right; the hook `0x50ce4c7e` maps them to 2 and 1), and PLAY or S1
   ends the play service (PlyComSyncRsb id 1) and returns to shooting. S-PLAYVIEW shows the image on the live-view
   plane, rendered again from the scene the image kept (the camera decodes the file onto its image plane, I).
   S-RELSEQ now runs only while the shooting service runs (startShootingService `0x50ae1124`, endShootingService
   `0x50ad7e8a`): S1 in playback only takes the application back. After an image was shown, DISP_FRAME's next draw
   waits for the frame plane's buffer swap (`0x5100d398`: the VSC write register `0x9bb80390 + 0x8000 * ch` against its
   mirror `+0x2000`, `0x501e2062`) with OlyTaSS(1); on the lab task that sleep never woke, so S-DISPFRAME runs those
   sleeps on the display clock and the VSC latches the address at a frame boundary. Not modelled: the file module's
   picture database (getReserveWifiTransfer's lookups through `0x50874bc9` log 0x10009005, index 0 of 0 entries, for
   each image shown), the image's date (no clock), the index, zoom and histogram views.

59. **One GUI: the EVF's information and bottom bar (X, H-GUIBYAPP; items 47, 55 and 56 resolved).** The GUI
   creator (`0x5108bc37`) is called from CA_MAIN's code (`0x510609ce`, at the application's start), and the lab's
   bring-up called it too: every play session ran two GUIs, each with a GUI task (entry `0x5115ba0c`) and a genifa
   timer task. The lab's idle one kept root `0x62b80e24` (output 0) and, from the OSD drawing registry
   (`0x62b26528`, two buffer descriptors per OSD layer, in-use byte at +6), one of OSD layer 1's two buffers, so the
   application's root got layer 1 for one side of its double buffer only: the GUI's free-slot search (`0x510123db`)
   logged 0x1700000d (layer 1, no free slot) and the HLS canvas's buffer triple for that side
   (`0x50ae8990`: the layer descriptors at +28, +32, +36 of the buffer context) had 0 in the middle, which the display
   API (`0x503e4dd5` -> `0x507f4899`, then DISPLAY cmd 17 `0x507f66ca`) turned into OSD1's address 0 and its DMA enable
   off (`0x501da763`, `0x501e236a`). On the TFT the layer is not shown; on the EVF it carries the shooting
   information and the bottom bar, which were missing in every other frame. H-GUIBYAPP: in a play session the lab's
   bring-up leaves the creation to the application and takes the GUI task and the OSD records after it
   (`gui_adopt`); both buffer sets then hold all three layers and the EVF shows the information in every frame (the
   frames differ only where the ISO value blinks). With one GUI the database changes reach the shown root and WinMain's
   layout call applies, so S-GUIOUT and S-ROOTLAYOUT (items 47, 55) are gone; for an EVF start the application sends
   its own 131 with lOutput 7 (S-OUTDISP), so the lab's H-CONNECT at the start is gone too. S1 on the EVF failed in the
   composite before (the face-frame plane on channel 1 is shown 1600 x 1200 from DISP_FRAME's 800-wide buffer: RSZ1
   `0x11`, steps `0x800`): A19 is on for both channels, with nearest-neighbour scaling (vsc spec), and S-DISPFRAME
   sets the face-plane colours of both.

Next steps, in order: why startShootingService's TRA 990 went unanswered in the native run (item 43; the shooting component answers it, hle-gaps.md 4.1.2); whether a camera's GUI holds a root for output 0 (item 47); the AF module's frames and the TAKE module's frame mode in place of S-AFOSD and S-TAKEFRAME (item 50); what the GUI's recording display waits for (item 42); why the GUI keeps the power-on panel (item 41); the module notifications at their own boundary (the HLS event manager, task 166 `0x50abbf0c`,
receives module event codes through `0x50abc393`, and the TRA notifications reach the components) in place of
S-RELSEQ's callbacks, now that the components that take them run; the module-ready bits (`0x62a3f148`) the modules
would set; the REC mark (item 35) and the lens record's layout (item 37).
60. **A real lens and the camera's own exposure plan (X, S-LENS, S-EXPOSE; item 37 superseded).** The lens driver's
   init (`0x502ac2ce`) points `0xa32caa8c` at the static record `0xa3193780` and keeps three current copies
   (`0x502ac60b`: 0 STATE `0xa32ca5f4` = record +4, 1 CHARACTER `0xa32caa38` = +1096, 2 the zoom entry `0xa32caa7c`
   = +1164), committed by `0x502ac838` (STATE) and `0x502acb96`. The record dump (`0x50118662`, `0x50118ab7`,
   `0x50118d20`) names the fields: STATE +0 L_STATUS_M, +4 L_ZMENC (the zoom step), +12 L_APACTnow; CHARACTER +0
   L_REF_M, +4 L_ID[6], +10 L_NAME[32], +42 L_ZMENCdiv (the number of zoom entries), +48 L_FLwide, +50 L_FLtele, +64
   L_VERSION; zoom entries of 16 bytes: L_FLenc, L_APmin, L_APmax, L_APACTmin, L_APACTmax, L_AFjdg, L_LDmaxmin.
   Apertures are APEX x 256 (F = 2^(Av / 512), `0x5057379f`); focal lengths are mm, and the driver's derived values
   (`0x50129a3e`, `0x50129980`, `0x501299a2`) store twice them, the 35 mm equivalents (`0xa32d4bb0` wide, `0xa32d4bb4`
   tele, `0xa32d4bb8` now). The record accessor `0x502ac5ce` also needs the data-valid byte `0xa32d4b98`. S-LENS
   fills a 12-40mm F2.8 PRO this way (values I: eight zoom steps 12..40 mm, F2.8 to F22); the derived apertures and
   focal lengths come out as the driver computes them (24 / 80 mm equivalents). The exposure plan,
   take_expose_calculate (`0x50597e82`), reads the scene's brightness from the AE result data objects `0xc12a`,
   `0xc0ba`, `0xc0ca` (its work struct, `0x50598688`; `0x505613ea` picks one by the metering mode, `0xc0ba` in the
   default ESP), which TAKE_EXPOSE's command handler `0x50596187` writes; the BV pair `0x62abd8a8/aa` is only carried
   through. BV is APEX x 256 and the plan keeps Tv + Av - Sv = BV, Sv = log2(ISO / 3.125) x 256, so BV = (EV100 - 5)
   x 256. The plan lands at `0x62a919dc` (+6 Tv, +10 Sv, +14 Av) and in the display properties: with no BV set (0)
   it showed 1/60 F2.8 ISO 1600, shutter and aperture blinking (I: the ISO-auto ceiling's warning); for EV 12 it shows 1/250 F5.6 ISO 200. S-EXPOSE
   sets the three objects through the setter `0x5004188b` and runs the plan natively once the application has started
   and after each input on the shooting screen; S-SCENE's auto exposure is the plan. Open: which task sends
   `0x50596187` on the camera (the LV AE task fed from the 18 x 18 grids is the likely one, not traced); what fixes
   the ISO-auto range (base 200, ceiling 1600 in the lab); whether `0xc12a` and `0xc0ca` are the other metering modes'.
