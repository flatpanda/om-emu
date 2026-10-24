#!/usr/bin/env node
// check_perf's play workload on the JS Player, with no calls file: play_workload(PLAY_SCRIPT) without check_perf's own
// instruments (packet counter, CPU-time readers, the --detail PNG check), which touch no lab state. The play loop's lab
// work with --idle off: idle phases run 50 ms slices of lab time with frames published as the play loop publishes them,
// key phases press and release. --a15 stays auto, the play loop's default: the camera application leaves the TFT
// channel's CTRL3 at 0x41, which the composite refuses (FEATURE_UNOBSERVED) unless A15 applies, so with --a15 off no
// frame is ever published. Prints one JSON line:
// the phases (name, wall seconds, lab ns, continues + steps, instructions), startup, the frame shas, lab_ns, hook_log and
// the workload digest (scenarios/session_replay.mjs workloadDigest: the sha256 of the spaced JSON of [frames, lab time,
// hook-log length, GUI state, the last 2,000 hook-log entries], first 16 hex digits). Exit 1 when the digest is not a981d0a3041b1d55 (pinned).
//   node emu/bin/playperf.mjs [--slice N] [--dump FILE (the JSON that is hashed)]
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { loadImage, loadBlock } from './run.mjs';
import { Player } from '../src/lab/player.mjs';
import { PLAYER_PARSER, WORKLOAD_DIGEST, workloadText } from '../scenarios/session_replay.mjs';
import { show } from '../src/util/show.mjs';
import { coverageEnv } from '../checks/lib/coverage.mjs';

export const PLAY_SCRIPT = [['shoot 3 s lab', 'idle', 3000], ['MENU open', 'key', 'menu'], ['menu 2 s lab', 'idle', 2000],
  ['MENU close', 'key', 'menu'], ['OK -> SCP', 'key', 'ok'], ['SCP 2 s lab', 'idle', 2000], ['MENU close', 'key', 'menu']];

// opts: onPublish(player) after every published frame (check_perf P10b's frame check), detail: add the hook log, the
// stand-in counters and the idle, elapse and settle logs (the keys check_perf P10b compares).
export function playWorkload(env, script = PLAY_SCRIPT, { onPublish = null, detail = false } = {}) {
  const wall = () => performance.now() / 1000;
  // the Player's defaults with --no-browser --idle off --a15 auto, and no wait on an error
  const a = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'auto', out: '<out>', no_wait_on_error: true };
  const pl = new Player(a, { ...env, wallClock: wall });
  const res = { phases: [], frames: [] };
  const t0 = performance.now();
  pl.open_session();
  res.startup = Math.round(performance.now() - t0) / 1000;
  const s = pl.session, st = () => s.lab.sim.m.stats;
  const published = () => { res.frames.push(pl.frame ? pl.frame[3] : null); if (onPublish) onPublish(pl); };
  let seq = 0;
  try {
    for (const [name, kind, arg] of script) {
      const w0 = performance.now(), l0 = s.lab.lab_time(), c0 = st().conts + st().steps, i0 = st().insns;
      if (kind === 'idle') {
        for (let k = 0; k < Math.floor(arg / 50); k++) {
          const m = pl.marks();
          s.idle_slice(s.lab.lab_time() + 50000000);
          pl.after_lab_time(m);
          published();
        }
      } else {
        for (const action of ['down', 'up']) {
          seq += 1;
          pl.apply({ type: 'key', id: arg, action, seq, t_wall: wall() });
          if (pl.error) throw new Error(`play workload: ${JSON.stringify(pl.error).slice(0, 2000)}`);
          published();
        }
      }
      res.phases.push({ name, wall: Math.round(performance.now() - w0) / 1000, lab_ns: s.lab.lab_time() - l0, stops: st().conts + st().steps - c0, insns: st().insns - i0 });
    }
    const lab = s.lab;
    res.hashed = workloadText(res.frames, lab);
    res.digest = createHash('sha256').update(res.hashed).digest('hex').slice(0, 16);
    res.lab_ns = lab.lab_time();
    res.hook_log = lab.log.length;
    if (detail) {
      res.log = lab.log.map(String);
      res.stub_hits = [...lab.stub_hits.entries()].map(([k, v]) => [String(k), v]).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
      res.elapse_log = show(lab.lt.elapse_log);
      res.settle_log = show(lab.lt.settle_log);
      res.idle_events = [...lab.lt.idle_events];
    }
  } finally {
    pl.close_session();
  }
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  let slice, dump = null;
  const usage = (why) => { console.error(`playperf.mjs: ${why}\nusage: node emu/bin/playperf.mjs [--slice N] [--dump FILE]`); process.exit(2); };
  for (let i = 0; i < argv.length; i++) {          // refused as run.mjs refuses them: a bad slice never runs unsliced
    if (argv[i] === '--slice') {
      slice = Number(argv[++i]);
      if (!Number.isInteger(slice) || slice < 1) usage(`--slice ${argv[i]}: a positive instruction count`);
    } else if (argv[i] === '--dump') {
      dump = argv[++i];
      if (dump === undefined || dump.startsWith('--')) usage('--dump FILE: a file is required');
    } else usage(`unknown argument ${argv[i]}`);
  }
  const load = os.loadavg()[0];
  const t0 = performance.now();
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, ...(slice !== undefined ? { slice } : {}), ...coverageEnv() };
  const res = playWorkload(env);
  const { hashed, ...shown } = res;
  if (dump) fs.writeFileSync(dump, hashed);
  shown.phase_sum = Math.round(res.phases.reduce((x, p) => x + p.wall * 1000, 0)) / 1000;
  shown.process_s = Math.round(performance.now() - t0) / 1000;
  shown.slice = slice ?? null;
  shown.load = load;
  console.log(JSON.stringify(shown));
  if (res.digest !== WORKLOAD_DIGEST) {
    console.error(`playperf: workload digest ${res.digest}, want ${WORKLOAD_DIGEST} (hashed JSON ${hashed.length} chars${dump ? ` in ${dump}` : ''})`);
    process.exitCode = 1;
  }
}
