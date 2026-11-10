#!/usr/bin/env node
// The test gate in one command: the recorded ISA vectors on both engines (the CPU's own step and the decoded-cache
// interpreter), the core's two tiers in lockstep, the decode-cache regression (test_regress.mjs), the command-line
// tools and the regression net's permanent controls (test_cli.mjs: mutants golden.mjs must report), infrastructure
// (test_infra.mjs), the VSC register tables, class tables, blend table and histogram unit (test_dev.mjs), the kind-3
// VSC's COMPOSE
// on E122's board (test_vsc3.mjs), the kick model's TB-layout
// refusals (test_irq.mjs), the replayer's argument binding and PlaySession.trim (test_lab.mjs), the check runner and
// the checks' controls (test_checks.mjs) and their command-line parser (test_args.mjs), the debug API's units
// (test_debug.mjs) and its live route to a play session (test_live.mjs), the .BIN unpacker (test_unpack.mjs, needing $OM_FW_DIR or $OM_BIN, else counted as a failure),
// the browser player's pure parts, its node host, webgate B6's page inputs on a node Player and its Worker in a node
// worker thread (test_web.mjs), the node host
// over HTTP (test_host.mjs), the image sensor stand-in (test_scene.mjs), the camera application running natively
// (test_camapp.mjs, with S-HEAP over an idle and a workload, the mode dial's positions and camapp 3), the TAKE
// probe's record of what TAKE_FUNC takes and asks on E143 (test_take.mjs), CPU 2 natively on the machine's second
// core (test_cpu2.mjs), the lab's audio output and the
// synthesized shutter sound at a
// release, and the AF beep end to end (test_audio.mjs), the audio hardware and AUD_EXEC's play path on E143
// (test_audiohw.mjs), the SCPU's clock, ports, link pins and sub-CPU model
// (test_scpu.mjs), the publication audit (test_pubaudit.mjs), patch overlays (test_patch.mjs: the rules, --patch on
// E143 through debug.mjs, play.mjs and nav.mjs), the HDMI port and a plug in play on E143,
// E146 and E147 (test_hdmi.mjs), the accelerometer's sample, check_level on E146 and its PER_ROTATE groups (--rotate
// on) on E143 and E146 (test_acc.mjs), the card and the
// file system on E143, E146, E147, E144, E142 and E134 and SDXC cards on E143 (test_storage.mjs), INFO's still information
// in playback on the 19 bodies (test_playinfo.mjs), a tap on the touch mode icon on E143 and ten bodies of the E144
// family (test_touch.mjs), subject detection's frames on E143
// (test_subject.mjs), CPU 3's MDET_DL natively with the DML engine's model on E143 (test_mdet.mjs),
// the lens on the mount natively on E143, E146 and E147 (test_lens.mjs), the resource tables loaded
// natively from the NAND on E143 (test_resnand.mjs), the SCPU's Cortex-M4 core
// (test_m4.mjs: hand-written vectors, QEMU's recorded vectors, the SCPU image from reset to its first unmodelled
// access), the SCPU's STM32L4 machine (test_stm32l4.mjs: the peripheral models, the SCPU image to its console prompt,
// console commands, its standby and the wake-up), the SCPU's own firmware behind the link against S-SCPUDEV on E143
// and E146 (test_scpum4.mjs), the firmware
// rules of src/fw/facts.mjs (test_facts.mjs) and the firmware map (test_fwmap.mjs:
// the machine's coverage option, the static map's determinism and pinned headline, the labels' keys, run.mjs under
// OM_COVERAGE). The fixtures they compare with are emu's own (test/fixtures, checks/fixtures, golden.json): a
// deliberate behaviour change that one of them pins is re-recorded from emu with its reason.
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
  const { camappSession, heapSession, heapWorkloadSession, modeDialSession, traRoutingSession } = await import('../test/test_camapp.mjs');
  const ca = await camappSession(), hp = await heapSession(), hw = await heapWorkloadSession(), md = await modeDialSession();
  const tr = await traRoutingSession();
  console.log(`camera application (S-CAMAPP) in play: ${ca.checks - ca.bad.length}/${ca.checks}; S-HEAP over an idle: ${hp.checks - hp.bad.length}/${hp.checks}; S-HEAP over a workload: ${hw.checks - hw.bad.length}/${hw.checks}; the mode dial's positions: ${md.checks - md.bad.length}/${md.checks}; camapp 3's native transactions: ${tr.checks - tr.bad.length}/${tr.checks}`);
  [...ca.bad, ...hp.bad, ...hw.bad, ...md.bad, ...tr.bad].forEach((x) => console.log('  ', x));
  bad += ca.bad.length + hp.bad.length + hw.bad.length + md.bad.length + tr.bad.length;
}
// the imgpro unit's model (S-IMGPRO) on a bare machine; the firmware's driver on it runs in camapp 3 above
{
  const { imgproUnits } = await import('../test/test_imgpro.mjs');
  const iu = imgproUnits();
  console.log(`the imgpro unit (S-IMGPRO), its units: ${iu.checks - iu.bad.length}/${iu.checks}`);
  iu.bad.forEach((x) => console.log('  ', x));
  bad += iu.bad.length;
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
// camapp 3 S1's take request reaches TAKE_MAIN natively, which waits for TAKE_FOCUS's callbacks
{
  const { releaseSession } = await import('../test/test_take_release.mjs');
  const rs = await releaseSession();
  console.log(`the release route to TAKE_EXEC (H-TAKEMAIN, S-THRTAKEOVER) in play: ${rs.checks - rs.bad.length}/${rs.checks}`);
  rs.bad.forEach((x) => console.log('  ', x));
  bad += rs.bad.length;
}
// CPU 2 natively (--cpu2 native): its boot to the idle loop, its first device accesses and cross-core call, and the
// Super Control Panel's posts answered by its AUD_LEVEL_MONITOR as S-CPU2 answered them; off by default
{
  const { cpu2Session } = await import('../test/test_cpu2.mjs');
  const c2 = await cpu2Session();
  console.log(`CPU 2 natively (--cpu2 native) in play: ${c2.checks - c2.bad.length}/${c2.checks}`);
  c2.bad.forEach((x) => console.log('  ', x));
  bad += c2.bad.length;
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
// patch overlays (src/fw/patch.mjs): the rules on synthetic blocks, then --patch on E143 through bin/debug.mjs,
// bin/play.mjs and bin/nav.mjs with a tiny patch file the test writes
{
  const { patchUnits, patchSession } = await import('../test/test_patch.mjs');
  const pu = patchUnits(), ps = await patchSession();
  console.log(`patch overlays: units ${pu.checks - pu.bad.length}/${pu.checks}; on E143 ${ps.checks - ps.bad.length}/${ps.checks}`);
  [...pu.bad, ...ps.bad].forEach((x) => console.log('  ', x));
  bad += pu.bad.length + ps.bad.length;
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
// the accelerometer: its sample without firmware, then checks/check_level.mjs on E146 and its PER_ROTATE groups R1 and
// R2 (--rotate on, with their mutant on E143) on E143 and E146, each in a process of its own (E143's default runs are
// checks/runs.json's; the model is fixed when the lab is imported)
{
  const { accUnits } = await import('../test/test_acc.mjs');
  const { spawnSync } = await import('node:child_process');
  const au = accUnits();
  const runs = [['E146', []], ['E143', ['--only', 'R1,R2']], ['E143', ['--only', 'R1,R2', '--mutants']], ['E146', ['--only', 'R1,R2']]].map(([m, args]) => {
    const r = spawnSync(process.execPath, [new URL('../checks/check_level.mjs', import.meta.url).pathname, ...args], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [`${m}${args.length ? ' ' + args.join(' ') : ''}`, r];
  });
  console.log(`accelerometer: sample units ${au.checks - au.bad.length}/${au.checks}; check_level ${runs.map(([n, r]) => `${n} ${r.status === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...au.bad, ...runs.flatMap(([n, r]) => (r.status === 0 ? [] : (r.stdout + r.stderr).trim().split('\n').map((l) => `${n}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += au.bad.length + runs.filter(([, r]) => r.status !== 0).length;
}
// the card and the file system (storage.mjs): the card model and the FAT and exFAT readers without firmware, then play
// sessions whose card the firmware formats and mounts itself: E143 here (an 8 GiB SDHC card, then blank 64 and 128 GiB
// SDXC cards, whose findings print as notes), and E146, E147, E144, E142 and E134 (the OM-1 family, the E144 family,
// the E142 lineage and the E-M1X, whose card needs UI_OUT) each in a process of its own (the model is fixed when the
// lab is imported); E146's with the HLS media side (Card Formatting from the menu, the card out and in)
{
  const { storageUnits, storageSession, storageSdxc } = await import('../test/test_storage.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = storageUnits(), ss = await storageSession(), sx = await storageSdxc();
  const others = ['E146', 'E147', 'E144', 'E142', 'E134'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_storage.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`card and file system: card model, FAT and exFAT readers ${su.checks - su.bad.length}/${su.checks}; in play (E143) ${ss.checks - ss.bad.length}/${ss.checks}; SDXC (E143) ${sx.checks - sx.bad.length}/${sx.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  sx.notes.forEach((x) => console.log('   note:', x));
  [...su.bad, ...ss.bad, ...sx.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + sx.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// INFO's still information in playback, from the picture's own record: E143 here (S-PLAYCOMP's answer in the
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
// touch in play: a tap on the shooting screen's touch mode icon reaching HFW and the frame, E143 here and the E144
// family's bodies with a touch panel each in a process of its own, four at a time
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
// bin/play.mjs keeping it by default per model, its opt-out, and --replay from the log's record
{
  const { nvramUnits, nvramSessions, nvramHost } = await import('../test/test_nvram.mjs');
  const nu = await nvramUnits(), nv = await nvramSessions(), nh = await nvramHost();
  console.log(`non-volatile state (S-NVRAM): units ${nu.checks - nu.bad.length}/${nu.checks}; across sessions ${nv.checks - nv.bad.length}/${nv.checks}; bin/play.mjs's default, opt-out and replay ${nh.checks - nh.bad.length}/${nh.checks}`);
  [...nu.bad, ...nv.bad, ...nh.bad].forEach((x) => console.log('  ', x));
  bad += nu.bad.length + nv.bad.length + nh.bad.length;
}
// the body's Fn-type buttons reach the camera application's button mapping (ISO, +/-, Drive, AF/metering, AF-ON, |o|, front)
{
  const { fnKeySessions } = await import('../test/test_fnkeys.mjs');
  const fk = await fnKeySessions();
  console.log(`Fn-type buttons in play: ${fk.checks - fk.bad.length}/${fk.checks}`);
  fk.bad.forEach((x) => console.log('  ', x));
  bad += fk.bad.length;
}
// the 12-40 on the mount (S-LENS, or natively with S-LENSMCU) and the camera's own exposure plan (S-EXPOSE)
{
  const { exposeSessions } = await import('../test/test_expose.mjs');
  const ex = await exposeSessions();
  console.log(`lens and exposure plan (S-EXPOSE) in play: ${ex.checks - ex.bad.length}/${ex.checks}`);
  ex.bad.forEach((x) => console.log('  ', x));
  bad += ex.bad.length;
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
// area)
{
  const { resnandUnits, resnandSession } = await import('../test/test_resnand.mjs');
  const ru = await resnandUnits(), rs = await resnandSession();
  console.log(`the resource tables' NAND: units ${ru.checks - ru.bad.length}/${ru.checks}; in play ${rs.checks - rs.bad.length}/${rs.checks}`);
  [...ru.bad, ...rs.bad].forEach((x) => console.log('  ', x));
  bad += ru.bad.length + rs.bad.length;
}
// PER_SIO's served IIC transfers and the TG-5's charger, without firmware (the TG-5s' sessions are bin/modelcheck.mjs's)
{
  const { sioUnits } = await import('../test/test_sio.mjs');
  const su = sioUnits();
  console.log(`PER_SIO IIC and the TG-5's charger: units ${su.checks - su.bad.length}/${su.checks}`);
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
// the firmware map (bin/fwmap.mjs) and the machine's coverage option
{
  const { fwmapUnits, fwmapFirmware } = await import('../test/test_fwmap.mjs');
  const fu = fwmapUnits(), ff = await fwmapFirmware();
  console.log(`firmware map: units ${fu.checks - fu.bad.length}/${fu.checks}; static map, labels and OM_COVERAGE ${ff.checks - ff.bad.length}/${ff.checks}${ff.skipped.length ? `, ${ff.skipped.length} SKIPPED (no E143 main block)` : ''}`);
  [...fu.bad, ...ff.bad, ...ff.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  bad += fu.bad.length + ff.bad.length + ff.skipped.length;
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
