#!/usr/bin/env node
// The scripted menu session on node: a command line driving the JS lab (a script of tokens; one line
// and a PNG per step, session.json). The logic is in host/navcli.mjs. --model CODE picks the camera model
// (host/modelarg.mjs, as bin/play.mjs); nav does not fetch firmware: a model without its blocks is refused, after its
// command line is parsed, with the bin/fetch-fw.mjs command that provisions them.
//   node emu/bin/nav.mjs [--model CODE|list] [--time] [--png each|end|none] [--out DIR] [--start T,P,C | --blank] 'DOWN OK MENU'
import { takeModel, importLab } from '../host/modelarg.mjs';

const argv = takeModel('nav.mjs', process.argv.slice(2));
const { main } = await importLab('nav.mjs', new URL('../host/navcli.mjs', import.meta.url).href);    // after takeModel: it fixes the lab's model
process.exitCode = await main(argv);
