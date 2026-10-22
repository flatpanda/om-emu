#!/usr/bin/env node
// Measurements M1 (interpreter MIPS on real code) and M2 (cost per stop), tracing off. Every pass must do what pass 0
// did: the same labs, the scenario's own checks passing, the same outcome digests of the replayed calls, and per lab
// the same final g_digest (the 'g' register reads) and harness digest (the harness's 'G' writes and Simulator.write
// data). It does not compare the event stream; bin/golden.mjs does.
//   node emu/bin/bench.mjs kernel|osd|<stage1 or stage2 scenario> [--passes N (>= 3, default 10)] [--json FILE]
//                            [--calls DIR (default emu/scenarios/calls)] [--slice N]
// Stage 1 scenarios: shoot-tft, shoot-evf, menu-tft, nav-a, nav-evf; Stage 2: play-perf and the other Player-boundary
// scenarios (run.mjs's group stage2); both replayed from DIR/<scenario>.calls.json (osd: its inputs generated before
// pass 0, bin/run.mjs osdDoc).
// A pass that differs from pass 0 makes the exit status 1: MIPS of a run that is not repeatable are not a measurement.
// Each pass runs the whole scenario on fresh machines (createMachine per session) in this process; pass 0 has V8
// cold. MIPS = insns / (guest ms - engine ms - compose ms) (guest: time inside continue/step; engine: the OSD engine's
// command execution inside a CPU store; compose: the VSC's COMPOSE inside the doorbell store). For a Stage 1 or 2
// scenario the figures are also split at the end of the session's __enter__ or the Player's open_session (the bring-up)
// and the remaining calls; a --replay scenario (scp-replay, power-replay) opens its session inside player.run and has
// no split. Per stop:
// (wall - guest ms - createMachine ms - replay checks) / stops, where stops = continues + steps: the harness, the HLE
// stubs and the machine API around the guest; setup (image and resource block read, call_frames index, resource
// decode) and the replays' own outcome normalisation are reported apart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runScenarios, osdDoc, loadImage, loadBlock, CALLS_DIR, STAGE1, STAGE2 } from './run.mjs';
import { callFrames } from '../src/lab/hle.mjs';
import { blobs, languages } from '../src/lab/resources.mjs';
import { SESSIONS } from '../scenarios/kernel.mjs';

const args = process.argv.slice(2);
const which = args[0];
const passes = args.includes('--passes') ? +args[args.indexOf('--passes') + 1] : 10;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const calls = args.includes('--calls') ? path.resolve(args[args.indexOf('--calls') + 1]) : CALLS_DIR;
const slice = args.includes('--slice') ? +args[args.indexOf('--slice') + 1] : undefined;
const names = which === 'kernel' ? SESSIONS : which === 'osd' ? ['osd'] : STAGE1.includes(which) || STAGE2.includes(which) ? [which] : null;
if (!names) { console.error(`usage: bench.mjs kernel|osd|${[...STAGE1, ...STAGE2].join('|')} [--passes N] [--json FILE] [--calls DIR] [--slice N]`); process.exit(2); }
// The steady statistics are passes 2.. (passes 0 and 1 are V8 warm-up): fewer than 3 passes leave no steady set.
if (!Number.isInteger(passes) || passes < 3) { console.error(`bench.mjs: --passes must be an integer >= 3 (passes 2.. are the steady set), got ${args[args.indexOf('--passes') + 1]}`); process.exit(2); }
if (slice !== undefined && !(Number.isInteger(slice) && slice >= 1)) { console.error('bench.mjs: --slice N: a positive instruction count'); process.exit(2); }
const stage1 = STAGE1.includes(which) || STAGE2.includes(which);      // a replayed session scenario: bring-up / rest split
// pass 0's labs, digests and outcome count: every pass must repeat them
let first = null;

const load0 = os.loadavg()[0];
let t = performance.now();
const rom = loadImage();
const resBlock = stage1 ? loadBlock() : undefined;
const imageMs = performance.now() - t;
t = performance.now();
callFrames(rom);
const indexMs = performance.now() - t;
t = performance.now();
if (stage1) { blobs(resBlock); languages(rom, resBlock); }
const resourceMs = performance.now() - t;
if (which === 'osd') await osdDoc(calls);       // generated outside the passes (setup, not measured)
const KEYS = ['insns', 'guestMs', 'engineMs', 'composeMs', 'conts', 'steps', 'longInsns', 'longMs', 'longEngineMs', 'createMs'];
const rows = [];
for (let p = 0; p < passes; p++) {
  const w0 = performance.now();
  const replayStats = { checkMs: 0 };
  let current = null, split = null;
  const onSession = (s) => { current = s; };
  // the end of the bring-up: the first action after the first __enter__ (Stage 1) or open_session (Stage 2). A --replay
  // session opens inside player.run, so it has no such boundary and no bring-up/rest split.
  let entered = false;
  const onAction = (i, act) => {
    if (entered && split === null && current) split = { wall: performance.now() - w0, check: replayStats.checkMs, ...Object.fromEntries(KEYS.map((k) => [k, current.hle.sim.m.stats[k]])) };
    if (act && (act[2] === '__enter__' || act[2] === 'open_session')) entered = true;
  };
  const { sessions, rc } = await runScenarios(names, { rom, resBlock, trace: false, replayStats, onSession, onAction, slice, calls });
  const wall = performance.now() - w0;
  const sum = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const s of sessions) for (const k of KEYS) sum[k] += s.hle.sim.m.stats[k];
  const did = JSON.stringify({ rc, outcomes: replayStats.outcomes ?? [], labs: sessions.map((s) => [s.name, s.final.g_digest, s.final.harness_sha]) });
  first ??= did;
  const parity = rc === 0 && did === first;
  const stops = sum.conts + sum.steps;
  const mips = (x) => x.insns / (x.guestMs - x.engineMs - x.composeMs) / 1e3;
  const row = { pass: p, wall, ...sum, stops, parity, replayCheckMs: replayStats.checkMs,
    mips: mips(sum), mipsWithEngine: sum.insns / sum.guestMs / 1e3,
    mipsLong: sum.longInsns / (sum.longMs - sum.longEngineMs) / 1e3,
    usPerStop: (wall - sum.guestMs - sum.createMs - replayStats.checkMs) * 1e3 / stops };
  if (stage1 && split) {
    const rest = Object.fromEntries(KEYS.map((k) => [k, sum[k] - split[k]]));
    row.enter = { wall: split.wall, insns: split.insns, mips: mips(split), stops: split.conts + split.steps,
      usPerStop: (split.wall - split.guestMs - split.createMs - split.check) * 1e3 / (split.conts + split.steps) };
    const restWall = wall - split.wall, restCheck = replayStats.checkMs - split.check;
    row.rest = { wall: restWall, insns: rest.insns, mips: mips(rest), stops: rest.conts + rest.steps, composeMs: rest.composeMs,
      usPerStop: (restWall - rest.guestMs - restCheck) * 1e3 / (rest.conts + rest.steps) };
  }
  rows.push(row);
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const steady = rows.slice(2);
const hasSplit = stage1 && rows.every((r) => r.enter);
const stat = (f) => ({ median: median(steady.map(f)), min: Math.min(...steady.map(f)), max: Math.max(...steady.map(f)) });
const result = { scenario: which, node: process.version, slice: slice ?? null, load1_start: load0, load1_end: os.loadavg()[0], imageMs, indexMs, resourceMs, passes: rows,
  steady: { mips: stat((r) => r.mips), mipsWithEngine: stat((r) => r.mipsWithEngine), mipsLong: stat((r) => r.mipsLong), usPerStop: stat((r) => r.usPerStop),
    wall: stat((r) => r.wall), composeMs: stat((r) => r.composeMs), createMs: stat((r) => r.createMs),
    ...(hasSplit ? { enterMips: stat((r) => r.enter.mips), restMips: stat((r) => r.rest.mips), enterUsPerStop: stat((r) => r.enter.usPerStop),
      restUsPerStop: stat((r) => r.rest.usPerStop) } : {}) },
  repeatsPass0: rows.every((r) => r.parity) };
const f = (v, d = 1) => v.toFixed(d);
console.log(`${which}: node ${process.version}, load ${f(load0, 2)} -> ${f(os.loadavg()[0], 2)}; image read ${f(imageMs, 0)} ms, call_frames index ${f(indexMs, 0)} ms${stage1 ? `, resource decode ${f(resourceMs, 0)} ms` : ''}${slice ? `; slices of ${slice} instructions` : ''}`);
for (const r of rows) {
  console.log(`  pass ${r.pass}: wall ${f(r.wall, 0)} ms, guest ${f(r.guestMs, 0)} ms (engine ${f(r.engineMs, 1)}, compose ${f(r.composeMs, 1)}), insns ${r.insns}, stops ${r.stops}, ` +
    `MIPS ${f(r.mips)} (with engine ${f(r.mipsWithEngine)}, long continues ${f(r.mipsLong)}), ${f(r.usPerStop)} us/stop, ` +
    `createMachine ${f(r.createMs, 1)} ms, replay checks ${f(r.replayCheckMs, 1)} ms, digests ${r.parity ? 'ok' : 'DIFFERENT'}` +
    (r.enter ? `; bring-up ${f(r.enter.wall, 0)} ms ${f(r.enter.mips)} MIPS ${f(r.enter.usPerStop)} us/stop, rest ${f(r.rest.wall, 0)} ms ${f(r.rest.mips)} MIPS ${f(r.rest.usPerStop)} us/stop` : ''));
}
const s = result.steady;
console.log(`  passes 2-${passes - 1}: MIPS median ${f(s.mips.median)} [${f(s.mips.min)}..${f(s.mips.max)}], with engine ${f(s.mipsWithEngine.median)}, ` +
  `long continues ${f(s.mipsLong.median)}; ${f(s.usPerStop.median)} us/stop [${f(s.usPerStop.min)}..${f(s.usPerStop.max)}]; wall ${f(s.wall.median, 0)} ms; ` +
  (hasSplit ? `bring-up ${f(s.enterMips.median)} MIPS ${f(s.enterUsPerStop.median)} us/stop, rest ${f(s.restMips.median)} MIPS ${f(s.restUsPerStop.median)} us/stop; compose ${f(s.composeMs.median, 0)} ms; ` : stage1 ? 'no bring-up split (the session opens inside player.run); ' : '') +
  `${result.repeatsPass0 ? 'every pass repeats pass 0' : 'a pass differs from pass 0: FAILED'}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1));
if (!result.repeatsPass0) process.exitCode = 1;
