> Status (2026-10): implemented by `emu/src/dev/vsc.mjs` and `vsccompose.mjs` (model), `emu/src/dev/stub.mjs`
> (panel-side stand-in), `emu/src/dev/bus.mjs` (DMA bus space and CPU bus window, M7), `emu/src/lab/display.mjs`
> (harness) and checked by `emu/checks/check_display.mjs` and `emu/checks/check_liveview.mjs` (live view, M7).
> Consolidated from three analysis reports that are not part of this repository (VSC
> register sweep, display-flow trace, output geometry) plus what the implementation found
> (section 9). Every register write listed as "firmware" below was produced by firmware code
> running in the lab; the sweep checked 16 setter families against these formulas in 1,292
> random cases per seed (two seeds).

# OM-1 VSC display compositor: register spec and lab model

Firmware = E143 v1.9 main block. Code addresses are disassembly notation (body offset +
0x50000000); data and MMIO addresses are literal. Tags: **H** executed in the lab or an
unambiguous code fact; **M** several code facts agree; **A** model assumption (section 7);
**?** unknown.

## 1. Address map and channels

| Range | Content | Tag |
|---|---|---|
| `0x9BB80000 + c*0x8000`, c = 0..2 | channel registers, offsets = name table at body `0x331da0` (503 entries `{u32 name*, u32 word index}`) | H |
| `+0x2000` in a channel | mirror bank, same layout; firmware only reads it | H (layout), M (meaning, 5.1) |
| `+0x4400..+0x5BFF` | OSD palettes: sel 0..2 x bank 0..1 x 256 words (writer `0x501e055b`) | H |
| `+0x5C00..+0x65FC` (channel 2) | three 128-word tables from `0x501e0695` (`(hi & 0x3FF) << 16 \| (lo & 0x3FF)`, floats clamped to 1023.0); `GAM1` is read just before; probably gamma (?) | H (writes) |
| `0x9BB98000` | output block, name table at body `0x332d60` (115 entries: OUT_CTRLn, OUT_SETn_m, MPTX_SET, VSCSIO_*, WDMA_*, VWD_*) | H (names) |
| `0x9BB9C000..` | output-block SRAM, EVF serial engine entries written by `0x501e3b80` | H (writes), M (role) |

All VSC accesses on the recorded TFT, EVF and switch paths are 32-bit (21,251 of 21,251).

DMA addresses are bus addresses. The memory manager hands out bank bases as `dma_addr` (constructors `0x50533d1e`, `0x50535769`; handle -> address `0x50534dd1`), and the firmware writes them into the DMA registers with no arithmetic but `>> 4` (`0x501e20c6`, `0x501e2122`); its only translation runs the other way, bus -> CPU, through a 128 MiB window at CPU `0xB8000000` whose segment is byte 3 of `0x98100058` (`0x50036da4` stores `0x00161514 | (bus >> 27) << 24` at `0x500370b2` and returns `0xB8000000 | (bus & 0x07FFFFFF)` at `0x500370c7..ca`; `0x50036d95` stores `0x17161514` back). The firmware also compares VSC register read-backs directly with bank bus addresses (`0x501e118e` -> `0x501e1162` on the static table `0x602c2d61`). The lab therefore gives the VSC and the OSD engine their own AddressSpace `om1.bus` (A16) and models the window (A17):

| Bus / CPU range | Lab | Evidence |
|---|---|---|
| bus `0xA0000000 .. + ram_size` | alias of lab DRAM at offset 0: the CPU's uncached view is the bus | window bytes 0..2 = `14 15 16` and restore byte 3 = `0x17` are the segment numbers of CPU `0xA0`/`0xA8`/`0xB0`/`0xB8` (I); `0x5004e839` returns 0 for `0xA0000000..0xB7FFFFFF` and its caller `0x50524457` then uses the bus address as the CPU address (`0x50524462..68`); every DMA address seen in the labs lies here (X) |
| bus `0x95F6C000..0xA0000000` (`om1.lv-banks-a`) | RAM | live-view banks 0x0e (`0x95f6c800`, 2 x `0x16f0800`), 0x0a and 0x18 (`0x98d4d800`, 5 x `0x16f0800`), table `0x602c2d61`; rounded out to 4 KiB (the `0x800` below the base is lab slack) |
| bus `0xEE087000..0xF533A000` (`om1.lv-banks-b`) | RAM | bank 0x75 (`0xee087500`, 5 x `0x16f0800`, constructor immediate `0x50535788`); rounded out to 4 KiB |
| any other bus address | unassigned: a VSC or engine span not inside one backed range is `DMA_RANGE` | the CPU's cached view `0x6xxxxxxx` is not a bus address (on the bus that range holds banks 0x5f/0x60/0x69/0x6a); no executed path used it (all checks unchanged with it removed) |
| CPU `0x98100000..0x98100FFF` | register page; only `0x58` modelled, 32-bit, bytes 0..2 must be `14 15 16`, reset `0x17161514`; any other offset or width faults | `0x50036da4`, `0x50036d95`; `0x9810004c` and the per-core copies used by `0x5004e839` stay unmodelled (that function is not run) |
| CPU `0xB8000000..0xBFFFFFFF` | alias of `om1.bus` at `(byte 3) << 27`, re-pointed on every store; an unbacked segment faults | `0x50036da4` return value |

Which physical memory backs the two bank ranges on the camera is ?; the lab needs only that the VSC and the window see the same bytes.

Channel by device mask, `0x501df74b` (table `0x603507e0` = `{0xFF000004, 2, 1}`): `& 0xFF000004`
-> 0, `& 2` -> 1, `& 1` -> 2. Mask 1 = rear TFT (geometry `0x501d8a97`, touch panel I2C slave 0x70
woken, MIPI TX traffic), 2 = built-in EVF (geometry `0x50023b87`, LVDS TX writes, `[EVF]` strings),
4 / `0xNN000004` = HDMI/video (format index in bits 24..31). The debug command at
`0x501cef3e..7f` maps the words `tft`/`evf`/`hdmi` to 1/2/4. Output routing: device open calls
`0x501e1897(d0 = channel, d1 = selector)` (`0x501d9a23..2b`) with the selector from `0x501df784(mask)`:
mask 4 (HDMI) -> 1, 2 (EVF) -> 4, 1 (TFT) -> 5 (`0x501df786..9d`). `0x501e1897` accepts 1..9 and jumps
through table `0x602c2e2c`: 1 -> OUT_CTRL1 (`0x9BB98400`, whole word), 2/3 -> OUT_CTRL2 [1:0]/[5:4],
4 -> OUT_CTRL3 (whole word), 5/6 -> OUT_CTRL4 [1:0]/[5:4], 7/8 -> OUT_CTRL5 [1:0]/[5:4], 9 -> OUT_CTRL6,
each storing the channel number. So EVF channel 1 -> OUT_CTRL3 and TFT channel 2 -> OUT_CTRL4[1:0]; all
three lab sessions end with OUT_CTRL3 = 1, OUT_CTRL4 = 2. What a selector or field drives physically
is ?.

## 2. Output timing

| Register | Field | Meaning | Tag |
|---|---|---|---|
| SYNC6 `0x738` | [11:0] / [25:16] | htotal / hsync width (pixels) | H (CEA timings of all 46 HDMI modes match) |
| SYNC2 `0x728` | [14:0] | vtotal of the frame or field 1 | H |
| SYNC3 `0x72C` | [4:0] | vsync width (lines) | H |
| SYNC4 / SYNC5 | as SYNC2 / SYNC3 | second field; 0 = progressive | M |
| SYNC1 `0x720` | bit 24 | 1 progressive, 0 field mode (`0x501dff54`; when 0 the IMGn/OSDn AREA setters write AREA2 = `(y / 2 + vs) << 16 \| h / 2` and AREA3 = `y / 2 + vs` (`0x501dfd65..96`, `0x501dfe0b..27`, `0x501dfeb4..e3`, `0x501dff33..4f`) and the VIDEOAREA setter `0x501dfbf2` writes VIDEOAREA2 = `vstart << 16 \| height / 2` (`0x501dfc18..39`) and HDMI1 = `(height / 2) << 16 \| vstart << 8 \| vstart` (`0x501dfc6b..8b`; progressive `height << 16 \| vstart`, `0x501dfc8f..9e`; HDMI2 = `width << 16 \| hstart` in both, `0x501dfca0..b3`; the frame-rate setter's constants agree: `0x02582929` two-field `0x501e2a98..a4`, `0x04B00030` progressive `0x501e2b58..64`): the request's y and height are halved, the porch vs and vstart are not) | H |
| VIDEOAREA1 `0x420` | `hstart << 16 \| width` | active window, hstart = hsync + back porch | H |
| VIDEOAREA2 `0x424` | `vstart << 16 \| height` | | H |
| MONI3 `0xE80` | [14:0], bit 16 | line counter; bit 16 selects the SYNC2 (1) or SYNC4 (0) mirror in `0x501e2181` | H (use), A3/A4 (behaviour) |

Panels (device-table getters, 59.94 Hz): TFT hstart 98 (hsync 4), vstart 8 (vsync 4), 900 x 600,
1300 x 770 (`0x501d8a97`, `0x501d8aba`, `0x501d8b2a`); EVF 48 (16), 41 (5), 1600 x 1200,
1884 x 1315 (`0x50023b87`, `0x50023bab`, `0x50023c53`). Frame period words: TFT `0xa32db47c`
(getter `0x501d8c12`), EVF `0xa32db428` (`0x50023ce3`), microseconds, one of 16683 / 20000 /
10000 / 8341; the display task init `0x501c2f13` sets both to 16683 in the lab. EVF at 10000 and
8341 is a two-field scan (`0x501e298b(1, ..)`: SYNC1 bit 24 = 0, SYNC2 = 657, SYNC4 = 658).

## 3. Planes

DMAEN `0x060`: bit 5..0 = IMG1, IMG2, IMG3, OSD1, OSD2, OSD3 (commit `0x501e227b`, dump labels
`0x501ce708..0x501ce9c4`), H.

| Field | IMG1 / IMG2 / IMG3 | OSD1 / OSD2 / OSD3 |
|---|---|---|
| DMASADR (byte address >> 4) | `0x390/0x394/0x398` | `0x39C/0x3A0/0x3A4` |
| DMALD [14:3] = stride / 128 | `0x3A8/..` | `0x3B4/..` |
| DMABN [n:3] = bursts per line | `0x3C0/..` | `0x3CC/..` |
| DMASPOS field k = bits 8k..8k+6 (start inside the first burst, in pixels) | `0x3D8` | `0x3DC` |
| FMT [3:0] | `0x400/0x404/0x408` | OSDFMT1 `0x40C` (= 0x111), OSDFMT2 `0x410` (= 0x11); see below |
| AREA1 / AREA2 (`x << 16 \| w`, `y << 16 \| h`, output coordinates incl. porch) | `0x42C + 12n` | `0x450 + 12n` |
| RSZ1..5 (IMG1) / RSZ1..6 | `0x4F0` / `0x504` / `0x51C` | `0x534 + 0x18n` |
| PLANC [8:1] | `0x620 + 4n` | `0x62C + 4n` |

- OSD: 8-bit palette index; `OSDnDMALD = (stride / 128) << 3` (`0x501e0005`), `OSDnDMABN =
  ceil(width / 128) << 3` (`0x501e00d0`), `+1` raw when the line straddles one more burst
  (`0x501e021c..2f`, meaning ?). Full setup `0x501e0e4c(d0 = ch, d1 = plane, a0 = {&stride,
  &width, &{x, y}, -, -, base})`: address `base + stride*y + x`, DMASPOS field = address & 127.
- OSDFMT1/OSDFMT2: the only writer found, `0x501e04e7(d0 = ch, d1 = n)` (one direct call in the image,
  `0x501d9942`, with n = 128), stores OSDRESO = 0, OSDFMT1 = 0x111, OSDFMT2 = 0x11, OSDMIX =
  0x111111; then, if n == 128, keeps OSDFMT1 = 0x111, else clears `OSDFMT1 & 0x777` and writes
  OSDCP2 = 0 (`0x501e0519..3a`). So the three 3-bit OSDFMT1 fields change together with the
  palette double buffer, and 128 equals the entry count of the palette upload loops
  (`0x501dc54b`, `0x501dc651`, `0x501dc753`): OSDFMT1 is an OSD pixel/palette mode (M), not a
  mixing register. The meaning of the values and the field -> plane mapping are ?; the model
  draws OSD planes only at 0x111 / 0x11 (section 7).
- IMG formats (`0x501e1e95`, names from dump `0x501cf852`): 0 YC, 1 YC/YP, 2 OSD, 3 R8G8B8a8,
  4 R8G8B8X8, 5 R5G5B5a1, 6 R5G5B5X1, 7 R4G4B4a4, 8 R4G4B4X4, 9 R5G6B5; the setter also sets
  PLANC bit 12 for 2/3/5/7. Pixels per 128 bytes from `0x501e2d3b` (format 0: 64, i.e. 2 B/px).
  Format 0 byte order Y0 Cb Y1 Cr (M: graphics library fill for buffer format 0xC02,
  `0x50490c73..a4`).
- RSZ1 bit 0 / bit 4 = horizontal / vertical scaling; RSZ2 / RSZ4 = source step per output
  pixel in 1/4096. OSD: equal sizes clear the bit, else `4*ceil((src-1)*1024/dst)` (`0x501df9dc`,
  `0x501dfa65`). IMG fit `0x501df31a`: `RSZ2 = ((src_w << 12) - 0x1001) / (out_w - 1)`, `RSZ4 =
  (((src_h - 1) << 10) / out_h) * 4`, doubled again on channel 2 (`0x501df498..a1`); RSZ3/5 = 0.
  Channel 2's IMG1 vertical unit is 1/8192 (assumption A12, M: device-open default `RSZ1 =
  0x10, RSZ4 = 0x2000` at 1:1 `0x501d96a0..b8`, the doubled write, and `0x501e2484` halving RSZ4
  when copying IMG1 to IMG2 on channel 2 and clearing IMG2's vertical bit when IMG1RSZ4 = 0x2000,
  `0x501e2505..66`; the generic vertical setter `0x501e1013` likewise writes 0x2000 at 1:1,
  `0x501e107f`, and doubles its step only for channel 2 IMG1, `0x501e10f8..0x501e1102`). Every TFT
  IMG row depends on it, and check_display uses the same constant, so the check cannot catch it if
  it is wrong.
- Generic IMG scaler setters `0x501e0ef5` (horizontal, `d0 = ch, d1 = plane, a0 = S`, source/dest
  `u16` pointers at S+4/S+12) and `0x501e1013` (vertical, `d0 = ch, d1 = plane, a0 = &src, a1 = &dst`,
  heights at +2). 19 display-task call sites, 10 horizontal and 9 vertical (`0x501d93f2/93ff`,
  `0x501db00e..0x501dbd2c`; live view and playback, not run here); they come in pairs except the
  horizontal call at `0x501dbaf4`, which is followed by `0x501dca34` and has no vertical partner.
  Equal sizes: the horizontal setter clears RSZ1 bit 0 (`0x501e0f49..5f`); the vertical one clears
  bit 4 (`0x501e1099`) except for plane 0 on channel 2, where it sets bit 4 and writes RSZ4 = 0x2000
  (`0x501e1058..84`, A12). Horizontal: `src < dst` with
  `src*4096 % dst == 0` -> `src*4096/dst` (`0x501e0f83..a3`), else `((src << 12) - 0x1001)/(dst - 1)`;
  it then adds 8 to IMGnDMABN when the words at S+20 and S+8 are non-zero and
  `(2*src + word(S+20)) & 127 == 0` (`0x501e0fc4..0x501e100f`). On the live-view path S is the per-channel
  pointer block `0xa32dda00 + 32*ch` built by `0x501dc1d6`: S+4/S+12 point to from_target/to_target, S+8 to
  from_coordinate (so the S+8 test is a non-NULL pointer test) and S+20 holds the source start address
  including the crop (`0x501db936..3c` adds the crop offset in place). The extra burst therefore appears
  exactly when scaling horizontally from a 128-byte aligned line end; read as "the scaler fetches past the
  last source pixel when it scales" (I), the tap weight there is ?.
  Vertical: exact upscale `src*4096/dst` (`0x501e10b7..c0`), else `ceil((src-1)*4096/dst)`
  (`0x501e10c2..e0`), the OSD form. With the exact-upscale step the last output column/row has
  `floor(pos) = src - 1` and a non-zero second-tap weight on source pixel `src`, outside the source;
  the vertical else-branch can do the same. Only `0x501df31a`'s steps provably keep `floor(pos) + 1`
  inside the source (section 7, A6).
- IMG stride setter `0x501dffae(d0 = ch, d1 = stride in pixels, a0 = plane, a1 = format)` writes
  IMGnDMALD (words 234..236) through the pixels-per-burst getter `0x501e2d3b` (executed: 11136 px ->
  IMG1DMALD `0x570`). The IMG1 source address changes without any RSZ write through `0x501e20c6`
  (IMG1DMASADR, DMAEN bit 5) and the commit `0x501e227b` (section 5.1); the double-buffer bookkeeping
  `0x501e1116` writes no register, it compares written and mirror IMG1DMASADR and keeps the next
  address in RAM (`0x501e1137..5d`). Hence the section 8 guard records the DMA geometry too.
- IMG fit (`0x501df59e`): source aspect code 4 3:4, 3 1:1, 0 4:3, 1 3:2, 5 256:135, other
  16:9, ranked 0, 1, 2, 3, 5, 4; display rank TFT 3, EVF 2. Source rank <= display rank ->
  height-fit (pillarbox), else width-fit (letterbox), centred. Executed: TFT 1620 x 1080 3:2 ->
  900 x 600 full; EVF -> 1600 x 1066 at y 67 (`IMG1AREA2 = 0x006c042a`, RSZ2/4 `0x1033/0x1030`).
  The same function writes `IMG1DMABN = ceil((src_w + crop_x % 64) / 64) << 3` (`0x501df3f0`)
  and `IMG1DMALD` from 5568 px (`0x501df418`). Its IMGDMASPOS write is not crop-derived: it
  reads channel 0's IMGDMASPOS (`0x501df41d` `mov 4,d0; call 0x501df74b` -> channel 0,
  `0x501df424` word 246 = `0x3D8` through `0x501e2cd3`), `& 127`, and passes it to
  `0x501e0137(ch, plane 0, fmt 0, v)`, which stores `(v mod pixels-per-burst(fmt)) & 126` (format
  0/1/11/12; format 2 stores 0; `0x501e0178..0x501e019b`, pixels per burst from `0x501e2d3b`)
  into the plane's 7-bit field (masks `0xFFFFFF80/0xFFFF80FF/0xFF80FFFF`, `0x501e014f..69`).
  Device OPEN writes word 246 only on the opened channel (`0x501d9693..99`), so on the TFT and
  EVF paths channel 0's IMGDMASPOS is never written and the IMG1 field 0 rests on an assumed
  reset value of 0 (visible only as the note `RESET_READ 0 IMGDMASPOS` in
  `check_display_notes.txt`).
- PLANC: IMG `0x501dfb32` / OSD `0x501dfb92` write `& ~0x1FF | (v & 0xFF) << 1`; device open passes 128 for every plane; the EVF transparency path `0x501e2bcb` writes `(v & 0xFF) << 1` alone (section 9.3). DISPLAY cmd 5 (section 10.7) and cmd 6 map the request's "img_trans" t to `128 - t`, and t >= 128 to 0 (`0x501da2e7..0x501da315`, `0x501db0f0..0x501db114`): PLANC 0 is transmittance 128 (A7). Bit 12 is set by the format setter for the per-pixel alpha formats 2, 3, 5 and 7 (`0x501e1e95`).
- Pixels per 128-byte burst, `0x501e2d3b(ch, format)` (jump table run-time `0x602c2e78`, executed for formats 0..15 in check_display group 13): 0 -> 64; 1, 2 -> 128; 3, 4 -> 32; 5..9 -> 64; 10 -> 32; 11 -> 48; 12 -> 96; 13 -> 32; 14 -> 64 when YCEXT1 (`+0xCC0`, read at `0x501e2d74`) is 0, else 72; 15 -> 0 (its entry jumps past the YCEXT1 read with d0 still 0); outside 0..15 -> 64.
- Registers outside the name table: `0x501e061a(ch, i, &value)` stores to `0x9BB80D00 + 0x8000 * ch + 4 * i` (`0x501e061a..2b`); its three callers `0x501d9494`, `0x501db234`, `0x501dbcdb` loop i = 0..7. The face-frame IMG3 setup `0x501dcb1a(mask)` (DISPLAY face control, called at `0x501c4381`) runs it: executed on the TFT it sets IMG3FMT 2, IMG3PLANC `0x1000`, IMG3DMALD and IMG3DMABN `0x40`, DMAEN `0x07` (IMG1 off, IMG3 not enabled) and CTRL3 `0x41`, and stores `0x808000` eight times at `+0xD00..+0xD1C` (check_display group 7b). The model stores that range (section 7); meaning ?.
- O1BC..O3BC `0x4D0..`, IMG2BC/IMG3BC `0x4C4/0x4C8`: bits 7..0 written by `0x501e19a8`, bit 8 by
  `0x501e1a57`; TFT and EVF open both leave `0x10F` in all five. Meaning ?.

## 4. Mixing, background, palettes

- MIXODR1 `0x618` is never written (no store by name or index); MIXODR2 `0x61C` = 8
  (`0x501e1945`), OSDMIX `0x638` = 0x111111, OSDRESO = 0 (`0x501e04e7`, which also writes
  OSDFMT1/2, section 3). The layer order
  encoding is not decodable from v1.9. GPISetOsdOrder `0x510bd77e` writes no MMIO.
- BG `0x63C` = `Cr << 16 | Cb << 8 | Y`, from RGB by `0x501de377` (`0x501de385..d8`):
  `Y = (19595R + 38470G + 7471B) >> 16`, `Cb = ((-11056R - 21712G + (B << 15)) >> 16) + 128`,
  `Cr = (((R << 15) - 27440G - 5328B) >> 16) + 128`. Device open sets RGB {11, 11, 11} ->
  `0x0080800B`.
- Palette word `tra << 24 | Cr << 16 | Cb << 8 | Y`, same integers, `tra = A >> 3` of the GUI
  ARGB. The upload `0x501dc449` sends 128 entries per plane from osddraw's arrays (inst 0:
  plane 1 `0x62B26DE1`, plane 2 `0x62B265E1`, plane 0 `0x62B275E1`). GPISetPalette `0x510bcb4f` fills
  an array only up to the per-layer bound `(0x613286d4)[layer]` = 256/256/64 (`add 0x613286d4` at
  `0x510bcb73`, compares at `0x510bcb7e` and `0x510bcbfa`), so plane 0 (GUI layer 2) holds 64 GUI
  entries; OSD3's upload entries 64..127 are array words GPISetPalette does not write (zero, so tra 0,
  in the lab; check_display compares the 64). GUI layer -> VSC palette sel by the table
  `0x602c20a4..ac` = {1, 0, 2}: sel 0 = OSD1 = GUI layer 0 (palette 62), sel 1 = OSD2 = layer 1
  (63), sel 2 = OSD3 = layer 2 (61).
- Writer bank: sel n tests OSDCP2 bit 4n; bit = 1 writes `0x4400 + 0x800n`, 0 writes
  `+0x400`. The commit toggles the bit after an upload (`0x501e2417..7f`).

## 5. Frame commit, mirror, interrupt

1. The commit `0x501e227b(d0 = ch, a0 = S)` writes only DMASADR, PLANC, DMAEN, OSDCP2 (and
   the DMA QoS registers through `0x501dfaf6 -> 0x501e2d86`); there is no "apply" strobe. S is
   the per-channel state `0xa32db480 + 3112*ch` (`0x501da7b9..7df`): `img[3]` at +0, `planc[3]`
   +12, `osd[3]` +24, `palflip[3]` +36. `img = 0` disables the plane, `0xFFFFFFFF` keeps IMG1/IMG3.
2. Mirror: `0x501e1116` flips the IMG1 double buffer only when `M.IMG1DMASADR == W`;
   `0x501ddfd0` (poll of the device-close loop `0x501c4c87`, 50 tries of a 10 ms sleep, then
   error `0x37003118` at `0x501c4ccd`) waits until the device table's vtotal equals the mirror
   vtotal read by `0x501e2181` (`M.SYNC2` if MONI3 bit 16, else `M.SYNC4`). Hence the hardware
   latches the written bank at a frame boundary (M), and MONI3 bit 16 must be 1 on a progressive
   panel (TFT SYNC4 = 0), else the poll could never succeed.
3. Interrupt: IRQ 46/48/50 for channel 0/1/2 (attach calls to `0x50053f76` at `0x501d90b6/c7/d8`, level 4; handlers
   `0x501dece7/f3/0x501ded00` -> `0x501de8df(ch)`). Status `0x501e049e` = INTST1 (`+0x10`) &
   INTEN1 (`+0x0C`). Bit 0: one-shot callback, frame counters, pending requests `(0xa32ddb88)`,
   `iOlyEvSt` of the channel's flag (ids at `0x6004305e/0x600430de/0x60043178`), clear with 1
   (`0x501e0403`). Bit 1 cleared with 2 (`0x501e048d`); its source is ?. The frame wait
   `0x501de78f(mask, clear)` enables bit 0 (clearing a stale status first, `0x501e038a`) and waits
   on the flag.
4. "Lines left" `0x501e215e` = mirror vtotal - MONI3[14:0]; below `0x501df0ca(mask)` the commit
   waits a frame first (`0x501da6c8..d1`), and logs `0x3700140a` if a boundary passed during the
   commit (`0x501da7e5..0x501da80d`).

## 6. Display flow (executed)

```
software-timer init 0x50058959 (boot step at 0x5002cd82; M8, every lab; hardware-timer init not run, section 8)
display task init 0x501c2f13 (SRAM init x3, IRQ attach 46/48/50, queue, period words = 16683)
disp_sync init 0x507f2fe0
DISPLAY task 0x501c3035, cmd 2 OPEN {u32 mask}: 0x501c3c1c -> 0x501c4a56 (close old sub device
   0x501c4c87, post DISPLAY_CHANGE 0x501c6d8c for it) -> 0x501c70e7 -> 0x501d90f9(mask): reset,
   0x501d94ed (timing, planes, MIXODR2), default palettes, geometry, canvas (TFT 900, EVF 800 x 600),
   BG; panel bring-up (TFT MIPI DCS loop 0x501d778f, EVF serial engine)
GPISetPalette 0x510bcb4f x3 -> osddraw arrays + dirty bytes 0x62b265d5 + 6*inst + 2*plane
gpiUpdateDisplay(0) 0x510bd4ee -> 0x50ae8827: dirty -> 0x503e52c7 -> DISPLAY cmd 4 {mask, u8[3]}
   -> 0x501dc449 -> 0x501e055b; planes -> 0x503e4dd5 -> disp_sync 0x507f30d7 .. 0x507f6683
   -> DISPLAY cmd 17 {mask, addr[3]} -> 0x501da699 -> 0x501e227b, two frame waits
switch (M8): cmd 2 OPEN of the other device; 0x503e52c7(kind, {1, 1, 1}) -> DISPLAY cmd 4 (H-RESEND, section 9.2);
   gpiUpdateDisplay; IMG attach
```

`gpiUpdateDisplay` reads the GUI buffer tables `0x62b3dfdc/e4/ec` (front/back VRAM records per GUI
layer; filled by GUI init on the camera, not run in the lab). Result on both panels:
OSD1 = `0xb7862000` (registry 2), OSD2 = `0xb7493000` (registry 4), OSD3 = `0xb7c31000`
(registry 0), DMALD 0x68 (1664 bytes), DMAEN 7, OSDCP2 0x111, PLANC 0x100.

## 7. Lab model (`emu/src/dev/vsc.mjs`)

Register file: exactly the offsets of the two name tables (the generated header `emu/checks/fixtures/om1-vsc-regs.h`, checked by `emu/checks/gen_vsc_regs.mjs --check`), plus the eight words `+0xD00..+0xD1C` the face path writes outside the table (section 3; stored and latched only, outside the generated header, and a written one is FEATURE_UNOBSERVED in a composite, A13), 32-bit only. Writes are stored with a written flag; a read of a never-written register returns 0 and is noted (reset values ?). INTST1 is write-1-to-clear; MONI3 is computed and read-only. At a channel's frame boundary every register except INTEN1/INTST1/MONI3 is copied into the mirror together with its written flag, then INTST1 bit 0 is set (also while masked). IRQ line = `(INTST1 & INTEN1 & 3) != 0`.

Clock: lab time in ns, moved only by the doorbell commands ADVANCE(dt) and RUN_TO_FRAME(ch). A
channel runs once the harness has set its line time and the firmware has written SYNC2[14:0];
boundaries are processed in time order across channels.

Compositor (COMPOSE(ch), mirror bank only; channels 1/2 with every A13 register in its observed state): window from VIDEOAREA1/2, BG fill, planes bottom to top in the configured order when their DMAEN bit is set (OSD planes only with OSDFMT1 = 0x111 and OSDFMT2 = 0x11); destination from AREA1/2 minus the window start; source `DMASADR << 4`, or under A18 `((DMASADR << 4) & ~127) + SPOS * Bpp`; stride `(DMALD >> 3) * 128`; steps from RSZ1/2/4. A plane with PLANC = 0 is not drawn (A7). OSD: `idx = byte[base + (j*sv / Uv)*stride + ((i*sh + 2048) >> 12)]` (columns rounded half up, rows floor: A6), displayed bank (A1), blend `(src*tra + dst*(31 - tra) + 15) // 31` per component. IMG format 0: per component `Y = b[2x]`, `Cb = b[4(x>>1)+1]`, `Cr = b[4(x>>1)+3]`; horizontal `(P(s)*(4096-f) + P(s+1)*f + 2048) >> 12` with `s = i*sh >> 12`, `f = i*sh & 4095`; then vertical with `g = j*sv % Uv`, `(top*(Uv-g) + bottom*g + Uv/2) // Uv`; opaque. Output u32 `Cr << 16 | Cb << 8 | Y`.

| Id | Assumption | Evidence | Trusted only when |
|---|---|---|---|
| A1 | OSDCP2 bit 4n = 1 displays `0x4800 + 0x800n`, 0 displays `0x4400 + 0x800n` | upload targets the bank the bit does not select, the commit then toggles the bit: a double buffer (M) | always |
| A2 | whole written bank latches at the boundary, before INTST bit 0 | no strobe on the commit path; `0x501e1116`, `0x501ddfd0` wait for mirror == written (M) | progressive |
| A3 | MONI3[14:0] counts lines up from 0 at the boundary | lines left = vtotal - MONI3 (M) | progressive |
| A4 | MONI3 bit 16 = 1 in field 1 and always in progressive scan | `0x501ddfd0` could not succeed on the TFT otherwise (M) | progressive |
| A5 | plane order bottom -> top IMG1, IMG2, IMG3, OSD1, OSD2, OSD3 (configurable) | which plane is on top: none (?). What v1.9 does with the order is settled (D/X, check_display group 13): it keeps it fixed. MIXODR2 has one writer call, `0x501e1945` at `0x501d98e8` with 8 (`mov 8,d1` at `0x501d98e6`); OSDMIX/OSDRESO come only from `0x501e04e7` (one call, `0x501d9942`, n = 128); GPISetOsdOrder `0x510bd77e` stores an order code at `0x62afcd80` ((2,1) -> 5, (0,1) -> 0, (1,2) -> 3, executed) and gpiUpdateDisplay then sends DISPLAY cmd 6, whose handler logs `0x37001406` (2, 3160, code) for any code != 255 (`0x501db4df..fa`) and writes no mixing register (the only register change is CTRL3 1 -> `0x41`) | MIXODR2/OSDMIX/OSDRESO at the v1.9 values, MIXODR1 never written (any store, 0 included, flags MIX_UNOBSERVED) |
| A6 | OSD nearest: output column i fetches source column `round_half_up(i * RSZ2 / 4096)`, row j fetches `floor(j * RSZ4 / 4096)`; IMG two-tap linear | OSD columns (M8, M): the DISPLAY driver's OSD right-edge pad `0x501db6d5(d0 = ch, d1 = buffer, a0 = plane)` (12 direct callers in the cmd 6 / cmd 17 / update paths, `0x501da548..0x501dbf58`) reads OSDnRSZ1/RSZ2/AREA1 (`0x501db6f6..0x501db758`); with RSZ1 bit 0 set it computes the last output pixel's source column with `0x501db824(RSZ2 >> 2, width)` = `((w - 1) * (RSZ2 >> 2)) / 1024`, +1 when the remainder is >= 512 (`0x501db824..0x501db83e`), i.e. rounded half up, and when the width word (u16 `0x62a3eb34 + 4 * plane`) is not above that column it copies the byte at row 0, column width - 1 into column width of every row (`0x501db7d8..0x501db7ef`, stride 1664, row count u16 `0x62a3eb36 + 4 * plane`; gated by flag bytes `0x62a3eb40 + 2 * plane` and a row-0 compare, `0x501db797..0x501db7b7`). The width word is not the GUI buffer's width. It has two writers: the OPEN loop stores one canvas width into all three planes' words (`0x501d99d6..0x501d99e8`), and the update stores the request's width when it differs (`0x501dc1ba`). On the first OPEN of a session two paths run that loop: the DISPLAY task for the opened device, which posts DISPLAY_CHANGE first (`0x501c7403`, called at `0x501c4aca`) and then sleeps in OlyTaSS(1) (dly_tsk, `0x501c7581`) before its stores, and the DISPLAY_CHANGE message for the other device, which stores without any RTOS service before it (observed at `0x501d99e4`). The lab runs that message synchronously after the OPEN step (a stand-in: ROADMAP "Open unknowns and assumptions", synchronous message delivery), so its width lands last: EVF session 800 then 900, TFT session 900 then 800. That order is the stand-in's. The DISPLAY task (static entry `0x5001868c`, id 0x36, priority 26) outranks DISPLAY_CHANGE (`0x50019048`, id 0x8f, priority 54), so on the camera the message runs during the DISPLAY task's sleep and the opened device's width most likely lands last (EVF session 800, TFT session 900); the lab does not model it. On a switch the message stores nothing and the DISPLAY task stores the new device's width, so switches end with that width in either order (observed: TFT -> EVF 800, EVF -> TFT 900). A floor sampler never reads that column; a two-tap filter would need it also when the fraction is below one half, which the rounded test does not cover. So the firmware expects nearest sampling rounded half up at the last column; the interior columns follow by the same rule (I). The model's rule equals `0x501db824` when RSZ2 is a multiple of 4, which is every value the OSD step setter writes (`asl2` at `0x501dfa51` in `0x501df9dc`); for a guest-stored RSZ2 with low bits set the firmware's `RSZ2 >> 2` drops them (w 1600, RSZ2 2051: firmware 800, model 801). Executed: on the EVF (width 1600, RSZ2 2048) `0x501db824` returns 800. In the lab a fresh EVF OPEN leaves the width words at 900, so the pad runs but copies nothing; with the words set to 800 after that OPEN (the order the priorities point to) the update stores no width and the pad copies column 800 of all three planes (check_display group 13 runs both and pins the store order). The pad copies whenever the word is 800: in the B2 EVF layout the first OPEN's update writes 800 and the pad copies column 800 of both buffers of every plane (check_nav group 7); a TFT -> EVF switch's OPEN writes 800 and the pad copies (group 8). In the lab's EVF-first session the words stay 900 and the pad copies only after a later TFT -> EVF switch (lab run, not a check); with the camera's likely order it copies from the first update. OSD rows: no code pads a row, so rows stay floor (L); the OSD step setter's form `4*ceil((src-1)*1024/dst)` (section 3) is what puts the EVF's last column at 799.5. For IMG only the fit `0x501df31a` keeps floor(pos)+1 inside the source, which only a two-tap filter needs; the generic setters `0x501e0ef5`/`0x501e1013` (section 3) do not, and their vertical else-branch is the OSD form, so the IMG filter is weakly supported (L) and what the hardware does when the second tap at the last column/row lies past the source (clamp, zero weight, next pixel) is ? | RSZ3/5/6 = 0; IMG steps written by a recorded attach (`0x501df31a` level 3, or the TH API `0x501c3f4d`, section 10) and every fetched tap inside the attached source (harness check IMG_EDGE_UNKNOWN, section 8): downscale, 1:1 and non-exact steps that stay inside; exact upscale and the vertical escape case are reported |
| A7 | blend linear in tra/31; PLANC 0x100 = plane fully applied; PLANC 0 = plane not drawn; IMG format 0 opaque | GUI alpha 255 -> 31 and 0 -> 0 must be opaque / transparent; live view also gets 128 (M endpoints, A between). PLANC 0: DISPLAY cmd 5/6 map the request's "img_trans" t to `128 - t` and t >= 128 to 0 (`0x501da2e7..0x501da315`, `0x501db0f0..0x501db114`), so 0 is transmittance 128 (I); executed in check_liveview G7 (cmd 5 {IMG1 trans 128} with the permit clear, then the update: IMG1PLANC 0). The blend curve and how PLANC scales tra are ? | PLANC = 0x100; PLANC = 0 (no other bit) skips the plane with the record PLANC_ZERO |
| A8 | format 0 bytes Y0 Cb Y1 Cr, full-range BT.601 | graphics library fill `0x50490c73..a4` (M) | format 0 |
| A9 | PNG = inverse full-range BT.601 (JFIF integers), no gamma | COLMAT never written on these paths; no YCbCr->RGB constant in VSC code (L) | PNG only |
| A10 | frame period from the firmware word; OlyTaSS argument in ms | getters (H); ms (I) | lab clock |
| A11 | BC registers at `0x10F` (TFT/EVF open value) do not change the mixer output | none: meaning ? | BC = 0x10F |
| A12 | channel 2 IMG1 vertical step (RSZ4, and Uv when RSZ1 bit 4 = 0) is in 1/8192; all other planes and channels 1/4096 | section 3: device-open 0x2000 at 1:1, the doubled writes in `0x501df31a` and `0x501e1013`, the IMG2 copy halving it (M). Device open writes RSZ1 `0x10` and RSZ4 `0x2000` on channel 2 only (`0x501d96a0..b8`, D). No path independent of these code facts exists in the lab: a photo is needed | channel 2 IMG1 |
| A13 | the registers the model does not read leave the mixer output unchanged in the state the v1.9 TFT/EVF paths leave them in: CTRL2 `0x1c0`, CTRL3 `1`, SRAM1/SRAM3 `0x4000`, VIDEOAREA3 `0x29` (EVF) / `8` (TFT), IMGnHDLY/OSDnHDLY `0x2e, 0x2e, 0x2e, 0x2e, 0x30, 0x32`, MIXHDLY `0x2e`, IMG1LPF and LPF3-6 `0x100`; the 245 registers those paths never write stay unwritten (class list below) | none: meanings ?; several have setters that clearly change the picture (HILIGHT1 bit 0 `0x501e1dd2`, zebra bits `0x330` of HILIGHT1 `0x501e1ba0..b1`/`0x501e1e57..64`, test patterns `0x501e375f` writing TEST1, the CMM enable `0x501e0e1f` writing CMMSET1 = `(old & 0x7FFFFEEF) \| en << 31 \| x << 8 \| en << 4`, run by the live-view setup `0x501dac92 -> 0x501dadc2 -> 0x501dc344 -> 0x501dc3e8` after the table setter `0x501e0804`, which writes CMMSET1, CMMSET2 and the 64 knee registers (section 11), and by the debug command `0x501c8e8d`). CTRL2/CTRL3 receive command-like stores. The A13 values themselves come from the device open `0x501d9e8a..0x501d9f55`, which stores through the generic register writer `0x501e2ce6(d0 = ch, d1 = word index, a0 = value)`, in order, CTRL2 = `0x400`, `0x140`, `0xC00`, `0x20`, CTRL3 = `0x20` (`0x501d9ed7`), CTRL2 = `0x1C0` (`0x501d9ee3..e8`), CTRL3 = 6, 8, 1 (`0x501d9f39`, `0x501d9f45`, `0x501d9f50`); executed (G8) on the opened channel and then on the other, after which `0x501da09a` resets the channel not opened (`0x501e02a1`, CTRL2 = 1) and stores its CTRL3 = `0x400` (`0x501da0ce..d4`); `0x501e04b7` is not called during OPEN. Elsewhere the reset path `0x501e02a1` stores CTRL3 = 14, later `0xC00`, then CTRL2 = 1; `0x501e0319` stores CTRL2 = 6, `0x501e0349` CTRL2 = 8; the frame-rate setter `0x501e298b` stores CTRL2 = 8 then 1 and CTRL3 = 1 then 8 back to back; the only read-modify-write is the OR of `0x501e04b7` (section 10.6). A "last stored value" of these two is therefore not a state in any known sense (I), see A15. HDLY differs by plane, so "pure latency compensation" is itself an assumption; OSD2/OSD3 get 0x30/0x32 only because `0x99800004` reads 0 from the lab stub (`0x501df827`) | exactly that state on channel 1 or 2 (FEATURE_UNOBSERVED otherwise, one error per register, composite skipped) |
| A14 | the composite is the mixer output before YGAIN, KNEE1-13, ROT1-4, RGBCNV, CRM1-7, GAM1/GAMTAEN and the table SRAM, YCCNV, SETUP, YCCLIP1, YCLPF | register order only: they follow BG/TEST1 (L) | always; their values are not checked (stored-only class). EVF writes non-identity KNEE3-13 and ROT1-4 (e.g. ROT1 `0x07f7fd04`, KNEE4 `0x08020100`) while TFT's are identity-like, so evf.png can differ from the panel image by more than A9. The never-written blocks above `0x6E4` (YCCLIP2/3, ZEBRA, 8MSK, CMM, NV*, YCEXT) are in the unwritten class instead: whether they act before or after the mixer is ? |
| A15 (opt-in) | CTRL3 = `0x41`, as left by the live-view setup (`0x501e04b7(ch, 0)` ORing bit 6 into the v1.9 value 1), does not change the composite of the latched bank | `0x501e04b7` is the only read-modify-write of CTRL2/CTRL3 found outside the debug command code (below) and only ORs, so on the live-view path nothing ever takes bit 6 out again, which fits a self-clearing command bit rather than a level (I); five caller pairs are executed and bracket register programming (`0x501daf40/65`, `0x501daf8c`/`0x501db574` in `0x501daf7d`, `0x501db5f1/6cd`, `0x501d8e6a/85`, `0x501ded2b/3a`; X); three more are paired by function (`0x501d04c7`/`0x501d05db`, `0x501dba93`/`0x501dbfab`, `0x501dbfcf`/`0x501dc119`; D, narrowing below) with no executed trace, and `0x501c5d4f` is a lone `(ch, 1)` (CTRL2 OR) right after the IMG3 address store `0x501e2122` (`0x501c5d3d`) with no `(ch, 0)` in its function, the task body `0x501c5b23` (DRAW_NORA, woken through the flag `0x62a35428` by `0x501c5604`, section 10.3 step 1), which fits a commit/hold reading of CTRL2 and CTRL3 better than a symmetric pair (I), but that task exists only after the AUTO DIMMER OSD LAYER handler `0x501cfac2` creates it, so it is weak evidence for the live-view path; the open-time CTRL2 `0x1C0` already has bits 6 and 7 set by a plain store (A13), so on the progressive path `0x501e04b7(ch, 1)` leaves CTRL2 unchanged; CTRL3 receives the same codes as CTRL2 (6, 8, 1, `0x20`; A13), which fits the command-register reading; the value follows the scan (`0x40` progressive, `0xC0` two-field, byte `0xa32ddd3c[ch]` from `0x501dff6f`); CTRL2/CTRL3 receive back-to-back command stores (A13). Reading: per-field update hold/release commands whose effect the A2 latch already models (I). The only reads of CTRL2/CTRL3 found besides the OR are a debug register dump: the string-dispatched debug command that prints "---- VSC Read Buff" (`0x501cde7c..82`, string `0x602bb73c`) walks the (name, word index) table `0x60352dc0` ("CTRL1 :" 0, "CTRL2 :" 1, "CTRL3 :" 2, INTEN1 3, ...) and loads `0x9bb80000 + 4 * index` for each channel the mask `0x501c3f0d` selects (`0x501cdf44..4e` channel 0, `(32768,a0)` at `0x501cdf72` channel 1, `(65536,a0)` at `0x501cdf99` channel 2) into heap snapshots `0x62a36748`/`0x62a36750`/`0x62a36758`; a second pass fills `0x62a3674c`/`0x62a36754`/`0x62a3675c`, and the print loop marks words that differ between the two with `x` (`0x501ce1f7..0x501ce210`); the values are only printed. Search scope: absolute addresses of CTRL2/CTRL3 in either bank or mirror (none); the 15 call sites of the generic reader `0x501e2cd3` (word indices 246, 462, 463, 466, 2333 and 2514, never 1 or 2); and the 59 places that form an address from the bank base `0x9bb80000`. Of those, the 36 in the driver (`0x501db942..0x501e2cea`) are stores, loads whose word index comes from a per-layer switch of constants (none is 1 or 2), the OR and the two generic accessors; two are data (`0x51448f9a`, `0x5159815a`); the other 21 (`0x501c8fe3..0x501d0b5a`) lie in debug commands (the register dump above, file dumps "VSC_REG.bin", "GMA_TBL.bin", "OSD%d.RAW" around `0x501d04ad..0x501d0726`, prints through `0x50029534`) and were not each resolved to an index set; one of them, `0x501d061e` in the GMA_TBL dump, ORs 16 into the words of a stack index list that was not resolved. Its meaning is ?. Narrowed in M10B (a15 investigation): all 17 call sites are resolved by their argument and every `(ch, 0)` is followed by a `(ch, 1)` in the same function, CTRL3 OR first and CTRL2 OR last, register programming between: `0x501d04c7`/`0x501d05db` (the read-only debug dump "OSD%d.RAW" / "VSC_REG.bin" / "GMA_TBL.bin", which still sets the bit), `0x501d8e6a`/`0x501d8e85` (`0x501d8e24`, ROT1-4), `0x501daf40`/`0x501daf65` (IMG address), `0x501daf8c`/`0x501db574` (`0x501daf7d`), `0x501db5f1`/`0x501db6cd` (live view), `0x501dba93`/`0x501dbfab` and `0x501dbfcf`/`0x501dc119` (each inside one function, separated by the `ret` at `0x501dbfb0`, the second ending at the `ret` at `0x501dc11e`; entry and caller not traced), `0x501ded2b`/`0x501ded3a`; the lone `(ch, 1)` at `0x501c5d4f` stays as above (D). `0x501daf7d` is reached from DISPLAY cmd 6 (`0x501c340c`, d1 = 0), cmd 28 (`0x501c3472`, d1 = 1) and cmd 20 (`0x501c3a6c`), and the sender `0x507f67fe` posts cmd 6 or 28 by its d0 (`0x507f6808..0f`), so every cmd 6/20/28 sets the bit on its device (D). Executed cmd 28 bracket (EVF layout): CTRL3 1 -> `0x41`, inside it only CTRL3, DMAEN, IMG2/IMG3PLANC, OSD1-3DMASADR, OSDCP2 and OSDDMASPOS change (cmd 28's own commit `0x501e227b`), no lab time passes and no frame boundary falls inside; later updates are unbracketed cmd 17 commits with the bit still set (X). The scan flag that picks `0x40` / `0xC0` pairs with `0xa32ddd30[ch]` = 16 / 48, which `0x501e0233` uses for INTEN1/INTST1 bits 4 / 5: bits 6/7 are per field (I). Rejected readings: OSD scaling or a 2x upscale (the 2x is in RSZ, present with CTRL3 = 1; N7 and N7C differ only in CTRL3 and OSDDMASPOS and composite from the same RSZ; the bit is also set on the 1:1 TFT and by a read-only dump) and a blend mode (no blend register changes inside any bracket) (I). Executed: the same latched state composited with A15, without A15 and with CTRL3 stored back to 1 gives the identical picture where it composites (EVF layout, store-first TFT). The narrowed statement: CTRL3 bits 6/7 left set after a closed `0x501e04b7` bracket (CTRL3 OR, then CTRL2 OR of the same value, no frame boundary between) do not change the latched composite. Only hardware settles it: an EVF photo next to check_nav N7's composite. A store-first boot TFT and the same TFT after a round trip differ in GAM1 (`0x111` / 0) too (A14), so a boot-versus-round-trip photo would not isolate bit 6 | only when the harness sets the debug-window flag (`DisplayLab.assume('A15')`); channels 1/2, CTRL3 exactly `0x41`; each such composite carries a model note `ASSUMED` (offset `0x008`, value `0x41`) and header field `assumed` bit 0. Default off in every check: a TH composite is FEATURE_UNOBSERVED (CTRL3 `0x41`). Play mode (M10B, `emu/bin/play.mjs --a15 auto`, the viewer's default) sets the flag per composite only under the bracket guard: the shown channel's latched CTRL3 is exactly `0x41`, every `(ch, 0)` since the channel's last OPEN was closed by `(ch, 1)` at the same lab time and no bracket is open (recorded behind the B2 `ctrl_or` observer); the status line and `session.json` say so (scenario `a15-open` replays an open bracket; the a15-no-guard mutant composes under it anyway) |
| A16 | the VSC and OSD-engine DMA addresses are bus addresses in one flat 32-bit space: bus `0xA0000000 + n` is DRAM offset n (the CPU's uncached view), the live-view bank ranges of table `0x602c2d61` are memory, any other bus address is outside the model (`DMA_RANGE`) | section 1 | always for the DRAM-identical range; the physical backing of the bank ranges is ? |
| A18 | the fetch starts SPOS pixels into the 128-byte burst that holds the DMASADR address: start = `((DMASADR << 4) & ~127) + SPOS * Bpp`, Bpp 2 for IMG format 0 and 1 for OSD; DMABN counts bursts from the burst start | M: the OSD writer `0x501e01b9` stores address & 127 as SPOS (`0x501e01e9..0x501e0207`) next to `DMASADR = address >> 4`, so DMASADR alone loses the start's low 4 bits; the IMG writer `0x501e0137` stores `(x mod pixels-per-burst) & 126` (`0x501e0173..0x501e01b5`) and the TH path the address of pixel `x & ~1`; the IMG burst count of `0x501e0045` (`ceil((w + SPOS) / ppb)`, `0x501e00a7..0x501e00cb`) counts from the burst start. The OSD count does not support that reading: `0x501e00d0` writes `ceil(w / 128) << 3` and `0x501e01b9` adds a raw 1 (bit 0, not a burst) only when `(w mod 128) + SPOS > 128` (`0x501e0208..0x501e022f`), nothing when w mod 128 == 0 whatever SPOS is; the firmware's own pair for width 896 at x = 5 is DMABN `0x38` (896 bytes) with SPOS 5, which A18 refuses as DMABN_SHORT (901 bytes from the burst start; check_display group 7). This contradiction is open. Reading the start as `DMASADR << 4` alone drops the OSD's low bits; `(DMASADR << 4) + SPOS` counts the offset twice and contradicts the IMG burst sum | the pair is consistent: `(DMASADR << 4)` bits 6..4 == `(SPOS * Bpp)` bits 6..4, `SPOS * Bpp < 128`, SPOS even for IMG format 0; DMABN covers `SPOS * Bpp` plus the fetched span; each such composite carries the record `SPOS_A18` (plane << 8 \| SPOS). The OSD writer's DMABN +1 (bit 0) stays DMA_FIELD; any other pair is SPOS_UNMODELLED |
| A19 (opt-in) | IMG3 with format 2 and PLANC `0x1000` (the face-frame plane CPU 3's DISP_FRAME draws into, set up by `0x501dcb1a`) is rows of 8-bit indices, nearest-neighbour scaled by the plane's resize steps (output pixel i of row j takes source column `floor(i * sh / 4096)` of source row `floor(j * sv / uv)`); index 0 leaves the pixel below, 1..7 replace it with the word at `+0xD00 + 4 * index` (Cr << 16 \| Cb << 8 \| Y); `+0xD00..+0xD1C` change the composite only so | X: DISP_FRAME (`0x5100d05a`, run on the lab CPU, shutter spec section 7 item 50) writes indices 0, 1, 2, 5 and 6 into a 900 x 600 buffer of stride 1024 that it shows as IMG3 (AREA 98, 8; DMALD/DMABN `0x40`), the drawn shapes (AF frames, the focus indicator) are where index 0 is not; the eight words are the frame colour table of `0x51016e3e` converted by the display setup (`0x501db1b4`: `Y = (19595 R + 38470 G + 7471 B) >> 16`, `Cb = ((-11056 R - 21712 G + 32768 B) >> 16) + 128`, `Cr = ((32768 R - 27440 G - 5328 B) >> 16) + 128`), which fits a palette; index 0 transparent is D: DISP_FRAME keeps the 900 x 600 plane enabled over the whole live view and leaves every pixel it does not draw at 0 (after its erase the plane is all 0, and the composite equals the one without the plane), so an opaque index 0 would black out the live view of every camera; opaque 1..7 is I; what PLANC `0x1000` selects is ? | only when the harness sets the debug-window bit (`DisplayLab.assume('A19', on, channels)`, bit 2 of CH_ASSUME); IMG3 format 2 with PLANC `0x1000`, SPOS 0, and steps that do not shrink (`sh <= 4096`, `sv <= uv`; RSZ_UNMODELLED otherwise); an index of 8 or more or an unwritten word is PAL_UNWRITTEN; each such composite carries the note `ASSUMED` (offset `0xD00`, value 2) and header `assumed` bit 2; the harness skips its IMG edge check for that plane. Default off; S-DISPFRAME sets it for the TFT and the EVF. On the EVF channel DISP_FRAME's 800-wide plane is shown 1600 x 1200 with RSZ1 `0x11` and steps `0x800` horizontally and vertically (X); indices are not interpolated (I) |
| A20 (opt-in) | HILIGHT1 (`+0x5D0`) written 0 shows the same picture as HILIGHT1 unwritten (A13): highlight off and zebra off | its three writers are read-modify-writes of bit 0 (`0x501e1b2c`, `0x501e1e08`) and of bits `0x330` (`0x501e1bb1`, the zebra setter, value `(old & ~0x330) \| x << 8 \| y << 4`); `0x501cc522` only reads it; so no code sets another bit, and 0 is both features off over the 0 an unwritten register reads (D). Playback's entry (the camera application, PLAY) writes it with zebra off | with the opt-in (CH_ASSUME bit 3; the player's camapp mode sets it on both channels), HILIGHT1 written 0 is accepted on channel 1 or 2 like an unwritten register (header assumed bit 3, an ASSUMED note); otherwise, and for any other value, FEATURE_UNOBSERVED |
| A17 | CPU `0xB8000000..0xBFFFFFFF` shows bus segment `(byte 3 of 0x98100058) << 27`; bytes 0..2 are the identity segments of CPU `0xA0`/`0xA8`/`0xB0` and only `14 15 16` is accepted; reset `0x17161514` | `0x50036da4`/`0x50036d95` (code); the identity reading of bytes 0..3 (I), pinned by check_liveview G1 against independent DRAM reads; the reset value is the firmware's restore value (the reset value itself is not in the code) | the harness's frame writes and reads (`DisplayLab.bus_rows`, `emu/src/lab/display.mjs`), which call the firmware's own window functions |

Errors (each a reason the composite could be wrong; the plane, or the composite, is skipped): REG_UNKNOWN, WIDTH, MIRROR_WRITE, MIRROR_LIVE, RO_WRITE, DEBUG_CPU_WRITE, DOORBELL, NOT_LATCHED, FIELD_MODE (SYNC1 bit 24 = 0 or SYNC4 != 0), WINDOW, MIX_UNOBSERVED (flag only; A5), PLANC_UNOBSERVED (neither 0x100 nor 0), FMT_UNMODELLED (IMG FMT != 0; OSDFMT1 != 0x111 or OSDFMT2 != 0x11 skips all three OSD planes; YPYC, IMG1FMT[5:4] written by `0x501e07e5` and set at `0x501dad90` for BT709 -> BT601; the M8 model investigation found no conversion coefficients for it in code, section 10.2), SPOS_UNMODELLED (an address/SPOS pair outside A18), DMA_FIELD (DMALD/DMABN low bits, DMALD >> 15, DMASADR bits 31..28, DMAEN bits above 5), DMABN_SHORT (fetched span > DMABN bursts), DMA_RANGE (fetched span not inside one backed range of `om1.bus`, A16), RSZ_UNMODELLED (RSZ1 bits other than 0/4, RSZ3/5/6 != 0), PEAK_BC (PEAK1 & 0x11 with IMG1/IMG2, BC != 0x10F), BG_FIELD, OSDCP2_FIELD, PAL_UNWRITTEN / PAL_FIELD (counted per plane, pixels not drawn), UNWRITTEN (a consumed register never written), NOT_RUNNING, ORDER, FEATURE_UNOBSERVED (A13; on channel 0 always). The harness adds IMG_EDGE_UNKNOWN (A6, section 8) to a composite's error list; it is not a model error. Records that are not errors (the notes ring, one per composite and plane): ASSUMED (A15), SPOS_A18 (A18), PLANC_ZERO (A7: a plane with PLANC 0 was not drawn), VIEW (the lab view mask CH_VIEW is not 0x3F, section 8).

Every one of the 503 channel registers is in exactly one class (the model's in `emu/src/dev/vsccompose.mjs`,
`REG_MODEL`/`REG_STORED`/`FEATURES` in `emu/refs/display.mjs`; check_display group 12a checks that both agree name by
name with the class tables of `emu/checks/fixtures/om1-vsc-tables.c`, to which test_dev pins the model, that the stored-only and A13-value classes are exactly the registers the TFT, TFT -> EVF and EVF
flows write on channels 1/2 and the model does not read, and, on a live TFT composite, that a store into
each stored-only register changes nothing while a store into each never-written one is reported):

- read by the model (99): DMAEN; per plane DMASADR, DMALD, DMABN, AREA1/2, PLANC, RSZ1-6 (IMG1 RSZ1-5),
  IMG1-3FMT; IMGDMASPOS, OSDDMASPOS, OSDFMT1/2, VIDEOAREA1/2, OSDRESO, IMG2BC/IMG3BC/O1BC-O3BC (A11),
  OSDCP2, PEAK1, MIXODR1/2, OSDMIX, BG; SYNC1, SYNC2, SYNC4, INTEN1, INTST1, MONI3 (clock and interrupt);
- A13 values (17): CTRL2, CTRL3, SRAM1, SRAM3, VIDEOAREA3, IMG1-3HDLY, OSD1-3HDLY, MIXHDLY, IMG1LPF,
  LPF3-6;
- stored only, value not checked (142), all written by the recorded paths: sync and timing VLSYNC,
  VLRST1-3, CYCLE1, SYNC3, SYNC5, SYNC6, LINECNT1; DMA tuning IMG1-3/OSD1-3 DMASET2-16 (no DMASET12),
  DMADDCSET1-6, IMG1-3DMAODR, OSDDMAODR; INTEN2/INTST2 (the paths write 0 / 0xFFFFFFFF,
  `0x501df9b8`/`0x501df9d1`); the A14 group; the panel/output side TVTFT17, TFTOUT1, PORT, HDMI1/2. That
  these do not enter the mixer is an assumption from their names and register order, not checked;
- never written by the recorded paths, must stay unwritten (245, A13): CTRL1, FIFO_CONTEN, MON_CYCLE,
  CLKG, VLFRM, SRAM2, SRAM4, HIST1, FRM1, WDMA1, OSDTAEN, DRAMSET, DMAREQINTRVL1/2, IMG1DMASET1,
  DMAMSK1-6, IMG1DMASADR2, OUTFMT, ALPHAFMT, the six AREA3, HISTAREA1-3, PEAKAREA1-3, HIAREA1-3, HIBC,
  IMG2LPF, COLMAT and its K words, HILIGHT1-4, PEAK2-14, TEST1, WDMA_OFMT, YCCLIP2/3, HIST2/3, ZEBRA1_1-7,
  ZEBRA2_1-7, 8MSK1-17, CMMSET1/2, CMM1_KNEE1-32, CMM2_KNEE1-32, CMM_COEF1-5, NVEN, NV11-NV23SET1-6,
  YCEXT1-11, MONDMA1-7/13-30.

The output block (`0x9BB98000`) and VWD_* are stored only.

## 8. Harness rules (`emu/src/lab/display.mjs`)

- Time: OlyEvWt on a channel's vsync flag -> if the flag is still clear after servicing pending
  interrupts, RUN_TO_FRAME(ch), then the firmware ISR; OlyTaSS(n) -> ADVANCE(n ms) then pending
  interrupts; a composite shows the frame that starts at the channel's next boundary. Line time
  = period (firmware word) * 1000 // the getter's vtotal (TFT 21666 ns, EVF 12686 ns).
- Panel-side MMIO goes to the lab stub, 16 allowed pages, five MIPI presets that are the exit
  values of the firmware's poll loops (`0x501d78d3..0x501d791d`, `0x501d7946..88`,
  `0x501d7cf4..0x501d7d43`).
- IMG frame: test card or PPM in a fixed lab region `0xAD300000 + 0xC00000`, attached by direct
  calls of `0x501df31a`, `0x501e1e95`, `0x501e20c6` after the update (9.1). The frame rows are
  re-hashed before every composite (a write into the region by anything stops the run).
- IMG edge guard (A6): no register holds an IMG plane's source size, so the model cannot tell
  whether a second tap lies past the source. After each attach the harness records what the IMG1
  fetch depends on as the attach left it (RSZ1/RSZ2/RSZ4, AREA1/AREA2, DMASADR, DMALD, DMABN,
  IMGDMASPOS, IMG1FMT) together with the frame's base, stride and size. A composite that draws an IMG
  plane gets the harness error IMG_EDGE_UNKNOWN when the plane was not attached this way (reason 1),
  any recorded register differs in the latched bank (2: e.g. `0x501e20c6` moving the address,
  `0x501dffae` the stride), the fetched span measured from the latched address and stride, second
  taps with non-zero weight and the format-0 pixel pair included, leaves the frame (3), or the latched
  address and stride do not map onto the frame at all (4).
- Live view (M7, section 10): the test frame goes into a live-view bank element (`load_lv_frame`), at the bus address the firmware's own `0x50534dd1` returns for the handle `bank << 8 | element`; that call logs `0x08010004`/`0x08010005` because the lab allocates nothing (meaning "observed, not decoded"; accepted in that step only), and the result is cross-checked against the static table `0x602c2d61`. Every frame write and read goes through the firmware's window: native `0x50036da4(bus)`, debugger access at the returned CPU address, native `0x50036d95`, split at 128 MiB segment ends (`bus_rows`, `bus_read`, `bus_write`). The rows are re-hashed through the window before every composite.
- The through permit is set natively (`0x501c40d0(mask, 1)`, or DISPLAY cmd 5 +34 = 1); the TH API is called natively with a 224-byte request in harness memory (`ThRequest.pack`). Two request forms: `rec_view`, the 1:1 form rec_misc `0x5054c1ad` builds (section 10.9), and `scaled`, harness-chosen geometry labelled H-REQ (the camera's live-view values come from the mvr builders `0x50453c2e`/`0x50453d88`, not decoded).
- TH attach for the A6 guard: recorded only when the firmware stored the request's start address as img[0] (the TH tail `0x501daf6a..78`). The source is from_target at the crop origin, clipped to the loaded frame; the guard's arithmetic is unchanged (reasons 2-4), with reason 4 also when the crop origin or the request's stride does not map onto the loaded frame. A level-3 attach afterwards replaces the record, and vice versa.
- Opt-in A15: `DisplayLab.assume('A15', on)` sets the debug-window byte `CH_ASSUME` (+0x38 of the channel block) bit 0 on channels 1/2; the session JSON lists it under `assumptions_in_use` and `opt_in`.
- Boot step 0 (M8): every lab's `start()` first runs the software-timer init `0x50058959` natively, the boot step called at `0x5002cd82` (section 9.5). H-TIMER: the hardware-timer init `0x500642dd` (boot `0x5002cd7b`) is not run, because it programs unmodelled timer hardware through `0x50064443`; the step asserts beforehand that the hardware table pointer `0xa32ca47c` is 0 and that the low-RAM u16 at `6 * ch + 2` is 0 for ch 16..31, so each hardware call reads 0 there and returns without touching hardware: `0x50064323` -> `0x5201` (16 calls: ch 20..31 from `0x50058a10`, then ch 16..19 from `0x5005844f` -> `0x50058483`, which builds a second 4-slot table of 28 bytes at `0xa32c544c`, `0x5005848f..0x500584bc`), `0x50064352` -> `0x5202` (1), `0x5006437d` -> the u16 it read, 0 (1; `0x5006438f..0x5006439e`); the calls that would program hardware (`0x50064478`, `0x5006449b`, `0x500644fa`) raise if reached, and a lab-stub access, an error-log call or a channel outside 16..31 raises too. No caller uses the returns (`0x50058a1f`, `0x50058ba5`, `0x50058bad`), so the asserted values only confirm the no-hardware path. `DisplayLab(timer_init=False)` exists only for check_display's negative control (group 6d). H-TIMER is the time-off path, the default of every lab. With lab time (M9, `MenuLab(time=True)`, `emu/bin/nav.mjs --time`) display start instead runs `0x5003121c`, `0x500642dd` and `0x50058959` natively in boot order (H-BOOTTIME), programming the timer block model; the firmware's channel arguments above are indices of the hardware table run-time `0x6011e0a0`, whose entry i is timer channel i + 1 (`om1-intc-timer-spec.md` section 4).
- H-RESEND (M8): after a switch the harness calls the display manager's request `0x503e52c7(d0 = kind, a0 = &{u32 1, 1, 1})` natively, kind 1 for the TFT and 32 for the EVF (the jump-table `0x6061ff44` kinds of masks 1 and 2). It is the request DevDpc_DispCtrlBase::openDevice `0x50d83338` makes after its open (`0x50d8350d..0x50d83535`); openDevice's caller is not traced. The step asserts one synchronous send (`0x5002e39d` called at `0x503ec110`) of DISPLAY cmd 4 `{mask, 1, 1, 1}`, no OlyQeWr, and the "dispif async" byte `0x60357648` left at its image value 1 (section 9.2). The open itself stays harness DISPLAY cmd 2: openDevice chooses between `0x503e4bf5` and `0x503e6aca` (cmd 45) by `0x50ab4756()`, whose meaning is ?, and cmd 45 would need an asynchronous-queue stand-in.
- Lab view (M8, not a hardware claim): the per-channel debug byte `CH_VIEW` (+0x39, default `0x3F`, bit p = IMG1..OSD3) limits the planes the compositor draws; the header field `view` holds it and any other mask adds the record VIEW. check_display group 8b composes each drawn plane alone with it and compares it with `reference(order=[plane])`.

## 9. Found while implementing

1. The IMG plane attached by the function-level setters is turned off by the next cmd 17 commit: `0x501da699` passes the per-channel state to `0x501e227b`, whose `img[0]` only the live-view path (`0x501c3f4d -> 0x501dac92`) and DISPLAY cmd 5/18 fill. Resolved in M7: the TH API runs natively and fills `img[0]`; its request, entry checks and register formulas are in section 10. The level-3 attach stays the default image path of the display harness and the baseline of check_display (it needs no assumption beyond A1-A14, A16; A18 only when a setter leaves SPOS != 0).
2. GPISetPalette sets a dirty byte only when a component changes (`0x51013be7..0x51013c13` compare old and new). After a switch the new channel's palettes are zero (written from the per-channel state by `0x501d90f9`), and re-applying the same GUI palettes sends no cmd 4. The sender (M8): DevDpc_DispCtrlBase::openDevice `0x50d83338` calls the display manager's `0x503e52c7(kind, {1, 1, 1})` after its open, for the first kind and for the second when it is non-zero (`0x50d8350d..0x50d83535`). `0x503e52c7` builds DISPLAY cmd 4 `{mask, 1, 1, 1}`; the image's "dispif async" byte `0x60357648` is 1, yet with the device open the synchronous branch is taken (`0x5002e39d` at `0x503ec110`, executed; the asynchronous branch would post to queue `0x88`, the DISPLAY queue). The lab calls it natively after each switch (H-RESEND, section 8). Open: the caller of openDevice (vtables `0x50ed2aa8`/`0x50ed3ddc`; the eye sensor), `0x50ab4756`, which picks `0x503e4bf5` or `0x503e6aca` (DISPLAY cmd 45) for the open, and `0x503e4bf5`. DISPLAY cmd 45 shares the OPEN handler: indices 0 (cmd 2) and 43 (cmd 45) of the jump table `0x602abbfc` both hold `0x501c30fb`.
3. PLANC after a switch (M8). The EVF switch reads kind `0xe831` (property 587; data-object table `0x606217e4`, settings spec section 2) at `0x501c73ad`; only when it reads 0 does it take `0x501c6b06(1)` (`0x501c73a6..b3`), the level-table path `0x501c67aa(p449 + 7)` -> table `0x602ae4b4` (15 x {u8 index, u8 panel, u8 level}, searched by index at `0x501c6849..70`) -> `0x501c69e5(level) -> 0x501c5730 -> 0x501e2bcb`, PLANC = `(level * 2) & 0x1FE`. The lab's empty store reads 587 as 0 (its default is 1) and 449 as 0: entry 7 = (7, 28, 101), OSD1-3 PLANC = `0xca`, outside the model (PLANC_UNOBSERVED x3, IMG1 only; check_display 6a checks the value against the table). On the firmware's own store (store-first, check_nav N8) 587 reads 1 and PLANC stays `0x100` both ways. The direct open checks kind `0xe831` == 1 (`0x501c600a..29`): 1 goes to `0x501c57aa`, which writes level 128 through `0x501c5730` (called at `0x501c6062`, executed); otherwise it searches the same table by the raw value. Correction to M7's text: the direct open does not write through `0x501df113`, which was never hit. The switch path indexes with +7 and the direct path with the raw value, and nothing found reconciles the two. `0x501c67aa` does run on the EVF -> TFT switch, with index 16 from `0x501c4f4f` (gated by `0x501c3f0d()` bit 2 at `0x501c4f48`): 16 takes the special branch at `0x501c67b1` (`0x501c47e5`, optionally `0x501c5604(0)`, then `0x501c687f(16)`), not the level table, and `0x501c69e5` does not run (executed, check_display 6b and check_nav N8). Kind `0xce0a` has the writers `0x505976ca`/`0x505978ff`; its source is ?. What PLANC `0xca` does to the pixels needs A7 (hardware).
4. With the latching mirror the close poll `0x501ddfd0` succeeds; the TFT -> EVF switch no longer
   logs `0x37003118`.
5. EVF -> TFT (M8: closed). The EVF open creates a software timer (handle stored at `0xa32c1f4c`; it is the burn-in one-shot of item 10, armed only when property 1947 reads 0); the TFT open deletes it through `0x500589d7(2, handle) -> 0x50059159`, which takes ISC lock `0x0f0d0f0f` and needs index 1..32, slot+0 == handle and slot+2 == 1 in the 24-byte slots at `0xa32c5620`, otherwise it logs `0x19001807` (4, 1255, handle) at `0x5005920a` (`0x50059171..0x500591f4`). The table is filled by the boot step `0x50058959` (called at `0x5002cd82`): `0x50058a10` (12 hardware-backed slots at `0xa32c5500`, channels 20..31 through `0x50064323`; it returns 0 whatever they return) and, when that returns 0, `0x50058e7d`, which writes handle i + 1 into the 32 software slots, zeroes `0xa32c592c/5934/593c` and creates the tick timer `0x5005899c(mode 128, period 2, callback run-time 0x6007a01c = 0x50058ffc)` (handle `0x0101` in hardware slot 1, stored at `0xa32c5930`). Handle layout: generation << 8 | slot index (executed: the EVF timer is `0x0101`, slot 1 of `0xa32c5620`). Without the step the slots are zero, the EVF open stores `0x0100` and the delete fails. Every lab now runs the step (section 8, H-TIMER); EVF -> TFT then composites word for word as a direct TFT open (check_display 6b), and the negative control without it reproduces `0x19001807` (6d). No timer fires in a time-off lab (kernel spec section 8); with lab time (M9) the tick timer runs on timer channel 21 (kernel spec 9.5).
6. The firmware's own live-view buffers (memory-manager banks 0x0a, 0x0e, 0x18, 0x75: 5568 x 2160 x 2 bytes) have bus addresses `0x98d4d800`, `0x95f6c800`, `0xee087500`. Settled in M7 from code: they are constructor immediates (`0x50533dde`, `0x50533e81`, `0x50533f58`, `0x50535788`), handed out unchanged as `base + (element - 1) * size` (`0x5053697b`, executed) and written to DMASADR with `>> 4` only; the firmware's only translation is the bus -> CPU window (section 1). There is no hidden bus-to-DRAM translation to find. The lab maps them as A16/A17; the physical memory behind them on the camera is ?. The level-3 IMG region `0xAD300000` stays where it was: it is bus DRAM (A16), outside every bank based in `0xA0000000..0xB7FFFFFF` (checked at run time), and the banks based at `0x6xxxxxxx` (0x5f, 0x6a) are bus addresses outside the lab (A16 makes the cached view no DMA address at all).
7. DISPLAY cmd 5 with an IMG1 handle and the permit clear (`0x501da2a8..e6`) stores `0x50534dd1(handle)` as img[0] (`0x501da2df`); the handler tail then calls `0x501da1b3(mask, handle)` (section 10.7), which rewrites IMG1FMT 0, stride 5568, SPOS 0 and IMG1DMABN = `ceil(panel width / 64) << 3` (`0x78` on the TFT, `0xC8` on the EVF, the values OPEN leaves) and leaves RSZ and AREA alone. After a scaled TH call (G7: 1620 -> 900, DMABN `0xD0`) that DMABN is too short for the TH steps, so the next composite reports `DMABN_SHORT` (`0x78`); right after OPEN the same cmd 5 only changes IMG1DMASADR and DMAEN, CTRL3 stays 1 and the model composites IMG1 without A15 (status NONE), with the harness's `IMG_EDGE_UNKNOWN` reason 1 because cmd 5 is not a recorded attach (G7, both devices; pinned in `check_liveview_notes.txt`).
8. The bus-window round trip (A17) needs no harness DRAM region at all for live view: frames live only in the bank ranges of `om1.bus`.
9. DISPLAY cmd 28 after a connect state exists (M10B, X): once the GUI has had 131 (`EVT_REQ_CHG_OUTPUT_DISPLAY`) on either device, the switch's re-entry runs `0x501daf7d` (which DISPLAY cmd 28 reaches; it calls `0x501e04b7` unconditionally at `0x501daf8c`), so CTRL3 is `0x41` on the shown channel (the closed EVF channel reads `0x400`, the value OPEN stores for the channel not opened). Not every later build runs it: on the EVF the menu entry and exit each add a bracket, while the shooting request, PLAY and the Super Control Panel (open and close) add none; on the TFT after LV back the menu entry and exit add none (X, the guard's executed bracket count after each step). On the EVF the GUI then programs two geometries: the menus' 800 x 600 layout, all three OSD planes scaled 2x (RSZ2 `0x800`), and for the shooting screen, the direct screens, playback and the Super Control Panel a 900 x 600 canvas whose GUI layers 1 and 2 the VSC scales into the EVF (OSD2/OSD3 RSZ1 `0x11`, RSZ2 `0x904`, RSZ4 `0x8e0`, AREA1 `0x32063c`, AREA2 `0x2d0438`: 1596 x 1080, all 900 source columns sampled), with layer 0 at 1600 x 1200 1:1. The composites rest on A15 (play mode's bracket guard, section 7).
10. EVF burn-in dimming (PLAYFIX). Registration (D, X): the EVF OPEN calls `0x501c6aca(1)` (return `0x501c627f`), which registers the eye callback `0x501c6ae2`: `0x50050e67` stores it at `0xa32c1f48` and calls `0x500515ed`, which reads property 1947 (kind `0x4671` at `0x500515fb`, data-object table `0x606217e4`; `call 0x500417da` at `0x50051601`). A non-zero value branches to `0x50051686` (`cmp 0,d0; beq; bra` at `0x50051609..0d`), which deletes any timer (`0x500589d7(2, handle)`, handle cleared). Zero with eye state 0 or 1 (0 = not yet sensed, 1 = no eye at the finder; input spec H-EYESTATE, output selector `0x501e7fd8`), only when no handle is pending (`0x50051627..29`, `bne` to `0x5005164f`, which skips both), stores 1 to `(0xa32c1f4e)` (`0x5005162b..2d`) and arms a one-shot at `0x50051633..44`: `0x5005899c(2, 5000, callback run-time 0x600726cf = 0x500516af, a1 = 0xa32c1f4e)`, handle stored at `0xa32c1f4c` (`0x50051649`). The one-shot's callback `0x500516af` clears the handle and defers `0x500516c8` (`0x50053505`, run-time `0x600726e8`), which calls the eye callback with `movhu (0xa32c1f4e)` = 1 (X: eye_cb d0 = 1 while the eye state was 0). So arm 1 means "the 5 s one-shot expired", for eye state 0 as well as 1. Any other state deletes a pending one-shot without calling the callback (`0x50051658..71`); with none pending it stores the state to `(0xa32c1f4e)` and calls the callback with it the same deferred way (`0x50051673..7f`), so state 2 (an eye at the finder) reaches arm 2. With 1947 != 0 the callback is never called (`0x50051686..a4`). Callback arms (D): `0x501c6ae2` with d0 1 sets `(0xa32db424) = 3` and calls `0x501c6a93`. That routine calls `0x501c5730(32)` (level 32; `0x501c5730` sets the planes only when `(0xa32db3ed)` == 0, otherwise it only records the level at `0xa32db3ec`, `0x501c5730..39`, `0x501c578f`), then stores 5 to `(0x60350bfe)`, calls `0x501c647a`, then `0x501c65a5(2, 0, ...)` with its debug string "[EVF] display_bievf_vsc_sio_send_brightness_yakitsuki" (run-time `0x602ae37c`, loaded at `0x501c6aaa`), then `0x501c674d` (`0x501c6a9a..c2`); that these calls are the SIO brightness send is I (the string). With d0 2 the callback calls `0x501c6b06(0)`, which sets `(0xa32db424) = 4` and, with d0 != 1, acts only when `0x501c57a1()` returns 32. It then calls `0x501c5604(0x501c47e5())` when `0x501c47e5()` != 0 (`0x501c6b49..4e`), otherwise, when bit 2 of `0x501c3f0d()` is set, takes the level-table path with property 449 (kind `0xd7f9`) + 7 (item 3, `0x501c67aa`). Neither arm touches the TFT. Executed on an EVF start in the old store order (store init after the OPEN): the read returns 0 at `0x50051608` on the empty store, handle `0x101`; at lab 5,586,792,000 ns the callback `0x500516af` runs from the timer service (return `0x50059124`), task 16 runs `0x501c6a93` (return `0x501c6af7`) and `0x501e2c00` stores `0x40` to OSD1-3PLANC of channel 1, the EVF (`mov d2,(d0,a0)` with a0 = `0x9bb80000` + 4 x reg 395/396/397 and d0 = channel << 15 = `0x8000`, `0x501e2bf3..0x501e2c00`: `0x9bb8862c/8630/8634`; value (32 x 2) & `0x1fe` = `0x40`, level 128 gives `0x100`); IMG1 stays `0x100`, and every later composite reports `PLANC_UNOBSERVED ch 1 off 0x062c/0x0630/0x0634 value 0x40` (pc `0xa2100400` is the harness's compose doorbell, `DOORBELL_STUB` in `display.mjs`, not the writer). With the store init first (boot order, H-STOREFIRST in play since PLAYFIX) 1947 reads its default 1, no timer exists and PLANC stays `0x100` (X, scenario `evf-idle`; the evf-store-after-open mutant keeps the old order). Level 32 is PLANC `0x40`, outside A7: how a partial level blends is ? (hardware), so the model keeps reporting it. Every later EVF OPEN arms it the same way when 1947 = 0 and the eye state is 0 or 1; the eye-state setter `0x50050efd` returns at once when the state is unchanged (`0x50050f06..07`) and otherwise calls `0x500515ed` with the new state (`0x50050f3c`), so a change to 2 deletes the pending one-shot. Before PLAYFIX play's eye sensor passed 1 for the EVF, so a TFT start, `SET:1947=0` and the eye sensor froze the EVF the same way (X); it now passes 2 (X, scenario `eye-burn`; the eye-inverted mutant swaps the states). Until a later PLAYFIX change an LV switch did not run the setter at all, so the eye state stayed 0 after a start (or 1 after an eye switch to the TFT) and an LV switch to the EVF with `SET:1947=0` froze it too (X: timer 258, frames stop at lab 5.56 s, OSD1-3 PLANC `0x40`); play now runs the setter after every switch, a stand-in that the viewer looks at the shown display (input spec H-EYESTATE), and the setter's 2 deletes the one-shot the OPEN armed (X; the lv-no-eyestate mutant skips the setter on LV). A real camera with 1947 = 0 and nobody at the finder does dim the EVF, which the model cannot draw. Open: which menu row writes 1947 (I: the eye-sensor auto switch, from the selector), what `0x501c647a` / `0x501c65a5` / `0x501c674d` send in the dimming routine, and why the 5000 ms one-shot fires at lab 5.59 s (0.55 s late).

## 10. Live-view API (TH, M7)

Executed in the lab: check_liveview groups G3, G4, G5, G7, G8 (X). Code addresses are disassembly notation.

### 10.1 Request

224 bytes, zero except the fields below (rec_misc `0x5054c1ad` memsets the request at `0x5054c213`). Field names are the firmware's own dump `0x501c8104` ("[DISP][TH]", strings `0x602b7f97..0x602b8401`, loads `0x501c8127..0x501c84a0`); the dump prints only when the debug level `0x501c8e0e(0)` returns 8.

| Offset | Type | Field | Values and use |
|---|---|---|---|
| +0 | u32 | device_type | device mask: 1 TFT, 2 EVF, 4 / bits 24..31 HDMI (mask table `0x603507e0` = `{0xFF000004, 2, 1}`); value 0 or any of bits 8..31 set (so also any HDMI request that uses bits 24..31) -> error log `0x3700310b` (`0x501c3f55..75`: `cmp 0; beq` to the log, then `btst 0xFFFFFF00`), processing continues |
| +4 | u32 | address | bus address of the source buffer |
| +8 | u32 | c_address | second plane: `0x501e20c6` writes IMG1DMASADR2 only when the VSC format it gets, `0x501dc7b8(layer_format)`, is 1 or 12 (`0x501e20dc..f1`), i.e. layer_format 2 (YCYP420) or 12 (YCYP420_10BIT) |
| +12 | u32 | layer_format | DISP_IMGSEL_*: 1 YC422, 2 YCYP420, 3 OSD, 4 RGB8A, 5 RGB8X, 6 RGB5A, 7 RGB5X, 8 RGB4A, 9 RGB4X, 10 RGB565, 11 YC422_10BIT, 12 YCYP420_10BIT (dump strings in order); VSC format by `0x501dc7b8` (table `0x602c2ae4`): 1..10 -> 0..9, 11 -> 11, 12 -> 12, other -> 0. 0 skips the format setter (`0x501dae20..23`): the plane keeps the format already in IMG1FMT[3:0], which the geometry code reads back from the register (`0x501db841 -> 0x501e1f47`) |
| +16 | u32 | resize | 1 skips the fit path (`0x501dae55`) |
| +21 | u8 | lut_onoff | CMM selector (section 11), YPYC |
| +22 | u8 | prm_pic_mode | 0 STILL, 253 HLG, 254 SUPERFLAT, 255 LOG (dump `0x501c8232..46`) |
| +23 / +24 | u8 | input_color_space / output_color_space | 1 BT601, 2 BT709, 3 BT2020, 4 P3D65 |
| +25 | u8 | output_bit_width | printed only |
| +40 | u16 x2 | from_coordinate {x, y} | crop origin in the buffer |
| +44 | u16 x2 | from_area {hw, vw} | buffer size; {0, 0} -> error log `0x3700140f` (`0x501dc25d..79`) and the previous value stays |
| +48 | u16 x2 | from_target {hw, vw} | source size |
| +52 | u16 x2 | to_target {hw, vw} | output size |
| +56 | u16 x2 | to_coordinate {x, y} | output position inside the active window |
| +60, +64 | u16 x2, x3 | fit {x, y}, {w, h, aspect} | copied only on the fit path (`0x501dae6c..91`); rec_misc stores the aspect code as a byte at +68 (section 10.9) |
| +72 / +76 | u32 / s16 | egpk_exec / egpk_sv | +72 == 1 -> `0x501dd065`, `0x501dcfb9`, `0x501dd871(.., 1)`; 0 and the channel's flag set -> `0x501dd871(.., 0)` (`0x501daea9..0x501daf3c`; not decoded) |
| +216 | u32 | zebra_prm | pointer to {onoff, level[0], level[1]} or NULL |
| +220 | u8 | drange_ptn | 0 KEEP, 1 D_RANGE 1, 2 D_RANGE 2 |

### 10.2 Entry and gates (`0x501c3f4d`)

`0x501c3f4d(a0 = R)` takes no semaphore and uses no queue: it runs in the caller's task. In order: the dump `0x501c8104`; the device_type error log; the HDMI branch (device_type bit 2 only: `0x501c3b1e()` = word `0xa32db3a0` bit 2, `0x501d6700() == 1`, `0x501d179a() == 1`, then the bytes +100..+104 and the word +96 copied to +108..+113 when any is non-zero, and `0x501d6708(R+108, R+48, 255)`; not reached on TFT/EVF); a timing print when `0x501c8e0e(8)` has bit 6 and device_type bits 0/1; then for each mask table entry e: if `e & device_type`, the permit check `0x501c41a5(e & device_type) == 1` and `e & opened` (`0xa32db39c`) -> `0x500251f3()` (returns 1 and copies when u16 `0x97f00290` != `0x97f00292`; then the callback `0x50035afd`, not reached in the lab) and `0x501dac92(a0 = R, d0 = e & opened)` (`0x501c40c0`). On the TFT and EVF the only gate is the through permit.

Permit: `0x501c40d0(d0 = mask, d1 = on)` -> `0x501c40d9`: under ISC lock `0x1b19001b`, on = 1 ORs the mask into `0xa32db3a8` (bits 24..31 dropped when bit 2 is set), 0 clears it, 2 keeps it, > 2 logs `0x3700310c` (`0x501c40d9..0x501c4146`). `0x501c41a5(mask)` returns `(0xa32db3a8 & mask) != 0` under the same lock. DISPLAY cmd 5 byte +34 goes through the same setter (`0x501da27d..80`).

### 10.3 Setup (`0x501dac92`)

ch = `0x501df74b(mask)`. In order (TFT/EVF):

1. EVF only (mask 2): when the word `0xa32db3b0` (`0x501c47e5`) is 1, a side call `0x501c5604(d0 = 1)` (`0x501dacaf..c4`); with or without it the setup continues at `0x501dad69` (step 2), so it does not replace the IMG programming. `0x501c5604` dispatches on d0 (0 at `0x501c5604`, 2 at `0x501c5669`, 1 at `0x501c56aa`); the 1 arm works on the bytes `0xa32db3e4`/`0xa32db3e6` (sentinel 119), calls `0x501c57d4`, and when the word `0xa32db3f0` != 0 sets bit 0 of the event flag whose id is in `0x62a35428` (OlyEvSt `0x5002bd01`, or iOlyEvSt `0x5002bd77` when `0x50017b6a` returns 1; `0x501c56eb..0x501c571e`; the 0 arm sets bit 1 of the same flag at `0x501c5611..19`). That flag ("AUTO DM DRAW FLG", `0x602ade4c`) and its waiter, the task `0x501c5b23` ("DRAW_NORA", `0x602ade42`; OlyEvWt mask 3 at `0x501c5b76`), are created only by `0x501c5a3e` (acre_Task `0x5002ca1f` at `0x501c5a59`, flag at `0x501c5a71..85`), whose only caller is the handler at `0x501cfac2..0x501cfb11` that prints "---- AUTO DIMMER OSD LAYER MODE" (`0x602bc060`); that handler is also the only writer of a non-zero `0xa32db3f0` (`0x501cfb01`, `0x501cfb0d`; cleared at `0x50023a03`). In the lab the word is 0 (G8), so the side call sets no flag. What the 1 arm is for is ?. The word `0xa32db3b0` is written by DISPLAY cmd 30 (jump table `0x602abbfc` index 28 -> `0x501c37d7`: the parameter's first word at `0x501c37ec`, unless byte `0xa32db3ec` (`0x501c57a1`) is 32; a value other than 1 calls `0x501c5604(value)` at once, `0x501c3801..0b`) and by `0x501c47dc`. Executed (G8): cmd 30 {1} sets it to 1; the next EVF TH call changes `0xa32db3e4..e7` and still writes the section 10.4 registers.
2. YPYC: `0x501e07e5(ch, v)` writes IMG1FMT[5:4] = v (`0x501e07e5..0x501e0800`), v = 1 iff (lut_onoff == 0 or prm_pic_mode == 0) and input 2 and output 1 (`0x501dad69..90`). IMG1FMT `0x10` is outside the model (FMT_UNMODELLED); its pixel effect is ?.
3. CMM: state = `0x501de269(R)`; unchanged from byte `0xa32ddb81[ch]` -> nothing; 0 -> OFF `0x501dc3fd(mask)`; else ON `0x501dc344(mask, state, drange_ptn)` (`0x501dad95..c6`, section 11).
4. Zebra (`0x501dadc7..0x501dae1a`): zebra_prm onoff 1 -> `0x501de005`, `0x501de0b9` (once, byte `0xa32ddb7e[ch]`), `0x501de142(level)`; else if that byte is set -> `0x501de20c`. Executed with {1, 200, 100}: writes HILIGHT1, HIAREA1-3, ZEBRA1_1-7, ZEBRA2_1-7 (all never-written class, FEATURE_UNOBSERVED; pinned in the notes).
5. layer_format != 0 -> `0x501e1e95(ch, 0x501dc7b8(layer_format), plane 0)`: IMG1FMT[3:0] = format, IMG1PLANC bit 12 = alpha format (`0x501e1ebf..e9`); IMG1FMT[5:4] are kept.
6. Geometry (`0x501dae34..0x501daea9`; `btst imm` tests a mask, so `btst 3` is bits 0|1 = TFT/EVF and `btst 4` is bit 2 = HDMI): `0x501dcaf7()` returns 1 when the opened mask `0xa32db39c` (`0x501c3f0d`) has an HDMI bit (`0xFF000004`) and a panel bit (`btst 3`, `0x501dcb0e`), i.e. panel and HDMI open together. When it is 1, device_type has an HDMI bit (`0x501dae41`) and a panel bit (`0x501dae49`), the mask passed in has a panel bit (`0x501dae50`) and resize != 1 (`0x501dae55`): with device_type bit 2 (`0x501dae5d`) and bit 0 or 1, the fit `0x501df31a` runs on the panel channel; without bit 2 (HDMI only by bits 24..31) neither the fit nor `0x501dc1d6` runs (`0x501dae5c` -> `0x501daea9`). Otherwise `0x501dc1d6(mask, &address, R)` (section 10.4). The lab opens no HDMI, so `0x501dcaf7()` is 0 and TFT/EVF always take `0x501dc1d6`.
7. egpk (+72).
8. Tail `0x501daf3d..78`: `0x501e04b7(ch, 0)`; `0x501e20c6(ch, address', c_address, 0x501dc7b8(layer_format))`; `0x501dca8c(mask, address')` (when byte `0xa32ddaf4[ch]` is 0: the face-frame IMG3 word `0xa32ddaf8 + 8*ch` (+4 when address' is 0) into img[2] and `0x501e2122(ch, word)`; the word is 0 in the lab, so `0x501e2122` clears DMAEN bit 3, `0x501e2143..56`); `0x501e04b7(ch, 1)`; img[0] (`0xa32db480 + 3112*ch`) = address', the address `0x501dc1d6` wrote back (start of the crop). The next DISPLAY cmd 17 commit `0x501e227b` therefore keeps IMG1 at that address: the post-update re-attach of the level-3 path is not needed (G4 asserts IMG1DMASADR and img[0] unchanged across gpiUpdateDisplay).

### 10.4 Register formulas (`0x501dc1d6` -> `0x501db5e6`)

`0x501dc1d6` returns at once when address is 0; it copies from_target, from_coordinate, from_area (unless {0, 0}), to_target and to_coordinate into per-channel tables (`0xa32dda6c`, `0xa32dda78`, `0xa32dda60`, `0xa32dda84`, `0xa32dda90` + 4*ch), the address into `0xa32dda00 + 32*ch + 20`, builds the block S = `0xa32dd910 + 80*ch` (+8 -> `0xa32dda00 + 32*ch`, whose +0/+4/+8/+12/+16 point to from_area, from_target, from_coordinate, to_target, to_coordinate) and calls `0x501db5e6(mask, S)`: `0x501e04b7(ch, 0)`; `0x501db841` (address, stride, start position, bursts, PLANC); `0x501dba08` (area); `0x501e0ef5` (horizontal step); `0x501e1013(ch, 0, &from_target, &to_target)` (vertical step); img[0] = -1 and the commit `0x501e227b` (keeps IMG1, rewrites the other planes from the per-channel state); `0x501e04b7(ch, 1)`. The two branches on `0x501dcaf7() == 1` (`0x501db5fe..2c`: B+24 = 0xFFFF; `0x501db66c..b3`) also need further conditions (`0x5101d9a9() & 2`, `0x501df148()`) and a panel bit in the mask (`btst 3,d3` at `0x501db61f`/`0x501db68d`): they are panel paths taken only while HDMI is open too, never in the lab.

For format 0 (layer_format 1; 64 pixels per 128-byte burst from `0x501e2d3b`), with W = from_area.hw, (x, y) = from_coordinate, (sw, sh) = from_target, (dw, dh) = to_target, (tx, ty) = to_coordinate, (hs, vs) = the panel porch from `0x501df27a` (TFT (98, 8), EVF (48, 41)), A = address:

| Register | Value | Code |
|---|---|---|
| start (img[0]) | A + (W*128/64)*y + ((x & ~1)*128/64), integer divisions; the jump table `0x602c2aa4` uses x & ~1 for formats 0/1/11/12, 0 for format 2, x otherwise | `0x501db86e..0x501db8c6`, added in place at `0x501db936..3c` |
| IMG1DMASADR | start >> 4 | `0x501db94c..51`, again `0x501e20d1..da` |
| IMGDMASPOS field 0 | (x mod 64) & 126 (formats 0/1/11/12), other fields kept | `0x501e0137..0x501e01b5` |
| IMG1DMALD | (old & 0xFFFF8000) \| (W / 64) << 3 (signed) | `0x501dffae..0x501e0001` |
| IMG1DMABN | ceil((sw + SPOS) / 64) << 3; + 8 when sw != dw and (2*sw + start) & 127 == 0 | `0x501e0045..cb`, `0x501e0fe2..0x501e100f` |
| IMG1AREA1 | (hs + tx) << 16 \| (dw & 0xFFFE) | `0x501dfced..0x501dfd15` |
| IMG1AREA2 | progressive: (vs + ty) << 16 \| dh; field mode: (ty / 2 + vs) << 16 \| dh / 2 (signed `/ 2`, the porch vs not halved); not written when PEAK1 & 0x11 == 1 | `0x501dfd17..0x501dfdb8` (field arm `0x501dfd65..96`) |
| IMG1AREA3 | field mode only: ty / 2 + vs (same PEAK1 condition) | `0x501dfdba..0x501dfe27` |
| IMG1RSZ1/RSZ2 | sw == dw: bit 0 cleared, RSZ2 kept; else bit 0 set and RSZ2 = sw*4096/dw if sw < dw and exact, else (sw*4096 - 4097) / (dw - 1) | `0x501e0f3e..0x501e0fc2` |
| IMG1RSZ1/RSZ4 | sh == dh: channel 2 sets bit 4 and RSZ4 = 0x2000, channel 1 clears bit 4; else bit 4 set and RSZ4 = sh*4096/dh if sh < dh and exact, else ceil((sh - 1)*4096/dh), doubled on channel 2 (A12) | `0x501e1046..0x501e1113` |
| IMG1FMT | (old & ~0x3F) \| YPYC << 4 \| format | `0x501e07e5`, `0x501e1e95` |
| DMAEN | (old \| 0x20) & ~0x08 (bit 3 cleared because the face-frame IMG3 word is 0 in the lab, section 10.3) | `0x501e20f3..0x501e211a`, `0x501dcad2` |
| CTRL3, CTRL2 | old \| 0x40 (progressive) or \| 0xC0 (two-field) | `0x501e04b7`, section 10.6 |

check_liveview G3 compares every register of both banks after 80 random requests per device and seed (60 inside the domain: crop x a multiple of 64, 1:1, downscale, exact and non-exact upscale, odd and even sizes; 20 outside: crop x not a multiple of 64, from_area {0, 0}, device_type bits 8..31, from_area.hw not a multiple of 64, an address not 128-aligned) with these formulas, requires every other register unchanged and the mirror bank to hold only latched copies, and runs six mutated formulas (no +8 burst, no A12 doubling, from_area instead of from_target in the step, SPOS from the address, AREA width not masked, DMASADR without the crop), each of which must fail on at least one case (the A12 mutant on channel 2 only). It also checks that a request with device_type 0 logs `0x3700310b` and changes nothing, and that a layer_format 0 request after `0x501e1e95(ch, 3, 0)` keeps IMG1FMT[3:0] = 3, IMG1PLANC and IMG1DMASADR2, after which a layer_format 1 request equals the formulas again.

Inside the model's domain: layer_format 1 (or 0 with format 0 already in IMG1FMT, the rec form), any crop x since M8 (A18: SPOS = `(x mod 64) & 126`, the address of pixel `x & ~1`; before M8 only multiples of 64), STILL or any colour-space pair except BT709 -> BT601 (YPYC), CMM state 0, zebra off. RSZ3/5 are never written on this path.

### 10.5 What the composite rests on

A TH composite with A15 off is `FEATURE_UNOBSERVED` with exactly one error, CTRL3 `0x41`. With A15 assumed the composite equals `reference()` word for word for TFT and EVF, the rec and the scaled form, banks 0x0a and 0x75 (G4; banks 0x0a and 0x75 lie in different window segments). Downscale, 1:1 and non-exact steps whose taps stay inside from_target compose; exact upscale (2x 450x300 -> 900x600) and the vertical escape case (non-exact upscale whose last row's second tap leaves from_target, e.g. 40 -> 427) are IMG_EDGE_UNKNOWN reason 3 (G5). G5 also exercises the TH attach rules of section 8: from_target past a smaller loaded frame is reason 3 (clipped to the frame), a crop origin before, above or outside the frame, a request stride that differs from the frame's, and a frame reloaded elsewhere after the attach are reason 4.

### 10.6 CTRL strobe and the scan

`0x501e04b7(ch, en)` ORs into CTRL2 (`+4`) when en != 0 and into CTRL3 (`+8`) when en == 0; the value is `0x40` when byte `0xa32ddd3c[ch]` == 1, else `0xC0` (`0x501e04b7..e4`). The byte is written by `0x501dff6f(ch, progressive)`, which also sets SYNC1 bit 24 and the word `0xa32ddd30[ch]` = 16 (progressive) or 48 (`0x501dff6f..ab`); `0x501df7ad` resets it to 0. The frame-rate setter `0x501e298b` calls `0x501dff6f` with 0 on its two-field branch (the one that writes SYNC1 `0x10000001`, SYNC2 657, SYNC4 658) and with 1 on its progressive branch. Executed: progressive TH call CTRL3 1 -> `0x41`; after `0x501e298b(1, 1)` CTRL3 is 8 and a TH call makes it `0xC8` (G8). Reading: bit 6 = first field or frame, bit 7 = second field (I); the effect on the picture is ? (A15).

### 10.7 DISPLAY cmd 5

Jump table `0x602abbfc` (= `0x5028abdc`), index cmd - 2: cmd 5 -> `0x501c3250`, cmd 17 -> `0x501c32ca`, cmd 18 -> `0x501c3324`, cmd 31 -> `0x501c31f4` -> `0x501c4e62` (not decoded), cmd 32 -> `0x501c31ff`. cmd 5 calls `0x501da22f(d0 = entry & opened, a0 = P, d1 = 1)` for each mask table entry in P+0 (`0x501c3289..a6`); it never calls `0x501c3f4d`. Parameter P (`0x501da22f..0x501da3bd`):

| Offset | Field | Use |
|---|---|---|
| +0 | u32 device mask | |
| +4, +8, +12 | u32 IMG1..3 MM handle (-1 keep, 0 none) | IMG1 only while the permit is clear (`0x501da298..a5`): `0x501da0de(mask)`, word `0xa32dd8f8[ch]` = handle, img[0] = `0x50534dd1(handle)` or 0, `0x501dca34`; at the tail, when `0x501c41a5(mask)` == 0 (`0x501da619..23`) and the handle != -1, `0x501da1b3(mask, handle)` (`0x501da62f`): panel geometry `0x501df27a` (`0x501da1f4`), then for a handle != 0 `0x501e1e95(ch, 0, 0)` IMG1FMT, `0x501dffae(ch, 5568, 0, 0)` stride, `0x501e0137(ch, 0, 0, 0)` SPOS, `0x501e0045(ch, panel width, 0, 0)` IMG1DMABN = `ceil(width / 64) << 3` (`0x501da202..27`; executed, G7); IMG2 regardless of the permit (img[1], `0x501da330..69`) |
| +16..+27 | three further u32 (OSD handles in the probe layout) | not traced here |
| +28 | u16 x3 PLANC (0xffff keep) | 0 -> 128, v < 128 -> 128 - v, else 0, into planc[] (the IMG1 entry only while the permit is clear) |
| +34 | u8 through permit | `0x501c40d9`: 0, 1, 2 keep |
| +36 | u32 BG pointer | non-NULL -> `0x501de377` |
| +40 | u32 x3 layer_format | non-zero -> `0x501e1e95(ch, 0x501dc7b8(v), plane)` (the IMG1 entry only while the permit is clear) |

Executed (G7): keep-all changes nothing; +34 = 1 sets the permit and a TH call then works without `0x501c40d0`; with the permit set an IMG1 handle leaves img[0] alone (TH-owned); with the permit clear img[0] = `0x98d4d800` for handle `0x0a01` (error log `0x08010005`, observed, not decoded); DispBlack (all 0) leaves only the background, equal to the reference.

### 10.8 DISPLAY cmd 32 (EVF frame rate)

`0x501c31ff -> 0x501c468e`: needs `0x501c3b1e()` bit 1 (EVF active); idx = `0x50023b4c()` (property 270 when `0x50024dcf(2) == 1`, else camera-state id `0x3091` through `0x500417da`); `0x501c6bb8(idx)` -> `0x501e298b(idx, 0)` plus period writes (`0x50023cec`: 8341 for idx 1, 16683 for idx 0), power/clock calls `0x501c65a5` and frame waits; then `0x501deec2`/`0x501e195f` x6 and `0x501c48a7(0)`. In the lab the camera-state store is empty, `0x50023b4c` returns 0 (error log `0x1c005002`) and cmd 32 changes only HIBC (`0xf`); the two-field mode is reached by calling `0x501e298b(1, 1)` directly, as `check_display` does (G8).

### 10.9 Rec-view request (rec_misc `0x5054c1ad`)

rec_misc memsets the request R = sp+44 (`0x5054c213`) and stores only these fields before `call 0x501c3f4d` at `0x5054c346` (record = a2, centre (cx, cy) = record +228/+230, size (w, h) = record +232/+234, E = 0xFFFE, `/` = signed division): +0 = record+140; +4 = `0x50534dd1(record+220 handle)`; +40 = +56 = ((cx - w/2) & E, cy - h/2) (`0x5054c29c..c4`, `0x5054c2fe..0x5054c324`); +44 = the handle's geometry from `0x50535324` (`0x5054c1e4`); +48 = +52 = (w & E, h) (`0x5054c2d8..fb`); +60 = (cx & E, cy & E), +64 = (w, h) (`0x5054c225..65`); the byte +68 = aspect code (`0x5054c26b..99`: the byte at (record+28)+38122 = 1, 2, 3, 4, 9, 10 -> 0..5, else 255); +72, +76, +96, +100..+103 and +20 = 0. Nothing is stored to +12, so layer_format is 0: `0x501dac92` skips the format setter, the plane keeps the format already in IMG1FMT (0 in the lab), and the tail passes `0x501dc7b8(0)` = 0 to `0x501e20c6` (no second plane). from_target = to_target and from_coordinate = to_coordinate: a 1:1 crop with no scaling, colour fields and drange 0. The fit fields are read only on the fit path (section 10.3 step 6), which the lab never takes. `ThRequest.rec_view(mask, address, centre, size, aspect)` builds exactly these fields; the aspect code is the caller's choice (the setting byte is not modelled). G3 shows the layer_format 0 rule (a format set before by `0x501e1e95` survives the call, IMG1PLANC and IMG1DMASADR2 unchanged); G4 composites this form.

### 10.10 Not reached, open

HDMI (M8, executed in check_display group 13): DISPLAY cmd 2 with mask 4 sets the opened mask `0xa32db39c` to 4, then polls `0x501d30f6` (the byte `0x62a3c8ec` == `0xF0`; it reads `0xFF` in the lab, so the getter returns 2) 50 times with OlyTaSS(20) between (`0x501d5c24..0x501d5c56`), logs `0x37008201` (level 2, 1, 259) at `0x501d5c75` and jumps past the rest of the open (`0x501d5c7c -> 0x501d5e94`). The flag is the EDID/sink side; past it the HDMI open needs that side and the EDID data. The HDMI branch beyond that wait and channel 0; the panel-plus-HDMI paths behind `0x501dcaf7() == 1` (section 10.3 step 6); the meaning of the EVF side call `0x501c5604(1)` and of DISPLAY cmd 30 (reached, section 10.3 step 1); the callback `0x50035afd` (M10B: the inter-CPU post, reached by the Super Control Panel, intc/timer spec section 2); egpk; the mvr request builders `0x50453c2e`/`0x50453d88` that hold the camera's live-view geometry and colour values, and who drives the stills live view; the allocation path `0x504518ab -> 0x505350ac` (the lab allocates nothing, hence `0x08010004/5`); what CTRL3 bit 6 does to the picture (A15); the field-mode sampling (FIELD_MODE).

## 11. Colour management (CMM, M7)

### 11.1 Selector `0x501de269(R)`

drange_ptn 0 -> 0. prm_pic_mode 253 (HLG): output 1 -> 1, else 0 (lut_onoff and input not tested). 254 (SUPERFLAT) and 255 (LOG) need lut_onoff != 0: 254 with (input, output) (2, 1) -> 2, (2, 2) -> 3; 255 with (2, 1) -> 4, (2, 2) -> 5, (3, 1) -> 6, (3, 2) -> 7; anything else 0 (`0x501de269..0x501de310`). G6 compares all 216 combinations of drange 0..2, lut 0/1, mode 0/253/254/255, input 1..3, output 1..3.

### 11.2 ON and OFF

ON `0x501dc344(mask, state, drange)`: half = 0 for drange 1, 1 for drange 2; any other drange logs `0x37001415` and uses half 0 (`0x501dc37b..0x501dc39e`). sel = 0 on TFT/EVF; on HDMI (mask bit 2) 17, or 1 when `0x501d623a() != 0` (`0x501dc3ad..c5`: `and 4` on the mask skips the whole block on TFT/EVF, so `0x501d623a` runs only for HDMI). Entry E = `0x602c20b0 + 288*half + 36*state`; `0x501e0804(ch, sel, E)`; `0x501e0e1f(ch, &{1, 0})`; byte `0xa32ddb81[ch]` = state. OFF `0x501dc3fd(mask)`: `0x501e0e1f(ch, &{0, 0})` and the byte = 0. `0x501e0e1f(ch, &{en, x})`: CMMSET1 = `(old & 0x7FFFFEEF) | en << 31 | x << 8 | en << 4` (`0x501e0e1f..48`).

### 11.3 Table setter `0x501e0804(ch, sel, E)` and the entry

E = 7 u32 pointers P0..P6 (+0..+24) to u16 arrays, then bytes b28..b33. Writes (symbolic reading of the straight-line code `0x501e082d..0x501e0e1a`):

- CMMSET1 = `(old & 0xC88CEFFE) | b32 << 28 | b33 << 24 | b31 << 20 | b30 << 16 | b29 << 12 | b28`;
- CMMSET2 = sel;
- CMM1_KNEE(2i+1) = `P1[i] << 16 | P0[i]`, CMM1_KNEE(2i+2) = `P2[i]`, CMM2_KNEE(2i+1) = `P4[i] << 16 | P3[i]`, CMM2_KNEE(2i+2) = `P5[i]`, i = 0..15;
- only when b33 == 5: CMM_COEF1-5 from P6 (`0x501e0da7..0x501e0e1a`).

66 registers per ON (CMMSET1, CMMSET2, 64 knees). In the image b33 is 0 in all 16 entries, so CMM_COEF1-5 are never written and CMMSET1[26:24] = 0. CMMSET1 after ON (both halves): state 0 `0x80000010`, 1 `0x80320010`, 2 `0x80010010`, 3 `0x90010010`, 4 `0x80210010`, 5 `0x90210010`, 6 `0x80320010`, 7 `0x90320010`. G6 checks CMMSET1, CMMSET2 and all 64 knees for states 1..7 with drange 1 and 2 and for drange 3 against these formulas applied to the table read from the image file, CMM_COEF unwritten, the state byte, and OFF clearing only CMMSET1's enable bits.

### 11.4 What the data suggest, and what is unknown

In the entries P0 and P4 rise from 0 to about 1010-1022 (10-bit), P1 and P3 rise to about 14000-15000, P5 falls: CMM1 looks like a curve from a 10-bit code to a wider linear range and CMM2 like a curve back (I). CMMSET1[29:28] = 1 exactly in the states whose output is BT709 (3, 5, 7) (I). Unknown (?): the knot interpolation, the colour domain the curves act in (RGB or YCbCr), the matrix stage with CMMSET1[26:24] = 0 and COEF unwritten, where the stage sits relative to the mixer (before or after, A14), and whether it acts on IMG1 only. The model therefore keeps every CMM register in the never-written class: a composite after ON is FEATURE_UNOBSERVED with 66 errors, and stays so after OFF (the registers stay written). A STILL request (prm_pic_mode 0, any drange) selects state 0 and writes no CMM register as long as no CMM state was set before (byte `0xa32ddb81[ch]` 0); once an ON has run, OFF leaves the 66 written registers and every later composite stays FEATURE_UNOBSERVED (G6). Whether the camera's own live-view request is STILL is open (section 10.10).
