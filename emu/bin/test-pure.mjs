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
// (test_scpu.mjs), the HDMI port's device and sink (test_hdmi.mjs), the kind-3 VSC's COMPOSE on E122's and E118's boards (a
// child per board, test_vsc3.mjs), the accelerometer stand-in's sample
// (test_acc.mjs), the SD card model (SDHC and SDXC) and the FAT and exFAT readers (test_storage.mjs), the host's
// writer of the card's FAT32 and exFAT volumes read back by those readers, and bin/card.mjs on a card the test makes
// (test_cardfs.mjs cardfsUnits, cardCliTests), S-SUBJECT's
// subject boxes and transform (test_subject.mjs), the DML engine's register file (test_mdet.mjs dmlUnits, S-DML),
// the PDT / TRC unit's register file (test_pdt.mjs pdtUnits, S-PDT),
// the A53's ISC node-4 service against the oracle's recorded exchanges (test_a53isc.mjs a53iscUnits, S-A53ISC),
// the EMS1 engine's register file (test_ems1.mjs ems1Units, S-EMS1),
// the imgpro unit's register file and fills (test_imgpro.mjs imgproUnits, S-IMGPRO),
// the lab's baseline JPEG decoder and the pipeline block's register file (test_imgpipe.mjs jpegUnits, imgpipeUnits,
// S-IMGPIPE),
// S-MODPOST's rule, the guard's report of it and the object-name table's rule (test_modpost.mjs modpostUnits),
// S-TAKERDY's rule (test_take_ready.mjs takeReadyUnits),
// S-DISPQ's queue discipline (test_dispq.mjs dispqUnits),
// S-RELSEQ's S1 rule by the focus mode and S-SEQSTANDBY's rest test (test_fnlever.mjs fnLeverUnits),
// the camera front end's control plane as cam.c's second init programs it, with the clock enables of the sensor's
// power-on (test_camfe.mjs camFeUnits, S-CAMFE),
// the lens serial controller, the deferred-call triggers and S-LENSMCU's replies (test_lens.mjs),
// PER_SIO's served IIC transfers and the TG-5's charger (test_sio.mjs),
// the debug API's argument checks, halt,
// trace filters and live-route units (test_live.mjs liveUnits: a machine on a blank image), the call op's argument
// checks and the exec trace's registers (test_call.mjs callUnits), the machine's second core
// on a blank image (test_cpu2.mjs coresUnits), its trace rules and edge
// cases (test_debug.mjs traceRuleUnits: halfword device accesses, code on the lab stub, the bus window, code-fetch
// faults, a watch hit in an interrupt entry) and the publication
// audit's rules on a throwaway repository (test_pubaudit.mjs), and the SCPU's Cortex-M4 core: its decoder, executor and
// exception model on hand-written vectors and the QEMU-recorded differential vectors (test_m4.mjs), and the SCPU's STM32L4
// peripheral models one by one against the reference manual's register semantics (test_stm32l4.mjs stm32Units), and
// the bridge that puts the SCPU's own firmware behind the link (test_scpum4.mjs scpuM4Units: its clock, the frame log
// rebuilt from the wire, the byte mover), the lab's audio output and the synthesized shutter sound (test_audio.mjs
// audioUnits: the events' checks, the queue and rings, publish_audio, the /api/audio route on the router and the
// browser page, the clicks, S-SHUTTERSND's events), the audio hardware's units (test_audiohw.mjs audioHwUnits: the
// audio port's registers, slots and interrupt, the sound IC's register file, the sink), the published site's files
// and the browser player's download command (test_site.mjs), the patch overlays' rules on synthetic blocks and the
// --replay check of a patched session (test_patch.mjs patchUnits), the NAND the resource tables are read from
// (test_resnand.mjs resnandUnits: the container's blocks at their load addresses, the browser's extract, the sound
// area's builder, S-RESNAND's layer), and S-NVRAM's choice, document, record and replay (test_nvram.mjs nvramUnits).
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
import { vsc3Units } from '../test/test_vsc3.mjs';
import { accUnits } from '../test/test_acc.mjs';
import { storageUnits } from '../test/test_storage.mjs';
import { subjectUnits } from '../test/test_subject.mjs';
import { dmlUnits } from '../test/test_mdet.mjs';
import { pdtUnits } from '../test/test_pdt.mjs';
import { a53iscUnits } from '../test/test_a53isc.mjs';
import { ems1Units } from '../test/test_ems1.mjs';
import { imgproUnits } from '../test/test_imgpro.mjs';
import { jpegUnits, imgpipeUnits } from '../test/test_imgpipe.mjs';
import { modpostUnits } from '../test/test_modpost.mjs';
import { takeReadyUnits } from '../test/test_take_ready.mjs';
import { dispqUnits } from '../test/test_dispq.mjs';
import { fnLeverUnits } from '../test/test_fnlever.mjs';
import { camFeUnits } from '../test/test_camfe.mjs';
import { lensUnits } from '../test/test_lens.mjs';
import { sioUnits } from '../test/test_sio.mjs';
import { liveUnits } from '../test/test_live.mjs';
import { callUnits } from '../test/test_call.mjs';
import { coresUnits } from '../test/test_cpu2.mjs';
import { traceRuleUnits } from '../test/test_debug.mjs';
import { pubauditTests } from '../test/test_pubaudit.mjs';
import { m4Units, m4Vectors } from '../test/test_m4.mjs';
import { stm32Units } from '../test/test_stm32l4.mjs';
import { scpuM4Units } from '../test/test_scpum4.mjs';
import { siteTests } from '../test/test_site.mjs';
import { audioUnits } from '../test/test_audio.mjs';
import { audioHwUnits } from '../test/test_audiohw.mjs';
import { patchUnits } from '../test/test_patch.mjs';
import { resnandUnits } from '../test/test_resnand.mjs';
import { nvramUnits } from '../test/test_nvram.mjs';
import { cardfsUnits, cardCliTests } from '../test/test_cardfs.mjs';

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
console.log(`core: lockstep step() vs run(1) ${co.lockstep.cases - co.lockstep.bad.length}/${co.lockstep.cases} (${co.lockstep.faults} faulting), mutant 7 caught: ${co.mutant.bad.length ? 'yes' : 'NO'}; lengths over ${co.lengths.pairs} (op, p) pairs; udf07 ${co.bsch.checks - co.bsch.bad.length}/${co.bsch.checks}`);
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
report('the published site\'s files and the player\'s download command (bin/site.mjs, src/fw/updater.mjs)', siteTests());
report('scene stand-in (S-SCENE)', sceneUnits());
report('audio output and the shutter sound (src/lab/audio.mjs, S-SHUTTERSND)', await audioUnits());
report('audio port, sound IC and sink (src/dev/audio.mjs, S-WM8946, src/lab/audiohw.mjs)', audioHwUnits());
report('patch overlays: file shapes, block references, old bytes, overlaps, ranges, digests, a patched replay (src/fw/patch.mjs)', patchUnits());
report('the resource tables\' NAND: blocks at their load addresses, the extract, the sound area builder, S-RESNAND (src/fw/nand.mjs)', await resnandUnits());
report('S-NVRAM: bin/play.mjs\'s choice, the document, the record and its replay (host/nvram.mjs, src/lab/nvramdoc.mjs)', await nvramUnits());
report('command-line parser', argsTests());
report('firmware map units (coverage option, decoder, union, blocks)', fwmapUnits());
report('SCPU clock, ports, link pins and the sub-CPU (S-SCPUDEV)', scpuUnits());
report('HDMI port: transmitter, hot-plug pin, sink (S-HDMISINK)', hdmiUnits());
report('kind-3 VSC COMPOSE on E122\'s and E118\'s boards (planes, palette groups, order codes, scaler, levels, refusals, the line compare)', vsc3Units());
report('accelerometer sample (S-ACCSAMPLE)', accUnits());
report('SD card and FAT / exFAT readers (S-SDCARD, refs/fat.mjs, refs/exfat.mjs)', storageUnits());
report('the host\'s card writer on FAT32 and exFAT, read back by refs/ (src/lab/cardfs.mjs)', cardfsUnits());
report('bin/card.mjs on a card the test makes: ls, put, get, mkdir, rm, refusals and usage errors', cardCliTests());
report('subject frames: the scene\'s subject boxes, DISP_FRAME\'s transform taken back (S-SUBJECT)', subjectUnits());
report('the DML engine\'s register file: images, output area, completion, refusals (S-DML)', dmlUnits());
report('the PDT / TRC unit\'s register file: resets, images, results, completions, refusals (S-PDT)', pdtUnits());
report('the A53\'s ISC node-4 service against the oracle\'s recorded sccore, socket and CGI exchanges (S-A53ISC)', a53iscUnits());
report('the EMS1 engine\'s register file: tables, images, results, completions, refusals (S-EMS1)', ems1Units());
report('the imgpro unit\'s register file: the fills, their bytes and ends, refusals (S-IMGPRO)', imgproUnits());
report('the lab\'s baseline JPEG decoder against the independent one (src/lab/jpeg.mjs, refs/jpeg.mjs)', jpegUnits());
report('the pipeline block\'s and the JPEG codec\'s register file: a decode, its bytes and end, refusals (S-IMGPIPE)', imgpipeUnits());
report('S-MODPOST: the posts it takes, the guard\'s report, the object-name table (src/lab/camapp.mjs, src/fw/facts.mjs objectNameId)', await modpostUnits());
report('S-TAKERDY: the take requests it follows with TAKE\'s event or leaves unanswered (src/lab/camapp.mjs take_ready_rule)', await takeReadyUnits());
report('S-DISPQ\'s queue: posts in an open DISPLAY run kept for the outermost run\'s end, in order (src/lab/dispq.mjs)', await dispqUnits());
report('S-RELSEQ\'s S1 by the focus mode (HALF_AF) and S-SEQSTANDBY\'s rest test (src/lab/camapp.mjs)', await fnLeverUnits());
report('the camera front end\'s control plane: the second init\'s program, A-CAMFE-1 / 2, refusals (S-CAMFE)', camFeUnits());
report('the lens serial controller, deferred-call triggers and the lens (S-LENSMCU)', lensUnits());
report('PER_SIO\'s served IIC transfers and the TG-5\'s charger (S-SIOIIC, S-CHARGER)', sioUnits());
report('debug API: argument checks, halt, trace filters, live route', await liveUnits());
report('debug API: the call op\'s argument checks, the exec trace\'s registers (src/debug/call.mjs)', callUnits());
report('the machine\'s second core: core numbers, local RAM, interleave, bank 2\'s request (src/core/cores.mjs)', await coresUnits());
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
