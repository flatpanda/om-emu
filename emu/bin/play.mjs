#!/usr/bin/env node
// The player on node: the play viewer's server with the JS lab, its command line and HTTP API; the
// page is web/play.html. The logic is in host/playcli.mjs. --model CODE picks the camera model (host/modelarg.mjs: the
// default is OM_EMU_MODEL, else E143; --model list shows them), whose firmware is provisioned on first use
// (host/firmware.mjs). The camera keeps its settings and clock between sessions (S-NVRAM) in
// ~/.om-emu/nvram-<model>.json unless --nvram off (or OM_EMU_NVRAM=off); --nvram FILE or OM_EMU_NVRAM=FILE keeps them
// elsewhere (host/nvram.mjs nvramChoice); the startup line names the file. --card-put DOS/PATH=LOCAL (repeatable) puts
// a file on the card OM_EMU_CARD keeps before the first session mounts it (src/lab/cardfs.mjs; emu/README.md "The
// card's files").
//   node emu/bin/play.mjs [--model CODE|list] [--nvram on|off|FILE] [--idle off] [--debug-api] [--no-browser]
//                         [--out DIR] [--replay FILE] [--card-put DOS/PATH=LOCAL]...
import { takeModel, importLab } from '../host/modelarg.mjs';

const argv = takeModel('play.mjs', process.argv.slice(2));
const { main } = await importLab('play.mjs', new URL('../host/playcli.mjs', import.meta.url).href);    // after takeModel: it fixes the lab's model
main(argv).then((rc) => { process.exitCode = rc; });
