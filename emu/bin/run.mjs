#!/usr/bin/env node
// Run the Stage 0, 1, 2 and 3 scenarios on the JS lab.
//   node emu/bin/run.mjs <scenario|group> ... [--trace DIR] [--calls DIR] [--time] [--slice N]
// Scenarios: kernel-1, kernel-5b, kernel-5c, kernel-6, kernel-7, kernel-7b, osd, shoot-tft, shoot-evf, menu-tft, nav-a,
// nav-evf, Stage 2's play-perf, scp-timeout, scp-edge, evf-idle, eye-burn, switch-shoot, switch-scp, inputs, a15-open,
// queue, power, scp-replay, keys, b7-gate, power-replay, tokens, playback, tokens-3b, and Stage 3's menu-open and menu-open-any
// (check_irq I4's menu session, gate mode 1 and 2; replayed like Stage 1's). Groups: kernel = the six check_kernel
// sessions, stage0 = kernel + osd, stage1 = the five Stage 1 scenarios, stage2 = the nineteen Stage 2 scenarios,
// stage3 = the two Stage 3 scenarios, all = all four (the default, 37 labs). A Stage 2 scenario is a Player session replayed from its calls file at the Player boundary
// (scenarios/session_replay.mjs); it can open more than one lab, traced as NAME, NAME#2, NAME#3 (the calls file's labs).
// The Stage 1, 2 and 3 scenarios replay their inputs, DIR/<scenario>.calls.json (--calls DIR, default
// emu/scenarios/calls: each session's recorded calls, without their outcomes); the osd scenario replays
// DIR/osd.calls.json when there is one, else the inputs checks/lib/osdcalls.mjs generates from the JS check_osd. Each
// replayed call's outcome digest is written into the trace (replay.outcomes), where bin/golden.mjs records it.
// --trace DIR: write DIR/<lab>.json (format om1-stage0-ref/2 for Stage 0, om1-stage0-ref/4 for Stages 1 and 2).
//              DIR/<lab>.json, .partial.json and .divergence.json of every requested scenario (every NAME#k of a
//              Stage 2 one) are removed before anything runs, so a scenario that fails leaves no trace of an earlier
//              run. DIR is required: a missing one, or a flag, scenario or group in its place ('--trace --time'), is
//              refused with exit 2.
// --time: wall time, guest/engine/compose time and the machine stats per scenario (tracing off unless --trace).
// --slice N: every continue runs in slices of N instructions (machine cont/resume; Simulator env.slice). The stops,
//            interrupt looks and traces must be the same as unsliced (gate A1).
// A scenario that throws (FirmwareError, Unported, inputs the replayer cannot drive, a bug) is reported, the
// remaining scenarios still run, and with --trace its partial trace is written to DIR/<lab>.partial.json. The throw
// is written to <out>/<lab>.divergence.json (<out>: the --trace DIR, else emu/out/js) and makes the exit status 1,
// as does a scenario whose own checks fail (rc != 0).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { checkImage, checkBlock } from '../checks/lib/env.mjs';
import { expandImage } from '../src/fw/expand.mjs';
import { MODEL_INFO } from '../src/fw/model.mjs';
import { romPath, resPath } from '../src/fw/models.mjs';
import { Session, dump, logical, inventory, fmtOf, FORMAT4, STAGE2_SCENARIOS, STAGE3_SCENARIOS } from '../src/trace/tracer.mjs';
import * as K from '../scenarios/kernel.mjs';
import { R, S, PC } from '../src/core/cpu.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const IMAGE = path.join(REPO, romPath(MODEL_INFO));
const KERNEL = K.SESSIONS;
const STAGE0 = [...KERNEL, 'osd'];
// Stage 3 scenarios are replayed like Stage 1's (inputs format om-emu-session-inputs/1, one lab each).
export const STAGE1 = ['shoot-tft', 'shoot-evf', 'menu-tft', 'nav-a', 'nav-evf', ...STAGE3_SCENARIOS];
export const STAGE3 = STAGE3_SCENARIOS;
const STAGE1_ONLY = STAGE1.filter((n) => !STAGE3.includes(n));
export const STAGE2 = STAGE2_SCENARIOS;
const ALL = [...STAGE0, ...STAGE1_ONLY, ...STAGE2, ...STAGE3];
const GROUPS = { all: ALL, kernel: KERNEL, stage0: STAGE0, stage1: STAGE1_ONLY, stage2: STAGE2, stage3: STAGE3 };
// The trace names of a scenario's labs: Stage 2 sessions can open more than one (NAME#2, NAME#3, ...: the calls file's
// `labs`); every other scenario has one.
export function labsOf(n, ref = CALLS_DIR) {
  if (!STAGE2.includes(n)) return [n];
  return JSON.parse(fs.readFileSync(path.join(ref, `${n}.calls.json`), 'utf8')).labs;
}

export const CALLS_DIR = path.join(REPO, 'emu/scenarios/calls');
const CALLS = new Map();       // calls file path -> parsed document, parsed once per process
const BLOCK = path.join(REPO, resPath(MODEL_INFO));
export function loadImage() { return expandImage(checkImage(new Uint8Array(fs.readFileSync(IMAGE)), IMAGE)); }   // the run-time image (src/fw/expand.mjs)
export function loadBlock() { return checkBlock(new Uint8Array(fs.readFileSync(BLOCK)), BLOCK); }
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// Run scenario names; returns { sessions: [Session], rc, stdout }. calls: the directory of the inputs (default
// emu/scenarios/calls): the replayed scenarios read <calls>/<scenario>.calls.json (scenarios/session_replay.mjs), osd
// <calls>/osd.calls.json or, without one, the generated inputs (osdInputs). onSession(session) is called as each
// session begins (a caller that must see a session's partial trace after a throw collects them there). resBlock: the
// resource block (loaded on first use when not given).
export async function runScenarios(names, { rom, resBlock, trace = false, onSession = null, onAction = null, clock, replayStats, slice, calls = CALLS_DIR } = {}) {
  const sessions = [];
  const stdout = [];
  let pending = null, current = null;
  const env = {
    rom, createHash, ...(clock ? { clock } : {}), ...(replayStats ? { replayStats } : {}), ...(slice ? { slice } : {}),
    // the WINDOWS token's zlib (level 6) and the replay's inflate of its 'z' fields (scenarios/session_replay.mjs)
    deflate: (b, level) => new Uint8Array(zlib.deflateSync(b, { level })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)),
    ...(onAction ? { onAction } : {}),
    sessionName(n) { pending = n; },          // a name, or the names of a session's labs in order (Stage 2)
    currentSession() { return current; },
    beginSession() {
      const name = Array.isArray(pending) ? pending.shift() : pending;
      if (name === undefined) throw new Error('run.mjs: a lab beyond the names given for the scenario');
      current = new Session(name, createHash, trace);
      sessions.push(current);
      if (onSession) onSession(current);
      return current;
    },
    mark(label) { if (current.tracer) current.tracer.events.push(['mark', label, { devices: current.tracer.devices() }]); },
    check(group, label, got, want, ok) { if (current.tracer) current.tracer.events.push(['check', group, label, got, want, ok]); },
    print(line) { stdout.push(line); },
  };
  let rc = 0;
  const kernel = names.filter((n) => KERNEL.includes(n));
  if (kernel.length) rc |= K.main(env, kernel);
  if (names.includes('osd')) {
    const O = await import('../scenarios/osd_replay.mjs');
    env.sessionName('osd');
    rc |= O.replay(env, await osdDoc(calls));
  }
  const replayed = names.filter((n) => STAGE1.includes(n) || STAGE2.includes(n));
  if (replayed.length) {
    const S1 = await import('../scenarios/session_replay.mjs');
    env.resBlock = resBlock ?? loadBlock();
    for (const n of replayed) {
      const file = path.join(calls, `${n}.calls.json`);
      if (!CALLS.has(file)) CALLS.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
      env.sessionName(STAGE2.includes(n) ? [n, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${n}#${k}`)] : n);
      rc |= S1.replay(env, CALLS.get(file));
    }
  }
  return { sessions, rc, stdout };
}
// the osd scenario's inputs: dir/osd.calls.json, else the ones generated from check_osd (once per process)
export async function osdDoc(dir = CALLS_DIR) {
  const file = path.join(dir, 'osd.calls.json');
  if (fs.existsSync(file)) {
    if (!CALLS.has(file)) CALLS.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
    return CALLS.get(file);
  }
  const { osdInputs } = await import('../checks/lib/osdcalls.mjs');
  return osdInputs();
}

class UsageError extends Error {}
export function parseArgs(argv) {
  const a = { names: [], trace: null, calls: CALLS_DIR, time: false, slice: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--trace') {
      // a directory is required: '--trace --time' must not take '--time' as the directory
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || ALL.includes(v) || Object.hasOwn(GROUPS, v)) throw new UsageError(`--trace DIR: a directory is required${v === undefined ? '' : `, got ${v}`}`);
      a.trace = argv[++i];
    }
    else if (x === '--calls') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || ALL.includes(v) || Object.hasOwn(GROUPS, v)) throw new UsageError(`--calls DIR: a directory is required${v === undefined ? '' : `, got ${v}`}`);
      a.calls = argv[++i];
    }
    else if (x === '--time') a.time = true;
    else if (x === '--slice') {
      a.slice = Number(argv[++i]);
      if (!Number.isInteger(a.slice) || a.slice < 1) throw new UsageError(`--slice ${argv[i]}: a positive instruction count`);
    } else if (Object.hasOwn(GROUPS, x)) a.names.push(...GROUPS[x]);
    else if (ALL.includes(x)) a.names.push(x);
    else throw new UsageError(`unknown argument ${x}`);
  }
  if (!a.names.length) a.names = ALL;
  return a;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`run.mjs: ${e.message}`);
    process.exit(2);
  }
  const load = os.loadavg()[0].toFixed(2);
  const t0 = performance.now();
  const rom = loadImage();
  const resBlock = args.names.some((n) => STAGE1.includes(n) || STAGE2.includes(n)) ? loadBlock() : null;
  const tImage = performance.now() - t0;
  const env = { head: '', emu: true, node: process.version };
  try { env.head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no git */ }
  // the inputs the replayed scenarios read (osd's are generated when the directory has none)
  for (const n of args.names.filter((x) => STAGE1.includes(x) || STAGE2.includes(x))) {
    const c = path.join(args.calls, `${n}.calls.json`);
    if (!fs.existsSync(c)) { console.error(`${n}: no inputs ${c}`); process.exit(2); }
  }
  const calls = args.calls;
  const trace = !!args.trace;
  const out = args.trace ?? path.join(REPO, 'emu/out/js');
  // Stale results of an earlier run must not survive a failed one.
  for (const n of args.names) {
    const labs = STAGE2.includes(n) ? [n, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${n}#${k}`)] : [n];
    for (const lab of labs) {
      for (const f of [path.join(out, `${lab}.divergence.json`), ...(args.trace ? [path.join(args.trace, `${lab}.json`), path.join(args.trace, `${lab}.partial.json`)] : [])]) fs.rmSync(f, { force: true });
    }
  }
  const res = [];
  for (const name of args.names) {
    const w0 = performance.now();
    let sessions, rc, stdout;
    const begun = [], replayStats = { checkMs: 0 };
    try {
      ({ sessions, rc, stdout } = await runScenarios([name], { rom, resBlock, trace, calls, slice: args.slice, replayStats, onSession: (s) => begun.push(s) }));
    } catch (e) {
      thrown(name, e, begun.at(-1) ?? null, args, out, env);
      process.exitCode = 1;
      continue;
    }
    const wall = performance.now() - w0;
    if (rc !== 0) { console.log(`${name}: the scenario's own checks failed (rc ${rc})`); process.exitCode = 1; }
    for (const s of sessions) {
      const st = s.hle.sim.m.stats;
      res.push({ name: s.name, wall, rc, st, final: s.tracer ? s.tracer.final : s.final });
      if (args.trace) {
        fs.mkdirSync(args.trace, { recursive: true });
        const doc = dump(s.tracer, createHash, { source: name === 'osd' ? 'emu/scenarios/osd_replay.mjs' : STAGE1.includes(name) || STAGE2.includes(name) ? 'emu/scenarios/session_replay.mjs' : 'emu/scenarios/kernel.mjs main()', rc, env, stdout });
        if (name === 'osd' || STAGE1.includes(name) || STAGE2.includes(name)) doc.replay = { outcomes: replayStats.outcomes ?? [] };
        fs.writeFileSync(path.join(args.trace, `${s.name}.json`), JSON.stringify(doc));
      }
    }
  }
  if (args.time || !args.trace) {
    console.log(`load ${load}; image read ${tImage.toFixed(0)} ms${args.slice ? `; slices of ${args.slice} instructions` : ''}`);
    for (const r of res) {
      const st = r.st;
      console.log(`${r.name.padEnd(10)} wall ${r.wall.toFixed(0)} ms (scenario), guest ${st.guestMs.toFixed(1)} ms, engine ${st.engineMs.toFixed(1)} ms, compose ${st.composeMs.toFixed(1)} ms, insns ${st.insns}, conts ${st.conts}, steps ${st.steps}, MIPS ${(st.insns / (st.guestMs - st.engineMs - st.composeMs) / 1e3).toFixed(1)}; g_count ${r.final.stats ? r.final.stats.g_count : r.final.g_count} g_digest ${(r.final.stats ? r.final.stats.g_digest : r.final.g_digest).slice(0, 16)} insns(stat) ${(r.final.stats ?? r.final).insns}`);
    }
  }
}

// A scenario threw: report it, write its partial trace (with --trace) and the throw.
function thrown(name, e, session, args, out, env) {
  const isDiv = e.constructor.name === 'Divergence';
  const exception = { class: e.constructor.name, message: e.message, ...(isDiv ? { step: e.method, seq: e.seq, js: e.got, ref: e.want } : { stack: e.stack }) };
  const tr = session?.tracer ?? null;
  if (tr && args.trace) {
    fs.mkdirSync(args.trace, { recursive: true });
    fs.writeFileSync(path.join(args.trace, `${session.name}.partial.json`), JSON.stringify(dump(tr, createHash, { source: 'partial: the session threw', rc: null, env, stdout: [] })));
  }
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${name}.divergence.json`);
  fs.writeFileSync(file, JSON.stringify({ scenario: name, session: session?.name ?? null, exception,
    events_before_throw: tr ? tr.events.length : null,
    cpu: { pc: R[PC] >>> 0, insns: S.insns, irqRequested: S.irqReq, irqWait: S.irqWait } }, null, 1));
  const head = isDiv ? `DIVERGES (replay) ${e.message.split('\n')[0]}` : `THREW ${exception.class}: ${e.message.split('\n')[0]}`;
  console.log(`${name}: ${head}`);
  console.log(`  -> ${file}`);
}

// CPU and interrupt-controller state for a divergence report (debugger reads: no side effects). The scenario has run to
// its end by then (the comparator runs after the session): first-divergence evidence is the event context above.
function machineState(tr) {
  const u32 = (a) => { const b = tr.sim.m.dbgRead(a, 4); return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; };
  if (!tr.sim) return null;
  try { u32(0x89A00008); } catch (e) { return { unreadable: String(e.message) }; }   // e.g. a session that threw in setup
  return { pc: R[PC] >>> 0, insns: S.insns, irqRequested: S.irqReq, irqWait: S.irqWait,
    intc: { gate: [u32(0x89A00008), u32(0x89A0000C)], request: u32(0x89A00018), level_mask: u32(0x89A0001C) } };
}
// The fields of two 'compose' events that differ: scalars, header fields, planes, the first
// differing error and note record, pixels.
function composeDiff(a, b) {
  const out = [], j = (v) => JSON.stringify(v ?? null);
  for (const k of ['device', 'next_frame', 'status', 'error_total', 'note_total']) if (j(a[k]) !== j(b[k])) out.push(`${k}: ${j(a[k])} != ${j(b[k])}`);
  for (const part of ['header', 'planes']) {
    for (const k of [...new Set([...Object.keys(a[part] ?? {}), ...Object.keys(b[part] ?? {})])].sort()) {
      if (j(a[part]?.[k]) !== j(b[part]?.[k])) out.push(`${part}.${k}: ${j(a[part]?.[k])} != ${j(b[part]?.[k])}`);
    }
  }
  for (const key of ['errors', 'notes']) {
    const xs = a[key] ?? [], ys = b[key] ?? [];
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      if (j(xs[i]) !== j(ys[i])) { out.push(`${key}[${i}] (of ${xs.length} / ${ys.length}): ${j(xs[i])} != ${j(ys[i])}`); break; }
    }
  }
  if (j(a.pixels) !== j(b.pixels)) out.push(`pixels: ${j(a.pixels)} != ${j(b.pixels)}`);
  return out;
}
// The path of the first differing element of two JSON values (dict keys in order, then list
// indices) with both values there, or null.
export function firstPath(a, b, p = '') {
  const j = (v) => JSON.stringify(v ?? null);
  if (j(a) === j(b)) return null;
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (obj(a) && obj(b)) {
    for (const k of [...Object.keys(a), ...Object.keys(b).filter((k) => !Object.hasOwn(a, k))]) {
      const d = firstPath(a[k], b[k], p ? `${p}.${k}` : k);
      if (d) return d;
    }
    return null;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = firstPath(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  return [p || '<value>', a ?? null, b ?? null];
}
const pathLine = (a, b) => { const d = firstPath(a, b); return d ? `${d[0]}: ${JSON.stringify(d[1])} != ${JSON.stringify(d[2])}` : null; };
// The comparator: the logical view of both event streams, then the finals. prefix: tr is the partial trace of a
// session that threw; only its own events are compared (a JS stream that ends early is not a difference), and when
// they all equal the reference's, the result is the place where the events stream stopped (index = its length).
export function firstDivergence(ref, tr, prefix = false) {
  const [sa, pa, aa] = logical(ref.events), [sb, pb, ab] = logical(tr.events);
  for (const [stream, xs, ys] of [['events', sa, sb], ['irq presented', pa, pb], ['irq accepted', aa, ab]]) {
    for (let k = 0; k < (prefix ? ys.length : Math.max(xs.length, ys.length)); k++) {
      if (JSON.stringify(xs[k]) !== JSON.stringify(ys[k])) {
        const before = ys.slice(0, k);
        const last = (kind) => before.filter((e) => e[0] === kind).slice(-1)[0] ?? null;
        const kind = xs[k]?.[0] === ys[k]?.[0] ? xs[k]?.[0] : null;
        const fields = kind === 'compose' ? composeDiff(xs[k][1], ys[k][1])
          : kind === 'dstep' || kind === 'dnote' ? [pathLine(xs[k][1], ys[k][1])] : kind === 'mark' ? [pathLine(xs[k].slice(1), ys[k].slice(1))] : undefined;
        return { stream, index: k, of: [xs.length, ys.length], ...(fields ? { kind, fields } : {}), ref: xs[k] ?? null, js: ys[k] ?? null,
          js_last_stops: before.filter((e) => e[0] === 'stop').slice(-8), last_mark: last('mark')?.[1] ?? null,
          last_check: last('check')?.slice(1, 3) ?? null, state_at_end: machineState(tr) };
      }
    }
  }
  if (prefix) return { stream: 'events', index: sb.length, of: [sa.length, sb.length], ref: sa[sb.length] ?? null, js: null, state_at_end: machineState(tr) };
  const fa = ref.final, fb = { ...tr.final, devices: tr.final_devices, planes: tr.final_planes, ...(tr.fmt4 ? { lab: tr.final_lab } : {}) };
  for (const key of ['regs', 'log_len', 'log_sha', 'harness_sha', 'devices', 'planes', 'lab']) {
    if (JSON.stringify(fa[key]) !== JSON.stringify(fb[key])) {
      return { stream: 'final.' + key, index: 0, ref: fa[key], js: fb[key], ...(key === 'devices' || key === 'lab' ? { kind: 'final.' + key, fields: [pathLine(fa[key], fb[key])] } : {}) };
    }
  }
  for (const key of ['insns', 'g_count', 'g_digest']) {
    if (fa.stats[key] !== fb.stats[key]) return { stream: 'final.stats.' + key, index: 0, ref: fa.stats[key], js: fb.stats[key] };
  }
  if (ref.format !== tr.fmt) return { stream: 'format', index: 0, ref: ref.format, js: tr.fmt };
  if (tr.fmt4) {
    // format /4 extras: counts.composes, dsteps, dnotes and the inventory (hooks, stub_hits)
    for (const kind of ['compose', 'dstep', 'dnote']) {
      const key = kind + 's', n = tr.events.filter((e) => e[0] === kind).length;
      if (ref.counts[key] !== n) return { stream: 'counts.' + key, index: 0, ref: ref.counts[key] ?? null, js: n };
    }
    const inv = inventory(tr);
    for (const key of ['hooks', 'stub_hits']) {
      if (!ref.inventory || JSON.stringify(ref.inventory[key]) !== JSON.stringify(inv[key])) return { stream: 'inventory.' + key, index: 0, ref: ref.inventory?.[key] ?? null, js: inv[key] };
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
