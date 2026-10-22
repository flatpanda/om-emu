#!/usr/bin/env node
// The player on node: the play viewer's server with the JS lab, its command line and HTTP API; the
// page is web/play.html. The logic is in host/playcli.mjs. --model CODE picks the camera model (host/modelarg.mjs: the
// default is OM_EMU_MODEL, else E143; --model list shows them), whose firmware is provisioned on first use
// (host/firmware.mjs).
//   node emu/bin/play.mjs [--model CODE|list] [--idle off] [--debug-api] [--no-browser] [--out DIR] [--replay FILE] ...
import { takeModel, importLab } from '../host/modelarg.mjs';

const argv = takeModel('play.mjs', process.argv.slice(2));
const { main } = await importLab('play.mjs', new URL('../host/playcli.mjs', import.meta.url).href);    // after takeModel: it fixes the lab's model
main(argv).then((rc) => { process.exitCode = rc; });
