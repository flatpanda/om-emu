#!/usr/bin/env node
// The firmware-free tier of bin/test.mjs: the tests that need no firmware image and nothing under emu/out/, so they run
// on any checkout with node (npm run test:pure, a few seconds). The recorded ISA vectors
// (test/fixtures/isa_vectors.json) on both engines, the core's two tiers in lockstep and its length tables
// (test_core.mjs), the pure sha256, the router's request bodies, the browser player's driver, result box and page
// after a stop, the players' Card panel and session options (the card's reader, the card routes on a headless
// Player, the browser's S-NVRAM host), the scene stand-in's model, the decode-cache checks, the command-line parser of the checks and tools
// (test_args.mjs), the worker purity rule (and no py-prefixed module or name), the firmware rules of
// src/fw/facts.mjs (test_facts.mjs: firmware-optional, each unpacked main block checked against its MODELS entry) and
// the firmware map's units (test_fwmap.mjs: the machine's coverage option off and on, fwmap's decoder against the
// interpreter's transfer forms, the coverage union, the block aggregation), the SCPU's clock, ports and link
// (test_scpu.mjs), the HDMI port's device and sink (test_hdmi.mjs), the accelerometer stand-in's sample
// (test_acc.mjs), the SD card model (SDHC and SDXC) and the FAT and exFAT readers (test_storage.mjs), S-SUBJECT's
// subject boxes and transform (test_subject.mjs), the lens serial controller, the deferred-call triggers and S-LENSMCU's replies (test_lens.mjs),
// the debug API's argument checks, halt,
// trace filters and live-route units (test_live.mjs liveUnits: a machine on a blank image), its trace rules and edge
// cases (test_debug.mjs traceRuleUnits: halfword device accesses, code on the lab stub, the bus window, code-fetch
// faults, a watch hit in an interrupt entry) and the publication
// audit's rules on a throwaway repository (test_pubaudit.mjs), and the SCPU's Cortex-M4 core: its decoder, executor and
// exception model on hand-written vectors and the QEMU-recorded differential vectors (test_m4.mjs), and the SCPU's STM32L4
// peripheral models one by one against the reference manual's register semantics (test_stm32l4.mjs stm32Units), and
// the bridge that puts the SCPU's own firmware behind the link (test_scpum4.mjs scpuM4Units: its clock, the frame log
// rebuilt from the wire, the byte mover).
// bin/test.mjs runs all of these too, with everything else.
//   node emu/bin/test-pure.mjs
import { vectors } from '../test/test_vectors.mjs';
import { coreTests } from '../test/test_core.mjs';
import { purity } from '../test/test_pure.mjs';
import { cache } from '../test/test_regress.mjs';
import { shaTests, bodyTests, driverTests, resultBoxTests, pageTests, cardTests } from '../test/test_web.mjs';
import { sceneUnits } from '../test/test_scene.mjs';
import { factsTests } from '../test/test_facts.mjs';
import { argsTests } from '../test/test_args.mjs';
import { fwmapUnits } from '../test/test_fwmap.mjs';
import { scpuUnits } from '../test/test_scpu.mjs';
import { hdmiUnits } from '../test/test_hdmi.mjs';
import { accUnits } from '../test/test_acc.mjs';
import { storageUnits } from '../test/test_storage.mjs';
import { subjectUnits } from '../test/test_subject.mjs';
import { lensUnits } from '../test/test_lens.mjs';
import { liveUnits } from '../test/test_live.mjs';
import { traceRuleUnits } from '../test/test_debug.mjs';
import { pubauditTests } from '../test/test_pubaudit.mjs';
import { m4Units, m4Vectors } from '../test/test_m4.mjs';
import { stm32Units } from '../test/test_stm32l4.mjs';
import { scpuM4Units } from '../test/test_scpum4.mjs';

let bad = 0;
const report = (name, r, passed = r.checks - r.bad.length, total = r.checks) => {
  console.log(`${name}: ${passed}/${total}`);
  r.bad.slice(0, 20).forEach((x) => console.log('  ', x));
  bad += r.bad.length;
};
for (const engine of ['port', 'cached']) {
  const r = vectors(engine);
  console.log(`isa vectors (${engine}): ${r.pass}/${r.total}`);
  for (const [f, l] of Object.entries(r.fails)) console.log('  ', f, l.length, l.slice(0, 3));
  bad += r.total - r.pass;
}
const co = coreTests();
console.log(`core: lockstep step() vs run(1) ${co.lockstep.cases - co.lockstep.bad.length}/${co.lockstep.cases} (${co.lockstep.faults} faulting), mutant 7 caught: ${co.mutant.bad.length ? 'yes' : 'NO'}; lengths over ${co.lengths.pairs} (op, p) pairs`);
co.bad.forEach((x) => console.log('  ', x));
bad += co.bad.length;
const ca = cache();
report('decode-cache checks', { checks: ca.checks, bad: ca.bad });
report('sha256', shaTests());
report('request bodies', bodyTests());
report('driver', await driverTests());
report('wait_result', await resultBoxTests());
report('page after a stop', await pageTests());
report('Card panel and session options (web/cardfiles.mjs, the card routes, web/nvram.mjs)', await cardTests());
report('scene stand-in (S-SCENE)', sceneUnits());
report('command-line parser', argsTests());
report('firmware map units (coverage option, decoder, union, blocks)', fwmapUnits());
report('SCPU clock, ports, link pins and the sub-CPU (S-SCPUDEV)', scpuUnits());
report('HDMI port: transmitter, hot-plug pin, sink (S-HDMISINK)', hdmiUnits());
report('accelerometer sample (S-ACCSAMPLE)', accUnits());
report('SD card and FAT / exFAT readers (S-SDCARD, refs/fat.mjs, refs/exfat.mjs)', storageUnits());
report('subject frames: the scene\'s subject boxes, DISP_FRAME\'s transform taken back (S-SUBJECT)', subjectUnits());
report('the lens serial controller, deferred-call triggers and the lens (S-LENSMCU)', lensUnits());
report('debug API: argument checks, halt, trace filters, live route', await liveUnits());
report('debug API: trace rules and edge cases (halfword device accesses, stub code, bus window, fetch faults, interrupt entry)', traceRuleUnits());
report('publication audit (throwaway repository, made-up firmware)', await pubauditTests());
report('Cortex-M4 core: decoder, executor, exceptions (hand-written)', m4Units());
{ const v = m4Vectors(); report(`Cortex-M4 core against QEMU's recorded vectors (${v.cases} cases)`, v); }
report('SCPU STM32L4 peripheral models (RCC, FLASH, GPIO / EXTI, U(S)ART, DMA, I2C, SPI, timers, RTC, ADC)', stm32Units());
report('the SCPU\'s own firmware behind the link: clock, frame log from the wire, byte mover', scpuM4Units());
const fa = factsTests();
report(`firmware facts (${fa.models} unpacked main blocks)`, fa);
const pu = purity();
report('purity', { checks: pu.files, bad: pu.bad });
console.log(bad ? `FAILED (${bad})` : 'all passed');
process.exit(bad ? 1 : 0);
