> Status (2026-10): implemented by `emu/src/lab/text.mjs` (harness), `emu/src/lab/resources.mjs` (resource
> records), `emu/refs/font.mjs` (offline reference) and checked by `emu/checks/check_text.mjs`. Consolidated
> from three analysis reports that are not part of this repository (GUI text path, font
> format, string tables) plus what the implementation found (section 9). No device model changed:
> glyphs are OSD engine BITMAP commands the engine model (`emu/src/dev/engine.mjs`) already executes.

# OM-1 GUI text: resources, fonts and the firmware text path

Firmware = E143 v1.9 main block. Code addresses are disassembly notation (body offset +
0x50000000; the code runs at body offset + 0x60021020); data addresses are run-time addresses.
Tags: **X** executed in the lab and compared with an independent computation; **D** read from
the code at the cited address; **V** holds for every byte or record of all 18 blobs, no reader
seen; **?** unknown.

## 1. Resource records (blk02000000, OE type 0x0101)

The block starts with 38 index records `{u32 flash address, u32 size, 0, 0}`. Entry 0's data is
the first `olycompress` magic after the index, which fixes the file offset of every record.

| entries | content | storage | link address | evidence |
|---|---|---|---|---|
| 0, 37 | GUI bitmaps (icons, etc.) | olycompress (LZ4) | `0xA403D000`, `0xA45FD000` | `emu/src/lab/resources.mjs` (M2) |
| 1..18 | string table per language | raw | `0xA502B680`, slot limit `0x5FC00` | handler `0x501a911a`: destination `0x501a917e`, size check `0x501a9197` (D); pointers inside all 18 (V) |
| 19..36 | font per language (same order) | raw | `0xA4F63680`, slot limit `0xC7C00` | handler `0x501a8eb8`: `0x501a8f1c`, `0x501a8f35` (D); pointers (V) |

So one language's strings and font are resident at a time. Language ↔ records come from two tables
in .data, read by `0x51257d5b` and `0x51257dad` (D, X):

- `0x615a16a0`: `{u32 setting value, u16 string record, u16 0}`, ends at key `0xFFFF0000`;
- `0x615a1740`: `{u32 setting value, u16 kind = 1, u16 font record}`, same end key;
- `0x615a1738`: `{u16 1, u16 0}` for the language-independent record 0 (`0x51257d84`).

Every font record is its string record + 18 (V, asserted by `languages` in `resources.mjs`). The
language name is the tag of `pFontsList` record 1, `OlympusLanguage_<tag>tft`: chs zh-CN 5, cht
zh-TW 6, csy cs 11, deu de 2, enu en 1, esp es 4, fin fi 16, fra fr 3, ita it 9, jpn ja 0, nld nl
12, nor no 15, plk pl 20, ptg pt 8, rus ru 10, sky sk 22, sve sv 13, tha th 29 (tag, BCP-47,
setting-3009 value). The tag → BCP-47 map is a naming convention, not firmware data.

## 2. String tables

| offset | content |
|---|---|
| +0 | `pStringsList`: pointer to `u32[4702]` string pointers |
| +4 | `pFontsList`: pointer just past that array: 74-byte font descriptors (+0 UTF-16 name, +66 size = 62) |
| +8.. | UTF-16LE strings, NUL-terminated; id 0 is the empty string at +8 |

`GetString` `0x510bb079`: `a0 = ((u32 **)0x60370858)[byte (0x603671c4)][id]`, no bounds check (D, X:
4702 ids × 18 languages earlier, 73 ids × 18 languages per `check_text` run). The text setter
`0x5108f2bf` accepts `1 <= id <= (0x60370854)` = 4701. Only slot 0 of `0x60370858` is ever written
(`0x51257ce5`); only readers of the slot byte `0x603671c4` were found.

Inside strings: CR LF or a lone LF ends a line (DrawText `0x510ab383..0x510ab3d1`); `@XXXX@` is an
inline icon. The parser `0x510bee28` takes six characters, each a hex digit (either case) or `@`,
which is stored like a digit with the value 64 (`0x510bee41..4d`); any other character or the end
of the string gives 0 (`0x510bee3c`, `0x510bee6d` → `0x510bee8c`), and so does a sixth character
other than `@` (`0x510bee85..8a`). The code is `(n1 << 12 | n2 << 8 | n3 << 4 | n4) & 0xFFFF`
(`0x510bee8f..ab`), so `@A00@@` is icon `0xA040` (X). Codes above `0xA095` give 0 and log
`gpifont.c` line 1060 (`0x510beeac..ce`). There is no lower bound: every caller only tests the result
against 0 (`0x510bed8c..8f`, `0x510bef44`, `0x510bf0db`), so `@0000@` is six ordinary glyphs (X) and
`0x0001..0x9FFF` reach the icon op, which indexes the icon table with `code - 0xA000`
(`0x510beee0`, `0x510bef1d`) and dereferences the entry unchecked (`0x510bef2a`): the result
depends on the memory before the table (in the lab `@0041@` and `@4000@` draw nothing; the
reference refuses these codes). 266 en strings (247 ja) use codes `0xA096..0xA113`; the firmware
draws their `@` as a glyph (X, ids 1212 and 1281). No string in the 18 tables contains `@0000@`, a
code below `0xA000` or U+001F.

The iterator `0x510bed1e` reads the text as UTF-16 code units (`movhu`, `0x510bed33`): a
character above U+FFFF is two surrogate units, each an absent glyph drawn as a space (X,
`A<U+1F600>B`). Its skip count (+24) is checked before anything else but U+001F/NUL: while it is
positive, each unit is consumed with no BITMAP and no advance and the count drops by one; the
measure op (op52, flag 1) returns 1 for it, the draw op (op20, flag 0) 0 (`0x510bed3d..7f` →
`0x510bee23` / `0x510bee12`). An icon escape sets the count to 5 when it is iterated
(`0x510bed91..95`), so its other five units take that path.

U+001F (and NUL, which ends the string anyway) is consumed the same way, and with a zero skip count
both ops return 0 for it (`0x510bed35..3b` → `0x510bed4a`); the glyph before it advances as before a
missing glyph. DrawText measures each line first with one iterator and counts the units whose
measure is non-zero (`0x510ab3e2..ef`): every unit except U+001F, an escape counting 6. Its draw
loop (`0x510ab60d..0x510ab727`) runs exactly that many iterations, one code unit each (a zero from
op20 steps 2 bytes, `0x510ab716`). So each U+001F drops the line's last code unit: `AB<1F>CD`
draws A, B, C, and `A<1F>@A003@` draws A and the icon, because the dropped unit is the escape's
closing `@` (X).

Skips carry across lines. The draw loop uses one iterator (sp+196) for every line and only rewrites
+0 at each line start (`0x510ab5f5..600`); op20 clears the skip count only when the iterator address
differs from its previous call's (`0x510bec46..57`; op52 keeps its own previous address,
`0x510bec67..78`). Skips still pending when a line ends consume the next line's first units, of any
kind. Two things end a line inside an escape: the U+001F rule (`A<1F>@A003@` CR LF `BC` draws A,
the icon, then C at the line start, X), and a cell right of the clip (section 6 step 8), tested after
op20 has set the count: `A@A003@` CR LF `CDEFGHIJ` in a box with right edge 50 draws A, then H at
the start of line 2 (X). U+0E00..0E5B goes to the Thai shaper `0x510bf19f` (not decoded).

## 3. Language loading: `getLanguageLoadResource` `0x51257bfb(a0, d0 = mode)`

Called by the GUI startup `0x510c2830` with mode 0 (`0x510c2910`) and by three language-change
paths with mode 1 (`0x5119e077`, `0x5119e12b`, `0x5120e0b4`). It gets the resource/settings API
singleton `0x50b4e3f0` (object at `(0x603613b0)`, vtable `0x60e38124` stored by the constructor at
`0x50b4e458`), then:

1. vtable +12 `0x50b4e86d`: setting 3009 → `0x50b7b618` (CALL at `0x50b4e883`);
2. `0x51257dad(setting, 1)` → font record; vtable +56 `0x50b4ecf3(record, 0)` → `(0x62b3e36c)`
   (`0x51257c78`); a null result logs and returns 0;
3. `0x51257d5b(setting)` → string record; `0x50b4ecf3(record, 2)` → word 0 → `(0x60370858)`,
   word 1 → `(0x603708a4)` (`0x51257ce4..ee`);
4. mode 0 only: `0x51257d84(1)` → record 0; `0x50b4ecf3(0, 1)` → word 0 → `(0x62b3e364)` (icon
   table `0xA403D008`), word 1 → `(0x60370af8)`;
5. returns 1.

`a0` is only stored at (12,sp) and passed to the three map helpers, which do not read it (D); the
lab passes the unmapped sentinel `0xC0000000`. On the camera `0x50b4ecf3` posts to the resource
task (event flag `0x77777777`, `0x501a9804`), whose handlers read flash through `0x500022c2`; the
API type → resource type map is `0x50b4f993` (0→0 font, 1→11 bitmap, 2→12 strings).

Lab (X): everything above runs natively except the two leaf calls, which are stubs:

| stub | address | does | checks (errors otherwise) |
|---|---|---|---|
| S-SET | `0x50b7b618` (CALL, return `0x50b4e88a`) | returns the setting-3009 value of the requested language | setting id = 3009 |
| S-RES | `0x50b4ecf3` (CALLS from `0x51257c58/cb8/d3b`) | copies the raw record to its slot, returns the slot address | (19..36, 0) font, (1..18, 2) strings, (0, 1) icons; the record is the language's; size ≤ slot; the string record's tag is the language. In the menu labs (native store), after GUI creation, the session language follows a change made in the GUI (Setup page 6, panel 439): when the latest native read of 3009 names a language whose record is the one requested, that language becomes the session's (`MenuLab._follow_language`, check_nav group 10); anything else is still an error |

The singleton's constructor runs natively and creates kernel objects with direct kernel calls (no RTOS wrapper): a mutex under `0x50ab2948`, a semaphore and a mutex under the settings-store init `0x50b7b5c3` (`0x50b4e468`), and GPIInitPlatform's mutex (`0x50b810bf`). The semaphore's error print carries the tag `BSE_ACRTSK`, but it follows the `acre_sem` call at `0x50d9b014` (kernel spec 7). On the K-native lab, the default of `check_text` since M9, these calls succeed and nothing prints (U11). In the kernel-less lab (`check_text --kernel none`) they fail and print four `[RTOS]ServiceCallErr` lines (mutex `-34`, semaphore `-25`, mutex `-25`, GPIInitPlatform's mutex `-25`), pinned there as `KERNEL_NONE_INIT_PRINTS`. The stubbed reads do not depend on those objects. Whether the cached or uncached alias is returned on the camera is unknown and irrelevant (callers only dereference it).

## 4. Fonts (entries 19..36)

```
+0x000  header, 16 bytes
+0x010  L1: u32[256] page pointers, index = code >> 8; 0 = absent
+0x410  per present page, ascending: per glyph, ascending code: bitmap (format 0x02, 4-byte
        aligned), 0..3 zero bytes, 16-byte glyph record; then the page's L2: u32[256] record
        pointers, index = code & 0xFF
zero fill to the record size
```

Every non-zero byte of the 18 blobs is accounted for by this layout (V). Header: +8 line height
(61 Latin, 58 CJK, 60 Thai; style table `0x510bea18`, centring `0x510bf153`) (D, X); +11 vertical
offset added to every glyph (`0x510bf157`, `0x510bd41f`) (D, X); +10 equals the largest pad (V,
unread); +0..7, +9, +12..15 unread in gpifont (?).

Glyph record: +0 `box_w`, +1 `box_h` (= bitmap size, V), +2 s8 `top`, +4 bitmap pointer, +8 s8
`lsb`, +9 `width`, +10 s8 `rsb`, +11 `pad_l`, +12 `pad_r`; bytes 3 and 13..15 always 0 (V).
`box_w = pad_l + width + pad_r` except U+0020 (V).

Pixels (format 0x02, one byte per run `index << 4 | run-1`): 0 background, 1 fill, 2/3 fill → edge,
4 edge, 5/6 edge → outside. The GPI text callback builds the inline LUT
`{0, c, c+1, c+2, e, e+1, e+2, 0, ...}` with c = gc+36, e = byte gc+684; e = 0 maps 4..6 to 0
(`0x510bc837..0x510bc870`) (D, X).

Lookup (`0x510bf061..0x510bf09b`): missing page or glyph → page0[0x20]: an absent character draws
as a space (D, X). The fonts are subsets: chs covers 85.7 % of its own strings' code points, jpn
86.2 %, Latin 96..100 % (V); why is unknown.

Advance of glyph g before the next character (mode = byte +684 ≠ 0 of the gc that the font
attributes point to, `0x510bf09d`; that is the last gc that ran GcSetFontById for the font, not
necessarily the drawing gc, section 5):

```
next is NUL / CR / LF:  mode 0: width            mode 1: box_w
next is a valid @icon@: mode 0: width + rsb      mode 1: width + pad_l + max(rsb, pad_r)
next is glyph n (absent: the zero record at 0x61328dc0, 0x510bf38f..a5):
  mode 0: width + rsb + (n.lsb >= 0 ? n.lsb : 0)
  mode 1: d = rsb + n.lsb; d > pad_r + n.pad_l ? width + pad_l + d - n.pad_l : width + pad_l + pad_r
  then if rsb < 0: advance -= rsb
extra (glyph n only; s16 slot zeroed at 0x510bf040): mode 0 and n.lsb < 0: n.lsb (0x510bf3c7..cc);
  then if rsb < 0: extra += rsb (0x510bf3fa..0a)
pen step = advance + extra
```

`advance` is iterator +8. The draw op copies `extra` to layout table +4 (`0x62b3e3c8`,
`0x510bf146..4d`; the icon op stores 0, `0x510beff1`), and the GPI text callback adds it to the pen
gc+32 at its end (`0x510bca7e..8f`); DrawText's path for an invisible cell does the same
(`0x510ab702..12`). The pen therefore moves `width + rsb + n.lsb` in mode 0 for either sign of
`n.lsb`, and the `rsb < 0` correction cancels in both modes. No glyph of the 17 Latin/CJK fonts has
a negative `lsb` or `rsb` (V), so `extra` is 0 for everything the reference draws; th has negative
values (17 negative `lsb`, e.g. U+0E31 −16; 3 negative `rsb`, e.g. U+0E4C −6), which matters once the
Thai shaper is modelled (U5). `advance` in `emu/refs/font.mjs` returns the pen step. `0x510b5a05` draws nothing
when iterator +8 ≤ 0 (`0x510b5a0c..13`); no non-Thai glyph reaches that.

Inline icon (`0x510beed4`): emitted at the first `@`, the next five characters are skipped (skip
count 5, `0x510bed91..95`); advance = icon width, plus, from the character after that first `@`
(`0x510bef1b..28`, so the escape's own hex digit): mode 0 `lsb` if > 0 (D, X: `@a003@`), mode 1
`lsb - pad_l` if `lsb > pad_l` (D only). For a code in `0xA000..0xA095` that character is `A` or `a`
(nothing else can put `0xA` in the code's top nibble: a second-character `@` adds only `0x4000`), and in all 17 non-Thai fonts `A` has lsb 0, pad_l 1 and `a`
lsb 1, pad_l 1 (V): the mode-0 term is 1 for a lowercase escape and the mode-1 term is never reached.
An absent glyph there makes the op return 0 (`0x510bef63..6f`, not exercised).

Placement by gpiDrawCharactor `0x510bd32f` (D, X):

```
glyph: x = pen - (mode 0 and pen - pad_l >= 0 ? pad_l : 0)          0x510bd3f2..0x510bd419
       y = line y + top + h[11] + int((size - h[8]) / 2)            0x510bd41f..0x510bd432
icon:  x = pen, y = line y + (size - icon h) // 2
```

`pen` is the x that gpiDrawCharactor receives. For a fully visible cell it is the layer x; for a
partly visible one the GPI text callback draws into the kind-3 record (section 9) at the cell's own x,
except that a cell with pen + iterator +8 > device +2 (1600 for all three devices, X) or pen < 0 is drawn
at x 0 there and copied back from the visible offset (`0x510bc98d..a3`; vertically the same with
device +4 = 1200, `0x510bc9a5..bd`). At x 0 the `pen - pad_l >= 0` test fails, so in mode 0 a glyph
cut by the screen's right edge lands `pad_l` right of the rule above, with no engine error (X: `Hello`
in a box ending at 1599; the same box 100 px left keeps the shift). `layout(..., {device_w})` in `emu/refs/font.mjs`.

`size` = descriptor +66 = 62 for every language. The global offset `(0x6036731c/e)` is added too;
it is 0 in the lab (asserted).

## 5. Call graph and data layouts

```
GUI startup 0x510c2830
  0x510bad63(d0 = 18, a0 = copy of .data 0x613292d0)   Genifa pools (0x510c2891)
  0x51257bfb(obj, 0)                                    section 3 (0x510c2910)
  0x510b93da Genifa init (0x510c293c)
    GPIInitPlatform 0x510bbae7: osddraw_init (via 0x50ae7ce1), GUI buffer tables
      0x62b3dfdc/e4/ec = records 2,3 / 4,5 / 0,1, offscreen 0x62b3dff4 = kind-3 record, FILL of
      every buffer with 255 (palettes 62/63) or 31 (61), 3 x 168-byte devices at 0x62b3dc94
      with the GPI ops at +76 (text callback +108 = 0x510bc7d8)
    port table 0x510b90c8: font ops at 0x60366f8c..0x60366ff0 (op20 0x510bec43 at 0x60366fac,
      op52 0x510bec64 at 0x60366fb0), text hook 0x510c10d8 at 0x60367034
    op12 0x510be8ef font driver init
GcCreate 0x510b998e(d0 = id): 688-byte gc from the Genifa pool; gc+0 = id, device 0, gc+4 =
  device bounds {0, 0, w-1, h-1}, copied to gc+16 and the clip gc+24; gc+40 = (1, 1);
  gc+660 = 1 (0x510b9c3a)
gc set device 0x510ba02c(a0 = gc, d0 = layer 0..2, a1 = 0): gc+68 = gc+72 = device
gc set background 0x510b9b39(a0 = gc, d0): gc+648, gc+60 (-1 = none, 0x510b5b2b)
gc set clip 0x510b9b6d(a0 = gc, a1 = rect or 0): gc+24 = rect ∩ gc+4 (0 = gc+4)
GcSetFontById 0x510b9f70(a0 = gc, d0 = id): descriptor 0x510bafcb, op13 open, op16 attrs,
  gc+76 = font handle
DrawTextById 0x510ae820(a0 = gc, d0 = id, d1 = style, a1 = box):
  GetString, then DrawText 0x510ab0f9(a0 = gc, d0 = style, d1 = text, a1 = box)   section 6
    per glyph: op20 -> 0x510bed1e (glyph / icon / Thai) -> layout table 0x62b3e3c4
      Genifa cell 0x510b5a05: cell rect 0x510bb525, clip 0x510bb0e6, background 0x510b4798
        device+108 = 0x510bc7d8 GPI text callback
          fully visible: gpiDrawCharactor 0x510bd32f into *(0x62b3dfdc + 8*layer + 4*byte 0x603672f0)
          partly visible: COPY layer -> kind-3 record, gpiDrawCharactor there, COPY back
            gpiDrawCharactor -> FONT wrapper 0x50ae827a -> osddraw_exec_font 0x51013415
              -> request type 1 -> BITMAP 0x51011913 (word 0 bits 0x800 | 0x1000, 4 LUT words)
```

Font handle: 12-byte record {u16 index, u16, → 24-byte attributes}; attributes +0/+2 size (62),
+12 = gc, +16 horizontal scale 1, +17 vertical scale 1, +20 0, +21 letter spacing 0 (read in the
lab after GcSetFontById). The font ops reach the attributes through `(0x62b3e3bc)` + 24 × index
(`0x510bf04a..56`, `0x510beef3..ff`), the same record handle +4 points to. GcSetFontById builds them
on its stack with +12 = its gc (`0x510b9fa0`) and stores them with op16; two gcs with font id 1 get
the same handle, so +12 is the last gc that ran GcSetFontById for that font (X). The glyph op and the
icon op read the layout mode from that gc's +684 (`0x510bf09d`, `0x510bef75`), and the layout entry's
no-edge flag (+2, `0x510bf17b..83`) that gpiDrawCharactor tests comes from it too; the LUT comes from
the drawing gc (`0x510bc850..70`). Iterator (28 bytes): +0 current, +4 next, +8 u16 advance, +10 u16 cell
height (= size), +16 bitmap, +20/+22 subtracted from the advance, +24 skip count. Layout table
`0x62b3e3c4`: s16 count, +3 vertical centring, +4 extra pen advance, entries of 20 bytes at
`0x62b3e3d0` (+0 code, +2 no-edge flag, +4 s8 top, +8 font, +12 glyph record, +16 icon record).
GPI text callback `0x510bc7d8` (CALLS): d0/d1 = visible top-left, a0 = gc, a1 = iterator, stack
S0 x offset, S1 visible width, S2 y offset, S3 visible height. FONT request `0x62b3dc68`: +0
record, +4 plane, +8/+10 x/y, +12/+14 0 (no scaling), +24..+39 LUT bytes, +40 bitmap. Type-1
request (108 bytes): +4 base, +8 1664, +14/+16 x/y, +20 bitmap, +40 4, +44 the 16-byte LUT.

## 6. DrawText `0x510ab0f9` (gate G1: runs natively)

Arguments (D, X):

| arg | meaning | evidence |
|---|---|---|
| a0 | gc | (20,sp) |
| d0 | style struct | (44,sp); fields below |
| d1 | UTF-16 text; 0 → return | `0x510ab117` |
| a1 | box `{s16 x0, y0, x1, y1}`, inclusive | copied by `0x510bb0b2` to sp+148 |

Style struct: +0 text colour → gc+36, +4 → gc+652, +8 → gc+656 (setters `0x510b9e95`,
`0x510b9ded`, `0x510b9dd0`; +4/+8 are not read on the text path we ran, meaning ?), +12 u8
horizontal alignment, +13 u8 vertical alignment, +14/+16/+18/+20 u16 margins left/right/top/bottom
(`0x510ab1a7..d0`), +22 u8 edge colour → gc+684. All four gc fields are saved first and restored
at the end (`0x510ab28c..2ef`, `0x510ab74e..63`). So the edge always reaches the LUT, but it sets the
layout mode only when the drawing gc is the font's attribute gc (section 5); on any other gc the mode
comes from that gc's resting +684, 0 in the lab (X: `check_text` 11).

Steps:

1. No font handle (gc+76) → return. Font attribute +20 = 1 diverts to `0x510ab789` (not decoded).
2. Box minus margins; empty → return.
3. Line height = `0x510b8d0a(gc, 'A')` (iterator +10 of the measure op on "A" = size) × vertical
   scale, because `(0x60366fb4)` = 0 at run time; line gap = gc+676 (`0x510b9063`, 0 from
   GcCreate). Lines allowed = ceil(box height / line height); a 12-byte entry per line from the
   Genifa pool (`0x510bad6d`), freed at `0x510ab769`.
4. Clip: `0x510b906a` saves gc+24 and sets it to box ∩ gc+4 ∩ gc+24 (restored by `0x510b9b6d`).
5. Text hook `(0x60367034)` = `0x510c10d8`: a copy of the text into a pool buffer
   (`0x510c2770`), or `0x510c1118` when attribute +20 = 1 (not decoded).
6. Split into lines at CR LF / LF; per line {start, characters, width}; width = sum of the measure
   op's advances × horizontal scale, plus the spacing where positive.
7. Vertical offset from +13: 0 top, 1 `(h - (n·lh + (n-1)·gap)) / 2`, 2 bottom; horizontal per line
   from +12: 0 left, 1 `(w - line width) / 2`, 2 right (remapped when attribute +20 = 1).
8. Per line: pen = (x0 + h offset, y0 + v offset) → gc+32 (`0x510b996c`); the line's count of
   iterations, one code unit each (section 2); per iteration op20, and a zero result just steps the
   iterator (`0x510ab716`). Otherwise the cell is `{pen x, pen y, pen x + (iterator +8 − +20 − +22)
   × scale, pen y + line height}` (`0x510ab641..671`, normalised by `0x510bb525`) and is intersected
   with the clip, edges inclusive (`0x510bb0e6`). A cell that misses the clip ends the line when its
   right edge is right of the clip's (`0x510ab6d7..ee`), else the pen moves on (`0x510ab6f0..712`).
   For a line inside the clip vertically and cells of positive width, the line ends at the first
   cell whose pen x is right of the clip; `layout(..., {clip_right})` models that. Visible cells
   go to `0x510b5a05` (scales 1) or `0x510b613e`; pen += advance × scale + spacing; next line
   y += line height + gap.

The lab calls it with no margins, left/top alignment and a box `(x, y, 1599, 1199)` unless a test
passes another box (H-STYLE). Line breaking, the first pen position and the line pitch are now
firmware behaviour; `check_text` predicts them as box origin and pitch 62 and matches. Step 7 is read
from the code at `0x510ab46d..0x510ab57f` (`om1-menu-spec.md` 9) and modelled by
`align_box` in `emu/refs/font.mjs`. Against the firmware only right alignment is checked: every text of Setup
pages 1-5 (en, ja, zh-CN) is one line in a 62-px box (= the line height), aligned (0,1) or (2,1), so
the vertical-centre offset is 0 whatever the formula and horizontal centring never occurs. Vertical
centre/bottom and horizontal centre are covered only by `check_menu` group 0's hand vectors, which come
from the same reading of the code. The line count n follows the measure loop: a break always records a
line, the last line only when its measure count is non-zero (`0x510ab42f`), so text ending in a break has
no trailing empty line (menu spec 9). `TextLab` (`emu/src/lab/text.mjs`) itself still passes left/top alignment.

## 7. Lab harness (`emu/src/lab/text.mjs`)

Native, in order: memory-manager constructors, Genifa pools, `0x51257bfb(0)`, Genifa init
(GPIInitPlatform with osddraw_init), GcCreate / set device / set background / GcSetFontById,
DrawTextById or DrawText, everything below them, `gpiUpdateDisplay` and the display flow of
`DisplayLab`. After the bring-up the harness asserts: the registry equals the guarded table, the
GUI buffer tables equal records 2,3 / 4,5 / 0,1 and the offscreen record is the kind-3 record, all
three devices have +108 = `0x510bc7d8`, the five resource pointers, the bytes `0x603657c5`,
`0x603671c4`, `0x603672f0` and the offset `0x6036731c` are 0, the resource calls are
`[(font, 0), (strings, 2), (0, 1)]`, the API object has vtable `0x60e38124`, and the engine ran
only FILLs.

Stand-ins:

| id | what | why |
|---|---|---|
| S-SET, S-RES | section 3 | the language is the experiment's input; no settings store, resource task or flash |
| S-LOG | `0x5124b173` records (file, line) and returns | that is all it does at log level `(0x603758b8)` = 0 (`0x5124b177..7f`); needed to observe the 1060 rejections |
| H-GC | gc id 0, background -1 passed to the native setters | the GUI's own values per widget are not traced |
| H-STYLE | style struct and box | section 6 |
| H-CLEAR | the harness zeroes the text layer (and, for the demo, the panel layer; for clip tests the kind-3 record) | section 9 |
| H-STACK | a zeroed 4 KiB stack window before each DrawText call | section 9 |
| H-SWITCH | `0x51257bfb(1)`, then GcSetFontById again on every gc, in creation order (the last one stays the attribute gc) | the camera's sequence after a change is not traced; `check_text` 5 shows buffers equal to fresh sessions |
| bracket | `exec_start`/`exec_end` around each call | existing `OsdLab` practice |
| colours | text 10, edge 7 (palette 63: 10/11/12 = fefefe/aaaaaa/555555, 7/8/9 = black at alpha ff/bb/88) | real menu colours not traced |

## 8. Checks (`emu/checks/check_text.mjs`)

0 offline parse of 18 string tables and 18 fonts (strict), font = strings + 18; 1 native loader for
all 18 languages with GetString on 73 ids each, the bring-up prints pinned (none on the default K-native lab, the four `KERNEL_NONE_INIT_PRINTS` with `--kernel none`), a wrong S-SET value
refused; 2 en/ja/zh-CN, ids 1020, 4414, 2872, 737, 147 (+ a literal for en): every BITMAP's header,
position and inline LUT and the whole 1664×1200 buffer equal `emu/refs/font.mjs`; 3 mode 0; 4 icons and the
rejected escapes (1212 is five CR LF lines); 5 language switch equivalence; 6 TFT/EVF demo against
`check_display.reference()`, the text record equals OSD2 DMASADR, fill pixels reach both outputs,
notes file; 7 negative controls; 8 the transparency cases pinned as expected errors; 9 right- and
bottom-clipped lines, an icon right of the clip whose skips carry into line 2 (with a glyph-only
control and a "no skip carry" reference that must differ), a three-line string cut after line 2
in mode 1 (8 pins the mode-0 refusal of the same draw), and mode-0 text cut by the device's right
edge (`Hello` at 1580, a 120-unit line from x 24) with a "no screen-edge rule" reference that must
differ, and the same box at 1480 where it must not; 10 fourteen one-line and seven multi-line literals
with U+001F before glyphs and escapes, `@` inside an escape, `@0000@`, a missing glyph, U+1F600 and
skips carried across lines (into a U+001F too), plus `A@a003@B` and `A@A003@B` in mode 0, and "U+001F
as a space" and "no skip carry" controls; the reference refuses escapes below `0xA000`, the lab
outcome is in the notes file; 11 two gcs with font id 1: one handle, attribute +12 = the last
GcSetFontById caller, text with edge 7 laid out in mode 1 on that gc and in mode 0 with the edge LUT
on the other (its refusals predicted), then the same after GcSetFontById on the first gc, and a
"mode from the drawing gc" reference that must differ. `--mutants` reruns the check with S-SET answering the requested
language and with H-STACK off, and requires reported `[FAIL]`s rather than an uncaught error. `emu/refs/font.mjs` is imported only after a lab exists, and the check asserts the
drawing code did not import it.

## 9. Found while implementing

- **The firmware cannot clear to colour 0 through osddraw.** `osddraw_exec_rect` rejects colour 0
  ("OSD Argument Err(rect).", `0x51012b92..0x51012bc2`); `gpiDrawOsdRectangle` with colour 0 issues
  no command (X). So H-CLEAR is a harness write, not a native FILL as the design planned.
- **GPIInitPlatform's clear colour 255 never reaches the VSC.** The display path uploads palette
  entries 0..127 per OSD plane (3 × 128 words, `check_display` 3), so index 255 in a composited
  plane is `PAL_UNWRITTEN`. The demo therefore zeroes both drawn layers. What the panel shows for
  index ≥ 128 is ?.
- **DrawText leaves its iterator's skip count uninitialised.** The iterator is at sp+196; +24 is
  never written by DrawText, and op20/op52 reset it only when the iterator address differs from the
  previous call's (`0x510bec46..57`, `0x510bec67..78`). The lab calls every function from the same
  SP, so the second DrawText saw a stale count and skipped every character (X). H-STACK zeroes the
  stack window first. Whether the camera can hit this is ?. Within one call the count is meant to
  carry: it crosses line breaks (section 2), and the reference models that.
- **Mode 0 overlaps glyph boxes.** Without an edge the bitmap is placed `pad_l` left of the pen, so
  the next glyph's LUT-0 pixels can land on the previous glyph's fill shades; in "Reset/Clock/
  Language/Others" one BITMAP is refused (`BMP_TRANSPARENCY`). `check_text` 3 predicts the refusal.
- **Clipped glyphs depend on transparency too.** A partly visible cell is drawn into the shared
  kind-3 record over a copy of the layer; stale pixels there from GPIInitPlatform or an earlier
  glyph make the BITMAP refused. With the kind-3 record zeroed, right and bottom clipping in mode 1
  match the reference cropped to the box (X). In mode 0 that is not enough: for a cell inside the
  screen the bitmap is shifted `pad_l` left inside the kind-3 record too, so its LUT-0 pixels can land
  on the fill the previous glyph just left there. 2387 cut by the bottom edge at y 1130 gets one
  `BMP_TRANSPARENCY` at `0x510113b6` on value `0x0c` (fill c+2) in the kind-3 record; `check_text` 8
  pins it (U1). A cell cut by the device's right edge is drawn at x 0 of the kind-3 record and loses
  the shift (section 4), so its visible part lands `pad_l` right, without an engine error; `check_text`
  9 checks it.
- **The layout mode is a property of the font, not of the drawing gc.** All gcs with one font id share
  a handle whose attributes point at the last GcSetFontById caller (section 5). With two gcs, text with
  edge 7 on the other gc is laid out in mode 0 but coloured with the edge LUT; "Wavy" and the literal
  give 4 refused BITMAPs that way (`check_text` 11). Which gc a camera screen leaves there is ? (U17).
- **Correction to the round-1 note:** the FONT wrapper `0x50ae827a` has three callers
  (`0x510bd4a5`, `0x510be57d`, `0x50b2fc89`) and is how the GUI draws every glyph; `0x62b3e3c4` is
  the one-character layout buffer, not a glyph table.

## 10. Unknowns

| # | unknown | effect in the lab |
|---|---|---|
| U1 | whether the engine skips LUT/index value 0 (evidence for "skip": Thai marks stacked as separate BITMAPs at negative x `0x510bf19f`, edge 0 → LUT 0 `0x510bc85a`, the clipped-glyph copy-through, objects 14/15/16 map their transparent colour to 0 `0x510bc600..67c`; all indirect) | `BMP_TRANSPARENCY`; H-CLEAR; a photo of the Thai menu would settle it |
| U2 | palette entries real menus use for text and edge | answered for the Setup tab by M5 (`om1-menu-spec.md` 8): palettes 86/87/85, theme 8 colour 13 (style 1) and 19 (title), edge 0; styles 7/8 (22/25) read from the tables only. `TextLab` keeps its labelled 10/7 |
| U4 | font header bytes 0..7, 9, 10, 12..15; glyph bytes 3, 13..15; descriptor fields other than name and size | none for drawing |
| U5 | Thai shaper `0x510bf19f`; DrawText's attribute +20 path `0x510ab789` and text hook `0x510c1118` | Thai excluded from the reference; 3 refused marks pinned |
| U6 | how strings with icon codes `0xA096..0xA113` are shown on the camera | the firmware's `@` glyphs are pinned |
| U7 | the camera's sequence after `0x51257bfb(1)` | H-SWITCH, proven equivalent to a fresh session |
| U8 | which string id a menu row uses; menu layout data | answered for the Setup tab: `om1-menu-spec.md`, `emu/src/lab/menudata.mjs`; the `TextLab` demo still chooses ids |
| U9 | top-clip copy-back height (`0x510bc97c` adds S2 to S3) and whether Genifa passes such a clip | observed only (notes file) |
| U10 | scaled glyph paths `0x510b613e`, `0x510be4b0`; deferred layer -1 queue | engine `BMP_SCALE` if reached |
| U11 | kernel object creation in the lab (four prints) | resolved: M9 makes K-native the default lab of `check_text`, which pins no print; the four prints stay pinned for `check_text --kernel none` (the kernel-less lab, `KERNEL_NONE_INIT_PRINTS`). The print tagged `BSE_ACRTSK` is a semaphore create (kernel spec 7) |
| U12 | writers of `0x603671c4` and `0x603672f0` | asserted 0; the drawn record equals the shown plane. `0x603672f0` is written by the GUI flip `0x510bcab8` (M5) |
| U13 | why the subset fonts omit characters their strings use | firmware draws a space; so does the reference |
| U14 | cached vs uncached address from the real resource getter | irrelevant to the callers |
| U15 | style +4/+8 (gc+652/+656) meaning; gc id (gc+0) meaning | 0 passed by `TextLab`; every menu DrawText passes 15/15 and gc id 1 (M5, X); meaning still ? |
| U16 | panel output of OSD indices ≥ 128 (no VSC palette upload) | H-CLEAR of drawn layers. M8 (check_display group 13): no v1.9 path uploads them: the palette-word writer `0x501e055b` has exactly six direct callers, in the loops of `0x501dc449` and `0x501d90f9`, each closed by `cmp 128` (`0x501dc54b`, `0x501dc651`, `0x501dc753`, `0x501d91ea`, `0x501d921a`, `0x501d924c`), and the only OSDFMT writer call (`0x501d9942`) passes 128, so only the 128-entry mode is used. The data: GUI palettes 61/62/63 and 85/86/87 give tra 0 at entries 127 and 255, so the menu's index 255 is transparent whether bit 7 selects entry 255 or is ignored (entry 127); a third reading, the never-written SRAM half 128..255, is unknown, and the model keeps PAL_UNWRITTEN. What the pixel shows needs hardware |
| U17 | which gc the camera's widgets leave as the font's attribute gc, and whether any sets its +684 outside DrawText | the lab draws on the attribute gc unless a test says otherwise; `check_text` 11 pins both cases. The menu uses one gc (id 1), which is also the attribute gc, +684 = 0 (M5, `check_menu` 2) |
