# Firmware acquisition and the .BIN container

How the vendor's firmware is fetched, how the `.BIN` container is laid out and descrambled, which bodies the updater
API serves, and what the community knows about repacking and flashing. The emulator never needs more than the first
two parts: `node emu/bin/fetch-fw.mjs` does the download, the check against `BLOBS.sha256` and the unpacking
(`emu/src/fw/olyfw.mjs`) for you.

## Fetching firmware: the vendor's updater API

The updater API needs no authentication and still answers as of 2026-10:

- Endpoint: `POST https://fw01.om-digitalsolutions.net/ww_inform/fcache.do`.
- The `User-Agent` must be `Olympus`; the body is a `<firmware_demand>` XML document (`emu/src/fw/updater.mjs`,
  `tools/omfw_download.sh`).
- The `<hard_code>` field `OLY<CODE>000000000` selects the model. `<CODE>` is the first four characters of the
  DCOLYMP file name: OM-1 `E143`, OM-1 Mark II `E146`, OM-3 `E147`, OM-5 `E144`.
- The reply gives a signed CloudFront `<url>` (`dl01.om-digitalsolutions.net/dslr/<model>/v<ver>/<file>`),
  `<file_name>` and `<file_size>`. The download itself needs nothing but the signed URL.
- The API serves only the latest release of each body, so a newer release will not match the hash `BLOBS.sha256`
  pins.

Tools: `node emu/bin/fetch-fw.mjs [--model CODE]` (download, verify and unpack one model's blocks),
`node emu/bin/fw-survey.mjs probe|fetch|survey` (the multi-model survey, `docs/model-survey.md`) and
`tools/omfw_download.sh <CODE> <outdir>` (the same request with curl; needs GNU grep). The reply each fetch writes next
to the `.BIN` (`<code>_reply.xml`) carries the vendor's terms and is not committed.

The current bodies' files:

| Body | Code | File | Bytes |
|---|---|---|---|
| OM-1 v1.9 | E143 | `OLY_E_143_1900_0000_0000.BIN` | 240,779,264 |
| OM-1 Mark II v1.3 | E146 | `OLY_E_146_1300_0000_0000.BIN` | 240,517,120 |
| OM-3 v1.1 | E147 | `OLY_E_147_1100_0000_0000.BIN` | 240,517,120 |
| OM-5 v1.2 | E144 | `OLY_E_144_1200_0000_0000.BIN` | 92,274,688 |

### From a web page

The browser player cannot fetch the `.BIN` itself, because neither server sends CORS headers. Measured from this
host with curl on 2026-10-29, with `Origin: https://flatpanda.github.io`:

- The API, preflight (`OPTIONS`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers:
  content-type`): `200`, `allow: POST, OPTIONS`, no `Access-Control-Allow-Origin`.
- The API, `POST` (with `User-Agent: Olympus` and `text/xml`, and again with a browser's `User-Agent` and
  `text/plain`, the form a page could send without a preflight): `200`, the same 4,142-byte reply both times
  (`OLY_E_143_1900_0000_0000.BIN`, 240,779,264 bytes, `up_date` 2025/11/04), no `Access-Control-Allow-Origin`.
  The API therefore does not require the `Olympus` user agent, but a page still cannot read the reply.
- The signed CDN URL (`dl01.om-digitalsolutions.net/dslr/1430/v1900/...`, CloudFront in front of S3): the preflight
  for a `Range` header gets `403`; `HEAD` gets `200` and a ranged `GET` gets `206` (`content-type:
  application/octet-stream`, `accept-ranges: bytes`), but neither has `Access-Control-Allow-Origin`. The URL without
  its signature gets `403`.

The file is the raw `.BIN`, with no archive around it. OM System's support pages
(`explore.omsystem.com/c/en/firmware`, the per-body support pages, the update instructions) offer no `.BIN` either:
they point to OM Workspace (USB) and OM Image Share (Wi-Fi), which fetch the file themselves. The player therefore
names the model's `.BIN`. It shows `emu/src/fw/updater.mjs` `fetchCommand()`, a one-line curl command that asks the
API and saves the file under its own name (tried with a 1 KiB range on 2026-10-29: the bytes matched
`fw/OLY_E_143_1900_0000_0000.BIN`), and it takes the file from its file input or from a drop on the page. It goes
through no relay or proxy.

## The container

The encoding is the long-known Olympus `oly_fw_manip` scheme (community tool with C++ source, mirrored at
`http://xdel.ru/downloads/olympus-firmware/oly_fw_tools.zip`). It is neither compression nor encryption:

- A file is a run of blocks `<head:32><body:len><tail:32>` that tiles the whole file.
- Head and tail (little-endian, packed): `0x00` u16 type, ASCII `OE` / `OM` / `OA` / `OL`; `0x02` u16 model, a
  big-endian nibble pair (OM-1 `14 30`, OM-1 Mark II `14 60`, OM-5 `14 40`); `0x04` u32 pad; `0x08` u32 load address;
  `0x0C` u32 body length; `0x10` u16 version, BCD (`0x1900` is v1.9); `0x12` u16 pad; `0x14` u16 flags; `0x16` 6 pad
  bytes; `0x1C` u32 checksum (0 in the head, minus the sum in the tail).
- Flags: `0x0000` code, plain; `0x0100` code, scrambled; `0x0101` languages, strings and fonts; `0x0102` images;
  `0x0106` large data; `0x0107` sounds; `0x010e` miscellaneous.
- Descrambling (flags != 0): per aligned 16 bytes `decoded[k] = encoded[PERM[k]] ^ 0xFF` with
  `PERM = [1,3,0,2, 6,4,7,5, 11,10,9,8, 13,14,12,15]`. An unaligned tail is kept as it is. There is no S-box and no
  key.
- Checksum: the sum of the u32 little-endian words over the head, the descrambled body and the tail is 0.
- Main code load address: head field `0x08`, `0x50000000` on the OM-1 and the OM-1 Mark II. The run-time base the
  code's pointers assume is a different matter (`0x60021020` on E143; `docs/model-survey.md`).

All six OM-1 v1.9 blocks pass the checksum, as do those of the OM-1 Mark II, OM-3 and OM-5: the 2022 TruePic X bodies
use the same container and scramble as the old E-series. Block `blk02000000` is an `olycompress` resource container
(compressed assets, Japanese text in UTF-16LE); the symbols are in the main code block `blk00000000`.

Readers: `emu/src/fw/olyfw.mjs` (the JS unpacker the emulator uses; `emu/test/test_unpack.mjs` checks the blocks it
walks against the files in `unpacked/E143`) and `tools/olyfw.py <BIN> [--dump]` (walks the blocks, descrambles, verifies
the checksums and with `--dump` writes each block to the current directory). `olyfw.py` also has the inverse
`scramble()`; all six OM-1 v1.9 blocks round-trip byte for byte.

The descrambled main code is full of readable text: `OM-1`, `OM SYSTEM CAMERA`, lens names,
`- uITRON Error Code -` (the RTOS is uITRON) and debug symbols such as `[GUI App] Class::method()`, about 97,000
strings in the OM-1 code block. The CPU is Panasonic MN10300 / AM33, not ARM: `0xCD` read as CALL lands in range 100%
of the time, while the ARM always-condition rate is 2.5% against about 80% for real ARM code.

## The bodies the API serves

Probing `hard_code=OLY<code>000000000` over E100-E199 (`node emu/bin/fw-survey.mjs probe`, 2026-10-19) finds 32
bodies: E100-E101, E106-E113, E115, E117, E118, E120-E122, E125, E126, E129, E130, E132-E134, E137, E139, E140 and
E142-E147. `docs/model-survey.md` lists them with model names and releases. E148-E199 return nothing; the OM System
PEN announced on 2026-09-09 (shipped 2026-10-14, TruePic IX) was not yet on the server at the last probe.

All 32 use the same OE container and scramble (every block checksums) and the same AM33 reset head, back to the 2012
E-PL5. Outside the OM-1 line (E143, E146, E147) all 29 use E144's MMIO bases (ISC `0x8fe00000`, VSC `0x9c000000`);
`docs/model-survey.md` has the run-time bases, resource forms and how far each body ports.

## Repacking, patching and flashing (community knowledge)

Writing firmware to a camera can brick it.

- The closed-source `oly_fw_manip.exe` (in `oly_fw_tools.zip`, by "invaders") does `--unpack --in X.BIN --out X.xml`
  (an XML manifest plus numbered parts such as `00.main-code-01.bin`), `--extract-resources` (JPEG and WAV out) and
  `--pack` (rebuild, rescramble, fix the checksums). `tools/olyfw.py` already reproduces unpacking, descrambling and
  the checksum for the current bodies.
- ABel's historical mods were published as direct byte patches into the packed `.BIN` (for example
  `003339D2: F6 FB`), with each segment's last four bytes (`...FFFC-...FFFF`) as the checksum fix, which matches the
  checksum model above: patch the descrambled body, rescramble, recompute the tail checksum so the sum is 0. Dither's
  `fc2bin.ps1` (gist `3cb04e90636e85ae7361`) applies `fc /b`-style diffs.
- Flashing paths: (a) the on-camera SD-card DCOLYMP method (hold OK at power-on); (b) a fake update server (jove's
  `oly_http.py`) through a hosts redirect of `fw01` / `dl01.olympus-imaging.com`; (c) jove's USB SCSI protocol
  (`oly_scsi.py`, SCSI opcodes `0xc0`-`0xc4`, write opcode `0x9119`).
- `tools/om1_nd128.py` builds a version- and hash-locked research candidate from the OM-1 v1.9 `.BIN`
  ([ND128 investigation](../analysis/nd128/README.md)). Its block checksums pass; it has not been tried on a camera.
- All public decoders and addresses come from the earlier MN103 generation (E-M5 to Pen-F, 2012-2018). The old
  load-anchor trick (`": This command list"`, the next DWORD, then `"init\0init "`) does not apply to the OM-1; use
  head field `0x08`.

## Disassembly aids

- MN103 IDA 4.9 processor module:
  `https://web.archive.org/web/20120927114459id_/http://www.pentax-hack.info/firmware/pan/mn103.zip`.
- MN103 ISA manual `13250-040e.pdf`:
  `https://web.archive.org/web/20160404092019id_/http://pentax-hack.info/firmware/pan/13250-040e.pdf`.
- GNU binutils `objdump` for `mn10300-elf` (build recipe in `BLOBS.md`; `tools/mn10300dis.sh` wraps it). Ghidra has no
  AM33 support.

See also: [feature gap OM-1 vs OM-1 Mark II](../analysis/feature-gap/README.md),
[lens-gated features](../analysis/lens-gates/README.md).
