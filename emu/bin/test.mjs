#!/usr/bin/env node
// The test gate in one command: the recorded ISA vectors on both engines (the CPU's own step and the decoded-cache
// interpreter), the core's two tiers in lockstep, the decode-cache regression (test_regress.mjs), the command-line
// tools and the regression net's permanent controls (test_cli.mjs: mutants golden.mjs must report), infrastructure
// (test_infra.mjs), the VSC register tables, class tables and blend table (test_dev.mjs), the kick model's TB-layout
// refusals (test_irq.mjs), the replayer's argument binding and PlaySession.trim (test_lab.mjs), the check runner and
// the checks' controls (test_checks.mjs) and their command-line parser (test_args.mjs), the debug API's units
// (test_debug.mjs) and its live route to a play session (test_live.mjs), the .BIN unpacker (test_unpack.mjs, needing $OM_FW_DIR or $OM_BIN, else counted as a failure),
// the browser player's pure parts, its node host, webgate B6's page inputs on a node Player and its Worker in a node
// worker thread (test_web.mjs), the node host
// over HTTP (test_host.mjs), the image sensor stand-in (test_scene.mjs), the camera application running natively
// (test_camapp.mjs), the SCPU's clock, ports, link pins and sub-CPU model (test_scpu.mjs), the publication audit
// (test_pubaudit.mjs), the HDMI port and a plug in play on E143,
// E146 and E147 (test_hdmi.mjs), the accelerometer's sample and check_level on E146 (test_acc.mjs), the card and the
// file system on E143, E146, E147, E144 and E142 (test_storage.mjs), subject detection's frames on E143
// (test_subject.mjs), the lens on the mount natively on E143 (test_lens.mjs), the SCPU's Cortex-M4 core
// (test_m4.mjs: hand-written vectors, QEMU's recorded vectors, the SCPU image from reset to its first unmodelled
// access), the firmware
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
import { vscClasses, vscRegsHeader, blendTable } from '../test/test_dev.mjs';
import { kickRefusals, refusalControl } from '../test/test_irq.mjs';
import { infra } from '../test/test_infra.mjs';
import { labTests, trimTests } from '../test/test_lab.mjs';
import { checksTests } from '../test/test_checks.mjs';
import { argsTests } from '../test/test_args.mjs';
import { watchUnits, snapshotUnits, protocolUnits, limitUnits, attachUnits } from '../test/test_debug.mjs';
import { unpackTests } from '../test/test_unpack.mjs';
import { shaTests, yccTests, controlsTests, hostApiTests, pageInputsTests, driverTests, bodyTests, resultBoxTests, pageTests, workerTests } from '../test/test_web.mjs';

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
const inf = infra(), hd = vscRegsHeader(), bl = blendTable(), vc = vscClasses(), c3 = cli3();
console.log(`infrastructure: ${inf.checks - inf.bad.length}/${inf.checks}; vsc register tables vs header: ${hd.bad.length ? 'DIFFERENT' : 'identical'}; blend table: ${bl.inputs - bl.bad.length}/${bl.inputs}; vsc-classes: ${vc.names} names, ${vc.bad.length} differences; Stage 1 tooling checks: ${c3.checks - c3.bad.length}/${c3.checks}`);
[...inf.bad, ...hd.bad, ...bl.bad, ...vc.bad, ...c3.bad].forEach((x) => console.log('  ', x));
bad += inf.bad.length + hd.bad.length + bl.bad.length + vc.bad.length + c3.bad.length;
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
const dw = watchUnits(), dsn = snapshotUnits(), dp = protocolUnits(), dl = limitUnits(), dat = attachUnits();
console.log(`debug API: watch units ${dw.checks - dw.bad.length}/${dw.checks}, snapshot units ${dsn.checks - dsn.bad.length}/${dsn.checks}, protocol units ${dp.checks - dp.bad.length}/${dp.checks}, trace-file, watch-log and stderr limits ${dl.checks - dl.bad.length}/${dl.checks}, lab-session and disasm units ${dat.checks - dat.bad.length}/${dat.checks}`);
[...dw.bad, ...dsn.bad, ...dp.bad, ...dl.bad, ...dat.bad].forEach((x) => console.log('  ', x));
bad += dw.bad.length + dsn.bad.length + dp.bad.length + dl.bad.length + dat.bad.length;
const up = await unpackTests(), sh = shaTests(), yc = yccTests(), ct = controlsTests(), dr = await driverTests(), ap = await hostApiTests(), pi = await pageInputsTests();
console.log(`browser player: unpacker (B1) ${up.checks - up.bad.length}/${up.checks}${up.skipped.length ? `, ${up.skipped.length} SKIPPED (no firmware: set OM_FW_DIR or OM_BIN)` : ''}; sha256 (B2) ${sh.checks - sh.bad.length}/${sh.checks}; ycc_to_rgb over 2^24 words (B4) ${yc.checks - yc.bad.length}/${yc.checks}; node host on a Player (B4) ${ap.checks - ap.bad.length}/${ap.checks}; B6's page inputs on a Player ${pi.checks - pi.bad.length}/${pi.checks}; playui rows ${ct.checks - ct.bad.length}/${ct.checks}; driver (B3) ${dr.checks - dr.bad.length}/${dr.checks}`);
[...up.bad, ...up.skipped.map((x) => `SKIPPED ${x}`), ...sh.bad.slice(0, 10), ...yc.bad, ...ap.bad, ...pi.bad, ...ct.bad, ...dr.bad].forEach((x) => console.log('  ', x));
bad += up.bad.length + up.skipped.length + sh.bad.length + yc.bad.length + ap.bad.length + pi.bad.length + ct.bad.length + dr.bad.length;
const pj = bodyTests(), rbx = await resultBoxTests(), pg = await pageTests(), wk = await workerTests();
console.log(`browser player hosts: request bodies ${pj.checks - pj.bad.length}/${pj.checks}; wait_result ${rbx.checks - rbx.bad.length}/${rbx.checks}; page after a stop ${pg.checks - pg.bad.length}/${pg.checks}; Worker in a node worker thread ${wk.checks - wk.bad.length}/${wk.checks}${wk.skipped.length ? `, ${wk.skipped.length} SKIPPED (no firmware: set OM_FW_DIR or OM_BIN)` : ''}`);
[...pj.bad, ...rbx.bad, ...pg.bad, ...wk.bad, ...wk.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
bad += pj.bad.length + rbx.bad.length + pg.bad.length + wk.bad.length + wk.skipped.length;
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
// the camera application running natively (S-CAMAPP and its stand-ins): S1, S2 and the rec view in a play session
{
  const { camappSession } = await import('../test/test_camapp.mjs');
  const ca = await camappSession();
  console.log(`camera application (S-CAMAPP) in play: ${ca.checks - ca.bad.length}/${ca.checks}`);
  ca.bad.forEach((x) => console.log('  ', x));
  bad += ca.bad.length;
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
// the accelerometer: its sample without firmware, then checks/check_level.mjs on E146 in a process of its own (E143's
// runs are checks/runs.json's; the model is fixed when the lab is imported)
{
  const { accUnits } = await import('../test/test_acc.mjs');
  const { spawnSync } = await import('node:child_process');
  const au = accUnits();
  const r = spawnSync(process.execPath, [new URL('../checks/check_level.mjs', import.meta.url).pathname], { env: { ...process.env, OM_EMU_MODEL: 'E146' }, encoding: 'utf8' });
  console.log(`accelerometer: sample units ${au.checks - au.bad.length}/${au.checks}; check_level on E146 ${r.status === 0 ? 'ok' : 'FAILED'}`);
  [...au.bad, ...(r.status === 0 ? [] : (r.stdout + r.stderr).trim().split('\n').map((l) => `E146: ${l.trim()}`))].forEach((x) => console.log('  ', x));
  bad += au.bad.length + (r.status === 0 ? 0 : 1);
}
// the card and the file system (storage.mjs): the card model and the FAT reader without firmware, then play sessions
// whose card the firmware formats and mounts itself: E143 here, and E146, E147, E144 and E142 (the OM-1 family, the
// E144 family and the E142 lineage) each in a process of its own (the model is fixed when the lab is imported)
{
  const { storageUnits, storageSession } = await import('../test/test_storage.mjs');
  const { spawnSync } = await import('node:child_process');
  const su = storageUnits(), ss = await storageSession();
  const others = ['E146', 'E147', 'E144', 'E142'].map((m) => {
    const r = spawnSync(process.execPath, [new URL('../test/test_storage.mjs', import.meta.url).pathname, '--session'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    return [m, r.status, (r.stdout + r.stderr).trim().split('\n').filter((l) => l.startsWith('   ') || r.status !== 0)];
  });
  console.log(`card and file system: card model and FAT reader ${su.checks - su.bad.length}/${su.checks}; in play (E143) ${ss.checks - ss.bad.length}/${ss.checks}; ${others.map(([m, rc]) => `${m} ${rc === 0 ? 'ok' : 'FAILED'}`).join(', ')}`);
  [...su.bad, ...ss.bad, ...others.flatMap(([m, rc, lines]) => (rc === 0 ? [] : lines.map((l) => `${m}: ${l.trim()}`)))].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length + others.filter(([, rc]) => rc !== 0).length;
}
// subject detection's frames (S-SUBJECT): the scene's subject boxes and DISP_FRAME's transform without firmware, then
// a play session on E143 whose DISP_FRAME draws the frames on the scene's rider while the setting names motorsports
{
  const { subjectUnits, subjectSession } = await import('../test/test_subject.mjs');
  const su = subjectUnits(), ss = await subjectSession();
  console.log(`subject frames (S-SUBJECT): boxes and transform ${su.checks - su.bad.length}/${su.checks}; in play ${ss.checks - ss.bad.length}/${ss.checks}`);
  [...su.bad, ...ss.bad].forEach((x) => console.log('  ', x));
  bad += su.bad.length + ss.bad.length;
}
// the camera's non-volatile state kept between sessions (S-NVRAM): no date prompt, a setting kept across sessions
{
  const { nvramSessions } = await import('../test/test_nvram.mjs');
  const nv = await nvramSessions();
  console.log(`non-volatile state (S-NVRAM) across sessions: ${nv.checks - nv.bad.length}/${nv.checks}`);
  nv.bad.forEach((x) => console.log('  ', x));
  bad += nv.bad.length;
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
// the lens on the mount natively: the serial controller, the deferred-call triggers, S-LENSMCU, the driver's start
{
  const { lensUnits, lensSession } = await import('../test/test_lens.mjs');
  const lu = lensUnits(), ls = await lensSession();
  console.log(`the native lens: units ${lu.checks - lu.bad.length}/${lu.checks}; in play ${ls.checks - ls.bad.length}/${ls.checks}`);
  [...lu.bad, ...ls.bad].forEach((x) => console.log('  ', x));
  bad += lu.bad.length + ls.bad.length;
}
// the SCPU's Cortex-M4 core: hand-written vectors, QEMU's recorded vectors, the SCPU image from its reset vector
{
  const { m4Units, m4Vectors, m4Firmware } = await import('../test/test_m4.mjs');
  const mu = m4Units(), mv = m4Vectors(), mf = m4Firmware();
  console.log(`Cortex-M4 core: units ${mu.checks - mu.bad.length}/${mu.checks}; QEMU vectors ${mv.checks - mv.bad.length}/${mv.checks}; the SCPU image from reset ${mf.checks - mf.bad.length}/${mf.checks}${mf.skipped.length ? `, ${mf.skipped.length} SKIPPED (no E143 SCPU block)` : ''}`);
  [...mu.bad, ...mv.bad.slice(0, 20), ...mf.bad, ...mf.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  bad += mu.bad.length + mv.bad.length + mf.bad.length + mf.skipped.length;
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
