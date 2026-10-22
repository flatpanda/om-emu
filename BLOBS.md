# Large blobs

Firmware images, descrambled blocks, patched candidates, third-party
references and the built objdump are not committed. `BLOBS.sha256` pins
every one of them except the objdump, a host build whose hash is not
reproducible; after restoring, check with:

```bash
sha256sum -c BLOBS.sha256
```

| Path | Source |
|---|---|
| `fw/OLY_E_14{0,2,3,4,5,6,7}_*.BIN` | Vendor updater API: `node emu/bin/fw-survey.mjs fetch E143` (or `tools/omfw_download.sh E143 fw`, which needs GNU grep) (E140 E-M10 IV, E142 E-P7, E143 OM-1, E144 OM-5, E145 TG-7, E146 OM-1 II, E147 OM-3). The API only serves the latest version, so a newer release will not match the pinned hash. Each fetch also writes the API's reply next to the file as `<code>_reply.xml` (not committed: it carries the vendor's terms); the reply's download URL is a signed CDN path, `dl01.om-digitalsolutions.net/dslr/<model>/v<ver>/<file>`. |
| `fw/old/OLY_E_1{00..39}_*.BIN` | Same API, `fw-survey.mjs fetch` files codes below E140 under `fw/old/`: the 25 bodies E100–E139 the API serves (list in `docs/model-survey.md`), from E-PL5 to E-M1 III. |
| `unpacked/<code>/*.bin` | Generated: `node emu/bin/fetch-fw.mjs --model <code>` writes the two blocks the emulator reads (the main code block and the resource block), unpacked by `emu/src/fw/olyfw.mjs` and checked against `emu/src/fw/models.mjs`; it downloads the `.BIN` first when it is missing. For every block of a body: `cd unpacked/E143 && python3 ../../tools/olyfw.py ../../fw/OLY_E_143_1900_0000_0000.BIN --dump` (writes to the current directory). The container format is in `docs/firmware-container.md`. |
| `artifacts/nd128/*.bin`, `*.BIN` | Generated: `python3 tools/om1_nd128.py` from `fw/OLY_E_143_1900_0000_0000.BIN`; hashes also in `artifacts/nd128/manifest.json`. |
| `refs/mn103_ida_module.zip` | https://web.archive.org/web/20120927114459id_/http://www.pentax-hack.info/firmware/pan/mn103.zip |
| `refs/mn103_isa_13250-040e.pdf` | https://web.archive.org/web/20160404092019id_/http://pentax-hack.info/firmware/pan/13250-040e.pdf |
| `tools/mn10300-objdump` | Built from GNU binutils 2.43 (`https://ftp.gnu.org/gnu/binutils/binutils-2.43.tar.xz`) with `configure --target=mn10300-elf --disable-nls --disable-werror`, then `make all-binutils`; copy `binutils/objdump`. Host build, so its hash is not reproducible. |
