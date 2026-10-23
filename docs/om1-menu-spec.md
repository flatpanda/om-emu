> Status (2026-10): implemented by `emu/src/lab/menu.mjs` (lab), `emu/src/lab/menudata.mjs` (offline decoder),
> `emu/refs/menuref.mjs` (independent reference, with the navigation rules `Nav`), `emu/src/lab/nav.mjs` (navigation,
> M6) and checked by `emu/checks/check_menu.mjs` and `emu/checks/check_nav.mjs`. Consolidated from analysis reports that
> are not part of this repository (menu layout data, page paint, kernel, event path) and what the M5/M6
> implementations read from the code (marked "M5"/"M6"). The settings store is in `docs/om1-settings-spec.md`.

# OM-1 menu pages: data, GUI path and the M5 reference

Firmware = E143 v1.9 main block. Code addresses are disassembly notation (body offset + 0x50000000);
data addresses run-time (body offset + 0x60021020). Tags: **X** executed in the lab, **D** read from the
code at the cited address, **V** holds for every record of the table (`check()` in `emu/src/lab/menudata.mjs`, run by check_menu group 0), **I**
inference (the check tests it), **?** unknown.

## 1. How a page is built and painted (X, D)

- GUI task: the creator `0x5108bc37` runs Genifa event init `0x510c2826` and creates GUI_TASK (entry
  `0x5115ba0c` -> WinMain `0x510c2830`) and the Genifa timer task (`0x510c1d01`) through OSAL
  `0x50b01412` -> acre_Task `0x5002ca1f` (kernel spec 5.5). WinMain builds pools, loads the language
  (`0x51257bfb`), inits Genifa, the GuiCaller (`0x5115b1f6`), the application window (`0x5109ff2b(2880)`,
  ctor `0x510e80a2`) and loops in `0x510c2a1b` (GetEvent `0x510ba415`); it idles in state 0x0102
  SS_COMMON/ID_ST_POWER_ON. State names come from the firmware's table `0x61596fb8` (`0x5124b459`).
- Event: `GuiCallerImp::sendEvent` `0x5115b286` maps its index through `0x614b5a14` (8-byte entries, u16
  at +4); index 0x87 is the only one giving message 0x9624. In POWER_ON, 0x9624 runs `0x51205308`
  (`mov 2817,d0` at `0x51205325`: state 0x0b01 MENU_ENTRY); `SsMenu_Menu_Entry` `0x5120cb17` builds the
  tab-menu viewer; after the paint the GUI posts 0x9624 itself from `0x5124f588` and ends in 0x0b02
  SS_MENU/ID_ST_MENU. Which camera event the MENU button sends is not traced.
- The viewer (`Menu_ListMenu_Tab_Menu_Viewer`, code `0x511bd000..0x511bf900`) fills a 2428-byte buffer at
  viewer+4476 and publishes it as Genifa variable 226 (`0x51090ea1(buf, 226, 2428)` at `0x511be1bc`), then
  shows panel 329 (`mov 329` at `0x511be17b`, ShowPanelEx `0x5124f726`). Panel 329 (id 0x603f, object
  `0x510e35ca`, 150 child slots, build loop `0x5110bcf8`, descriptors `0x6036bb44[1..149]`) copies the
  variable into its widgets (`0x5110c025`, section 8).
- Paint (message 0x1002): per GUI layer a FILL of the panel, then the widgets (text widget `0x510a54a1` ->
  DrawText `0x510ab0f9`; image widget `0x5109e1ef` -> `0x510aeae0`/`0x510ae838` -> device op `0x510bc208`
  -> gpiDrawBitmap), partly visible cells through the kind-3 offscreen record (COPY, draw, COPY back).
  The firmware brackets with exec_start/exec_end (`0x510bd855`, `0x510bd8e4`), flips the front/back byte
  `0x603672f0` (`0x510bcab8`), calls gpiUpdateDisplay and copies front to back. A second 0x1002 repaints
  the tab band (gc clip (130,0)-(769,61)) into the back buffer and copies it to the front.
- Palettes: palette kind 8 (MENU_SETUP; `0x51241fd5(8)` from `0x5110c025`) -> `0x5124fdb9` parks palettes
  86/87/85 for GUI layers 0/1/2 in `0x60367300` (`0x510bcc16`); the flip's `0x510bd8e4` applies them and
  gpiUpdateDisplay uploads them (X).
- Requests the menu entry makes to camera-side servers (answered by S-RPC): `0x50af8487` from the camera
  API vt+40 call at `0x5120cc98` ("setIgnoreFinderStyle"), and `0x50ac734c` + `0x50af8487` from
  chgBackGround `0x512500c1` (reqDrawJpeg `0x510ca1e1`, background JPEG 607, IMG plane stays empty) (X).
- A synchronous send (S-SEND): `0x50045462` = `movhu (0x600431d8),d0; mov 10,d1; mov 0,a0; call
  0x5002e39d`, called from `0x50420b82` (chain `0x5120cb17` -> `0x5120ce5d` -> `0x50db52d4` -> `0x50b023ef`
  -> `0x50abadb2` -> `0x50420b63`), in state 0x0b01 outside any display run; queue id 10 at run time. The
  caller does not read d0: `0x50420b89` is `mov 2,d1` and `0x50420b8b` `mov d2,d0` overwrites it.
  `0x5002e39d` is synchronous: it creates a reply queue (`0x5002c866`), OlyQeWr (`0x5002c151`) {reply
  queue, tid, cmd = d1, param = a0}, then OlyQeRd (`0x5002c067`) with timeout -1 on the reply queue. The
  receiver waits on the flag `(0x60042f86)` with pattern 7 (`0x50043d2a`), then `btst 2` at `0x50043d44` tests bit 1
  (mask 2) of the word at (24,sp), and reads the queue at
  `0x50043d8b` (dispatch `0x50043f55`); it does not run in the lab, so the send is dropped and what cmd 10
  does is unknown (?). Any other non-DISPLAY synchronous send raises.
- Camera property 4513 (S-PROP): the GUI path reads it 29 times on page 1 through the gate `0x503eff27`
  (`mov 4513,d0; call 0x503ee3bf` at `0x503eff59`, whatever the gate's argument), 24 times from
  `0x50ab651a` (calls at `0x50ab6521`/`0x50ab652c`, mask 0x10 tested at `0x50ab6533`) and 5 times from the
  calls returning to `0x50ae883f`/`0x50ae8899`/`0x50ae8aad`. The lab answers the device the
  display was opened on (1 TFT, 8 EVF). With the empty store's 0 the page is drawn the same but
  gpiUpdateDisplay sends no DISPLAY cmd 4/17, so nothing reaches the VSC (X; `check_menu --mutants`
  gui-4513-native). Which branch the value selects is not traced.

## 2. Tabs (D)

`0x511bd96f`: 8 tabs; tab id = u16 `0x61527174[i]` (`0x511bda00`); 8 x 12-byte entries at `0x6152722c`
{u16 tab id, u16 page count, u16 *page ids, u16 *cursor-memory setting ids} (`0x511bd97e`, `0x511bda1f`).
Tab index 6 (id 7) holds the six Setup pages 0xea..0xef with cursor memories 1914..1919. The tab names
are drawn as icons (children 21..28).

## 3. Pages, records, descriptors (D, V)

Page header list `0x6152d6b8` -> 42 x 16-byte headers {u32 page id 0xcb..0xf4, 8-byte title descriptor,
page record}. Page record (28 bytes): {n, labels, helps, n2, value lists {u16 mode, u16 count, items},
n3, 2nd-layer lists} (`0x511beb26`, `0x511be725`, `0x511be964`). Items are {u32 key, descriptor},
searched by key (`0x51188203`). Descriptor {u16 type, u16 id, char *literal} (no literal = `0x615273e4`).
`0x51188203` fills a 108-byte record: +0 type, +2 image id (types 3/7/8/12), +4 string id (1/2/4/9/10/11),
+12 the literal widened (types 1/2/5..11); +6 (style) and +8 (edge flag) are set by the viewer. The
generic renderer `0x51241ff9` (jump table `0x615889b4`):

| type | content |
|---|---|
| 1 / 2 | literal + GetString(id) / GetString(id) + literal |
| 3 / 12 | image id; 12 remaps style 1..9 to 10..18 when +8 == 0 (`0x61588990`) |
| 4 | string id (`0x51241a80`); id 0 sets no text: `0x51241a80` hides the widget (`0x51241a89`), but the case ends at `0x512421c2` with a3 = 1 and the tail shows the text widget again (`0x51242293..9c`), so it keeps the text it held, in the style's text colour (`0x51242210..40`); no Setup descriptor has it, the reference refuses it |
| 5 / 6 | literal / literal with each '0' as L"@A08D@0" |
| 7, 8 | nothing |
| 9 / 10 / 11 | "@A028@" / "@A070@" / "@A061@" + literal + GetString(id) |

Row order: `0x51170afb` searches `0x614da31c`; for every page kind = page id + 4 holds one list equal to
the label order (V). At most 7 rows are visible; no Setup page has more.

## 4. Values (D)

For each row with a value list (`0x511be71f..0x511be773`) `0x511beb9a`: a mode in the 36-entry handler
table `0x6152d6c0` is passed to its handler; otherwise value = API vtable +12 (`0x50b4e86d` ->
`0x50b7b618`, the settings store) and the first item whose key equals it fills the record; no match
leaves the record zeroed. Handlers read for M5:

| handler | modes | rule | evidence |
|---|---|---|---|
| `0x511bf0a6` | 14 modes | store mode from `0x60373f64` {u16 menu, u16 store} (3200 = none), then as above | `0x511bf0bc` |
| `0x511bf488` | 5072 | v1 = store(1129); key v1; for v1 in {0, 1} and store(1130) != 0 the search skips the first two items | M5: `0x511bf491..0x511bf4ea` |
| `0x511bf4f4` | 1400 | store(1400) == 0: key 0; else type 5, swprintf(L"%3dOMSYS" `0x6152da18`, store(1133)) | M5: `0x511bf4fd..0x511bf558` |
| `0x511bf55d` | 179 | type 5, swprintf(L"%ddpi" `0x6152da2a`, store(179)) | M5: `0x511bf562..0x511bf591` |
| `0x511bf765` | 2031 | API `0x50b4436d` vt+24 result -> key 0/1 | M5: not predicted (the API is not decoded) |
| `0x511bf596` | 5339, 3416 | writes the per-row data of children 69..131 | not decoded (R5/R6) |
| `0x511bf7a2`, `0x511bf8d2` | 5120, 3269 (page 6) | clock, firmware version | not read |

The store is RAM built at run time. Since M6 the lab builds it with the firmware's own blank-store init, so values are
the firmware defaults (settings spec sections 4 and 6); M5's empty store (value 0) remains as `check_menu
--store empty`.

## 5. Panel 329 widgets (D, V; M5 additions marked)

Widget descriptor (`0x5108cade`): +0 class, +2 id, +4 rects {s16 x, y, w, h} per layout (the app's +82
picks one; WinMain selects GUI display mode 1, layout 1 = the 900-wide rects, `0x510c29c8` ->
`0x510c2db4` -> `0x510a27d4`), +8 u32 -> widget +16, +16 u16 -> widget +30.

- M5: widget +16 holds the image alignment: `0x5109eb41` returns `& 0x30000` (horizontal: 0 left, 0x10000
  centre, 0x20000 right) and `& 0xC0000` (vertical: 0, 0x40000 centre, 0x80000 bottom). The image draw
  `0x5109e37e..0x5109e425` places the state image in the inclusive rect (x0, y0, x1, y1): x = x0, x0 +
  div0((x1 - x0 + 1) - w, 2) or x1 + 1 - w (signed division truncating toward zero), y likewise. Row
  backgrounds, tabs and page bars have 0x50009 (centre/centre), value images 0x60009 (right/centre),
  label and title images 0x40009.
- Descriptor +16 minus 1 is the GUI layer the widget is painted on (I, checked: 1 for the row
  backgrounds = OSD1, 2 for the rest = OSD2, 3 for some containers).
- 0x8010 text: +20 text id, +24..+47 DrawText style (colour, +4/+8 = 15, align, margins 0, edge), +48
  font 1. The DrawText box is (0, 0, w-1, h-1) with gc+12/+14 = -(x, y) (I, checked).
- 0x8003 image: +52 kind (2 = draw the state image), +53 state count, +56 states {u16 background (0xffff
  none), ..., u16 image id at +12}, +60 per-state LUT ids. The LUT id becomes gc+680 (`0x510bafbc`,
  `0x510b9b62`).
- 0x8013 and 0x0105: not decoded.

| children | content (layout 1) |
|---|---|
| 1..7 | row backgrounds (0, 141 + 64r, 900, 62), states 12365 / 12523 |
| 8..20, 135..149 | containers (0x0105) |
| 21..28 | tab icons (84 + 94k, 0, 74, 60), states 10210+k, 10218+k, 10226+k, 10234+k |
| 29 | scroll position, 10 states |
| 30, 31/32 | page number "N." (10, 60, 34, 62); title image/text (44, 60, 600, 62) |
| 33..40 | page bars (y 122, h 7), images 13305 (900x7), 13306 (900x5) |
| 41..47 / 48..54 | row label image / text (34, 141 + 64r, 510, 62) |
| 55..61 / 62..68 | row value image / text (586, 141 + 64r, 290, 62) |
| 69..131 | per-row icons (0x8013 and 0x8003, images 1825, 1826, 10296) |
| 132..134 | help box (hidden unless My Menu is empty) |

## 6. Variable 226: what the viewer writes (D; M5 read the writers)

The level ("focus") of the cursor model, f = `0x511bddd6` -> model+92 object vt+4 = its u16 +84: page ids
203..239 are initialised by `0x51161dde`, which searches the table `0x614c3c54` (`add 0x614c3c54,a2` at
`0x51161e05`, 36-byte entries, 160 of them, bound at `0x51161e52`) and then stores 1 at +84 (`mov 1,d0;
movhu d0,(84,a3)` at `0x51161e57`) on both the found and the not-found path (M5). So f = 1 on entry,
whatever the page id.

| offset | written by | value on entry (f = 1, normal menu mode) |
|---|---|---|
| +0..+7 tabs | `0x511be2df..0x511be30a` | current tab 1, others 3 (f == 2: 2 and 4) |
| +10 page number | `0x511be3a9` L"%1d." (`0x6152d7e0`) | "N." |
| +16 number colour code | `0x511be3bf..d3` | 5 (f == 1) else 6 |
| +20 title record | `0x511be3d6..0x511be415` | the header descriptor, style 6 (f == 1) else 7, +8 = 0 |
| +128 / +129 | `0x511be42c` / `0x511be471` | page index + 1 / page count |
| +132 + 108r labels | `0x511be699` | label descriptor, +8 = 0 |
| +888 + 108r values | `0x511beb9a` | section 4 |
| row style (+6 of both) | `0x511be6ac..0x511be711` | f == 2: 1 on the cursor row, else 7; f != 2: 1 if s == 0, else 8 on the cursor row, 7 elsewhere; s = `0x511bdb2c(model, 0, r)` (not decoded) |
| +1910 / +1994 / +2282 per-row codes | same | 94 / 95 / 96 with the styles 1 / 7 / 8 |
| +2289 + 2r row backgrounds {state+1, code} | `0x511be789..0x511be7cc`, all 7 slots | f == 2: {2, 11} on the cursor row, hidden elsewhere; else {1, 5} on the cursor row, {2, 11} elsewhere |
| +2303, +2412.. | `0x511be319..4d`, `0x511be8c9..` | My Menu empty flag 0; container flags 0 (X) |

The rows loop runs over `0x511bdcb7(model, 0)` rows; the background loop always over 7, which is why a
6-item page draws 7 backgrounds.

## 7. Panel apply (D, M5)

`0x5110c025`: theme = `0x613a0ca8[i]` of the first tab byte equal to 1 or 2 (Setup: 8), then
`0x5110c096` containers (child 20 always visible; 8..16 and 135..143 by +2412.., panel+3820 = 1 if any),
`0x5110c35d` tabs (byte 0 hides, else state = byte - 1), `0x5110c3f6` child 29 (+8), `0x5110c42b` child 30
(literal +10, colour `0x512423d0` = THEME.text[code] directly, edge 0) and the title record to 31/32,
`0x5110c480` page bars, `0x5110c6b9` labels to 41+r/48+r, `0x5110c797` values to 55+r/62+r and the per-row
data to 69.., `0x5110ce0e` row backgrounds, `0x5110ceab` help, `0x5110cef0` containers.

Page bars (`0x5110c480`): children 33..33+count-1 visible; the rect's x = `0x613a0d48[count-1][k]` and
x1 = x + `0x613a0e48[count-1][k]` (s16 tables, 16 bytes per row; `0x613a0cc8`/`0x613a0dc8` when the GUI
display mode byte `0x60368ba4` (`0x510c2f61`) is 0); the page's own bar gets state 0 and code 18 (21 when
panel+3820 = 1), the others state 1 and code 19 (22). Setup (6 pages): x 0, 151, ..., 755, x1 = x + 145.
`0x5124235f(widget, code)` sets the current state's LUT id to THEME.image_lut[code] (indexed by the code
itself).

Row backgrounds (`0x5110ce0e`, `0x512422f0`): state = byte - 1; code 11 keeps the state's LUT id, any other
code sets `(0x603751c8)[theme][code]` (Setup code 5 -> LUT 189).

## 8. Colours and LUTs (D)

`0x51241ff9` ends (`0x51242204..0x5124229c`) by turning the record style (< 24) into colours through the
theme `(0x60375200)`: text THEME[t].text[STYLE[code] text slot] (STYLE `0x61587fd0`, THEME `0x61587f58`);
edge THEME.edge only when record +8 == 1; image LUT id THEME.image_lut[STYLE[code] image slot]. Setup
(theme 8): text colours `[0xd, 0x10, -1, -1, -1, 0x13, 0x16, 0x19, 0x1c]`, so style 1 -> 13, title style 6
-> 19; type-12 value images style 1 -> 10 -> image slot 9 -> LUT 186.

The bitmap LUT the GPI callback passes to gpiDrawBitmap (M5, `0x510bc507..0x510bc680`): colour map
`0x6147f318 + 12 * id` = {u32 n, u32, u8 *map}; no map -> no LUT; otherwise a u8 table with entries
0..min(n, bound[layer]) - 1 from the map (bound `(0x613286d4)[layer]` = 256/256/64) and the rest of the
bound identity; for image records of type 14..16 map entries equal to the record's +20 word become 0
(`0x510bc612..3e`). The index table[word & 0xff] becomes 0 only when the map is shorter than the bound
(`0x510bc646..4b` skips it when count >= bound) and the index is at or past the count (`0x510bc666..75`
`extbu d0; cmp d1,d0; bcs`, d1 = count from `0x510bc5fb`). All 295 colour maps have n = 256, so on layers
0/1 the index rule never fires; maps with map[0] != 0 (12, e.g. 27, 53, 69) keep table[0] = map[0]. (The
u16 table at `(0x613286c8)` is built the same way, `0x510bc5c4..d7`, and not used by the draw path.)

## 9. DrawText alignment (M5, D)

Step 7 of DrawText, read at `0x510ab46d..0x510ab4b5` (vertical) and `0x510ab53d..0x510ab57f` (horizontal);
box after margins (x0, y0, x1, y1) inclusive, w = x1 - x0 + 1, h = y1 - y0 + 1, n lines, line height lh,
gap gc+676: vertical 0 / div0(h - (n*lh + (n-1)*gap), 2) / h - (n*lh + (n-1)*gap); horizontal per line 0 /
div0(w - width, 2) / w - width, div0 truncating toward zero. The line width is the measure pass's sum of
iterator +8 (+20/+22 are 0 on every path of `0x510bed1e`) over the units with a non-zero measure, times
the horizontal scale, plus the spacing between them (`0x510ab383..0x510ab45f`). n: every line break (LF
or CR LF) records a line, empty or not (`0x510ab396..0x510ab3ce`); at the end of the string the last line is
recorded only if its measure count d3 is non-zero (`0x510ab42f` `exth d3; cmp 0,d3; beq 0x510ab462`), so
text ending in a break has no trailing empty line and '' has n = 0; the loop stops once n reaches
allowed = ceil(h / lh) (`0x510ab423..2a`), always right after a break has cleared d3 (`0x510ab3b2`,
`0x510ab3c9`). An empty box (x0 > x1 or y0 > y1, `0x510ab1d3..ec`) returns at `0x510ab782` before step 7,
so h >= 1, allowed >= 1 for a positive lh, n <= allowed, and the 'n > allowed -> offset 0' test at
`0x510ab46a` cannot fire. n = 0 draws nothing (`0x510ab4ea..f0`). `emu/refs/font.mjs` returns no lines for an empty
box and refuses a line height <= 0. None of the 18 languages' strings ends in a break.
`align_box` in `emu/refs/font.mjs`.

## 10. The reference and its inputs (`emu/refs/menuref.mjs`)

The reference builds the element list of a page (FILLs, image draws, DrawText calls) from sections 2..9 and
rasters it with `emu/refs/font.mjs` and `emu/refs/osdfmt.mjs` under the engine's U1 key rule (refuse / skip / write). Inputs
not derived from code, each tested by `check_menu`:

| input | tag | value |
|---|---|---|
| paint-pass FILL colours | X | GUI layer 0/1/2: 127 / 255 / 31; source not traced |
| row state s | I | 0 on every row of the Setup tab except the rows below (`0x511bdb2c` level 0 -> `0x511b5689` -> item objects vt+12, not decoded); other tabs are refused, because the lab contradicts s = 0 there (tab 5 page 1, cursor 3: labels in colours 22/25, styles 7/8, not 13) |
| row state with the defaults | X | M6: with the firmware defaults page 1 row 2 (video Card Slot Settings) and page 4 row 1 (Bluetooth), rows from 0, have s != 0 (style 7, colour 22; style 8 under the cursor); with M5's empty store s = 0 everywhere. Which store values the item objects test is not decoded (`ROW_STATE_DEFAULTS`) |
| cursor row | I | cursor-memory value - 1, for values 1..rows of the page only; other values are refused (the path value + 1 (`0x511bdfea`) -> kind-6 object +140 -> level 0 is not decoded; observed in the lab, not modelled: page 2 (3 rows) 0 -> row 3 and 5 -> row 1, page 1 (6 rows) 7 -> row 1, rows counted from 1) |
| paint order, layer | I | per layer: the FILL, then visible children in index order; layer = descriptor +16 - 1 |
| text box | I | (0, 0, w-1, h-1), origin = rect (x, y) |
| second pass | I | the band repaint leaves the displayed buffers equal to the first pass |
| zeroed record, child 29, containers, menu mode | I | draw nothing / hidden / draw nothing / normal tab menu; for the zeroed record only the zeroing is inferred: the renderer's type 0 is read from code (`0x51241ffd..08` -> `0x51242204` with a3 = 0 and (40,sp) = 0, both widgets hidden at `0x51242285..9c`) |
| glyph cells | I | a fully visible cell's bitmap is drawn whole (also left of the pen by pad_l); a partly visible one only inside the cell rect clipped |

Layout (M8): `Reference(lang, layout=1)` builds layout 1 (rects[1], 900 x 600, bars `0x613a0d48`/`0x613a0e48`); `layout=0` builds the EVF layout of section 14 (rects[0], an 800 x 600 panel, bars `0x613a0cc8`/`0x613a0dc8`); `Raster.window` returns the layout's panel width. Layout-1 output is byte-identical to M7's.

Not predicted (unverified cells, masked with their area in `check_menu_notes.txt`): value cells and the
per-row children 69..131 of the rows with handler `0x511bf596` (page 3: Monitor Adjust, mode 5339, and EVF
Adjust, mode 3416, the 2nd and 3rd rows) and `0x511bf765` (page 4: mode 2031, Bluetooth, the 2nd row).
`check_menu_notes.txt` prints 0-based row indices ("row 1" = the 2nd row).

## 11. Verification (`emu/checks/check_menu.mjs`)

Default matrix (native store since M6): pages 1-6 en (U1 A), page 6 ja (A), page 1 ja/zh-CN (A), page 1 en/ja/zh-CN and page 5 en (B), page 1 en refuse, EVF page 1 en (A), EVF page 1 en in the EVF layout (A, A15; M8), seeded page 5, cursor 3 (page 1) and 7 (page 5), plus two G2 sessions (display only on K-native). `--quick` is one session (page 1 en, A) without G2; a group with no session of its kind prints [skip]. Groups: 0 offline (also: the reference refuses cursor values outside 1..rows and tabs other than Setup); 1 bring-up, S-SEND/S-PROP sites, a value for every native settings read, no unlisted hook outside display runs, and G2 (with a direct test of the S-SEND rule); 2 the first pass's DrawText, image and FILL calls equal the reference in order; 3 displayed buffers equal the raster under A and B; 4 the refused BITMAPs in the default model equal the prediction (direct draws; kind-3 path refusals are counted, not predicted); 5 composites equal `check_display.reference()`, the only VSC error is PAL_UNWRITTEN for OSD2 index 255 with the predicted count, U1 A/B differences pinned (page 1: en 0, ja 20, zh-CN 1; page 5 en 3 pixels); 6 EVF (without the B2 inputs: the TFT layout, same buffers as the TFT session; M8 adds `p1-en-evflayout-A`, S-TAKEOVER and H-CONNECT on the EVF, compared in groups 2/3/5 against `Reference(layout=0)` with the composite under A15, mode byte 0 at the menu); 7 seed; 8 cursor; 9 negative controls; 10 notes (default mode only; `--write-notes` is refused with other modes). `--full`: pages 1-6 x 3 languages x A/B. `--mutants`: a child killed on timeout must leave no process or temporary directory, then five broken harnesses (S-PERSIST page + 1, no CTORS, no engine interrupt in settle, S-PROP off, composite against the other device's reference) must be reported. Page 6 masks the clock (`0x511bf7a2`) and firmware-version (`0x511bf8d2`) cells; the language row is a normal value cell. The reference store is the settings reference's (`emu/refs/settings.mjs`) defaults overlaid with the session's S-PERSIST writes (language 3009, tab, page, cursor memory) and the seed. `--store empty` (`OM_MENU_STORE=empty`) runs M5's empty store on pages 1-5 only: page 6 checks the SCPU signature the native DB init writes (reg0 = 0xa8); without it the page takes the SCPU clock-set path (command 0x20041001 at `0x5004e35f`) and the CPU traps at `0x00008959` (which call jumps there is not traced). The notes are compared only in the default native run.

## 12. Open items

| id | item | state |
|---|---|---|
| B1 | page 6 reads MMIO `0x98e00000` at `0x5004e384` (tab actuator `0x511bde6b` -> `0x5115bb61` -> ... -> OSAL `0x50b01314` -> `0x50b7ae3f` ... `0x5012b7cd` -> `0x5005a59e`) | closed (M6): the SCPU interface `om1.scpu`, settings spec 3 |
| B2 | EVF shows the TFT layout (display mode 1) | done with two labelled inputs (M8, section 14: S-TAKEOVER, H-CONNECT); the composite rests on A15; the normal-boot route, the 0x9601 sender and a photo are open |
| B3 | U1: A and B composites differ on some pages | open (hardware) |
| B4 | background JPEG 607, finder-style request | open (no server task) |
| B5 | U16: OSD index 255 never uploaded | partly (M8): no v1.9 path uploads indices >= 128, and palettes 85/86/87 give tra 0 at entries 127 and 255 (text spec U16); what the pixel shows needs hardware |
| B6 | values are the empty store's or a seed's | closed (M6): firmware defaults from the native store init |
| B7 | after a value-popup OK the GUI awaits EVT_10MS_WIZARD_MENU 0x9ac6 from Genifa timer 522 and re-posts every other event | done with lab time (M9): the event arrives at the predicted time and closes the popup (section 13.7, check_nav N3T) |
| R1 | image placement in the rect | read (section 5) |
| R2 | page bars | read (section 7) |
| R3 | tab states | read (section 6/7) |
| R4 | f read (1; 2 while a value popup is open, M6); s not decoded (Setup tab only, two rows with s != 0 under the defaults); cursor values outside 1..rows not modelled | partly open |
| S-SEND | queue 10 cmd 10 from the menu entry dropped; the receiver's effect | open |
| S-PROP | property 4513 for the GUI = the display device; the branch it selects | open (needed: without it nothing is shown) |
| R5 | handlers `0x511bf596`, `0x511bf765` | open |
| R6 | children 69..131 (class 0x8013) | open |
| R7 | DrawText alignment | read (section 9) |
| - | paint-pass FILL colours; container class 0x0105; the help box | open |

## 13. Navigation (M6)

### 13.1 Events

`GuiCallerImp::sendEvent` `0x5115b286` takes `{u32 index, u32 data, u32 kind, ...}` with index 1..334 (`0x5115b2a5`,
`0x5115b2af`), maps it through `0x614b5a14` (8-byte `{u32 index, u16 message, u16 0}`) and posts the message with
GESetEvent `0x510ba2c2(1, event)`, which drops a message already queued (`0x510ba39d..b7`) (D). The GUI's message
names are the 530-entry table `0x6159a3a4` read by the logger `0x5124b4c1` (D). The `EV_*` table at body `0xdb2130`
is a different numbering, used only by the name lookup `0x50abc864` (D). 30 indices map to 0x7fff, which has no
name; the nav harness (`NavLab`, `emu/src/lab/nav.mjs`) refuses them.

| keys (ON / LONG_ON / OFF) | index | message |
|---|---|---|
| UP / DOWN / LEFT / RIGHT | 8 / 11 / 14 / 17 (+1, +2) | 0x9004 / 0x9006 / 0x9008 / 0x900a (_ON) |
| OK / MENU | 20 / 23 (+1, +2) | 0x900c / 0x900e (_ON) |
| INFO ON / OFF | 37 / 38 | 0x9014 / 0x9015 |
| main dial / sub dial | 59 / 60 | 0x9032 EVT_ST_CHANGE_MAIN_DIAL / 0x9031 EVT_ST_CHANGE_SUB_DIAL |
| start / end menu | 0x87 / 0x88, 0x13f | 0x9624 / 0x9625 |

The camera side above sendEvent (UI_IN static task 84 posts codes `0x0203xxxx` to queue 6; the GUI-side receiver is
static task 58; the translation into GUI indices) is not traced; the lab injects at sendEvent.

### 13.2 Post, then settle

After bring-up the lab task calls `chg_pri(TSK_SELF, 50)` (`0x5000f9aa`), above every task the lab lets run (GUI 55,
Genifa timer 54, CHANGE 54, HLS_EYEFI 55, empty task 70). sendEvent then only posts (an observer on the GUI dispatch
`0x510c2a2e` raises if the GUI runs during the post); the GUI reacts in `settle()`. Budgets per event, 4 x the
measured maxima of the check scripts: 140 hook stops for the post (34 measured, the SET step's setter call), 40,000
for the settle (9,870, the first OPEN), 810 GESetEvent calls per step (202, an OPEN). A token is one event per settle;
a key click is ON then OFF (I).

### 13.3 Dials

The GUI reads a dial with `0x5014ba1c(id)`: `0x5014bb88` finds the id in the 4-entry table `(0xa32daab0)` and
`0x5014ba55..78` returns `(+10) - (+8)` of the slot's u16 counters at `0xa32daab4 + 16 * slot` and clears them (D).
The main dial message reads id 0x2031902 (slot 2), the sub dial 0x2031903 (slot 3) (X). The table comes from the
UI_IN init `0x5014b7c7`, which runs natively (settings spec 4); S-DIAL sets one counter word before each dial
event. The nav tokens are named after the counter words (`MAIN+n` = +8, `MAIN-n` = +10); the physical rotation is ?. The firmware's own writer of these words is `0x5014bae6(dial id, signed delta)` (a delta >= 0 adds to +8, a negative one to +10; input spec section 2); the player drives each detent through it and UI_IN's dial step (H-DIALSTEP), with the same GUI states and frames as S-DIAL (X).

### 13.4 Writes

Menu writes go through API vt+4 `0x50b4f28b`, which reaches the user-setting manager's value path `0x50ab51a1` ->
`0x503c49b4` (value to raw, then the store setter `0x503c6511`), not the raw path `0x50ac4afe` -> `0x503c49f7` the
harness SET uses (settings spec 2, 5); every write seen has d1 = 0, a value in a1 and returns 0 (X).

### 13.5 Observed rules (`NAV_RULES` in `emu/refs/menuref.mjs`)

| rule | tag | behaviour |
|---|---|---|
| updown | X | DOWN/UP: row +1/-1 modulo the page's rows; both wraps |
| page | X | RIGHT and main dial + (counter +8): next page, at the last page the next tab's page 1; LEFT and main dial -: previous page, at page 1 the previous tab's last page; tabs wrap 8 <-> 1 |
| tab | X | sub dial - (counter +10): tab index + 1 modulo 8; sub dial +: - 1; page 1 |
| entry_cursor | X | OPEN enters its page with row = the page's cursor memory - 1; a page entered inside the menu (RIGHT, LEFT, main or sub dial) gets row 0, whatever its memory (e.g. 1914 = 6, 1919 = 4 read by the getter at that step) and wherever the cursor was on it earlier in the session |
| mymenu | X | tab 8 (My Menu) shows 1 page without rows under the defaults (variable 226 page 1 of 1), although its tab entry lists 5 pages. The GUI keeps an internal page that MENU writes to 1882: 1 when entered with the sub dial (RIGHT/main dial + from Setup page 6 is not observed; the page rule predicts 1), the tab entry's last page (5) when entered with LEFT/main dial - from tab 1 page 1; OPEN with 1882 = 1 or 5 shows the same 1/1 page and keeps it; RIGHT and LEFT leave the tab from either internal page. Whether the shown page count follows My Menu content (empty by default) is undecided; 1882 = 2..4 is not observed and the reference refuses it. With 1882 = 5 and 1924 = 2 put in by S-PERSIST (`check_nav` N6) OPEN shows 1/1 and MENU writes nothing. UP/DOWN, OK and INFO there are not observed and refused |
| open | X | 0x87: tab = 1881, page = 1882, row from memory; writes 1446..1449 = 3200 |
| close | X | MENU on a page: state 0x0104 SS_COMMON/ID_ST_BLACK_SCREEN; writes only the memories that differ from the store: 1881 (tab id), 1882 (page), the page's cursor memory (row + 1); 1882 is the internal page on My Menu (see mymenu), and there (no rows, no cursor slot in variable 226) the internal page's memory = 2: 1920 for page 1, 1924 for page 5 (`LEFT MENU` from tab 1 page 1 writes 1881 = 8, 1882 = 5, 1924 = 2), meaning unknown; a second MENU with those stored writes nothing |
| ok | X | OK opens a sub-screen: a panel (Card Formatting 386 "Select Card to Set Up", still Card Slot Settings 339) or a value popup drawn by the viewer (variable 226 f = 2; Sleep, File Name, Auto Power Off) |
| unselectable | X | OK on a row with s != 0 shows a box "This item cannot be selected for the following reason." with a per-row reason over the page (page 1 row 2: "Camera Settings or Status"; page 4 row 1: "[phone icon] Initial Setting not performed"); MENU closes it. Variable 226 shows no change, so the nav harness (`screen_of` in `nav.mjs`) classifies the screen as 'page' and the Nav reference refuses OK on such rows |
| back | X | MENU in a sub-screen or an unconfirmed popup: back to the page, same row |
| help | X | INFO on a page shows the cursor row's help box (variable 226 +2421 = 1); INFO again, or DOWN, closes it with the row unchanged |
| noop | X | OFF messages change nothing |
| popup_ok | X | OK in a popup writes the selected item (also when unchanged), then B7 |
| popup_confirm | X | with lab time (M9): when Genifa timer 522 posts 0x9ac6 the popup closes, back to the page, same row, no further write (token B7, check_nav N3T) |

Decoding the 0x9031/0x9032 handlers and the tab actuator `0x511bde6b` would turn these X rules into D rules.

### 13.6 Store reads on the way

On OPEN the GUI reads 1881, 1882 and the page's cursor memory natively (X); a page entered inside the menu does
not use its memory (entry_cursor); the memories change only on MENU at the top level (close rule). The values the pages show are the store's (B6 closed).

### 13.7 B7: the popup confirmation waits for a Genifa timer

After OK in a value popup the GUI calls `0x5115c62a(1)`, sets its awaited event `(0x603710f8)` = 0x9ac6 EVT_10MS_WIZARD_MENU (`0x5115c64e`) and starts Genifa timer 522 for 100 units (`0x5124f980(522, 100)`, e.g. at `0x51162e23..33`) (D). While the awaited word is set, GuiCallerImp re-posts every other message (`0x5115c4fd..0x5115c5f6`, GESetEvent at `0x5115c5f6`), so a MENU after the confirmation loops (X: event storm, `check_nav` N3 pins it). The Genifa timer task `0x510c1d01` waits in OSAL `0x50b81c5c(-1)`; 1500 K-TICK ticks did not wake it (X), so its time source is not the kernel tick. The written value is in the store (the getter reads it back); without lab time the popup stays open.

M9 (lab time, `om1-intc-timer-spec.md` section 4): the time source is the 2 ms software tick (timer channel 21, IRQ 158), whose Genifa slot fires every 5th tick; its callback `0x50ab8fe6` posts a deferred call that task 16 runs (`0x510c1ccf`: Genifa ms clock + 10, wake the Genifa timer task, which runs the Genifa timers in `0x510bb7df`) (kernel spec 9.5, X). With `emu/bin/nav.mjs --time` the event arrives on the 10th Genifa tick after timer 522's start (clock + 100; the comparison in `0x510bb7df` is observed, not decoded), the GUI clears the awaited word, closes the popup (NAV_RULES `popup_confirm`, X) and the page shows the written value; MENU then follows the close rule (writes the page's cursor memory, 1918 = 5 in N3T, and closes). check_nav N3T predicts the event time from the lab state and checks it to the nanosecond (at T_pred - 1 the word is still 0x9ac6, at T_pred it is 0).

## 14. EVF layout (B2, M8)

**Layout mode.** `SetLayoutMode` `0x510c2db4(mode)` accepts 0..3 and stores the byte `0x60368ba4` (D). Modes 0 and 1 pass themselves to vt+252 of the GUI object; modes 2 and 3 pass 1 (`0x510c2dc8..0x510c2dea`). So mode 1, which WinMain sets (`0x510c29c8`), draws layout 1 like modes 2/3. The page bars read `0x613a0cc8`/`0x613a0dc8` when the byte is 0 (`0x5110c5f7`, `0x5110c641`) and `0x613a0d48`/`0x613a0e48` otherwise (`0x5110c615`, `0x5110c667`). Panel 329 carries two rects per child (`rects` in `menudata.mjs`): rects[0] is an 800 x 600 layout, rects[1] the 900 x 600 one. The rule "mode byte 0 draws rects[0] and the 0x613a0cc8 bars" is D for the bars and executed for the rects (pages 1..6 below).

**Callers.** `CCommon::ChangeFinderStyle` `0x510c812d` (style 1/2 -> mode 2, style 3 -> mode 0); `CCommon::ConnectChangePlay` `0x510c412a`, reached from GUI message 0x9601 = sendEvent index 0x83 with data = lOutput; `0x510c857d`, which reads the OutputType table (run-time `0x6132c2cc`, read at `0x510c79d7` and `0x510c859c`). The lOutput jump table is at run-time `0x6132c04c` (read at `0x510c4319`; keys 0..8 and 0x8001..0x8007). M7's text gave `0x61329a4c` and `0x61329cc4`; nothing in the image refers to those. The {u32 key, u32 handler} table `0x6159ce14` is searched at `0x5124d483..a7` and `0x5124e3e8`; that it is the 0x9601 dispatch is the B2 investigation's reading, not re-walked here. CCommon (`(0x60368bac)`) +16 is the connect state.

**lOutput 7.** The handler `0x510c6c27` calls the camera API vt+20 (`0x50afcd3a`) with output 16; when that returns 0 it sets connect state 5 (`SetConnectState` at `0x510c6c71`, returning to `0x510c6c76`). getDisplayDeviceState maps the current output 8 (property 4513 of the EVF) to 5 (`0x50abd8e4..ea`). vt+20 reaches ChangeOutline, which reads the module-9 state twice (`0x50ab5780(9)` returning to `0x50abcfd7` and `0x50abcfe2`): with state 2 or 3 and a request that pairs with the current output (16 with 8, 8 with 16, 1 with 1, 2 with 4, 4 with 2; `0x50abcfed..0x50abd02c`) it returns 0 (`0x50abd03b`); otherwise it takes the RPC path (`0x50abd041` -> `0x50abd08e`), which in the lab ends at S-RPC with status `0xf0000001`, or, when `0x50abea2d()` is non-zero and module 9 is non-zero, sets module 9 to 4 (`0x50abd077`) and returns `0xf0000063`. State 2 is written only at `0x50ae0048` (API 70405, modes 1/2) and state 1 at `0x50ae0008`; the caller chain up to the boot take-over `0x501e6adb` is the B2 investigation's (D). The lab's module 9 is 1 after bring-up.

**Inputs (labelled, `MenuLab` with `evf_layout=True`, EVF only).** S-TAKEOVER: after GUI creation the lab calls `0x50ab6299(9, 2)` natively, the value API 70405 writes; from then on module 9 may be read only by ChangeOutline's two reads, any other reader raises (scope guard). Whether the camera is in that state at menu time is ?. H-CONNECT: `sendEvent(0x83, 7)` in POWER_ON, then settle. Why 7: it is the only lOutput that requests output 16, ChangeOutline pairs 16 with output 8, and its handler `0x510c6c27` sets connect state 5, which is getDisplayDeviceState(8) (D). M10B found the sender (next paragraph); which of its two finder rows the camera uses is still not traced.

**What then runs natively (executed, check_nav N7, check_menu G6).** ConnectChangePlay(7); its query 65803 answers 1, its gate word `(0x60375a9c)` is 0, and the branch after `0x510c4237` is skipped (below); vt+20(16) returns 0 without S-RPC; SetConnectState(5); setOutputType applies the finder-style setting 453 (default: style 2) -> `SetLayoutMode(2)`. At the menu entry (OPEN) the entry finds connect state 5 (`cmp 5` at `0x5120ccc9`) and calls `ChangeFinderStyle(3, 1)` at `0x5120ccd8` (returning to `0x5120ccdf`) -> `SetLayoutMode(0)`; the byte stays 0 after MENU and a second OPEN. Setting 453 is therefore not needed for the menu's layout. Query 65803 is on the path but does not decide the layout in the lab. Before the jump table ConnectChangePlay calls `0x510c91eb` (`0x510c4230`). That function first reads four values into its own locals: settings 304, 1265 and 288 through the getter `0x51287b45` (`mov 304/1265/288,d0`, a0 = sp+12/16/20, `0x510c91eb..0x510c920b`; the getter is the resource/settings API `0x50b4e3f0` vt+12 (text spec section 3) except for id 27, `0x51287b48..0x51287b8f`) and id 44 through `0x50b4e3f0()` vt+12 with a1 = sp+24 (`0x510c9212..0x510c9223`). Then it calls the camera API vt+56 = `0x50afcf14` (`calls (a1)` at `0x510c9232`; `mov 65803,d0` at `0x50afcf1a`), which takes none of those locals. It returns 1 only when the query returns 0, setting 304 is 0, and either id 44 is 1 with setting 1265 in {1, 3} or setting 288 is 17 or 18 (`0x510c9234..0x510c9258`). On 0 ConnectChangePlay takes `beq 0x510c4284` (`0x510c4237`). On 1 it has a second gate: it calls `0x51252c7b`, which returns the word `(0x60375a9c)`, and skips on 0 (`beq 0x510c4284` at `0x510c4242`); then it skips when its own (16,sp) is 1 or d3 is 1 (`0x510c4253..0x510c425b`); only past all of these does it call `0x510c9365(0)` and `0x510c9387` (not traced). The word `0x60375a9c` is set to 1 by six callers of the setter `0x51252c72` (`0x511625d8`, `0x51164ed9`, `0x5116e5dc`, `0x511768f8`, `0x511770c9`, `0x5117bcd6`; which events reach them is not traced) and cleared by ConnectChangePlay itself (`0x510c427d`, `0x510c4285`). `0x50afcf14` returns `0x50abdbb5()`, which is 1 when `0x50abaab7()` returns 0 (`0x50abdbb5..0x50abdbc1`); `0x50abaab7` returns 0 when `0x50424f9a(0x02020501)` is non-zero, or when `0x50424f9a(0x02020400)` is 0 and `(0x6035e9a0)` (`0x50ab4e0f`) is 0; what those properties mean is not traced. Executed (check_nav N7 asserts all of it): the query answers 1, the locals are [0, 2, 18, 0] (so the settings tests alone would pass), `0x510c91eb` returns 0, and `(0x60375a9c)` is 0 at `0x510c4235`. A one-off lab run that forced the query's answer to 0 at `0x510c9234` got `0x510c91eb` = 1, `0x51252c7b` = 0 and the skip anyway; the rest of the trace, the error log and the EVF composite were unchanged (byte-identical). So in the lab the EVF layout does not depend on the answer to 65803; on the camera the branch runs only when 65803 answers 0 and one of the six setters has run since the last ConnectChangePlay, and what it does then is not known. `0x50afcf14` is also called from other GUI code during the session (return addresses `0x51251c09`, `0x5125218f`, `0x5125125b`, `0x5120d58a`), not examined. Query 65826 (`0x50afd59c`) is not called in the executed trace. Further `ChangeFinderStyle(3, 1)` call sites after a `cmp 5` exist (a byte scan of the 23 direct calls finds 13 more, e.g. `0x51204dad`, `0x5120e28a`, `0x51238525`); whether each compares the connect state was not checked. DISPLAY cmd 28 runs `0x501daf7d`, which ORs bit 6 into CTRL3 (`0x41`), so the EVF-layout composite rests on A15 (vsc spec section 7). Registers against the same EVF menu without the inputs (N7C): only CTRL3 `1 -> 0x41` and OSDDMASPOS (unwritten -> 0) differ.

**The sender of 0x9601 (M10B, D).** The camera's CA side builds request 131 in `0x5105053c`: device 2 or 3 -> `mov 2,d2` (`0x5105055b`), device 6 -> `mov 7,d2` (`0x5105058a`); it stores 131 at (32,a3) and d2 (lOutput) at (36,a3) (`0x510505cf..0x510505d7`) and logs "CA->GUI CHG_OUT_LINE : TFT" (`0x612c92ba`) or "CA->GUI CHG_OUT_LINE : INTERNAL_EVF" (`0x612c930d`). It has two finder rows: device 5 -> `mov 3,d2` (`0x5105057a`, "CA->GUI CHG_OUT_LINE : EVF", `0x612c92f2`) and device 6 -> lOutput 7 ("INTERNAL_EVF"). lOutput 2 for the TFT is D. Which device number the camera passes for its finder is not traced (the CA chain into `0x5105053c` is not), so 7 is a choice backed by the handlers: lOutput 7 runs `0x510c6c27` (vt+20(16), SetConnectState(5), the state getDisplayDeviceState(8) maps to), while lOutput 3 runs `0x510c43db -> 0x510c6bb5` (vt+20(2), SetConnectState(3)) and then `SetLayoutMode(0)` at `0x510c43f3` (D). The jump table `0x6132c04c` sends lOutput 0 and 2 to the same handler (`0x610e537b` = code `0x510c435b`): {0, 2} -> `0x510c435b`, 1 -> `0x510c433c`, {3, 6} -> `0x510c43db`, 4 -> `0x510c43bf`, 5 -> `0x510c43a3`, 7 -> `0x510c4406`, 8 -> `0x510c438c`, `0x8001..` -> `0x510c445c` (run-time `0x610e5xxx` minus `0x10021020`). The chain that calls `0x5105053c` (from EV_EYESENSOR_STATUS / EV_PRESS_EVFSW through the CA module, whose `(212,this)` framework object is null in the lab) is not traced; static next step: the callers of the function that contains `0x510504f8` and the users of "receiveConnectChangeSubAppMdlDispDevice".

**Live switches (M10B, play only; the nav token SWITCH and check_nav N7/N7C/N8 unchanged).** `PlaySession.live_switch` (`emu/src/lab/play.mjs`) runs, for a TFT <-> EVF switch from any screen play offers: the end request of the S-OUTSEQ rule (below), DISPLAY cmd 2 OPEN, H-RESEND, H-EYESTATE for the eye sensor (input spec section 8), H-CONNECT `sendEvent(131, 2 | 7)` and the re-entry request(s). S-TAKEOVER runs once at every play bring-up (TFT or EVF), with the module-9 scope guard for the whole session; only API 70405 on the boot take-over path writes state 2 (`0x501e6adb -> 0x50ab2309 -> 0x50adffda`, D) and no live switch writes it. Across every switch of the switch sweep module 9 is read only at `0x50abcfd7`, once per 131 (X). After 131 the B2 observers see ConnectChangePlay, vt+20 returning 0 with no RPC and SetConnectState 2 (TFT) or 5 (EVF) (X); then the layout byte is 1 on the TFT and on the EVF 0 in the menus and the initial-setup screens, 2 elsewhere (X, a post-condition of every switch). 131 alone repaints nothing in any state tried (X, two investigations); each screen needs a re-entry request (S-OUTSEQ, a stand-in; the camera's own follow-up is not traced):

| GUI state (panel) | Class | End | After 131 | Evidence |
|---|---|---|---|---|
| `0x0108` (10) | shooting | | 125 | X, scenario `switch-shoot`: EVF windows equal an EVF start |
| `0x0108` (488) | bulb | | 177 | X |
| `0x0104` (6) | black | | 153 | X (with no re-entry the new channel's OSD planes stay unprogrammed: UNWRITTEN) |
| `0x0b02` | menu: Setup tabs, sub-screens, popups, help, Wi-Fi (386); not panel 430 (All WB±, refused, below) | | 183 EVT_REFRESH_PANEL | X: the menu reference's layout 0 / 1; 122 EVT_ST_CHANGE_EVF gives the same windows |
| `0x0b03` (439 / 411 / 394) | initial setup | | 183, then the opener of the panel shown: 439 -> 241, 411 -> 242, 394 -> 243 (another panel refuses) | X (also when the screen was opened by a debug token) |
| `0x0417` / `0x0418` | direct WB / Picture Mode | 164 | 163:3 / 163:4 | X |
| `0x0414` | item bar (store 819 names the item) | 164 | 163:n, n from store 819 (below) | D table, X |
| `0x0407` (496) | WB dial-direct | 164 | 219 | X (store unchanged; re-opens like direct WB) |
| `0x0505` | playback | 134 | 133:1 | X |
| `0x0401` / `0x0403` / `0x0404` | Super Control Panel | 186 | 185:0 | X, scenario `switch-scp` (cursor 261/293 kept) |
| any other, or any state while the GUI task is not at its message receive (below) | refused | | | |

FUNC_DIRECT (`0x0407`) has more panels than 219's 496: ISO dial-direct (217) and OK on most Super Control Panel cells open panel 452, OK on AF Target Mode (item 85) panel 491 (X). Which request re-enters those is not known, so a switch there is refused (X); so is a switch in `0x0409` and `0x0416` (section 15) and in Connection Setup, panel 444, which OK on Device Connection in the Wi-Fi menu opens: in `0x0c08` SS_EDIT/ID_ST_INTERNAL_WIFI_FROM_REC when the menu came from request 192 (X), in `0x0c06` SS_EDIT/ID_ST_INTERNAL_WIFI_FROM_MENU when it came from the Setup menu (tab 7 page 4 row 3, panel 386, OK on row 0 or 2; X); before this guard such a switch re-entered with 219 and silently landed on panel 496. Every switch now also checks after the re-entry that the GUI state and panel are the ones it started from (from `0x0401` SCP_PREPARE any SCP state), and stops with an error otherwise.

**All WB± (`0x0b02` panel 430) refuses a switch** (`OUTSEQ_REFUSED`). The panel is the WB compensation screen with its G/M A/B grid, opened by Shooting Menu 1 page 2 row 3 and the same row on tab 4 page 2; it is the only one of the 222 first-level menu sub-screens swept (tabs 1-7, every row) whose switch fails. Executed order on 131 there: ConnectChangePlay(7), vt+20 returns 0, SetConnectState(5), SetLayoutMode(0), then two camera requests `0x50af8487` (caller `0x50af7d8d`) with no RPC origin, ShowPanelEx(329) (return `0x511be209`) closing the screen to the page, and two background-jpeg requests (origin `0x512504f1`) for the page (X). So the GUI closes the screen on 131 itself, as in `0x0b03`, but only after camera requests whose effect is not known (the lab answers every RPC with 0), and the 183 re-entry would refresh panel 329, not 430. Play refuses the switch before any lab action (X, LV and the eye sensor); without the refusal the switch ended in a session error with H-CONNECT's RPC check.

**A GUI task that is not at its message receive refuses a switch** (`PlaySession.gui_busy`, any screen). At rest the GUI task waits in GetEvent's receive (return addresses `0x510ba41b`, `0x510be85d`, `0x50b81c7b`, `0x50b01b3d`, `0x50ac5b64` on its stack) with no timeout, so it is not in the kernel's timeout queue (X); a task in that queue is in dly_tsk or a finite wait (kernel spec section 2.2) and would not take 131. One screen gets there: Setup tab 7 page 6 row 3, Level Adjust (`0x0b02` panel 387), then 'Adjust' and OK. The GUI task calls `0x5004ad13` (from `0x5004a604`; debug string `0x60117b53` "acc-adj heap_head"), which sleeps with dly_tsk(20) (`0x5004adce`) until a sample counter has moved 12 times (`cmp 12,a3` at `0x5004add5`). `0x50049771` reads the counter through the pointer `(0x62963f58)`, which `0x50048cb9..bf` sets to `0x6034d9d4`; only `0x500491b5..be` in `0x5004910a` increments it, after packing sensor bytes `0x62963fc8..` and before setting flag `(0x60043114)` (D). Until 2026-10-23 the lab ran neither, so the pointer was 0, the loop read the word at address 0 and never ended (X: 143 dly_tsk calls from `0x5004add5` in 3 s of lab time; after the OK the GUI took no message, UP drew nothing). Since then the ACC module init runs at the play bring-up and a sample arrives with each of ACC_MAIN's 80 ms cycles (hle-gaps.md 4.7.3): the loop ends after about 1 s of lab time and the GUI returns to the shooting screen (X, check_level L4); a switch during that second is still refused. That the sensor is the level gauge's accelerometer is I ("acc-adj", Level Adjust). Before the guard LV there ran the OPEN and 131, the GUI did not take the 131, and H-CONNECT's check put the session in an error state on the EVF; now LV and the eye sensor are refused and the session keeps running on the TFT (X; the gui-busy-unchecked mutant lets the switch run). The first-level sweep above did not include this second-level action; before 'Adjust', panel 387 switches like the other sub-screens, and OK on 'Reset' leaves for the shooting screen, which switches as usual (X).

`0x0414` SS_MENU_LV/ID_ST_MUTE_CONTROL_2ND panel 466 is one item bar for several items, and store 819 picks the item: 163:5 shows shutter speed (819 = 5), 163:6 aperture (4), 163:7 exposure compensation (3), 163:8 ISO (6), 163:9 Electronic Zoom (0), 163:11 Headphone Volume (1) (X, each from a fresh session). The 0x9715 handler writes store 819 for data 5..11 with 5, 4, 3, 6, 0, 2, 1 (`0x51206108..0x512061b5`, D); its inverse gives the bar's re-entry for the item the store names: 819 = 5 -> 163:5, 4 -> 6, 3 -> 7, 6 -> 8, 0 -> 9, 1 -> 11; 2 needs data 10, which starts the firmware task `0x50ab83f4` (not modelled), so that switch is refused. OK on the Super Control Panel's ISO or Exp. Comp. cell writes 819 = 6 / 3 and opens the same bar, and the re-entry brings back that item (X: TFT windows byte-equal before and after LV, LV).

**EVF geometry (X, latched registers).** In the menus the three OSD planes are 800-wide layouts scaled 2x (RSZ2 `0x800`), as in N7. The shooting screen, the direct screens, playback and the Super Control Panel keep a 900 x 600 canvas: GUI layers 1 and 2 are scaled into the EVF by the VSC (OSD2/OSD3 RSZ1 `0x11`, RSZ2 `0x904`, RSZ4 `0x8e0`, AREA1 `0x32063c`, AREA2 `0x2d0438`: 1596 x 1080 output, every one of the 900 source columns sampled), layer 0 is 1600 x 1200 at 1:1. Before M10B the GUI was not told and kept the TFT programming, which the EVF showed as the top-left 800 x 600 doubled: the right 100 columns were cut off.

**What a re-entry loses.** A row whose re-entry opens the screen again starts it afresh. In `0x0b03` the GUI itself closes the screen on 131: ShowPanelEx(0) from `0x5120e0e4` (return `0x5120e0eb`), and 183 then leaves for `0x0104` (X), so the opener brings the screen back from scratch: a date typed but not confirmed shows `----.--.--` again and the language cursor is back on its first entry (X). In `0x0417` / `0x0418` 131, 183 and 122 repaint nothing (X); 164 then 163:3 / 163:4, and 164 then 219 for WB dial-direct (`0x0407` panel 496), open the screen again on the top item of its left column and the stored value: the strip scrolls as a fresh open does, and a left-column item selected before the switch is lost (Keep Warm Color and the WB compensation grid in direct WB and WB dial-direct, a Picture Mode parameter such as Sharpness), while values already written stay in the store (X: WB dial-direct with Keep Warm Color and Picture Mode with Sharpness). The time-zone setup, the item bar, playback, menu popups and the Super Control Panel cursor survive a round trip byte-identically (X, verifier sweep). Play marks the three lossy rows in the switch record (`reopens`, shown on the page); which request the camera itself sends, and whether it keeps the entry, is not traced.

**Not settled.** Whether the branch `0x510c4244..0x510c4282` runs on the camera (query 65803 answering 0 and `(0x60375a9c)` set by one of its six setters) and what it does; the normal-boot route to connect state 5 (module 9 is 1 after the lab's boot, so the RPC path would ask a server the lab does not run); the CA chain that calls the sender `0x5105053c` and which finder row (lOutput 3 or 7) it takes, and the camera's own request after a switch (S-OUTSEQ stands in); what CTRL3 bit 6 does (A15); a photo of the camera's EVF menu.

## 15. Screens beyond the menu (M10)

The interactive play mode (`emu/bin/play.mjs`, `emu/src/lab/play.mjs`, input spec `docs/om1-input-spec.md`) reaches GUI screens other than the Setup Menu with sendEvent requests the camera application would send. The GUI's side of each one runs natively; which request the camera sends when is not traced (the application, task 58, does not run). Tags as in section 13: X executed, D read from code, I inference.

**Dispatch.** A request index maps through `0x614b5a14` like a key (section 13.1). Four indices map to `0xf001` EVT_REQ_REC_DISP_INFO (125, 169, 172, 176). From POWER_ON (`0x0102`) or the closed menu (`0x0104`), 125 enters `0x0108` SS_COMMON/ID_ST_CA_REQ_DISP and shows panel 10, the shooting / standby information screen (X). Entry 0 of the touch-pattern table `0x615a04e0` is `{panel 10, Genifa id 0x6003, pattern 1, 0x6127cfff}` (D): the shooting screen has GUI touch areas (input spec section 6).

**Paint gate and S-BGDRAW.** The GUI asks `0x50b3dcca` (reached by `calls (a2)`, vtable +12) before painting some panels; natively it returns a value that keeps the paint held on the shooting screen and in playback (0 engine commands, X; the chain `0x50ae5095` -> `0x50ab5683` = `(0x6035e9d4)`, written only at `0x50ab6053`, and `0x50ae55b9` loading `0xf0000058`, D). S-BGDRAW returns d0 = 0 to two of its four callers (return addresses `0x510c9a07`: shooting screen, direct WB / Picture Mode, dial-direct; `0x510c9cf5`: playback) and lets the other two run natively (`0x510ca74f` menu entry and Wi-Fi menu, `0x510c98f6` menu close and black screen), as every lab before M10, so the menu runs the paths the nav harness runs (X: states, menus and frames equal). Without S-BGDRAW the shooting screen never programs its OSD planes (composite UNWRITTEN, X).

**Request data.** EVT_START_LV_CONTROL (163) takes a screen number in its data word: 3 direct WB (`0x0417` SS_MENU_LV/ID_ST_DIRECT_WB, panel 496), 4 direct Picture Mode (`0x0418`, panel 500), 5 the item bar on shutter speed (`0x0414` SS_MENU_LV/ID_ST_MUTE_CONTROL_2ND, panel 466; data 5..11 pick other items, section 14) (X); 2 and 14 fault or hang and 1 is FUNC_DIRECT with nothing drawn (screens investigation, X); 0 stopped at the unmodelled inter-CPU doorbell and opens the Super Control Panel since M10B (below). EVT_REQ_START_PLAY (133) with data 1 shows "No Picture" (`0x0505` SS_PLAY_SINGLE/ID_ST_NO_PICTURE, panel 324, X); choosing 1 among the values 1, 3, 7 that reach it is I; 5 and 6 fault.

**Reachable screens** (each from a fresh shooting screen unless noted; X for every row):

| Request (index:data) | GUI state | Panel | Drawn |
|---|---|---|---|
| 125 | `0x0108` | 10 | shooting / standby information |
| 135 | `0x0b02` | 329 | Setup Menu (sections 1-14) |
| 133:1 | `0x0505` | 324 | "No Picture" |
| 163:3, 163:4, 163:5 | `0x0417`, `0x0418`, `0x0414` | 496, 500, 466 | direct WB, direct Picture Mode, the item bar on shutter speed |
| 177 | `0x0108` | 488 | bulb timer box |
| 192 | `0x0b02` | 386 | Wi-Fi menu |
| 241, 242, 243, only from `0x0104` | `0x0b03` SS_MENU/ID_ST_INITIAL_SETTINGS | 439, 411, 394 | language, date, time-zone setup |
| 153 | `0x0104` | 6 | black screen |
| 219 | `0x0407` SS_MENU_LV/ID_ST_MENU_FUNC_DIRECT | 496 | WB dial-direct on the direct-WB panel (41 engine commands; arrows and dials redraw it, X) |
| 217 | `0x0407` SS_MENU_LV/ID_ST_MENU_FUNC_DIRECT | 452 | ISO dial-direct (10 engine commands: the cursor box and arrows, the item cells without labels; why is not traced); LEFT, RIGHT and the dials write ISO (store 1671) since H-AEINIT (below) |

From `0x0108` the initial-setup requests 241..243 do nothing (X); the player offered them only in `0x0104`, which S-CAMSEQ leaves at once, so they need `--no-camseq`. **H-AEINIT (M10B fix).** Before it, LEFT, RIGHT or a main-dial detent in ISO dial-direct stopped the lab with fault 6 at `0x5056319c`, `div d1,d0` in the interpolation `0x50563138` (`(d0 - d3) * (a3 - a1) / (a2 - a1) + d3 + a0`, `a2 - a1` at `0x50563195..98`), and so did a dial step or a FUNC_DIRECT change on six Super Control Panel cells (Metering, Drive, ISO, Exposure Comp., Flash Mode, Flash Exposure Comp.). The store write reaches it through the callback chain `0x50563209 <- 0x505622d4 <- 0x505613c4` (return addresses, X). a1 and a2 come from the u16 table `0x62a91abe`, which only `0x50560b29` fills (D): it clears `0x62a919dc`, `0x62a91a2c`, `0x62a91a84`, `0x62a91aba`, sets `(0x62a91aba)` = `0x505631a5(1194)`, `(0x62a91abc)` = `0x500417da(6730, 0)`, writes the step table `0x62a91abe[i]` from `(0x62a91aba)` and `0x62a91af0[i]` = `0x500417da(6458, i)` for i 0..24, and calls `0x50562f1b`. Its only caller is `0x50572574` in `0x505724cc`, which `0x50553649` calls (`0x5055365b`), which the boot sequence calls at `0x501e90c4` (after its progress print "2_p"); the lab does not run that chain. Play runs `0x50560b29` natively at bring-up (pre-condition: the four regions still BSS 0; post-condition: the step table strictly increasing). Kinds 6730 and 6458 are F-store objects 420 and 403, image templates of 0 because the lab has no flash data, so the interpolation returns `(0x62a91abc)` = 0; what it computes on the camera is not decoded. With it every dial step on all 22 panel cells and LEFT / RIGHT / main dial in every FUNC_DIRECT dialog the cells open run without a fault (X, fix sweep; the no-aeinit mutant brings the fault back); UP, DOWN and INFO do nothing in ISO dial-direct. Not reachable: playback with images (no media model), the start-screen logo and version check (132, 137: state only, content ?), and the requests that fault or hang (163:2/14, 139, 143, 165, START_PLAY 5/6).

**Super Control Panel (M10B).** OK on the shooting screen is ignored by the GUI itself (no state change, no engine command, no call of `0x50aa9d43`, X). Indices 163 and 185 both map to 0x9715 EVT_START_LV_CONTROL and 164 and 186 to 0x9734 EVT_END_LV_CONTROL; the application's own sites use 185 / 186 (`0x5106e2da`, `0x51077be4`, ..., D). Stage 1 of 0x9715 (`0x51206068`) switches on the data word: 3, 12, 13 direct screens; 4 Picture Mode; 5..11 write store 819 (above) and open the item bar `0x0414` on the item 819 names (section 14); anything else falls to the default case, which enters `0x0401` SCP_PREPARE, and `0x5120faba` then picks `0x0403` ID_ST_MENU_DTL_SCP or `0x0404` ID_ST_MENU_RC_SCP from the Control Settings id that the mode redirect `0x51287c84 -> 0x51287d18` names (330 for P/A/S/M): 2 -> DTL, 3 -> RC (D/X; `SET:330=3` then OK reaches `0x0404`). Data 0 in that branch is the store-driven entry; which application site runs on OK and with which data is ? (task 58), so S-CAMSEQ Q4 sends 185:0 (I). Data sweep (M10, X): 6, 7, 8, 9, 11 -> `0x0414`, 12, 13 -> `0x0417`, 10 -> the firmware task `0x50ab83f4` (not modelled), 15 / 16 -> `0x0403`. Entering the panel calls `0x50aa9d43`, which posts `0x50aaa173` to CPU 2 and waits for its reply; that path runs natively up to the missing CPU since M10B (input spec section 8: H-IPIINIT, A-IPI, S-CPU2; intc/timer spec section 2). Then the panel paints natively (panel 467, 83 engine commands on a fresh shooting screen). The cursor is store ids 261/293, item ids; the panel opens on 111 Picture Mode, and RIGHT, DOWN, LEFT, UP pressed in turn from there move it to 9 WB, 241 Face & Eye Detection, 289 AF Mode and back to 111 (X); UP alone from 111 gives 85 AF Target Mode (X); a dial step writes through vt+4 (X, cell sweep of 22 cells, TFT and EVF start alike): most cells write one store id with d1 = 1 (next) or 2 (previous), a positive main-dial detent and a negative sub-dial detent giving 1, but the id written is not always the cursor's item id (9 WB -> 1548, 24 Shooting Mode -> 3200, 6 ISO -> 1671, 85 AF Target Mode -> 163); Picture Mode (111) and Drive (3265) write d1 = 0 with the new value in a1 (111: main +1 -> a1 2, sub +1 -> 0; 3265: main +1 -> 30, sub +1 -> 24); cells 860 and 1098 each write the eight ids 1330, 1331, 1334-1337, 1340, 1341 with d1 1 / 2 and a1 10..12; Button Function (1378), Shutter Speed (1669), Aperture Value (1667) and Wi-Fi/Bluetooth (1684) write nothing. Six cells need H-AEINIT for that (above). On AF Target Mode (item 85, store 163, descriptor list `[0, 1, 2, 3, 5, 10, 6, 7, 8, 9]`) the main dial cycles 2, 3, 5, 10, 0, 1 in list order; 6..9 are skipped, why is not decoded (X). Shooting Mode (item 24 / 3200) refuses the write with `0xf0000016` and the store stays unchanged (X). OK on a cell opens its direct screen (WB -> `0x0417` panel 496, Picture Mode -> `0x0418` panel 500, ISO and Exposure Comp. -> `0x0414` panel 466 with store 819 set to that bar, AF Mode and ten other cells (289, 241, 16, 17, 3265, 1, 269, 157, 860, 1098, 695) -> `0x0407` FUNC_DIRECT panel 452, AF Target Mode -> `0x0407` panel 491, Button Function (1378) -> `0x0409` SS_MENU_LV/ID_ST_FUNC_DIRECT panel 351, where OK opens panel 392, the card cell (1129, its title line shows Standard) -> `0x0416` ID_ST_MENU_REC_MODE panel 339, "Card Slot Settings"; X, cell sweeps). OK on Wi-Fi/Bluetooth (1684) takes the GUI to `0x0104` and S-CAMSEQ Q1 back to the shooting screen; on Shooting Mode (24), Shutter Speed (1669) and Aperture Value (1667) it does nothing (X). A display switch is refused on FUNC_DIRECT panels 452 and 491, in `0x0409` and in `0x0416` (no re-entry request known, section 14); outside the panel the same holds for Connection Setup panel 444 ("Connection Setup 1/3"), which OK on Device Connection in the Wi-Fi menu opens: `0x0c08` SS_EDIT/ID_ST_INTERNAL_WIFI_FROM_REC from request 192's menu (X), `0x0c06` SS_EDIT/ID_ST_INTERNAL_WIFI_FROM_MENU from the Setup menu's (X), and for the menu's All WB± screen (`0x0b02` panel 430, section 14). Cell names are the panel's own title line with the cursor on the cell (X). MENU and S1 close to `0x0104` (X). The snapshot words are the audio sequencer's level (peak) data (CPU-2 task `0x200e`, aud_seq; intc/timer spec section 2) and are lab RAM that CPU 2 never wrote, so they read 0. Not reached: the Live Control, live-guide and ART / SCN variants (settings 109 and 44 have no descriptor list; the camera's mode handling does not run); a decode of each cell's value -> image / string mapping (no offline decoder; the writes, the descriptor order and the repaint from the store were checked instead, X); what the camera does after MENU in the panel.

**The menu close and UI_IN's switches.** With UI_IN running and group 4 pushed all ones (HDMI `0x0501`, CEC, lens and grip bits), MENU at the top level closes the menu by painting the black panel 6 (6 engine commands); with group 4 at the old state 0 of every lab before M10 nothing is painted and the nav harness's frames match (X, by bisection). The GUI's check is `0x50abaab7`: it asks `0x50424f9a` for HDMI `0x02020501` and for `0x02020400` (D); panel 6 comes with both bits at 1 and with neither alone (X, input spec section 3). The player's idle image keeps switches at 0.

**Hand-back to the camera: `0x0104` and the screen timeouts (PLAYFIX).** Names (D): the state-set table `0x61596fb8` (12-byte rows {u16 set, u32 name, u32 child table}) gives set 1 = SS_COMMON (child table `0x61595c48`, 8-byte rows {u16 id, u16, char *name}), whose entry 4 is ID_ST_BLACK_SCREEN, so `0x0104` = SS_COMMON/ID_ST_BLACK_SCREEN; the GUI message table `0x6159a3a4` holds `{0x9acf, "EVT_END_FUNC_MENU"}` at `0x6159ad54`. It is the state the GUI returns after handing control back to the camera application: it draws nothing new and takes no key until the camera's next request (X: in play before PLAYFIX, frames stopped and arrows and dials had no effect there; MENU opened the Setup Menu through S-CAMSEQ Q2). The Super Control Panel's inactivity timer (D): the panel object starts Genifa timer 510 at `0x5118586c movhu (a0),d0; 0x5118586e mov 8000,d1; 0x51185871 call 0x5124f980` (GenifaStart; a0 = d3 from `0x5118586a`), then `mov 532,d0; mov 200,d1; call 0x5124f980` (`0x51185878..7e`, the 200 ms refresh); every key restarts it at `0x51185e8b mov 8000,d1; 0x51185e8e movhu (48,a0),d0; 0x51185e91 call 0x5124f980`. On expiry the dispatch posts EVT_END_FUNC_MENU, and the `0x0403` handler `0x512117f1` is `add -4,sp; mov 21,d0; mov 3,d1; call 0x5124f5b5 (PostEventToCA); mov 260,d0; ret`: the GUI tells the camera (21, 3) and returns state `0x0104`. Executed (X, repo tree): GenifaStart(510, 8000) at lab 0.269 s with the Genifa clock `0x603679d0` at 20 (return `0x51185878`); the dispatch kills 510 at lab 8.706 s with the clock at 8020 (return `0x510e8538`); `0x0104` by lab 8.719 s, 318 engine commands in the closing slice and none in the next 2 s; request 125 then gives `0x0108` panel 10. Other screens time out the same way (X, observer on `0x5124f5b5`, --idle off; D for the sites). The lab times are those of the PostEventToCA call in an in-process run in which each screen was opened at lab 0.286 s (the SCP by OK, the item bar by request 163:5, WB dial-direct by request 219):

| Screen | Genifa timer, ms (start site, return) | PostEventToCA at lab s | PostEventToCA (return) |
|---|---|---|---|
| Super Control Panel `0x0403` panel 467 | 510, 8000 (`0x51185871`, `0x51185878`) | 8.710 | (21, 3) (`0x512117ff`) |
| item bar `0x0414` panel 466 | 547, 8000 (`0x511d0c2a`, `0x511d0c31`; `mov 8000,d1` at `0x511d0c27`) | 8.710 | (21, 3) (`0x51213590`; sequence at `0x51213585..89`) |
| WB dial-direct `0x0407` panel 496 | 500, 8000 (`0x51184a34`, `0x51184a3b`; `mov 8000,d1` at `0x51184a31`) | 8.278 | (21, 3) (`0x51211070`; sequence at `0x51211065..69`) |

Screens opened from a Super Control Panel cell with OK also close about 8 s after they open, with (21, 3) and Q1 back to `0x0108` (X, --idle off, 100 ms WAITs; their timers are not identified): direct Picture Mode `0x0418` panel 500 (cell 111; post sequence `0x512149c2..c6`, return `0x512149cd`), direct WB `0x0417` panel 496 (cell 9; `0x51214820 mov 3,d1; 0x51214822 mov d2,d0; call 0x5124f5b5`, return `0x5121482a`, d2 = 21 executed), FUNC_DIRECT `0x0407` panels 452 (cell 289, AF mode) and 491 (cell 85, AF target mode; both return `0x51211070`, the WB dial-direct site), and the item bar `0x0414` panel 466 (cell 6, 8.49 s); ISO dial-direct (request 217, `0x0407` panel 452) closes the same way. Not closed after 20 lab s of 1 s WAITs (X, TFT and EVF): direct WB and direct Picture Mode opened by requests 163:3 / 163:4, `0x0409` panel 351 and `0x0416` panel 339 opened from the panel, the bulb timer, the Wi-Fi menu, `0x0104` panel 6 and playback.

WB dial-direct draws nothing while idle and its Genifa clock keeps pace with lab time; the panel and the item bar refresh every 200 ms and lose about 5 % (X, PLAYFIX: the Genifa clock `0x603679d0`, +10 per Genifa tick at `0x510c1cd8`, advanced 920..990 per lab second on the panel, mean about 0.945, and 960..1000 on the shooting screen). Lost 2 ms software ticks account for all of it (X, PLAYFIX, 0.286..6.286 lab s on the panel in 100 ms WAITs, per lab second): the tick callback `0x50058ffc` ran 496, 484, 457, 475, 483, 458 times (500 expected); the 10 ms Genifa timer callback `0x50ab8fe6` (a0 = 10, created at `0x50ab8e31`) 100, 96, 92, 95, 96, 92 times; and the Genifa clock (`+10` at `0x510c1cd8`; every observed call returns to `0x50ab8fdc`) by 1000, 960, 920, 950, 960, 920. That is one 10 ms callback per 5 ticks and one +10 per callback (2853 ticks, 571 callbacks, 571 increments), so no Genifa wakeup is lost; the lab drops ticks while a display step runs (ROADMAP "Open follow-ups by milestone", M9). Correction: a first PLAYFIX measurement put the tick loss at about 2 % from the first 2 s after the panel opens (979 of about 1000), where the Genifa clock also ran at 0.98. Other PostEventToCA sites of the same shape (D): the panel's S1 handler `0x5120f831..42` is the same sequence (`(21, 3)`, return `0x5120f83f`, then `mov 260,d0`); MENU in the panel (`0x5120ea8a..98`) posts `(21, 8)` and also returns 260; MENU on the Setup top page posts `(20, 3)` (return `0x5120d5c7`, scp0104 investigation). A static scan finds 60 `mov 21,d0; mov p,d1; call 0x5124f5b5` sites (p = 3 at 46 sites, 5 at 2, 6 at 1, 8 at 4, 9 at 7, D), and the scan misses other shapes such as direct WB's `mov d2,d0`. 59 of them lie in `0x5120e3a8..0x51215433` (the GUI's state handlers; returns `0x5120e3b3..0x5121543e`). The other, `0x512060a7`, is in the EVT_START_LV_CONTROL handler `0x51206068`, on the branch taken when three tests pass (D): `(44,sp)` == 1 (`0x51206095..99`, word +12 of the record that the vtable +44 call of the object from `0x510848b5` fills at `sp+32`, `0x51206070..7f`), `(16,sp)` == 8 (`0x5120609b..9f`, the first word the vtable +12 call of the object from `0x50b4e3f0` writes to `sp+16` for d0 = 695, `0x51206081..93`) and data == 2 (`cmp 2,d0; bne` at `0x512060a3`) and is followed by `clr d0; jmp 0x51206319`: it posts (21, 3) without returning `0x0104`. Of the 46 p = 3 sites, 19 are followed directly by `mov 260,d0; ret` (D). So (21, 3) does not always come with `0x0104`; that it is the generic "screen ended, back to the camera" notification is I (its count and placement). PostEventToCA hands event 21 to `0x51084994`, whose table `0x61309100` maps it to code `0x4000013` for the CAM_APP queue (D, scp0104 investigation); the reader, task 58, does not run, and the handler of `0x4000013` is not found, so what the camera answers and shows meanwhile is ?. The player (S-CAMSEQ, input spec section 8) answers a `0x0104` entered in lab time between inputs with Q1 (request 125) only when an observer at `0x5124f5b5` saw (21, 3) since the last step that was not a WAIT; any other `0x0104` entered that way is an error. Input steps keep Q1 without that gate (MENU in the panel, `(21, 8)`, is answered by Q1 as before). The check also runs after the frame that follows lab work, whose run on to the frame boundary can cross an expiry, and when Q1 runs there the shooting screen's frame is published at once (fix1: before it, a WAIT that ended just before the panel's expiry returned in `0x0104`; without the second frame the status reads `0x0108` while `/api/frame` keeps the panel, PLAYFIX). The 8000 ms and the post sites were read from the image (X: without Q1 after lab time play stays in `0x0104`); scenario `scp-timeout` waits through the panel's expiry, and scenario `scp-edge` is a WAIT whose frame's boundary run crosses the expiry and needs Q1's own frame; a replay of a wall-idle session whose Q1 comes from an internal camseq entry alone kept every later lab time (X).
