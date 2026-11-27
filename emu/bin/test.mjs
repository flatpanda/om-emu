#!/usr/bin/env node
// The test gate in one command: the recorded ISA vectors on both engines (the CPU's own step and the decoded-cache
// interpreter), the core's two tiers in lockstep, the decode-cache regression (test_regress.mjs), the command-line
// tools and the regression net's permanent controls (test_cli.mjs: mutants golden.mjs must report), infrastructure
// (test_infra.mjs), the VSC register tables, class tables, blend table and histogram unit (test_dev.mjs), the kind-3
// VSC's COMPOSE
// on E122's board (test_vsc3.mjs), the E118 family's second timer unit (test_timer2.mjs), the kick model's TB-layout
// refusals (test_irq.mjs), the replayer's argument binding and PlaySession.trim (test_lab.mjs), the check runner and
// the checks' controls (test_checks.mjs) and their command-line parser (test_args.mjs), the debug API's units
// (test_debug.mjs) and its live route to a play session (test_live.mjs) with its call op (test_call.mjs: mid-function
// calls with stop pcs too, and through bin/session.mjs on E143 and E147), the firmware's setting names and the setting
// op and tokens on E143, E146 and E147 (test_setnames.mjs), the settings init chain's rule and its sessions against the off switch on
// E143, E146 and E147 (test_setchain.mjs), the date prompt's end at a display switch on the same three
// (test_promptend.mjs), the .BIN unpacker (test_unpack.mjs, needing $OM_FW_DIR or $OM_BIN, else counted as a failure),
// the browser player's pure parts, its node host, webgate B6's page inputs on a node Player and its Worker in a node
// worker thread (test_web.mjs), the node host
// over HTTP (test_host.mjs), the image sensor stand-in (test_scene.mjs), the camera application running natively
// (test_camapp.mjs, with S-HEAP over an idle and a workload, the mode dial's positions and camapp 3 with its
// frames), S-MODPOST (test_modpost.mjs), a still under camapp 3 on E143, E146 and E147 (test_c3take.mjs), the play
// module native under camapp 3 on E143, E146 and E147 (test_playmod.mjs), the TAKE
// probe's record of what TAKE_FUNC takes and asks on E143 (test_take.mjs), CPU 2 natively on the machine's second
// core (test_cpu2.mjs), the VSC's histogram unit in play under camapp 3 (test_hist.mjs), the firmware's start
// tasks' conditions and the start probe's records on E143 (test_ustart.mjs), the lab's audio output and the
// synthesized shutter sound at a
// release, and the AF beep end to end (test_audio.mjs), the audio hardware and AUD_EXEC's play path on E143
// (test_audiohw.mjs), the SCPU's clock, ports, link pins and sub-CPU model
// (test_scpu.mjs), the publication audit (test_pubaudit.mjs), patch overlays (test_patch.mjs: the rules, --patch and
// --main on E143 through debug.mjs, play.mjs and nav.mjs, the hook rule; an om3-patch-2 file and --main on E147),
// caduceus-ep7's edits.json (test_ep7edits.mjs: the reader's rules, and each pinned release at hand on E142), the
// boot's section loader (test_sections.mjs: the rules and the unloaded ranges on a synthetic block, a patched routine
// past section 6's end through debug.mjs on E143 and E147, and S-SECLOADED with its negative control on E143), the
// boot's stage bits S-BOOTSTAGE sets and the boot job they follow on E143, E146 and E147 (test_bootstage.mjs), staged
// section availability for patched code, --sec-ready's static pass and run-time watch (test_secready.mjs), the
// strict mode (test_strict.mjs: the machine's strict ranges and the log on a synthetic block, stock sessions on E143,
// E147 and E142 with no new site, and patched routines of each class with their controls on E142 and E143), the hidden
// service screens with MENU held at power-on on E143 and the MS count (H-MECCOUNT) on E143, E146 and E147
// (test_hidemode.mjs), the HDMI
// port and a plug in play with the output switch to HDMI on E143,
// E146 and E147 and the GUI on it under control camapp 3 on E143 (test_hdmi.mjs), the accelerometer's sample, check_level
// on E146 and E147 and its PER_ROTATE groups
// (PER_ROTATE by default since 2026-11-23) on E143, E146 and E147 (test_acc.mjs), the picture's orientation tag by
// default and with --rotate off on E143, E146 and E147 (test_orient.mjs), the card and the
// file system on E143, E146, E147, E144, E142, E134, E148, E137, E125, E130, E133, E129, E132, E145 and the E118
// family (S2's file with its header maker's Exif) and SDXC cards on E143 (test_storage.mjs), the host's card writer and the
// firmware mounting what it wrote on E143 and E147 (test_cardfs.mjs), a power-on with no card and the media status
// around a removal on E143 and E147 (test_nocard.mjs), INFO's still information
// in playback with two pictures, RIGHT, LEFT, OK's wizard, INFO's three views and the erase or its refusal on the 19
// bodies (test_playinfo.mjs), the erase in playback natively on fifteen bodies and its refusal on the four others
// (test_erase.mjs), the playback menu's Erase All natively on E143, E146, E147 and E148 (test_eraseall.mjs), its Copy All to
// the second card natively on E143 and E146 (test_copyall.mjs), the creative dial refused on E143 and turned on E147 (test_cdial.mjs), the still / movie switch
// refused on E143 and moved on E147 (test_smswitch.mjs), the E-P7's Shortcut button refused on E143 and opening the
// Colour Profile page on E142 (test_shortcut.mjs), the display switch both ways with a shot on each display and
// the TFT's frame at idle on E146 and E147, LV in S2's rec view on all three (test_dispswitch.mjs), the scripted session through
// bin/session.mjs on E143 and on E147 with a synthetic om3-patch-2 file (test_session.mjs), its traces, breakpoints and
// watchpoints on E143 and E147 (test_trace.mjs), its stack captures, dumps, breaks at hooked pcs, calls at a stop,
// display options and OSD policy on E143 and E147 (test_tools.mjs), a Caduceus film's values below the pixels on E147
// with OM_CADUCEUS (test_looks.mjs), its hue and lightness, Blacks and Whites and split toning hooks on their outputs
// with OM_CADUCEUS (test_lookhooks.mjs), its Grain's camera route to combiner 1's gain and its halation pass on pixels
// by calls with OM_CADUCEUS (test_lookcode.mjs), E147's still set-up at each creative-dial position and, with
// OM_CADUCEUS, Caduceus' .hook_su run by S2 at COLOR (test_stillsetup.mjs), TAKE's shot allocated and freed over 20
// pictures on E143, E146 and E147 (test_shotalloc.mjs), TAKE's own fills of the shot against S-EXIFPRM's copies
// on the same three (test_takefills.mjs), the still's stage builders called standalone on stock E122,
// E143 and E147 on a job the test writes, with their read sets (test_stages.mjs, A-STAGEJOB), every caduceus-om3
// release against its pins when
// OM_CADUCEUS names a checkout
// (test_caduceus.mjs), the field-failure corpus: builds that failed on a camera caught and their fixes passing, with
// a synthetic self-control on E143 (test_fieldfail.mjs), a tap on the touch mode icon on E143, E146, E147, ten bodies of the E144
// family and the E118 family, and in the super control panel on E144 and the E118 family, and with the EVF active
// on the E118 family and the E144 family's bodies with an EVF, the AF Targeting Pad off and on (test_touch.mjs),
// subject
// detection's frames on E143
// (test_subject.mjs), CPU 3's MDET_DL natively with the DML engine's model on E143 (test_mdet.mjs),
// the lens on the mount natively on E143, E146 and E147 (test_lens.mjs), the resource tables loaded
// natively from the NAND on E143 (test_resnand.mjs), the SCPU's Cortex-M4 core
// (test_m4.mjs: hand-written vectors, QEMU's recorded vectors, the SCPU image from reset to its first unmodelled
// access), the SCPU's STM32L4 machine (test_stm32l4.mjs: the peripheral models, the SCPU image to its console prompt,
// console commands, its standby and the wake-up), the SCPU's own firmware behind the link against S-SCPUDEV on E143
// and E146 (test_scpum4.mjs), the firmware
// rules of src/fw/facts.mjs (test_facts.mjs) and the firmware map (test_fwmap.mjs:
// the machine's coverage option, the static map's determinism and pinned headline, the labels' keys, run.mjs under
// OM_COVERAGE), and the port's placement of a tied vote (test_place.mjs). The fixtures they compare with are emu's own (test/fixtures, checks/fixtures, golden.json): a
// deliberate behaviour change that one of them pins is re-recorded from emu with its reason.
// Also: the memory map's rules at addRegion (test_mem.mjs).
// What a firmware file is, on made-up bodies and on the .BINs and blocks at hand, and --main with a .BIN container on
// E143 and E147 (test_identify.mjs).
// E-M1-Miii mods.json packs on E139's run-time image, --main's resource block and version-only containers, on made-up
// blocks, on E139's blocks and the pinned pack, and through bin/session.mjs on E139 (test_mods.mjs).
// The Stand-ins tab's rows against the labels a session can report, and does report on E143 and E147 (test_standins.mjs).
// What a picture is, said at the picture, and a shot's source on E143 and E147 (test_sources.mjs).
// The lab's call on a synthetic block of hand-written functions, without firmware (test_slice.mjs).
// The idle key image on every body: no type-2 key idles pressed (test_keyidle.mjs).
//   node emu/bin/test.mjs        (needs the unpacked firmware and emu/golden.json)
import fs from 'node:fs';
import { vectors } from '../test/test_vectors.mjs';
import { coreTests } from '../test/test_core.mjs';
import { purity } from '../test/test_pure.mjs';
import { factsTests } from '../test/test_facts.mjs';
import { cache } from '../test/test_regress.mjs';
import { cli, cli2, cli3, cli4, cli5, cli6 } from '../test/test_cli.mjs';
import { vscClasses, vscRegsHeader, blendTable, vscHistUnits } from '../test/test_dev.mjs';
import { vsc3Units } from '../test/test_vsc3.mjs';
import { timer2Units } from '../test/test_timer2.mjs';
import { kickRefusals, refusalControl } from '../test/test_irq.mjs';
import { infra } from '../test/test_infra.mjs';
import { labTests, trimTests } from '../test/test_lab.mjs';
import { checksTests } from '../test/test_checks.mjs';
import { argsTests } from '../test/test_args.mjs';
import { watchUnits, snapshotUnits, protocolUnits, limitUnits, attachUnits, traceRuleUnits } from '../test/test_debug.mjs';
import { unpackTests } from '../test/test_unpack.mjs';
import { shaTests, yccTests, controlsTests, hostApiTests, pageInputsTests, driverTests, bodyTests, resultBoxTests, pageTests, cardTests, workerTests } from '../test/test_web.mjs';

// the temporary OM_CHECK_OUT directories of checktrace runs that ended by a signal, which they could not remove
{
  const os = await import('node:os'), path = await import('node:path');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  let swept = 0;
  for (const f of fs.readdirSync(os.tmpdir())) {
    const m = /^om-emu-checktrace-(\d+)-/.exec(f);
    if (m && !alive(Number(m[1]))) { fs.rmSync(path.join(os.tmpdir(), f), { recursive: true, force: true }); swept++; }
  }
  if (swept) console.log(`swept ${swept} temporary directories of checktrace runs that no longer exist`);
}
let bad = 0;
for (const engine of ['port', 'cached']) {
  const r = vectors(engine);
  console.log(`isa vectors (${engine}): ${r.pass}/${r.total}`);
  bad += r.total - r.pass;
}
{
  const co = coreTests();
  console.log(`core (test_core.mjs): lockstep step() vs run(1) ${co.lockstep.cases - co.lockstep.bad.length}/${co.lockstep.cases}, mutant 7 caught: ${co.mutant.bad.length ? 'yes' : 'NO'}; lengths over ${co.lengths.pairs} (op, p) pairs`);
  co.bad.forEach((x) => console.log('  ', x));
  bad += co.bad.length;
}
const ca = cache(), cl = cli(), c2 = cli2();
console.log(`decode-cache checks: ${ca.checks - ca.bad.length}/${ca.checks}; command-line checks: ${cl.checks - cl.bad.length}/${cl.checks} (round 1), ${c2.checks - c2.bad.length}/${c2.checks} (round 2)`);
[...ca.bad, ...cl.bad, ...c2.bad].forEach((x) => console.log('  ', x));
bad += ca.bad.length + cl.bad.length + c2.bad.length;
const inf = infra(), hd = vscRegsHeader(), bl = blendTable(), vc = vscClasses(), v3 = vsc3Units(), c3 = cli3(), vh = await vscHistUnits();
console.log(`infrastructure: ${inf.checks - inf.bad.length}/${inf.checks}; vsc register tables vs header: ${hd.bad.length ? 'DIFFERENT' : 'identical'}; blend table: ${bl.inputs - bl.bad.length}/${bl.inputs}; vsc-classes: ${vc.names} names, ${vc.bad.length} differences; kind-3 VSC compose: ${v3.checks - v3.bad.length}/${v3.checks}; Stage 1 tooling checks: ${c3.checks - c3.bad.length}/${c3.checks}; vsc histogram unit: ${vh.checks - vh.bad.length}/${vh.checks}`);
[...inf.bad, ...hd.bad, ...bl.bad, ...vc.bad, ...v3.bad, ...c3.bad, ...vh.bad].forEach((x) => console.log('  ', x));
bad += inf.bad.length + hd.bad.length + bl.bad.length + vc.bad.length + v3.bad.length + c3.bad.length + vh.bad.length;
// the E118 family's second timer unit on the lab clock, without firmware (test_timer2.mjs)
{
  const t2 = timer2Units();
  console.log(`the second timer unit: ${t2.checks - t2.bad.length}/${t2.checks}`);
  t2.bad.forEach((x) => console.log('  ', x));
  bad += t2.bad.length;
}
const c4 = cli4(), c5 = cli5();
console.log(`Stage 2 tooling checks (J1 included): ${c4.checks - c4.bad.length}/${c4.checks}; Player-boundary replay checks: ${c5.checks - c5.bad.length}/${c5.checks}`);
[...c4.bad, ...c5.bad].forEach((x) => console.log('  ', x));
bad += c4.bad.length + c5.bad.length;
const kr = await kickRefusals(), kn = await refusalControl();
console.log(`TB-layout refusals: ${kr.cases - kr.bad.length}/${kr.cases}; refusal control (NC-REF-e): ${kn.checks - kn.bad.length}/${kn.checks}`);
[...kr.bad, ...kn.bad].forEach((x) => console.log('  ', x));
bad += kr.bad.length + kn.bad.length;
const lt = labTests(), tt = trimTests();
console.log(`replayer binding and Player refusals (test_lab.mjs): ${lt.checks - lt.bad.length}/${lt.checks}; PlaySession.trim bounds an idling session: ${tt.checks - tt.bad.length}/${tt.checks}`);
[...lt.bad.slice(0, 20), ...tt.bad].forEach((x) => console.log('  ', x));
bad += lt.bad.length + tt.bad.length;
const c6 = cli6(), ck = await checksTests(), ar = argsTests();
console.log(`Stage 3a open item 1 (J7, J8, J7b, NC-FMT): ${c6.checks - c6.bad.length}/${c6.checks}; check runner and check controls (the osd inputs included): ${ck.checks - ck.bad.length}/${ck.checks}; command-line parser: ${ar.checks - ar.bad.length}/${ar.checks}`);
[...c6.bad, ...ck.bad, ...ar.bad].forEach((x) => console.log('  ', x));
bad += c6.bad.length + ck.bad.length + ar.bad.length;
const dw = watchUnits(), dsn = snapshotUnits(), dp = protocolUnits(), dl = limitUnits(), dat = attachUnits(), dtr = traceRuleUnits();
console.log(`debug API: watch units ${dw.checks - dw.bad.length}/${dw.checks}, snapshot units ${dsn.checks - dsn.bad.length}/${dsn.checks}, protocol units ${dp.checks - dp.bad.length}/${dp.checks}, trace-file, watch-log and stderr limits ${dl.checks - dl.bad.length}/${dl.checks}, lab-session and disasm units ${dat.checks - dat.bad.length}/${dat.checks}, trace rules and edge cases ${dtr.checks - dtr.bad.length}/${dtr.checks}`);
[...dw.bad, ...dsn.bad, ...dp.bad, ...dl.bad, ...dat.bad, ...dtr.bad].forEach((x) => console.log('  ', x));
bad += dw.bad.length + dsn.bad.length + dp.bad.length + dl.bad.length + dat.bad.length + dtr.bad.length;
const up = await unpackTests(), sh = shaTests(), yc = yccTests(), ct = controlsTests(), dr = await driverTests(), ap = await hostApiTests(), pi = await pageInputsTests();
console.log(`browser player: unpacker (B1) ${up.checks - up.bad.length}/${up.checks}${up.skipped.length ? `, ${up.skipped.length} SKIPPED (no firmware: set OM_FW_DIR or OM_BIN)` : ''}; sha256 (B2) ${sh.checks - sh.bad.length}/${sh.checks}; ycc_to_rgb over 2^24 words (B4) ${yc.checks - yc.bad.length}/${yc.checks}; node host on a Player (B4) ${ap.checks - ap.bad.length}/${ap.checks}; B6's page inputs on a Player ${pi.checks - pi.bad.length}/${pi.checks}; playui rows ${ct.checks - ct.bad.length}/${ct.checks}; driver (B3) ${dr.checks - dr.bad.length}/${dr.checks}`);
[...up.bad, ...up.skipped.map((x) => `SKIPPED ${x}`), ...sh.bad.slice(0, 10), ...yc.bad, ...ap.bad, ...pi.bad, ...ct.bad, ...dr.bad].forEach((x) => console.log('  ', x));
bad += up.bad.length + up.skipped.length + sh.bad.length + yc.bad.length + ap.bad.length + pi.bad.length + ct.bad.length + dr.bad.length;
const pj = bodyTests(), rbx = await resultBoxTests(), pg = await pageTests(), cdt = await cardTests(), wk = await workerTests();
console.log(`browser player hosts: request bodies ${pj.checks - pj.bad.length}/${pj.checks}; wait_result ${rbx.checks - rbx.bad.length}/${rbx.checks}; page after a stop ${pg.checks - pg.bad.length}/${pg.checks}; Card panel and session options ${cdt.checks - cdt.bad.length}/${cdt.checks}; Worker in a node worker thread ${wk.checks - wk.bad.length}/${wk.checks}${wk.skipped.length ? `, ${wk.skipped.length} SKIPPED (no firmware: set OM_FW_DIR or OM_BIN)` : ''}`);
[...pj.bad, ...rbx.bad, ...pg.bad, ...cdt.bad, ...wk.bad, ...wk.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
bad += pj.bad.length + rbx.bad.length + pg.bad.length + cdt.bad.length + wk.bad.length + wk.skipped.length;
// the published site's path logic and the player's download command (bin/site.mjs, src/fw/updater.mjs)
{
  const { siteTests } = await import('../test/test_site.mjs');
  const st = siteTests();
  console.log(`site and download command: ${st.checks - st.bad.length}/${st.checks}`);
  st.bad.forEach((x) => console.log('  ', x));
  bad += st.bad.length;
}
// The node host over real HTTP (G-host)
{
  const { hostTests } = await import('../test/test_host.mjs');
  const hs = await hostTests();
  console.log(`Stage 3c host (G-host: the queue under load, the status during a WAIT, one clock, the stops and signals, SIGUSR2, the order wait, the page copy, the HTTP front, a busy port): ${hs.checks - hs.bad.filter((x) => x.startsWith('[')).length}/${hs.checks}`);
  hs.bad.forEach((x) => console.log('  ', x));
  bad += hs.bad.length;
}
// the debug API's live route to a play session (F31): its units, a headless Player, bin/play.mjs over HTTP
{
  const { liveUnits, liveSession, liveHost } = await import('../test/test_live.mjs');
  const lu = await liveUnits(), ls = await liveSession(), lh = await liveHost();
  console.log(`debug API live route (F31): argument checks, halt, trace filters and route units ${lu.checks - lu.bad.length}/${lu.checks}; a headless play session ${ls.checks - ls.bad.length}/${ls.checks}; the play server and --attach ${lh.checks - lh.bad.length}/${lh.checks}`);
  [...lu.bad, ...ls.bad, ...lh.bad].forEach((x) => console.log('  ', x));
  bad += lu.bad.length + ls.bad.length + lh.bad.length;
}
// the debug API's call op: its argument checks, and firmware functions called natively in two E143 play sessions;
// its mid-function forms through bin/session.mjs on E143, and on E147 in a process of its own
{
  const { callUnits, callSession, callScripted } = await import('../test/test_call.mjs');
  const { spawnSync } = await import('node:child_process');
  const cu = callUnits(), cs = await callSession(), cx = await callScripted();
  const r = spawnSync(process.execPath, [new URL('../test/test_call.mjs', import.meta.url).pathname, '--scripted'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const e147 = r.status === 0 ? [] : (r.stdout + r.stderr).trim().split('\n').map((l) => `E147: ${l.trim()}`);
  console.log(`debug API call op: argument checks and the exec trace's registers ${cu.checks - cu.bad.length}/${cu.checks}; calls in a play session against one without ${cs.checks - cs.bad.length}/${cs.checks}; mid-function calls through bin/session.mjs ${cx.checks - cx.bad.length}/${cx.checks}, E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...cu.bad, ...cs.bad, ...cx.bad, ...e147].forEach((x) => console.log('  ', x));
  bad += cu.bad.length + cs.bad.length + cx.bad.length + (r.status === 0 ? 0 : 1);
}
// the image sensor stand-in (S-SCENE): its model, and its live view in a play session with a --replay of it
{
  const { sceneUnits, sceneSession } = await import('../test/test_scene.mjs');
  const su = sceneUnits(), ss = await sceneSession();
  console.log(`scene stand-in: model ${su.checks - su.bad.length}/${su.checks}; live view in play ${ss.checks - ss.bad.length}/${ss.checks}`);
  [...su.bad, ...ss.bad].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length;
}
// the lab's audio output and S-SHUTTERSND: the channel and the clicks, then one open and one close click per S2 in
// play; the AF beep end to end: each half press in focus one beep on the host's audio output, S-SOUNDRES's samples
// (H-UIOUTSTART, S-AFLOCK, the audio hardware), none with the beep Off or without S-AFLOCK
{
  const { audioUnits, audioSession, afBeepSession } = await import('../test/test_audio.mjs');
  const au = await audioUnits(), as = await audioSession(), ab = await afBeepSession();
  console.log(`audio output and the shutter sound: units ${au.checks - au.bad.length}/${au.checks}; S-SHUTTERSND in play ${as.checks - as.bad.length}/${as.checks}; the AF beep end to end ${ab.checks - ab.bad.length}/${ab.checks}`);
  [...au.bad, ...as.bad, ...ab.bad].forEach((x) => console.log('  ', x));
  bad += au.bad.length + as.bad.length + ab.bad.length;
}
// the audio hardware (--audio on): the port, the sound IC and the sink, then AUD_EXEC's play path natively on E143
{
  const { audioHwUnits, audioHwSession } = await import('../test/test_audiohw.mjs');
  const hu = audioHwUnits(), hs = await audioHwSession();
  console.log(`audio hardware: units ${hu.checks - hu.bad.length}/${hu.checks}; the play path in play ${hs.checks - hs.bad.length}/${hs.checks}`);
  [...hu.bad, ...hs.bad].forEach((x) => console.log('  ', x));
  bad += hu.bad.length + hs.bad.length;
}
// the camera application running natively (S-CAMAPP and its stand-ins): S1, S2 and the rec view in a play session
{
  const { camappSession, heapSession, heapWorkloadSession, modeDialSession, traRoutingSession, camapp3FramesSession } = await import('../test/test_camapp.mjs');
  const ca = await camappSession(), hp = await heapSession(), hw = await heapWorkloadSession(), md = await modeDialSession();
  const tr = await traRoutingSession(), fr = await camapp3FramesSession();
  console.log(`camera application (S-CAMAPP) in play: ${ca.checks - ca.bad.length}/${ca.checks}; S-HEAP over an idle: ${hp.checks - hp.bad.length}/${hp.checks}; S-HEAP over a workload: ${hw.checks - hw.bad.length}/${hw.checks}; the mode dial's positions: ${md.checks - md.bad.length}/${md.checks}; camapp 3's native transactions: ${tr.checks - tr.bad.length}/${tr.checks}; camapp 3's frames: ${fr.checks - fr.bad.length}/${fr.checks}`);
  [...ca.bad, ...hp.bad, ...hw.bad, ...md.bad, ...tr.bad, ...fr.bad].forEach((x) => console.log('  ', x));
  bad += ca.bad.length + hp.bad.length + hw.bad.length + md.bad.length + tr.bad.length + fr.bad.length;
}
// CapMov_MovieRecorderSLR's add-observer methods and api_movie's start / stop watched over a camapp 2 recording
// (test_movobs.mjs, docs/hle-gaps/4.5.md 4.5; E143)
{
  const { movieObserverSession } = await import('../test/test_movobs.mjs');
  const mo = await movieObserverSession();
  console.log(`movie observers under camapp 2: ${mo.checks - mo.bad.length}/${mo.checks}`);
  mo.bad.forEach((x) => console.log('  ', x));
  bad += mo.bad.length;
}
// the Fn lever and the AF mode in the default session (test_fnlever.mjs, docs/hle-gaps/4.3.md 4.3.8; E143): the idle lever
// at API_LEVER_SW_1, S-SEQSTANDBY at the standby gate, S1 with and without the half-press AF; the sequence parts' own
// StartFocus by the focus mode under control camapp 3
{
  const { fnLeverSession, fnLeverSequenceSession } = await import('../test/test_fnlever.mjs');
  const fl = await fnLeverSession(), fq = await fnLeverSequenceSession();
  console.log(`the Fn lever and the AF mode: ${fl.checks - fl.bad.length}/${fl.checks}; the sequence's StartFocus by the focus mode: ${fq.checks - fq.bad.length}/${fq.checks}`);
  [...fl.bad, ...fq.bad].forEach((x) => console.log('  ', x));
  bad += fl.bad.length + fq.bad.length;
}
// S-MODPOST (test_modpost.mjs): the direct posts to S-MODACK's queues the module's task would take, taken under
// camapp 3, no module queue holding a message over a long workload, a post it does not take named by the guard
{
  const { modpostUnits, modpostSession } = await import('../test/test_modpost.mjs');
  const mu = await modpostUnits(), ms = await modpostSession();
  console.log(`S-MODPOST: units ${mu.checks - mu.bad.length}/${mu.checks}; in play ${ms.checks - ms.bad.length}/${ms.checks}`);
  [...mu.bad, ...ms.bad].forEach((x) => console.log('  ', x));
  bad += mu.bad.length + ms.bad.length;
}
// control camapp 3 with the play module native (src/lab/playmod.mjs, docs/hle-gaps/4.8.md 4.8.11): the PLAY tasks load the
// card's picture, its header and still information natively; the view's decode runs on the pipeline block's model
// (S-IMGPIPE, docs/hle-gaps/4.8.md 4.8.13: playDecodeSession), the detail view's is S-PLAYDEC's
{
  const { playNativeSession, playDecodeSession } = await import('../test/test_camapp.mjs');
  const pn = await playNativeSession(), pd = await playDecodeSession();
  console.log(`camapp 3 with the play module native: ${pn.checks - pn.bad.length}/${pn.checks}; its view decode: ${pd.checks - pd.bad.length}/${pd.checks}`);
  [...pn.bad, ...pd.bad].forEach((x) => console.log('  ', x));
  bad += pn.bad.length + pd.bad.length;
}
// the play module native per body (test_playmod.mjs, docs/hle-gaps/4.8.md 4.8.18, 4.8.22): the view decoded after one
// shot on E143, and on E146 and E147, each in a process of its own, with the play buffer in the 512 MiB of bus DRAM
{
  const { playBodySession } = await import('../test/test_playmod.mjs');
  const { spawnSync } = await import('node:child_process');
  const pb = await playBodySession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_playmod.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   '))];
  });
  console.log(`the play module native per body: E143 ${pb.checks - pb.bad.length}/${pb.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...pb.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += pb.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// control camapp 3 against the golden sessions (test_c3power.mjs, docs/hle-gaps/4.3.md 4.3.6, 4.3.10): where the power-off
// stops and why, the lever's off in the components, the display switch as the firmware's own output change, the
// sequence parts' module-9 read
{
  const { powerOffSession, leverSession, evfSwitchSession, standbySession } = await import('../test/test_c3power.mjs');
  const po = await powerOffSession(), lv = await leverSession(), ev = await evfSwitchSession(), sb = await standbySession();
  console.log(`camapp 3's power-off (TRA 586, the flash's stop): ${po.checks - po.bad.length}/${po.checks}; the lever's off in the components: ${lv.checks - lv.bad.length}/${lv.checks}; camapp 3's display switch (the firmware's own): ${ev.checks - ev.bad.length}/${ev.checks}; the standby entry's module-9 read: ${sb.checks - sb.bad.length}/${sb.checks}`);
  [...po.bad, ...lv.bad, ...ev.bad, ...sb.bad].forEach((x) => console.log('  ', x));
  bad += po.bad.length + lv.bad.length + ev.bad.length + sb.bad.length;
}
// the VSC's histogram unit in play (test_hist.mjs, docs/hle-gaps/4.2.md 4.2.7): the live histogram with S-SCENE's live
// view and playback's four histograms from the unit's bins, without and with --cpu2 native; the EVF switch under a run
{
  const { histLiveSession, histInfoSession, histEvfSession } = await import('../test/test_hist.mjs');
  const hl = await histLiveSession(), hi = await histInfoSession(), he = await histEvfSession();
  console.log(`the VSC's histogram unit in play: the live histogram ${hl.checks - hl.bad.length}/${hl.checks}; playback's ${hi.checks - hi.bad.length}/${hi.checks}; the EVF switch under a run ${he.checks - he.bad.length}/${he.checks}`);
  [...hl.bad, ...hi.bad, ...he.bad].forEach((x) => console.log('  ', x));
  bad += hl.bad.length + hi.bad.length + he.bad.length;
}
// the imgpro unit's model (S-IMGPRO) on a bare machine; the firmware's driver on it runs in camapp 3 above
{
  const { imgproUnits } = await import('../test/test_imgpro.mjs');
  const iu = imgproUnits();
  console.log(`the imgpro unit (S-IMGPRO), its units: ${iu.checks - iu.bad.length}/${iu.checks}`);
  iu.bad.forEach((x) => console.log('  ', x));
  bad += iu.bad.length;
}
// the pipeline block's and the JPEG codec's model (S-IMGPIPE) on a bare machine and the lab's baseline JPEG decoder
// against the independent one; the firmware's driver on the model runs in playDecodeSession above
{
  const { jpegUnits, imgpipeUnits } = await import('../test/test_imgpipe.mjs');
  const ju = jpegUnits(), pu = imgpipeUnits();
  console.log(`the baseline JPEG decoder: ${ju.checks - ju.bad.length}/${ju.checks}; the pipeline block (S-IMGPIPE), its units: ${pu.checks - pu.bad.length}/${pu.checks}`);
  [...ju.bad, ...pu.bad].forEach((x) => console.log('  ', x));
  bad += ju.bad.length + pu.bad.length;
}
// the TAKE probe (--take probe): TAKE_FUNC and TAKE_FUNC_CP natively, the record of a start, a live view, S1, S2, the
// menu and a mode change under camapp 1 and 2; off by default
{
  const { takeSession } = await import('../test/test_take.mjs');
  const tk = await takeSession();
  console.log(`the TAKE probe (S-TAKEREQ, S-TAKECAM, S-TAKEUSF) in play: ${tk.checks - tk.bad.length}/${tk.checks}`);
  tk.bad.forEach((x) => console.log('  ', x));
  bad += tk.bad.length;
}
// the release route to TAKE_EXEC (test_take_release.mjs, --take probe round 2: H-TAKEMAIN, S-THRTAKEOVER): under
// camapp 3 without the probe the sequence parts refuse S1 at their guard, under camapp 1 with it S1 reaches nothing
// (camapp 3 with the probe: focusSession, below)
{
  const { releaseSession } = await import('../test/test_take_release.mjs');
  const rs = await releaseSession();
  console.log(`the release route to TAKE_EXEC (H-TAKEMAIN, S-THRTAKEOVER) in play: ${rs.checks - rs.bad.length}/${rs.checks}`);
  rs.bad.forEach((x) => console.log('  ', x));
  bad += rs.bad.length;
}
// the release route, round 2 (test_take_release.mjs focusSession, --take probe round 3: H-TAKEFOCUS): under camapp 3
// TAKE_FOCUS runs natively, S1's take request goes through RdyFcsRdy1..3; with --cpu2 native (round 4: H-CAMINIT,
// H-EXPINIT) TAKE_EXPOSE's request reaches EXP_MOVIE, which waits for the frame events; S2's DISPLAY commands go in the
// DISPLAY task's order (S-DISPQ's queue) and its idle goes on past the power manager's sub-CPU command 0x14, which
// S-SCPUDEV takes (docs/hle-gaps/4.7.md 4.7.6)
{
  const { focusSession } = await import('../test/test_take_release.mjs');
  const fs = await focusSession();
  console.log(`the release route, rounds 2 and 4: TAKE_FOCUS and EXP (H-TAKEFOCUS, H-EXPINIT) in play: ${fs.checks - fs.bad.length}/${fs.checks}`);
  fs.bad.forEach((x) => console.log('  ', x));
  bad += fs.bad.length;
}
// S-DISPQ's queue (test_dispq.mjs, docs/hle-gaps/4.1.md 4.1.9): the discipline's order without firmware, and under
// control camapp 3 PLAY at the start's end: task 168's synchronous cmd 4, sent while cmd 15 waits, kept and run after
// it, its reply to its own queue; PLAY shows No Picture; control: the dispq-at-once mutant stops at depth 1
{
  const { dispqUnits, dispqSession } = await import('../test/test_dispq.mjs');
  const du = await dispqUnits(), ds = await dispqSession();
  console.log(`S-DISPQ's queue: the discipline ${du.checks - du.bad.length}/${du.checks}; in play (camapp 3, PLAY at the start's end) ${ds.checks - ds.bad.length}/${ds.checks}`);
  [...du.bad, ...ds.bad].forEach((x) => console.log('  ', x));
  bad += du.bad.length + ds.bad.length;
}
// TAKE's take-ready on the second shot (test_take_ready.mjs, camapp 3 with --take probe and --cpu2 native): the first
// S1's 794 comes from TAKE_MAIN's event 0x04080032 through Com_EvSenderManager; S1's release stops the take-ready with
// TAKE_EXEC command 7, which TAKE_MAIN does not read in RdyFcsRdy3, so the sequence waits in phase 111 and the second
// S1 makes no take request; the power manager's 0x14, which the first S1 brings at the manager's next cyclic tick, is
// taken by S-SCPUDEV as by the sub-CPU's own firmware, with the same bytes kept (docs/hle-gaps/4.7.md 4.7.6)
{
  const { secondShotSession } = await import('../test/test_take_ready.mjs');
  const ss = await secondShotSession();
  console.log(`TAKE's take-ready on the second shot (phase 111) in play: ${ss.checks - ss.bad.length}/${ss.checks}`);
  ss.bad.forEach((x) => console.log('  ', x));
  bad += ss.bad.length;
}
// S-TAKERDY (test_take_ready.mjs, camapp 3 without the probe): TAKE's event after S-MODACK's answer to the take-ready
// request brings 794; three half-press shots end in STANDBY (the stop's reply, 793, phase 111's exit) with the menu
// and playback taken between them; a full shot's take-picture request is not answered and the sequence waits in
// phase 106; the controls (S-TAKERDY off; the take-picture request answered at once: the rec view's divide)
{
  const { takeReadyUnits, takeReadySession } = await import('../test/test_take_ready.mjs');
  const tu = await takeReadyUnits(), ts = await takeReadySession();
  console.log(`S-TAKERDY: its rule ${tu.checks - tu.bad.length}/${tu.checks}; three shots and a full shot in play (camapp 3) ${ts.checks - ts.bad.length}/${ts.checks}`);
  [...tu.bad, ...ts.bad].forEach((x) => console.log('  ', x));
  bad += tu.bad.length + ts.bad.length;
}
// a still under control camapp 3 per body (test_c3take.mjs): S1 to READY (and 103 with S-TAKERDY), S1 released alone
// back to STANDBY with MENU taken, a full shot left in its phase with MENU untaken; E143 here, E146 and E147 each in a
// process of its own (E147's still / movie switch at its stills position, src/fw/models.mjs switch_idle)
{
  const { stillSession } = await import('../test/test_c3take.mjs');
  const { spawnSync } = await import('node:child_process');
  const cs = await stillSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_c3take.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`a still under control camapp 3: E143 ${cs.checks - cs.bad.length}/${cs.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...cs.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += cs.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the release route with cam.c's second init (test_take_release.mjs camFeSession, the probe's cam_fe opt-in:
// H-CAMINIT2, S-CAMFE): S1 as focusSession's, cam.c takes EXP_MOVIE's requests without an error, nothing runs the movie
// sequence's frame step, EXP_MOVIE still waits; S2 as focusSession's, the sub-CPU's command 0x14 taken and no stop;
// TAKE's request 6 (the sensor's power-on) stays with S-TAKECAM
{
  const { camFeSession } = await import('../test/test_take_release.mjs');
  const cs = await camFeSession();
  console.log(`the release route with cam.c's second init (H-CAMINIT2, S-CAMFE) in play: ${cs.checks - cs.bad.length}/${cs.checks}`);
  cs.bad.forEach((x) => console.log('  ', x));
  bad += cs.bad.length;
}
// CPU 2 natively (--cpu2 native): its boot to the idle loop, its first device accesses, CPU 0's CPUCONN and the tasks
// CPU 0's boot stages start on it, and the Super Control Panel's posts answered by its AUD_LEVEL_MONITOR as S-CPU2
// answered them; under control camapp 3 the GUI's histogram drawn by its OSD_DRAW_CPU2; off by default
{
  const { cpu2Session, cpu2Histogram } = await import('../test/test_cpu2.mjs');
  const c2 = await cpu2Session();
  console.log(`CPU 2 natively (--cpu2 native) in play: ${c2.checks - c2.bad.length}/${c2.checks}`);
  c2.bad.forEach((x) => console.log('  ', x));
  bad += c2.bad.length;
  const ch = await cpu2Histogram();
  console.log(`CPU 2's queues (--cpu2 native), the histogram on OSD_DRAW_CPU2: ${ch.checks - ch.bad.length}/${ch.checks}`);
  ch.bad.forEach((x) => console.log('  ', x));
  bad += ch.bad.length;
}
// the firmware's start tasks (bin/ustart.mjs, docs/hle-gaps/4.6.md 4.6.3): the start conditions' call sites in the image,
// and the start probe's record of each start task run natively in a bare lab of its own (no session runs it)
{
  const { ustartMap, ustartProbe } = await import('../test/test_ustart.mjs');
  const um = await ustartMap(), up = await ustartProbe();
  console.log(`the start tasks: the conditions' call sites ${um.checks - um.bad.length}/${um.checks}; the start probe ${up.checks - up.bad.length}/${up.checks}`);
  [...um.bad, ...up.bad].forEach((x) => console.log('  ', x));
  bad += um.bad.length + up.bad.length;
}
// the SCPU interface's clock and ports, the link's pins and the sub-CPU's model (S-SCPUDEV) without firmware, then the
// link at a play session's start: E143 here, E146, E147, E139 and E134
// each in a process of its own (the model is fixed when the lab is imported)
{
  const { scpuUnits, scpuSession } = await import('../test/test_scpu.mjs');
  const { spawnSync } = await import('node:child_process');
  const sc = scpuUnits(), ss = await scpuSession();
  const others = ['E146', 'E147', 'E139', 'E134'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_scpu.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`SCPU clock, ports, link pins and the sub-CPU (S-SCPUDEV): ${sc.checks - sc.bad.length}/${sc.checks}; the link in play (E143) ${ss.checks - ss.bad.length}/${ss.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...sc.bad, ...ss.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += sc.bad.length + ss.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// patch overlays (src/fw/patch.mjs, src/lab/patchaudit.mjs): the rules on synthetic blocks, then --patch and --main on
// E143 through bin/debug.mjs, bin/play.mjs and bin/nav.mjs with a tiny patch file the test writes, and an om3-patch-2
// file the test writes and its block as --main on E147, in a process of its own (the model is fixed when the lab is
// imported)
{
  const { patchUnits, patchSession } = await import('../test/test_patch.mjs');
  const { spawnSync } = await import('node:child_process');
  const pu = patchUnits(), ps = await patchSession();
  const others = ['E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_patch.mjs', import.meta.url).pathname, '--session-model'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`patch overlays: units ${pu.checks - pu.bad.length}/${pu.checks}; on E143 ${ps.checks - ps.bad.length}/${ps.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...pu.bad, ...ps.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += pu.bad.length + ps.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// caduceus-ep7's edits.json (src/fw/patch.mjs): the reader's rules on synthetic blocks, then each pinned release found
// under ~/.om-emu/thirdparty/caduceus-ep7 (OM_THIRDPARTY) on E142 in a process of its own: pins, the patched blocks,
// the flipped-expect controls and a --patch session to the menu (SKIPPED without the release's files)
{
  const { ep7Units } = await import('../test/test_ep7edits.mjs');
  const { spawnSync } = await import('node:child_process');
  const u = ep7Units();
  const r = spawnSync(process.execPath, [new URL('../test/test_ep7edits.mjs', import.meta.url).pathname, '--release'], { env: { ...process.env, OM_EMU_MODEL: 'E142' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n');
  console.log(`caduceus-ep7 edits.json: units ${u.checks - u.bad.length}/${u.checks}; ${lines.filter((l) => !l.startsWith('   ')).join('; ')}`);
  [...u.bad, ...(r.status === 0 ? [] : lines.filter((l) => l.startsWith('   ')).map((l) => `E142: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += u.bad.length + (r.status === 0 ? 0 : 1);
}
// the boot's section loader (src/fw/sections.mjs, S-SECLOADED, S-STALERAM): the units, then E143 here and E147 in a
// process of its own (the model is fixed when the lab is imported)
{
  const { sectionsUnits, sectionsSession } = await import('../test/test_sections.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = await sectionsUnits(), ss = await sectionsSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_sections.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`section loader: units ${su.checks - su.bad.length}/${su.checks}; on E143 ${ss.checks - ss.bad.length}/${ss.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...su.bad, ...ss.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + (r.status === 0 ? 0 : 1);
}
// the strict mode (src/lab/strict.mjs, src/core/mem.mjs setStrict, src/fw/strict-allow.mjs): the units, then the stock
// sessions and the patched routines, each model in a bin/session.mjs child of the test's own
{
  const { strictUnits, strictSession } = await import('../test/test_strict.mjs');
  const u = await strictUnits(), s = await strictSession();
  console.log(`strict mode: units ${u.checks - u.bad.length}/${u.checks}; sessions ${s.checks - s.bad.length}/${s.checks}`);
  [...u.bad, ...s.bad].forEach((x) => console.log('  ', x));
  bad += u.bad.length + s.bad.length;
}
// the strict mode's cave-store class (src/lab/strict.mjs ownRanges): stores into a range the patch made the boot load
// aggregated per range, a stock range's per site, the cap per class (firmware-free)
{
  const { strictCaveUnits } = await import('../test/test_strict_cave.mjs');
  const u = await strictCaveUnits();
  console.log(`strict cave-store: units ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  bad += u.bad.length;
}
// the boot's stage bits (S-BOOTSTAGE, src/lab/menu.mjs stage_bits): the boot job they follow read from the block and
// the stage word after a play session's open, E143 here, E146 and E147 each in a process of its own
{
  const { bootstageImage, bootstageSession } = await import('../test/test_bootstage.mjs');
  const { spawnSync } = await import('node:child_process');
  const bi = await bootstageImage(), bs = await bootstageSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_bootstage.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`the boot's stage bits: E143's block ${bi.checks - bi.bad.length}/${bi.checks}, its session ${bs.checks - bs.bad.length}/${bs.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...bi.bad, ...bs.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += bi.bad.length + bs.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// staged section availability for patched code (--sec-ready, src/lab/secready.mjs): the static section-order pass and
// the run-time watch on synthetic inputs, then on each of E143, E146 and E147's blocks (E146 and E147 each in a process
// of its own), and nav.mjs --sec-ready on E143
{
  const { secreadyUnits, secreadyFirmware, secreadyCli } = await import('../test/test_secready.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = secreadyUnits(), sf = await secreadyFirmware(), sc = await secreadyCli();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_secready.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`sec-ready: units ${su.checks - su.bad.length}/${su.checks}; E143's block ${sf.checks - sf.bad.length}/${sf.checks}, nav.mjs ${sc.checks - sc.bad.length}/${sc.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...su.bad, ...sf.bad, ...sc.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + sf.bad.length + sc.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the hidden service screens (H-STARTKEY, docs/hle-gaps/4.6.md 4.6.5): USTART5's MENU state step read by its instructions,
// then E143 sessions with and without MENU held at power-on (Monitor Adjust's OK to ID_ST_HIDE_MODE or back to the menu)
{
  const { hideModeSite, hideModeSession } = await import('../test/test_hidemode.mjs');
  const hi = await hideModeSite(), hs = await hideModeSession();
  console.log(`the hidden screens: the MENU state step ${hi.checks - hi.bad.length}/${hi.checks}, the sessions ${hs.checks - hs.bad.length}/${hs.checks}`);
  [...hi.bad, ...hs.bad].forEach((x) => console.log('  ', x));
  bad += hi.bad.length + hs.bad.length;
}
// the MS count (H-MECCOUNT, docs/hle-gaps/4.6.md 4.6.6): the mechanism driver's counter sites on E143, E146 and E147 (each
// in a process of its own), PAGE 2's MS row after three shots on E143, and the count over a power cycle under S-NVRAM
{
  const { mecCountSites, mecCountSession } = await import('../test/test_hidemode.mjs');
  const { spawnSync } = await import('node:child_process');
  const ms = await mecCountSites(), mc = await mecCountSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_hidemode.mjs', import.meta.url).pathname, '--mec'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).split('\n').filter((l) => /^\s/.test(l))];
  });
  console.log(`the MS count: E143's sites ${ms.checks - ms.bad.length}/${ms.checks}, its sessions ${mc.checks - mc.bad.length}/${mc.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...ms.bad, ...mc.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += ms.bad.length + mc.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the OSD engine's picture runs across a row end (A-BMPWRAP): the units, then Caduceus for OM-3's v0.29 guides on E147
// in a process of its own when OM_CADUCEUS names their checkout (skipped otherwise; their bytes are read there)
{
  const { osdWrapUnits } = await import('../test/test_osdwrap.mjs');
  const { spawnSync } = await import('node:child_process');
  const ou = osdWrapUnits();
  const r = spawnSync(process.execPath, [new URL('../test/test_osdwrap.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const out = (r.stdout + r.stderr).trim().split('\n'), skipped = r.status === 0 && out.some((l) => l.includes(': skipped ('));
  console.log(`OSD runs across a row end (A-BMPWRAP): units ${ou.checks - ou.bad.length}/${ou.checks}; their guides on E147 ${skipped ? 'SKIPPED (set OM_CADUCEUS to a caduceus-om3 checkout)' : r.status === 0 ? 'ok' : 'FAILED'}`);
  [...ou.bad, ...(r.status === 0 ? [] : out.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += ou.bad.length + (r.status === 0 ? 0 : 1);
}
// the publication audit (bin/pubaudit.mjs) on a throwaway repository with made-up firmware
{
  const { pubauditTests } = await import('../test/test_pubaudit.mjs');
  const pa = await pubauditTests();
  console.log(`publication audit: ${pa.checks - pa.bad.length}/${pa.checks}`);
  pa.bad.forEach((x) => console.log('  ', x));
  bad += pa.bad.length;
}
// the HDMI port: its device and sink without firmware, then a plug in play: E143 here, E146 and E147 each in a process
// of its own (the model is fixed when the lab is imported)
{
  const { hdmiUnits, hdmiSession } = await import('../test/test_hdmi.mjs');
  const { spawnSync } = await import('node:child_process');
  const hu = hdmiUnits(), hs = await hdmiSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_hdmi.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`HDMI port: units ${hu.checks - hu.bad.length}/${hu.checks}; plug in play (E143) ${hs.checks - hs.bad.length}/${hs.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...hu.bad, ...hs.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += hu.bad.length + hs.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the HDMI plug under control camapp 3 on E143: the GUI's planes on channel 0, the unplug back to the TFT
{
  const { hdmiCamapp3Session } = await import('../test/test_hdmi.mjs');
  const r = await hdmiCamapp3Session();
  console.log(`HDMI under control camapp 3 (E143): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  bad += r.bad.length;
}
// the USB cable at the event level (S-USBCABLE): plug and unplug through the sub-CPU's PC13 on E143
{
  const { usbSession } = await import('../test/test_usbcable.mjs');
  const r = await usbSession();
  console.log(`USB cable (E143): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  bad += r.bad.length;
}
// a session with no USB cable (USB_IDLE 'out'): the lever's off follows the application's own shutdown on E143
{
  const { usbIdleSessions } = await import('../test/test_usbcable.mjs');
  const r = await usbIdleSessions();
  console.log(`USB idle out (E143): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  bad += r.bad.length;
}
// the USB plug under control camapp 3 from a start with the cable out: without S-USBHOST CA_MAIN's handler ends, with
// it command 38 PC_START_PC_USB_SELECT, "One Moment" and the PC application's startPc on E143
{
  const { usbSelectSession } = await import('../test/test_usbselect.mjs');
  for (const host of [false, true]) {
    const r = await usbSelectSession(host);
    console.log(`USB select ${host ? 'with S-USBHOST' : 'control'} (E143): ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    bad += r.bad.length;
  }
}
// the accelerometer: its sample without firmware, then checks/check_level.mjs on E146 and E147 and its PER_ROTATE
// groups R1 and R2 (PER_ROTATE by default, with their mutant on E143) on E143, E146 and E147, each in a process of
// its own
// (E143's default runs are checks/runs.json's; the model is fixed when the lab is imported)
{
  const { accUnits } = await import('../test/test_acc.mjs');
  const { spawnSync } = await import('node:child_process');
  const au = accUnits();
  const runs = [['E146', []], ['E143', ['--only', 'R1,R2']], ['E143', ['--only', 'R1,R2', '--mutants']], ['E146', ['--only', 'R1,R2']],
    ['E147', []], ['E147', ['--only', 'R1,R2']]].map(([m, args]) => {
    const r = spawnSync(process.execPath, [new URL('../checks/check_level.mjs', import.meta.url).pathname, ...args], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [`${m}${args.length ? ' ' + args.join(' ') : ''}`, r];
  });
  console.log(`accelerometer: sample units ${au.checks - au.bad.length}/${au.checks}; check_level ${runs.map(([n, r]) => `${n} ${r.status === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...au.bad, ...runs.flatMap(([n, r]) => (r.status === 0 ? [] : (r.stdout + r.stderr).trim().split('\n').map((l) => `${n}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += au.bad.length + runs.filter(([, r]) => r.status !== 0).length;
}
// the picture's orientation tag (test_orient.mjs): the tilt token, the sites on E143, E146 and E147 by their bytes,
// then S2 in portrait with the default --rotate (PER_ROTATE) and the control with --rotate off on E143 here, E146 and
// E147 each in a process of its own
{
  const { orientUnits, orientSites, orientSession } = await import('../test/test_orient.mjs');
  const { spawnSync } = await import('node:child_process');
  const ou = await orientUnits(), oi = await orientSites(), os = await orientSession();
  const runs = ['E146', 'E147'].map((m) => [m, spawnSync(process.execPath, [new URL('../test/test_orient.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' })]);
  const lines = (r) => (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`the orientation tag: units ${ou.checks - ou.bad.length}/${ou.checks}; sites ${oi.checks - oi.bad.length}/${oi.checks}; E143 ${os.checks - os.bad.length}/${os.checks}; ${runs.map(([m, r]) => `${m} ${r.status === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...ou.bad, ...oi.bad, ...os.bad, ...runs.flatMap(([m, r]) => (r.status === 0 ? [] : lines(r).map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += ou.bad.length + oi.bad.length + os.bad.length + runs.filter(([, r]) => r.status !== 0).length;
}
// the card and the file system (storage.mjs): the card model and the FAT and exFAT readers without firmware, then play
// sessions whose card the firmware formats and mounts itself: E143 here (an 8 GiB SDHC card, then blank 64 and 128 GiB
// SDXC cards, whose findings print as notes), and E146, E147, E144, E142 and E134 (the OM-1 family, the E144 family,
// the E142 lineage and the E-M1X, whose card needs UI_OUT) each in a process of its own (the model is fixed when the
// lab is imported); each with the HLS media side where the body runs it (Card Formatting from the menu, the card out
// and in: E146, E147 and E148 as E143; E144, E142, E134, E137, E125, E133 and E129 by the rule), and that side alone
// on E122, E118 and E120 (the E118 family's, read by a rule), on E139, E140, E145 and E132 (the E144 family's bodies
// whose session is not run here) and on E130; E148, E137 and E125 for the E144 family's REC_FILE
// natively in the forms the others do not take (Exif 0300, the E137 date set, two file contexts with Exif 0230;
// src/fw/facts.mjs recFileQueue); E122, E118 and E120 also for their S2 files, which their own REC_FILE records
// natively in the family's older REC version (src/fw/facts.mjs recFileFrame)
{
  const { storageUnits, storageSession, storageSdxc } = await import('../test/test_storage.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = storageUnits(), ss = await storageSession(), sx = await storageSdxc();
  // E130, E133 and E129 for REC_FILE natively in the REC version before the E144 family's, each in a form the other
  // two do not take (E133's rec_jpeg_exec, E129's date set; src/fw/facts.mjs recFileInline), E132 for its record step
  // through rec_file_destination_record and E145 for the family's version with an inlined loop (recFileQueue)
  // the HLS media side alone (--hls: Format from Card Setup, the card out and in, a picture after each)
  const others = [...['E146', 'E147', 'E144', 'E142', 'E134', 'E148', 'E137', 'E125', 'E130', 'E133', 'E129', 'E132', 'E145', 'E122', 'E118', 'E120'].map((m) => [m, '--session']), ...['E122', 'E118', 'E120', 'E139', 'E140', 'E130'].map((m) => [m, '--hls'])].map(([m, arg]) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_storage.mjs', import.meta.url).pathname, arg], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [arg === '--session' ? m : `${m} ${arg}`, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`card and file system: card model, FAT and exFAT readers ${su.checks - su.bad.length}/${su.checks}; in play (E143) ${ss.checks - ss.bad.length}/${ss.checks}; SDXC (E143) ${sx.checks - sx.bad.length}/${sx.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  sx.notes.forEach((x) => console.log('   note:', x));
  [...su.bad, ...ss.bad, ...sx.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + sx.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the host's card writer (src/lab/cardfs.mjs): its units, then the firmware mounting a card it wrote (a picture put
// back under a later DCF number, a file of the host's own): E143 here, E147 in a process of its own
{
  const { cardfsUnits, cardCliTests, cardfsSession } = await import('../test/test_cardfs.mjs');
  const { spawnSync } = await import('node:child_process');
  const cu = cardfsUnits(), cc = cardCliTests(), cs = await cardfsSession();
  const others = ['E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_cardfs.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`card writer: units ${cu.checks - cu.bad.length}/${cu.checks}; bin/card.mjs ${cc.checks - cc.bad.length}/${cc.checks}; in play (E143) ${cs.checks - cs.bad.length}/${cs.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...cu.bad, ...cc.bad, ...cs.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += cu.bad.length + cc.bad.length + cs.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the HLS media side with a 64 GiB SDXC card (test_sdxchls.mjs; docs/hle-gaps/4.8.md 4.8.19): E146, E147, E148 and E139
// in processes of their own (E143's is storageSdxc's above; E144 stops at its start's divide, 4.8.7)
{
  const { spawnSync } = await import('node:child_process');
  const runs = ['E146', 'E147', 'E148', 'E139'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_sdxchls.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') && !l.startsWith('   note:'))];
  });
  console.log(`the HLS side with an SDXC card: ${runs.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  runs.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`))).forEach((x) => console.log('  ', x));
  bad += runs.filter(([, rc]) => rc !== 0).length;
}
// a power-on with the first card slot empty and the media status around a removal (test_nocard.mjs): its units, E143
// here, E147 in a process of its own
{
  const { nocardUnits, nocardSession } = await import('../test/test_nocard.mjs');
  const { spawnSync } = await import('node:child_process');
  const nu = nocardUnits(), ns = await nocardSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_nocard.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`no card at the start, the media status: units ${nu.checks - nu.bad.length}/${nu.checks}; E143 ${ns.checks - ns.bad.length}/${ns.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...nu.bad, ...ns.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += nu.bad.length + ns.bad.length + (r.status === 0 ? 0 : 1);
}
// the second card slot (test_storage.mjs --slot2: E143's and E146's two card slots, one card and two, the save slot,
// the cards out and in, the save settings from the menu, Dual Same on both cards, Auto Switch off a full card, on
// E143 also under control camapp 3; docs/hle-gaps/4.8.md 4.8.12, 4.8.14), each body in a process of its own
{
  const { spawnSync } = await import('node:child_process');
  const runs = ['E143', 'E146'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_storage.mjs', import.meta.url).pathname, '--slot2'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`the second card slot: ${runs.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  runs.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`))).forEach((x) => console.log('  ', x));
  bad += runs.filter(([, rc]) => rc !== 0).length;
}
// the second card slot on the bodies whose slots the rule reads (test_slot2_rule.mjs: E139 and E125 one card and two,
// S2 on each card; E134's second card stops at the slave ASIC's CCI after S-SASIC; docs/hle-gaps/4.8.md 4.8.17,
// 4.8.29), each body in a process of its own
{
  const { spawnSync } = await import('node:child_process');
  const runs = ['E139', 'E134', 'E125'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_slot2_rule.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n')];
  });
  console.log(`the second card slot by the rule: ${runs.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  runs.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`))).forEach((x) => console.log('  ', x));
  bad += runs.filter(([, rc]) => rc !== 0).length;
}
// Playback with two pictures (RIGHT, LEFT, OK's wizard and PLAY from it, INFO's three views, the erase dialog's request
// performed or refused where Delete opens it) and INFO's still information, from the picture's own
// record: E143 here (S-PLAYCOMP's answer in the
// component's struct), and E146, E147, the E118 family (S-PLAYSEQ's answer to the play module's request 3) and the
// E144 family (S-PLAYCOMP's) each in a process of its own, PLAYINFO_JOBS at once
{
  const { playInfoSession } = await import('../test/test_playinfo.mjs');
  const { spawn } = await import('node:child_process');
  const PLAYINFO_BODIES = ['E146', 'E147', 'E122', 'E118', 'E120', 'E144', 'E139', 'E134', 'E137', 'E142', 'E140', 'E125', 'E130', 'E133', 'E145', 'E129', 'E132', 'E148'];
  const PLAYINFO_JOBS = 8;
  const pi = await playInfoSession();
  const one = (m) => new Promise((done) => {
    const c = spawn(process.execPath, [new URL('../test/test_playinfo.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (rc) => done([m, rc, out.trim().split('\n')]));
  });
  const others = [], queue = [...PLAYINFO_BODIES];
  await Promise.all(Array.from({ length: PLAYINFO_JOBS }, async () => { while (queue.length) { const m = queue.shift(); others.push(await one(m)); } }));
  others.sort((x, y) => PLAYINFO_BODIES.indexOf(x[0]) - PLAYINFO_BODIES.indexOf(y[0]));
  console.log(`INFO's still information: E143 ${pi.checks - pi.bad.length}/${pi.checks}; ${others.map(([m, rc, lines]) => `${m} ${rc === 0 ? lines[0].split(': ').pop() : 'FAILED'}`).join(', ')}`);
  [...pi.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += pi.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// The erase in playback (S-PLAYSEQ's eraseCurrent with the firmware's own calls, H-OBJDEL): three pictures, one
// locked by the DCF edit, each erased through the erase dialog where the body's Delete opens it, the card read back by
// the independent FAT reader, the protected one refused, No Picture after the last, and the refused erases and edit
// saves; on a body without the native erase its refusal with the files kept: E143 here, the others each in a
// process of its own, ERASE_JOBS at once
{
  const { eraseSession } = await import('../test/test_erase.mjs');
  const { spawn } = await import('node:child_process');
  const ERASE_BODIES = ['E146', 'E147', 'E144', 'E148', 'E139', 'E134', 'E137', 'E142', 'E140', 'E125', 'E130', 'E145', 'E133', 'E129', 'E132', 'E122', 'E118', 'E120'];
  const ERASE_JOBS = 8;
  const er = await eraseSession();
  const one = (m) => new Promise((done) => {
    const c = spawn(process.execPath, [new URL('../test/test_erase.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (rc) => done([m, rc, out.trim().split('\n')]));
  });
  const others = [], queue = [...ERASE_BODIES];
  await Promise.all(Array.from({ length: ERASE_JOBS }, async () => { while (queue.length) { const m = queue.shift(); others.push(await one(m)); } }));
  others.sort((x, y) => ERASE_BODIES.indexOf(x[0]) - ERASE_BODIES.indexOf(y[0]));
  console.log(`the erase in playback: E143 ${er.checks - er.bad.length}/${er.checks}; ${others.map(([m, rc, lines]) => `${m} ${rc === 0 ? lines[0].split(': ').pop() : 'FAILED'}`).join(', ')}`);
  [...er.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += er.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the playback menu's Erase All (S-MDACTRL's erase all with the picture file API's own call, the DCF edit's ALL_DELETE
// in FILECLBK): three pictures, one locked by the DCF edit, Erase All through the menu, the card read back by the
// independent FAT reader, the locked one kept; unlocked, all gone; Save's command refused: E143 here, E146, E147 and
// E148 each in a process of its own, and E144 and E122 (no S-MDACTRL: ERASE_ALL held the other way)
{
  const { eraseAllSession, ERASE_ALL_BODIES } = await import('../test/test_eraseall.mjs');
  const { spawn } = await import('node:child_process');
  const r = await eraseAllSession();
  const one = (m) => new Promise((done) => {
    const c = spawn(process.execPath, [new URL('../test/test_eraseall.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (rc) => done([m, rc, out.trim().split('\n')]));
  });
  const others = await Promise.all(ERASE_ALL_BODIES.map(one));
  console.log(`the menu's erase all: E143 ${r.checks - r.bad.length}/${r.checks}; ${others.map(([m, rc, lines]) => `${m} ${rc === 0 ? lines[0].split(': ').pop() : 'FAILED'}`).join(', ')}`);
  [...r.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += r.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the playback menu's Copy All (S-MDACTRL's copy all, the picture file API's call natively, FILECLBK's code 38): two
// pictures on card 1, Copy All, the copy screen's choice and Yes, card 2 read back with card 1's files: E143 here,
// E146 in a process of its own (docs/hle-gaps/4.8.md 4.8.27)
{
  const { copyAllSession } = await import('../test/test_copyall.mjs');
  const r = await copyAllSession();
  console.log(`the menu's copy all: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  bad += r.bad.length;
  const { spawnSync } = await import('node:child_process');
  const e146 = spawnSync(process.execPath, [new URL('../test/test_copyall.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: 'E146' }, encoding: 'utf8' });
  console.log(`the menu's copy all on E146: ${(e146.stdout.match(/copy all: (\S+)/) ?? [])[1] ?? 'no result'}`);
  if (e146.status !== 0) { console.log(e146.stdout.split('\n').slice(1).join('\n') + (e146.stderr ?? '')); bad += 1; }
}
// touch in play: a tap on the shooting screen's touch mode icon reaching HFW and the frame, E143 here, E146, E147 and
// the E144 and E118 families' bodies with a touch panel each in a process of its own, four at a time (on the
// families' bodies with an EVF, also the taps with the EVF active)
{
  const { touchSession, TOUCH_BODIES } = await import('../test/test_touch.mjs');
  const { spawn } = await import('node:child_process');
  const tt = await touchSession();
  const run = (m) => new Promise((done) => {
    const c = spawn(process.execPath, [new URL('../test/test_touch.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (rc) => done([m, rc, out.trim().split('\n')]));
  });
  const others = [];
  for (let i = 0; i < TOUCH_BODIES.length; i += 4) others.push(...await Promise.all(TOUCH_BODIES.slice(i, i + 4).map(run)));
  console.log(`touch in play: E143 ${tt.checks - tt.bad.length}/${tt.checks}; ${others.map(([m, rc, lines]) => `${m} ${rc === 0 ? lines[0].split(': ').pop() : 'FAILED'}`).join(', ')}`);
  [...tt.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += tt.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// bin/nav.mjs's session: its bring-up's checks by the body's rules, OPEN at the build's index of E143's message to the
// state named SS_MENU/ID_ST_MENU, DOWN, MENU, MENU; E143 here, the bodies of NAV_BODIES each in a process of its own,
// four at a time (test_nav.mjs)
{
  const { navSession, NAV_BODIES } = await import('../test/test_nav.mjs');
  const { spawn } = await import('node:child_process');
  const nv = await navSession();
  const run = (m) => new Promise((done) => {
    const c = spawn(process.execPath, [new URL('../test/test_nav.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (rc) => done([m, rc, out.trim().split('\n')]));
  });
  const others = [];
  for (let i = 0; i < NAV_BODIES.length; i += 4) others.push(...await Promise.all(NAV_BODIES.slice(i, i + 4).map(run)));
  console.log(`nav session: E143 ${nv.checks - nv.bad.length}/${nv.checks}; ${others.map(([m, rc, lines]) => `${m} ${rc === 0 ? lines[0].split(': ').pop() : 'FAILED'}`).join(', ')}`);
  [...nv.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += nv.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// nav's TFT layout: the connect posted on the ported bodies, the TG-5s' layout 0 with the value column and "Set"
// whole, the other bodies' frames unchanged by it; E143 here, NAV_BODIES each in a process, four at a time
// (test_navlayout.mjs)
{
  const { navLayout, NAV_BODIES } = await import('../test/test_navlayout.mjs');
  const { spawn } = await import('node:child_process');
  const nl = await navLayout();
  const run = (m) => new Promise((done) => {
    const c = spawn(process.execPath, [new URL('../test/test_navlayout.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (rc) => done([m, rc, out.trim().split('\n')]));
  });
  const others = [];
  for (let i = 0; i < NAV_BODIES.length; i += 4) others.push(...await Promise.all(NAV_BODIES.slice(i, i + 4).map(run)));
  console.log(`nav layout: E143 ${nl.checks - nl.bad.length}/${nl.checks}; ${others.map(([m, rc, lines]) => `${m} ${rc === 0 ? lines[0].split(': ').pop() : 'FAILED'}`).join(', ')}`);
  [...nl.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += nl.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// subject detection's frames: the scene's subject boxes and DISP_FRAME's transform without firmware, then a play
// session on E143 whose DISP_FRAME draws the frames from MDET's own table on the scene's rider while the setting names
// motorsports, one on the EVF, one switched from the TFT to the EVF (the frame plane after MENU in and out), one with
// the race preset's two racers (two frames), and S-SUBJECT's frames with the mdet facts taken away
{
  const { subjectUnits, subjectSession, subjectEvfSession, subjectEvfSwitchSession, subjectRaceSession, subjectStandInSession } = await import('../test/test_subject.mjs');
  const su = subjectUnits(), ss = await subjectSession(), se = await subjectEvfSession(), sw = await subjectEvfSwitchSession(), sr = await subjectRaceSession(), sa = await subjectStandInSession();
  const n = (r) => `${r.checks - r.bad.length}/${r.checks}`;
  console.log(`subject frames: boxes and transform ${n(su)}; in play ${n(ss)}; on the EVF ${n(se)}; after LV to the EVF ${n(sw)}; two racers ${n(sr)}; S-SUBJECT without MDET_DL ${n(sa)}`);
  [...su.bad, ...ss.bad, ...se.bad, ...sw.bad, ...sr.bad, ...sa.bad].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + se.bad.length + sw.bad.length + sr.bad.length + sa.bad.length;
}
// CPU 3's MDET_DL natively with S-DML: the engine's register file without firmware, then a play session on E143 where
// the chain from mdet_dl_start to dml_start_callback runs at each kind and the register images follow the firmware's
// tables, the rider is reported and two racers are reported each combined with its helmet; TAKE's message 81 takes
// take_mov's LAF mode up and down, whose TAKE_MOV start and LAF end run PDT's and TRC's tasks natively; the firmware's
// PDT / TRC drivers run on S-PDT and its EMS1 driver on S-EMS1 (with the units' register files, test_pdt.mjs and
// test_ems1.mjs)
{
  const { dmlUnits, mdetSession } = await import('../test/test_mdet.mjs');
  const { pdtUnits } = await import('../test/test_pdt.mjs');
  const { ems1Units } = await import('../test/test_ems1.mjs');
  const du = dmlUnits(), pu = pdtUnits(), eu = ems1Units(), ms = await mdetSession();
  console.log(`MDET_DL with S-DML, S-PDT and S-EMS1: engine units ${du.checks - du.bad.length}/${du.checks}; PDT / TRC units ${pu.checks - pu.bad.length}/${pu.checks}; EMS1 units ${eu.checks - eu.bad.length}/${eu.checks}; in play ${ms.checks - ms.bad.length}/${ms.checks}`);
  [...du.bad, ...pu.bad, ...eu.bad, ...ms.bad].forEach((x) => console.log('  ', x));
  bad += du.bad.length + pu.bad.length + eu.bad.length + ms.bad.length;
}
// the A53's ISC node-4 service (S-A53ISC, not wired) against the exchanges recorded in the QEMU oracle
{
  const { a53iscUnits } = await import('../test/test_a53isc.mjs');
  const au = a53iscUnits();
  console.log(`the A53's ISC node-4 service (S-A53ISC): units ${au.checks - au.bad.length}/${au.checks}`);
  au.bad.forEach((x) => console.log('  ', x));
  bad += au.bad.length;
}
// the camera's non-volatile state kept between sessions (S-NVRAM): no date prompt, a setting kept across sessions;
// bin/play.mjs keeping it by default per model, its opt-out, and --replay from the log's record; the power lever's off
// and the next start on the same file (the B store in the SCPU words): E143 here, E146 and E147 each in a process of
// its own (the model is fixed when the lab is imported)
{
  const { nvramUnits, nvramSessions, nvramPowerSession, nvramHost } = await import('../test/test_nvram.mjs');
  const { spawnSync } = await import('node:child_process');
  const nu = await nvramUnits(), nv = await nvramSessions(), np = await nvramPowerSession(), nh = await nvramHost();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_nvram.mjs', import.meta.url).pathname, 'power'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`non-volatile state (S-NVRAM): units ${nu.checks - nu.bad.length}/${nu.checks}; across sessions ${nv.checks - nv.bad.length}/${nv.checks}; power-off and restart (E143) ${np.checks - np.bad.length}/${np.checks}, ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}; bin/play.mjs's default, opt-out and replay ${nh.checks - nh.bad.length}/${nh.checks}`);
  [...nu.bad, ...nv.bad, ...np.bad, ...nh.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += nu.bad.length + nv.bad.length + np.bad.length + nh.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the creative dial (UI_IN's position switch 0x1906): refused on E143 with its reason; turned through its positions on
// E147 in a process of its own (the model is fixed when the lab is imported), where each sets the picture-mode family
{
  const { cdialSession } = await import('../test/test_cdial.mjs');
  const { spawnSync } = await import('node:child_process');
  const cd = await cdialSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_cdial.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`creative dial: E143 ${cd.checks - cd.bad.length}/${cd.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...cd.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += cd.bad.length + (r.status === 0 ? 0 : 1);
}
// the OM-3's still / movie switch (UI_IN's position switch 0x1909, test_smswitch.mjs): refused on E143 with its reason;
// moved on E147 in a process of its own, where its positions set the movie mode, a power-on keeps it and logs carry it
{
  const { smswitchSession } = await import('../test/test_smswitch.mjs');
  const { spawnSync } = await import('node:child_process');
  const sm = await smswitchSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_smswitch.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`still / movie switch: E143 ${sm.checks - sm.bad.length}/${sm.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...sm.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += sm.bad.length + (r.status === 0 ? 0 : 1);
}
// the E-P7's Shortcut button (UI_IN key 0x1224, test_shortcut.mjs): refused on E143 with its reason; on E142 in a
// process of its own, a press from the shooting screen opens the Colour Profile page
{
  const { shortcutSession } = await import('../test/test_shortcut.mjs');
  const { spawnSync } = await import('node:child_process');
  const sc = await shortcutSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_shortcut.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: 'E142' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`shortcut button: E143 ${sc.checks - sc.bad.length}/${sc.checks}; E142 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...sc.bad, ...(r.status === 0 ? [] : lines.map((l) => `E142: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += sc.bad.length + (r.status === 0 ? 0 : 1);
}
// the display switch and the TFT's frame at idle on the bodies whose touch driver's close waits for the touch task
// and sleeps in its wake (test_dispswitch.mjs, H-CHAINREST): E146 and E147 each in a process of its own, through
// bin/session.mjs with the controls (the touch task not run, no chain rest); E143 here, which gets no lab time from it;
// on each, LV in S2's rec view landing on the shooting screen, with the control recview-unheld
{
  const { dispswitchSession } = await import('../test/test_dispswitch.mjs');
  const { spawnSync } = await import('node:child_process');
  const ds = await dispswitchSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_dispswitch.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`display switch and idle frame: E143 ${ds.checks - ds.bad.length}/${ds.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...ds.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += ds.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the scripted session (bin/session.mjs, host/session.mjs): its units, then whole runs through the command line on
// E143 here and on E147 (a synthetic om3-patch-2 file) in a process of its own
{
  const { sessionUnits, sessionSession } = await import('../test/test_session.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = sessionUnits(), ss = await sessionSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_session.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`scripted session: units ${su.checks - su.bad.length}/${su.checks}; E143 ${ss.checks - ss.bad.length}/${ss.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...su.bad, ...ss.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + (r.status === 0 ? 0 : 1);
}
// the firmware's setting names (test_setnames.mjs): the rule's units, then a session resolving names on E143 here and
// on E146 and E147 in processes of their own (MODE_MOVIE is 44, 897's name the body's, an unknown name refused)
{
  const { setnamesUnits, setnamesSession } = await import('../test/test_setnames.mjs');
  const { spawnSync } = await import('node:child_process');
  const nu = setnamesUnits(), ns = await setnamesSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_setnames.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`setting names: units ${nu.checks - nu.bad.length}/${nu.checks}; E143 ${ns.checks - ns.bad.length}/${ns.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...nu.bad, ...ns.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += nu.bad.length + ns.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the settings init chain run whole by default (test_setchain.mjs): the rule's units on synthetic and unpacked bodies,
// then a session with the chain against one with its off switch on E143 here and on E146 and E147 in processes of
// their own (every setting, the frame and the lab time the same at the start and after a mode change)
{
  const { setchainUnits, setchainSession } = await import('../test/test_setchain.mjs');
  const { spawnSync } = await import('node:child_process');
  const cu = setchainUnits(), cs = await setchainSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_setchain.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`settings init chain: units ${cu.checks - cu.bad.length}/${cu.checks}; E143 ${cs.checks - cs.bad.length}/${cs.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...cu.bad, ...cs.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += cu.bad.length + cs.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the date prompt's end within a display switch's step (test_promptend.mjs): the event ring the chain's step 10 sizes,
// the switch on the prompt with it and with its size zeroed, on E143 here and on E146 and E147 in processes of their own
{
  const { promptendSession } = await import('../test/test_promptend.mjs');
  const { spawnSync } = await import('node:child_process');
  const pe = await promptendSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_promptend.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`date prompt's end at a switch: E143 ${pe.checks - pe.bad.length}/${pe.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...pe.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += pe.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the scripted session's traces, breakpoints and watchpoints (test_trace.mjs): its units, then whole runs through the
// command line on E143 here and on E147 in a process of its own
{
  const { traceUnits, traceSession } = await import('../test/test_trace.mjs');
  const { spawnSync } = await import('node:child_process');
  const tu = await traceUnits(), ts = await traceSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_trace.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`session traces and stops: units ${tu.checks - tu.bad.length}/${tu.checks}; E143 ${ts.checks - ts.bad.length}/${ts.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...tu.bad, ...ts.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += tu.bad.length + ts.bad.length + (r.status === 0 ? 0 : 1);
}
// the scripted session's tools (test_tools.mjs): stack captures, dumps, a break at a hooked pc, a call at a stop, the
// display options and the OSD policy; its units, then whole runs on E143 here and on E147 in a process of its own
{
  const { toolsUnits, toolsSession } = await import('../test/test_tools.mjs');
  const { spawnSync } = await import('node:child_process');
  const tu = await toolsUnits(), ts = await toolsSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_tools.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`session tools: units ${tu.checks - tu.bad.length}/${tu.checks}; E143 ${ts.checks - ts.bad.length}/${ts.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...tu.bad, ...ts.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += tu.bad.length + ts.bad.length + (r.status === 0 ? 0 : 1);
}
// a Caduceus film checked below the pixels (test_looks.mjs): the LOOKS.BIN reader and a film's values, then, with
// OM_CADUCEUS (a caduceus-om3 checkout), a release's films on E147 in a process of its own; not run without it
{
  const { looksUnits } = await import('../test/test_looks.mjs');
  const { spawnSync } = await import('node:child_process');
  const lu = looksUnits();
  const r = process.env.OM_CADUCEUS ? spawnSync(process.execPath, [new URL('../test/test_looks.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' }) : null;
  const lines = r ? (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0) : [];
  console.log(`Caduceus films below the pixels: units ${lu.checks - lu.bad.length}/${lu.checks}; E147 ${r === null ? 'SKIPPED (set OM_CADUCEUS to a caduceus-om3 checkout)' : r.status === 0 ? 'ok' : 'FAILED'}`);
  [...lu.bad, ...(r === null || r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += lu.bad.length + (r === null || r.status === 0 ? 0 : 1);
}
// a Caduceus film's look hooks on their outputs (test_lookhooks.mjs): the expectations' units, then, with OM_CADUCEUS,
// the COLOR stage, the gamma stage and the stage list run on a job in the call's scratch on E147, in a process of its own
{
  const { lookhooksUnits } = await import('../test/test_lookhooks.mjs');
  const { spawnSync } = await import('node:child_process');
  const lu = lookhooksUnits();
  const r = process.env.OM_CADUCEUS ? spawnSync(process.execPath, [new URL('../test/test_lookhooks.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' }) : null;
  const lines = r ? (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0) : [];
  console.log(`Caduceus look hooks on their outputs: units ${lu.checks - lu.bad.length}/${lu.checks}; E147 ${r === null ? 'SKIPPED (set OM_CADUCEUS to a caduceus-om3 checkout)' : r.status === 0 ? 'ok' : 'FAILED'}`);
  [...lu.bad, ...(r === null || r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += lu.bad.length + (r === null || r.status === 0 ? 0 : 1);
}
// Caduceus' look code by calls (test_lookcode.mjs): the readers' and the halation definition's units, then, with
// OM_CADUCEUS, Grain's camera route at its hook sites and the halation pass on frames in the calls' scratch on E147, in a
// process of its own
{
  const { lookcodeUnits } = await import('../test/test_lookcode.mjs');
  const { spawnSync } = await import('node:child_process');
  const lu = lookcodeUnits();
  const r = process.env.OM_CADUCEUS ? spawnSync(process.execPath, [new URL('../test/test_lookcode.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' }) : null;
  const lines = r ? (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0) : [];
  console.log(`Caduceus look code by calls: units ${lu.checks - lu.bad.length}/${lu.checks}; E147 ${r === null ? 'SKIPPED (set OM_CADUCEUS to a caduceus-om3 checkout)' : r.status === 0 ? 'ok' : 'FAILED'}`);
  [...lu.bad, ...(r === null || r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += lu.bad.length + (r === null || r.status === 0 ? 0 : 1);
}
// E147's still set-up (test_stillsetup.mjs): a shot at each creative-dial position, the constructor the picture mode
// selects; with OM_CADUCEUS, Caduceus' .hook_su run by S2 at COLOR; each in a process of its own on E147
{
  const { spawnSync } = await import('node:child_process');
  const one = (arg) => spawnSync(process.execPath, [new URL('../test/test_stillsetup.mjs', import.meta.url).pathname, arg], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const r = one('--session'), c = process.env.OM_CADUCEUS ? one('--caduceus') : null;
  const lines = (x) => (x.stdout + x.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || x.status !== 0);
  console.log(`E147's still set-up: dial ${r.status === 0 ? 'ok' : 'FAILED'}; Caduceus ${c === null ? 'SKIPPED (set OM_CADUCEUS to a caduceus-om3 checkout)' : c.status === 0 ? 'ok' : 'FAILED'}`);
  [...(r.status === 0 ? [] : lines(r)), ...(c === null || c.status === 0 ? [] : lines(c))].forEach((l) => console.log('  ', `E147: ${l.trim()}`));
  bad += (r.status === 0 ? 0 : 1) + (c === null || c.status === 0 ? 0 : 1);
}
// H-SHOTALLOC over 20 consecutive pictures (test_shotalloc.mjs): TAKE's shot table and MM's handles left as found
// after each, on E143, E146 and E147, each in a process of its own
{
  const { spawnSync } = await import('node:child_process');
  for (const m of ['E143', 'E146', 'E147']) {
    const r = spawnSync(process.execPath, [new URL('../test/test_shotalloc.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    const lines = (r.stdout + r.stderr).trim().split('\n');
    console.log(lines.find((l) => /^H-SHOTALLOC over/.test(l)) ?? `H-SHOTALLOC over 20 pictures (${m}): FAILED`);
    if (r.status !== 0) { lines.filter((l) => l.startsWith('   ') || !/^H-SHOTALLOC over/.test(l)).forEach((l) => console.log('  ', `${m}: ${l.trim()}`)); bad += 1; }
  }
}
// S-RAWFRAME's control (test_shotalloc.mjs --dram 384): the fill runs in the runs above with the E143 family's 512 MiB
// of DRAM (src/fw/facts.mjs mmDramSize); with the 384 MiB before, MM's Bayer block lies past the lab's DRAM and
// S-RAWFRAME is not in use, giving that reason
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('../test/test_shotalloc.mjs', import.meta.url).pathname, '--session', '--dram', '384', '--shots', '2'], { env: { ...process.env, OM_EMU_MODEL: 'E143' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n');
  console.log(lines.find((l) => /^H-SHOTALLOC over/.test(l)) ?? 'H-SHOTALLOC over 2 pictures (E143, 384 MiB): FAILED');
  if (r.status !== 0) { lines.filter((l) => l.startsWith('   ')).forEach((l) => console.log('  ', `E143 384 MiB: ${l.trim()}`)); bad += 1; }
}
// H-TAKEFILLS (test_takefills.mjs): TAKE's own fills of the shot natively against S-EXIFPRM's copies, the record
// compared byte for byte, on E143, E146 and E147, each in a process of its own (takepic, the lens fill and the third
// fill with S-AFMKNT among them, and StlRdy1's strobe request after H-STBPROP, Sv filled); on E143 also S-AFMKNT's
// control, takepic's stop without it
{
  const { spawnSync } = await import('node:child_process');
  for (const m of ['E143', 'E146', 'E147']) {
    const r = spawnSync(process.execPath, [new URL('../test/test_takefills.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    const lines = (r.stdout + r.stderr).trim().split('\n');
    console.log(lines.find((l) => /^H-TAKEFILLS \(/.test(l)) ?? `H-TAKEFILLS (${m}): FAILED`);
    if (r.status !== 0) { lines.filter((l) => l.startsWith('   ') || !/^H-TAKEFILLS \(/.test(l)).forEach((l) => console.log('  ', `${m}: ${l.trim()}`)); bad += 1; }
  }
}
// the still's stage builders on stock firmware (test_stages.mjs, A-STAGEJOB): the units, then each builder called
// standalone on a job the test writes, its outputs and read set against the pins, on E122, E143 and E147, each in a
// process of its own; no downstream checkout
{
  const { stagesUnits } = await import('../test/test_stages.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = stagesUnits(), lines = [];
  let failed = 0;
  for (const m of ['E122', 'E143', 'E147']) {
    const r = spawnSync(process.execPath, [new URL('../test/test_stages.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    if (r.status !== 0) { failed++; lines.push(...(r.stdout + r.stderr).trim().split('\n').slice(0, 20).map((l) => `${m}: ${l.trim()}`)); }
  }
  console.log(`the still's stage builders: units ${su.checks - su.bad.length}/${su.checks}; E122, E143, E147 ${failed ? 'FAILED' : 'ok'}`);
  [...su.bad, ...lines].forEach((x) => console.log('  ', x));
  bad += su.bad.length + failed;
}
// the caduceus-om3 releases (test_caduceus.mjs): the pins' units; with OM_CADUCEUS naming a caduceus-om3 checkout, each
// release folder's files against its pins and its flow on E147 in processes of their own, under the strict mode with
// its findings against test/fixtures/caduceus-strict.json (the folders without a flow pin too); without it SKIPPED
{
  const { caduceusUnits } = await import('../test/test_caduceus.mjs');
  const cu = caduceusUnits();
  let rc = 0, lines = ['SKIPPED (set OM_CADUCEUS to a caduceus-om3 checkout)'];
  if (process.env.OM_CADUCEUS) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [new URL('../test/test_caduceus.mjs', import.meta.url).pathname, '--session', '--strict'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
    rc = r.status;
    lines = (r.stdout + r.stderr).trim().split('\n').map((l) => l.replace(/^caduceus-om3 releases: /, ''));
  }
  console.log(`caduceus-om3 releases: pin units ${cu.checks - cu.bad.length}/${cu.checks}; E147 ${lines[0]}${rc === 0 ? '' : ' FAILED'}`);
  [...cu.bad, ...lines.slice(1).map((l) => l.trim())].forEach((x) => console.log('  ', x));
  bad += cu.bad.length + (rc === 0 ? 0 : 1);
}
// the field-failure corpus (test_fieldfail.mjs): patched builds that failed on a camera and their fixed builds, the
// bad one caught and the fixed one passing the same scenario, each build in a process of its own on its case's body;
// the self-control (a synthetic hook to an unmapped address on E143) always runs, a third-party build missing under
// $OM_THIRDPARTY is a skip, a case whose capability does not exist yet an xfail
{
  const { fieldfailUnits, fieldfailTableUnits } = await import('../test/test_fieldfail.mjs');
  const { spawnSync } = await import('node:child_process');
  const fu = fieldfailUnits(), ft = await fieldfailTableUnits();
  const r = spawnSync(process.execPath, [new URL('../test/test_fieldfail.mjs', import.meta.url).pathname, '--session'], { encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n');
  console.log(`field-failure corpus: units ${fu.checks - fu.bad.length}/${fu.checks}, table ${ft.checks - ft.bad.length}/${ft.checks}; ${(lines[0] ?? '').replace(/^field-failure corpus: /, '')}${r.status === 0 ? '' : ' FAILED'}`);
  [...fu.bad, ...ft.bad, ...lines.slice(1).map((l) => l.trim())].forEach((x) => console.log('  ', x));
  bad += fu.bad.length + ft.bad.length + (r.status === 0 ? 0 : 1);
}
// the E-P7 and E-M1 III cases' shape and their pins against the files present (test_fieldfail_cases.mjs, firmware-free)
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('../test/test_fieldfail_cases.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n');
  console.log(`field-failure cases, E-P7 and E-M1 III: ${(lines.at(-1) ?? '').replace(/^test_fieldfail_cases: /, '')}${r.status === 0 ? '' : ' FAILED'}`);
  if (r.status !== 0) lines.slice(0, -1).forEach((x) => console.log('  ', x.trim()));
  bad += r.status === 0 ? 0 : 1;
}
// the body's Fn-type buttons reach the camera application's button mapping (ISO, +/-, Drive, AF/metering, AF-ON, |o|, front)
{
  const { fnKeySessions } = await import('../test/test_fnkeys.mjs');
  const fk = await fnKeySessions();
  console.log(`Fn-type buttons in play: ${fk.checks - fk.bad.length}/${fk.checks}`);
  fk.bad.forEach((x) => console.log('  ', x));
  bad += fk.bad.length;
}
// the idle key image releases every type-2 entry of each body's UI_IN tables; the picture-function rows (test_keyidle.mjs)
{
  const { keyIdleTests } = await import('../test/test_keyidle.mjs');
  const ki = await keyIdleTests();
  console.log(`idle key image: ${ki.bodies.length} bodies, ${ki.bad.length ? 'FAILED' : 'ok'}`);
  ki.bad.forEach((x) => console.log('  ', x));
  bad += ki.bad.length;
}
// UI_IN's module init natively (H-UIININIT, S-WAKEFACTOR; test_uiininit.mjs, E143): its calls from its bytes, the key
// table at the power button's factor; a start and MENU, down, OK, MENU the same as with S-BOOTKEY's path
{
  const { uiinInitUnits, uiinInitSession } = await import('../test/test_uiininit.mjs');
  const uu = await uiinInitUnits(), us = await uiinInitSession();
  console.log(`UI_IN's module init: units ${uu.checks - uu.bad.length}/${uu.checks}; in play ${us.checks - us.bad.length}/${us.checks}`);
  [...uu.bad, ...us.bad].forEach((x) => console.log('  ', x));
  bad += uu.bad.length + us.bad.length;
}
// UI_IN's GIO key pins (H-GIOKEYS, src/dev/gio.mjs; test_giokeys.mjs, E143): the board's pins against the driver's
// tables; the key init reads and arms them at the idle levels; a tap still accepted; OK through its pin decoded natively
{
  const { gioKeysUnits, gioKeysSession } = await import('../test/test_giokeys.mjs');
  const gu = await gioKeysUnits(), gs = await gioKeysSession();
  console.log(`UI_IN's GIO key pins: units ${gu.checks - gu.bad.length}/${gu.checks}; in play ${gs.checks - gs.bad.length}/${gs.checks}`);
  [...gu.bad, ...gs.bad].forEach((x) => console.log('  ', x));
  bad += gu.bad.length + gs.bad.length;
}
// the 12-40 on the mount (S-LENS, or natively with S-LENSMCU) and the camera's own exposure plan (S-EXPOSE)
{
  const { exposeSessions } = await import('../test/test_expose.mjs');
  const ex = await exposeSessions();
  console.log(`lens and exposure plan (S-EXPOSE) in play: ${ex.checks - ex.bad.length}/${ex.checks}`);
  ex.bad.forEach((x) => console.log('  ', x));
  bad += ex.bad.length;
}
// S-EXPOSE's readers in a default session, and the EXP callback that would write the AE results run natively as far
// as it goes (test_expcb.mjs, --take probe with --cpu2 native: EXP_MOVIE's AE request stops before the callback);
// cam.c's inits and requests natively, step by step (camDriverSession); its second init against S-CAMFE, and its
// request 6 (the sensor's power-on) natively past the sensor's serial unit (camFrontEndSession)
{
  const { aeReadersSession, expCallbackSession, camDriverSession, camFrontEndSession } = await import('../test/test_expcb.mjs');
  const ar = await aeReadersSession();
  const ec = await expCallbackSession();
  const cd = await camDriverSession();
  const cf = await camFrontEndSession();
  console.log(`S-EXPOSE's readers in play: ${ar.checks - ar.bad.length}/${ar.checks}; the EXP callback, rounds 1 and 2: ${ec.checks - ec.bad.length}/${ec.checks}; cam.c natively: ${cd.checks - cd.bad.length}/${cd.checks}; its second init against S-CAMFE: ${cf.checks - cf.bad.length}/${cf.checks}`);
  [...ar.bad, ...ec.bad, ...cd.bad, ...cf.bad].forEach((x) => console.log('  ', x));
  bad += ar.bad.length + ec.bad.length + cd.bad.length + cf.bad.length;
}
// SSG1's command unit in S-CAMFE: request 6's mode-0 batches end on IRQ 18 through the firmware's handler and the
// power-on passes the unit to the units' set-up (test_camfe.mjs camFeSsgSession; docs/hle-gaps/4.2.md 4.2.6)
{
  const { camFeSsgSession } = await import('../test/test_camfe.mjs');
  const r = await camFeSsgSession();
  console.log(`SSG1's command unit (S-CAMFE) in play: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  bad += r.bad.length;
}
// the lens on the mount natively: the serial controller, the deferred-call triggers, S-LENSMCU, the driver's start:
// E143 here, E146 and E147 each in a process of its own (the model is fixed when the lab is imported)
{
  const { lensUnits, lensSession } = await import('../test/test_lens.mjs');
  const { spawnSync } = await import('node:child_process');
  const lu = lensUnits(), ls = await lensSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_lens.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`the native lens: units ${lu.checks - lu.bad.length}/${lu.checks}; in play (E143) ${ls.checks - ls.bad.length}/${ls.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...lu.bad, ...ls.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += lu.bad.length + ls.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// the resource tables from the NAND (H-RESINIT, S-RESNAND): the NAND view, the extract and the sound area's builder,
// then the tables and the resource API's answers in play on E143 (the .BIN, the browser's extract, a lab-made sound
// area), and on E146 and E147 in their own processes
{
  const { resnandUnits, resnandSession } = await import('../test/test_resnand.mjs');
  const { spawnSync } = await import('node:child_process');
  const ru = await resnandUnits(), rs = await resnandSession();
  const others = ['E146', 'E147'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_resnand.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`the resource tables' NAND: units ${ru.checks - ru.bad.length}/${ru.checks}; in play (E143) ${rs.checks - rs.bad.length}/${rs.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...ru.bad, ...rs.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += ru.bad.length + rs.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// PER_SIO's served IIC transfers and the TG-5's charger, without firmware (the TG-5s' sessions are bin/modelcheck.mjs's)
{
  const { sioUnits } = await import('../test/test_sio.mjs');
  const su = sioUnits();
  console.log(`PER_SIO IIC and the TG-5's charger: units ${su.checks - su.bad.length}/${su.checks}`);
  su.bad.forEach((x) => console.log('  ', x));
  bad += su.bad.length;
}
// PER_SIO's channel map set at the play bring-up (H-SIOMAP, test_siomap.mjs)
{
  const { sioMapSession } = await import('../test/test_siomap.mjs');
  const sm = await sioMapSession();
  console.log(`PER_SIO's channel map at the bring-up: ${sm.checks - sm.bad.length}/${sm.checks}`);
  sm.bad.forEach((x) => console.log('  ', x));
  bad += sm.bad.length;
}
// the memory map's rules at addRegion (src/core/mem.mjs), without firmware
{
  const { memUnits } = await import('../test/test_mem.mjs');
  const mu = await memUnits();
  console.log(`the memory map's rules at addRegion: units ${mu.checks - mu.bad.length}/${mu.checks}`);
  mu.bad.forEach((x) => console.log('  ', x));
  bad += mu.bad.length;
}
// what a firmware file is (src/fw/identify.mjs) and --main with a .BIN container (test_identify.mjs): the units, the
// .BINs and unpacked blocks at hand, then bin/session.mjs on E143 here and on E147 in a process of its own; a body
// without its .BIN is a counted skip
{
  const { identifyUnits, identifyFiles, identifySession } = await import('../test/test_identify.mjs');
  const { spawnSync } = await import('node:child_process');
  const iu = await identifyUnits(), fi = await identifyFiles(), is = await identifySession();
  const r = spawnSync(process.execPath, [new URL('../test/test_identify.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`firmware identity: units ${iu.checks - iu.bad.length}/${iu.checks}; the files at hand ${fi.checks - fi.bad.length}/${fi.checks}${fi.skipped.length ? `, ${fi.skipped.length} SKIPPED` : ''}; --main with a .BIN on E143 ${is.checks - is.bad.length}/${is.checks}${is.skipped.length ? `, ${is.skipped.length} SKIPPED` : ''}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...iu.bad, ...fi.bad, ...is.bad, ...[...fi.skipped, ...is.skipped].map((x) => `SKIPPED ${x}`), ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += iu.bad.length + fi.bad.length + is.bad.length + is.skipped.length + (r.status === 0 ? 0 : 1);
}
// E-M1-Miii mods.json packs (test_mods.mjs): the units; E139's blocks against the pinned pack (in ~/.om-emu/thirdparty,
// outside the tree; without it a counted skip); then bin/session.mjs on E139 in a process of its own
{
  const { modsUnits, modsFiles } = await import('../test/test_mods.mjs');
  const { spawnSync } = await import('node:child_process');
  const mu = modsUnits(), mf = await modsFiles();
  const r = spawnSync(process.execPath, [new URL('../test/test_mods.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E139' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`E-M1-Miii mods.json: units ${mu.checks - mu.bad.length}/${mu.checks}; E139's blocks ${mf.checks - mf.bad.length}/${mf.checks}${mf.skipped.length ? `, ${mf.skipped.length} SKIPPED` : ''}; E139 sessions ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...mu.bad, ...mf.bad, ...mf.skipped.map((x) => `SKIPPED ${x}`), ...lines.map((l) => `E139: ${l.trim()}`)].forEach((x) => console.log('  ', x));
  bad += mu.bad.length + mf.bad.length + (r.status === 0 ? 0 : 1);
}
// the Stand-ins tab's rows (src/lab/playapi.mjs standInRows; test_standins.mjs): a row for every label a session can
// report, then the labels a session reports on E143 here and on E147 in a process of its own
{
  const { standinsUnits, standinsSession } = await import('../test/test_standins.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = await standinsUnits(), ss = await standinsSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_standins.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`the Stand-ins tab's rows: units ${su.checks - su.bad.length}/${su.checks}; a session's labels on E143 ${ss.checks - ss.bad.length}/${ss.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...su.bad, ...ss.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + (r.status === 0 ? 0 : 1);
}
// what a picture is, said at the picture (src/lab/sources.mjs; test_sources.mjs): the sentences and the pages' copies,
// then a scripted session's shots before and after S-SCENE's live view on E143 here and on E147 in a process of its own
{
  const { sourcesUnits, sourcesSession } = await import('../test/test_sources.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = await sourcesUnits(), ss = await sourcesSession();
  const r = spawnSync(process.execPath, [new URL('../test/test_sources.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E147' }, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0);
  console.log(`what a picture is: units ${su.checks - su.bad.length}/${su.checks}; a session's shots on E143 ${ss.checks - ss.bad.length}/${ss.checks}; E147 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...su.bad, ...ss.bad, ...(r.status === 0 ? [] : lines.map((l) => `E147: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + (r.status === 0 ? 0 : 1);
}
// the lab's call on a synthetic block (src/lab/hle.mjs HLE.call; test_slice.mjs), without firmware
{
  const { sliceUnits } = await import('../test/test_slice.mjs');
  const su = await sliceUnits();
  console.log(`the lab's call on a synthetic block: units ${su.checks - su.bad.length}/${su.checks}`);
  su.bad.forEach((x) => console.log('  ', x));
  bad += su.bad.length;
}
// the SCPU's Cortex-M4 core: hand-written vectors, QEMU's recorded vectors, the SCPU image from its reset vector
{
  const { m4Units, m4Vectors, m4Firmware } = await import('../test/test_m4.mjs');
  const mu = m4Units(), mv = m4Vectors(), mf = m4Firmware();
  console.log(`Cortex-M4 core: units ${mu.checks - mu.bad.length}/${mu.checks}; QEMU vectors ${mv.checks - mv.bad.length}/${mv.checks}; the SCPU image from reset ${mf.checks - mf.bad.length}/${mf.checks}${mf.skipped.length ? `, ${mf.skipped.length} SKIPPED (no E143 SCPU block)` : ''}`);
  [...mu.bad, ...mv.bad.slice(0, 20), ...mf.bad, ...mf.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  bad += mu.bad.length + mv.bad.length + mf.bad.length + mf.skipped.length;
}
// the SCPU's STM32L4 machine: the peripheral models, the SCPU image to its console prompt and its commands
{
  const { stm32Units, stm32Firmware } = await import('../test/test_stm32l4.mjs');
  const su = stm32Units(), sf = await stm32Firmware();
  console.log(`SCPU STM32L4 machine: peripheral models ${su.checks - su.bad.length}/${su.checks}; the SCPU image to its console and standby ${sf.checks - sf.bad.length}/${sf.checks}${sf.skipped.length ? `, ${sf.skipped.length} SKIPPED (no E143 SCPU block)` : ''}`);
  [...su.bad, ...sf.bad, ...sf.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  bad += su.bad.length + sf.bad.length + sf.skipped.length;
}
// the SCPU's own firmware behind the link (OM_EMU_SCPU=native): the bridge's units, then a play session's start against
// S-SCPUDEV's: E143 here, E146 in a process of its own (the model is fixed when the lab is imported)
{
  const { scpuM4Units, scpuM4Session } = await import('../test/test_scpum4.mjs');
  const { spawnSync } = await import('node:child_process');
  const mu = scpuM4Units(), ms = await scpuM4Session();
  const r = spawnSync(process.execPath, [new URL('../test/test_scpum4.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: 'E146' }, encoding: 'utf8' });
  const e146 = r.status === 0 ? [] : (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || /SKIPPED|Error/.test(l)).map((l) => `E146: ${l.trim()}`);
  console.log(`the SCPU's own firmware behind the link: units ${mu.checks - mu.bad.length}/${mu.checks}; in play against S-SCPUDEV (E143) ${ms.checks - ms.bad.length}/${ms.checks}${ms.skipped.length ? `, ${ms.skipped.length} SKIPPED` : ''}; E146 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...mu.bad, ...ms.bad, ...ms.skipped.map((x) => `SKIPPED ${x}`), ...e146].forEach((x) => console.log('  ', x));
  bad += mu.bad.length + ms.bad.length + ms.skipped.length + (r.status === 0 ? 0 : 1);
}
// the A/D converter and the A/D driver's init (H-ADINIT; test_adc.mjs): the device without firmware, the rule on E143's
// image, and E143's start with and without it (UI_IN's channel open, and with OM_POWER_LATER=on the temperature read,
// through the converter)
{
  const { adcUnits, adcFacts, adcSession } = await import('../test/test_adc.mjs');
  const au = adcUnits(), af = await adcFacts(), as = await adcSession();
  console.log(`the A/D converter: units ${au.checks - au.bad.length}/${au.checks}; rule ${af.checks - af.bad.length}/${af.checks}; in play ${as.checks - as.bad.length}/${as.checks}`);
  [...au.bad, ...af.bad, ...as.bad].forEach((x) => console.log('  ', x));
  bad += au.bad.length + af.bad.length + as.bad.length;
}
// the power manager's later inits at the bring-up (H-PWRLATER, opt-in; test_pwrlater.mjs), E143 with the SCPU's own
// firmware and with S-SCPUDEV
{
  const { pwrLaterSession } = await import('../test/test_pwrlater.mjs');
  const pw = await pwrLaterSession();
  console.log(`the power manager's later inits (H-PWRLATER): ${pw.checks - pw.bad.length}/${pw.checks}${pw.skipped.length ? `, ${pw.skipped.length} SKIPPED` : ''}`);
  [...pw.bad, ...pw.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  bad += pw.bad.length;
}
// the firmware map (bin/fwmap.mjs) and the machine's coverage option
{
  const { fwmapUnits, fwmapFirmware } = await import('../test/test_fwmap.mjs');
  const fu = fwmapUnits(), ff = await fwmapFirmware();
  console.log(`firmware map: units ${fu.checks - fu.bad.length}/${fu.checks}; static map, labels and OM_COVERAGE ${ff.checks - ff.bad.length}/${ff.checks}${ff.skipped.length ? `, ${ff.skipped.length} SKIPPED (no E143 main block)` : ''}`);
  [...fu.bad, ...ff.bad, ...ff.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  bad += fu.bad.length + ff.bad.length + ff.skipped.length;
}
// the port's placement (src/fw/place.mjs) on a synthetic map: a vote in the image copy with no majority
{
  const { placeUnits } = await import('../test/test_place.mjs');
  const pl = placeUnits();
  console.log(`port placement (place.mjs): ${pl.checks - pl.bad.length}/${pl.checks}`);
  pl.bad.forEach((x) => console.log('  ', x));
  bad += pl.bad.length;
}
// replay across power cycle phase race, host worker memory probe, VSC LINE_NS rebase (F05), session --lang, Player pacing gates
{
  const { replayPhaseTests } = await import('../test/test_replay_phase.mjs');
  const { memprobeTests } = await import('../test/test_memprobe.mjs');
  const { vscRebaseUnits } = await import('../test/test_vsc_rebase.mjs');
  const { sessionLangUnits, sessionLangSession } = await import('../test/test_session_lang.mjs');
  const { pacingUnits } = await import('../test/test_pacing.mjs');
  for (const [label, r] of [
    ['replay phase race', replayPhaseTests()],
    ['host memory probe (main + worker)', await memprobeTests()],
    ['VSC LINE_NS rebase (F05)', vscRebaseUnits()],
    ['session --lang units', sessionLangUnits()],
    ['session --lang in play (E143)', await sessionLangSession()],
    ['Player pacing and timing gates', pacingUnits()],
  ]) {
    console.log(`${label}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    bad += r.bad.length;
  }
}
// checks portable time (F40), memSnapshot ROM skip (F25), web selftest Card panel, slot 2 media status, S-PANELDONE gate, debug inspect ops
{
  const { checksTimeUnits } = await import('../test/test_checks_time.mjs');
  const { memSnapshotUnits } = await import('../test/test_mem_snapshot.mjs');
  const { webSelftestUnits } = await import('../test/test_web_selftest.mjs');
  const { slot2StatusUnits, slot2StatusSession } = await import('../test/test_slot2_status.mjs');
  const { panelDoneUnits } = await import('../test/test_paneldone.mjs');
  const { debugInspectUnits } = await import('../test/test_debug_inspect.mjs');
  for (const [label, r] of [
    ['checks portable time (F40)', checksTimeUnits()],
    ['memSnapshot ROM skip (F25)', memSnapshotUnits()],
    ['web ?selftest=1 Card panel', await webSelftestUnits()],
    ['slot 2 media status units', slot2StatusUnits()],
    ['slot 2 media status in play (E143)', await slot2StatusSession()],
    ['S-PANELDONE gate units', panelDoneUnits()],
    ['debug API breakpoints/watchpoints inspect', debugInspectUnits()],
  ]) {
    console.log(`${label}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    bad += r.bad.length;
  }
}
// static dependency cycle gate (P1.4) and E147 AEL/AFL + H-ADINIT E146 units (P1.2/P1.3a)
{
  const { cycleUnits } = await import('../test/test_cycles.mjs');
  const { magnifyUnits } = await import('../test/test_magnify.mjs');
  for (const [label, r] of [
    ['static ES dependency cycle gate (emu/src)', cycleUnits()],
    ['E147 AEL/AFL control & H-ADINIT E146 units', magnifyUnits()],
  ]) {
    console.log(`${label}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    bad += r.bad.length;
  }
}
const fa = factsTests();
console.log(`firmware facts (${fa.models} unpacked main blocks): ${fa.checks - fa.bad.length}/${fa.checks}`);
fa.bad.forEach((x) => console.log('  ', x));
bad += fa.bad.length;
const pu = purity();
console.log(`purity: ${pu.files} modules, ${pu.bad.length} violations`);
pu.bad.forEach((x) => console.log('  ', x));
bad += pu.bad.length;
console.log(bad ? `FAILED (${bad})` : 'all passed');
process.exit(bad ? 1 : 0);
