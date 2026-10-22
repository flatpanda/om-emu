#!/usr/bin/env node
// Gate A5: machine snapshots make detours invisible.
//   node emu/bin/snapgate.mjs SCENARIO... [--calls DIR (default emu/scenarios/calls)] [--detours N (default 20)]
// Every continue of the scenario's machines goes through a wrapper (machine.mjs onMachine). At every Kth continue
// (K = the continues of a run without detours / N, so 10 to 30 detours per session) the wrapper takes a snapshot and runs a detour
// through the machine API only, in one of three kinds (by turns): (a) the 16 registers scrambled (the pc kept) and the
// 4 KiB code page at the pc overwritten with random bytes (the decode cache then holds junk at the session's own pcs);
// (b) the registers kept, 4 KiB of another hot code page (the RT base page) overwritten; (c) only d0..d3 scrambled.
// Each also overwrites 4 KiB of a DRAM data page and makes CPU stores into a timer channel register and an INTC level
// register (single-stepped from a stub), then continues for up to 200,000 instructions with the breakpoints cleared (it
// may fault, throw a host error or end at the instruction bound). Then it restores the snapshot and the breakpoints,
// and the session goes on. Every session must be identical to the same scenario run without detours in the same
// process (bin/run.mjs's comparator: the logical view, then the finals), and so must the machine's whole state at the
// end (guest memory, the CPU, every device: its sha256).
// Cross-check, at the first detour point of each session: one detour of kind (b) runs three times from the same
// snapshot, each with its exec trace hashed (native mode), and the three digests and end states must be equal.
// Reports the detours (how each ended), snapshot sizes and the snapshot and restore times. Exit 1 on a difference.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { runScenarios, osdDoc, loadImage, loadBlock, firstDivergence, CALLS_DIR, STAGE1, STAGE2 } from './run.mjs';
import { dump } from '../src/trace/tracer.mjs';
import { onMachine } from '../src/machine.mjs';
import { R, S } from '../src/core/cpu.mjs';
import { BP } from '../src/core/interp.mjs';
import * as mem from '../src/core/mem.mjs';
import { IMAGE_BASE, IMAGE_END } from '../src/fw/model.mjs';
import { snapshotDevices } from '../src/debug/snapshot.mjs';

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const calls = path.resolve(opt('--calls', CALLS_DIR));
const per = Number(opt('--detours', 20));
const names = argv;
if (!names.length) { console.error('usage: snapgate.mjs SCENARIO... [--calls DIR] [--detours N]'); process.exit(2); }

let bad = 0;
const fail = (m) => { bad++; console.log(`  FAIL ${m}`); };
const rom = loadImage();
const resBlock = names.some((n) => STAGE1.includes(n) || STAGE2.includes(n)) ? loadBlock() : undefined;
if (names.includes('osd')) await osdDoc(calls);      // osd's generated inputs: made once, before any machine is wrapped

// xorshift32, seeded per detour: the detours are the same on every run
function rng(seed) { let x = (seed * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; }; }
const STUB = 0xA2100400;
function cpuStore(m, addr, value) {        // a CPU store over the machine API
  m.dbgWrite(STUB, Uint8Array.of(0x60));
  const r = m.getRegs().slice();
  r[9] = STUB; r[0] = value >>> 0; r[4] = addr >>> 0; r[14] = 0;
  m.setRegs(r);
  m.step();
}

for (const name of names) {
  // the sessions and the end state without detours (the same scenario, the same process)
  const plain = await runScenarios([name], { rom, resBlock, trace: true, calls });
  const want = stateDigest(plain.sessions.at(-1).hle.sim.m);
  const docs = Object.fromEntries(plain.sessions.map((s) => [s.name, JSON.parse(JSON.stringify(dump(s.tracer, createHash, { source: name, rc: plain.rc, env: {}, stdout: [] })))]));
  const conts = plain.sessions.reduce((a, s) => a + s.hle.sim.m.stats.conts, 0);
  const K = Math.max(1, Math.floor(conts / per));
  const st = { detours: 0, ends: {}, snapMs: [], restoreMs: [], bytes: [], cross: null, insns: 0 };
  let busy = false;
  const off = onMachine((m) => {
    let n = 0, crossed = false;
    const cont = m.cont;
    m.cont = function (opts) {
      if (++n % K === 0 && !busy) {
        busy = true;
        try {
          if (!crossed) { crossed = true; st.cross = crossCheck(m, n); }
          detour(m, n, st);
        } finally { busy = false; }
      }
      return cont.call(m, opts);
    };
  });
  const t0 = performance.now(), l0 = os.loadavg()[0].toFixed(2);
  let sessions = [], rc = 0, err = null;
  try { ({ sessions, rc } = await runScenarios([name], { rom, resBlock, trace: true, calls })); } catch (e) { err = e; }
  off();
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const med = (a) => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN;
  console.log(`${name}: ${st.detours} detours (every ${K}th of about ${conts} continues; ${st.insns} detour instructions), ${secs} s (load ${l0} -> ${os.loadavg()[0].toFixed(2)}); detour ends ${JSON.stringify(st.ends)}; snapshot ${(med(st.bytes) / 1048576).toFixed(1)} MiB median, ${med(st.snapMs).toFixed(1)} ms, restore ${med(st.restoreMs).toFixed(1)} ms (medians)`);
  if (err) { fail(`${name}: threw ${err.name}: ${err.message.split('\n')[0]}`); continue; }
  if (rc !== 0) fail(`${name}: the scenario's own checks failed (rc ${rc})`);
  if (st.detours < 10 && conts >= 10) fail(`${name}: only ${st.detours} detours`);
  if (!st.cross || !st.cross.ok) fail(`${name}: cross-check: ${JSON.stringify(st.cross)}`);
  else console.log(`  cross-check: one detour ran three times from one snapshot, exec digest ${st.cross.digests[0].slice(0, 16)} and end ${st.cross.ends[0]} each time (${st.cross.insns} instructions traced)`);
  const got = stateDigest(sessions.at(-1).hle.sim.m);
  if (got !== want) fail(`${name}: the machine state at the end differs from the run without detours (${got.slice(0, 16)} != ${want.slice(0, 16)})`);
  else console.log(`  end state (memory, CPU, devices) identical to the run without detours: ${got.slice(0, 16)}`);
  for (const s of sessions) {
    const d = docs[s.name] ? firstDivergence(docs[s.name], s.tracer) : { stream: 'lab', index: 0, ref: null, js: s.name };
    if (d) fail(`${s.name}: DIVERGES at ${d.stream} index ${d.index}: without detours ${JSON.stringify(d.ref).slice(0, 300)}, with ${JSON.stringify(d.js).slice(0, 300)}`);
    else console.log(`  ${s.name}: identical to the run without detours (logical view, finals)`);
  }
}
console.log(bad ? `snapgate: ${bad} FAILED` : 'snapgate: all identical');
process.exit(bad ? 1 : 0);

// sha256 of the whole machine state: the guest memory buffer, R, S (but its intc closure and the fault object), and
// every device as the snapshot walker sees it.
function stateDigest(m) {
  const h = createHash('sha256');
  h.update(mem.U8.subarray(0, mem.TOTAL));
  h.update(new Uint8Array(R.buffer, R.byteOffset, R.byteLength));
  h.update(JSON.stringify(Object.entries(S).filter(([k]) => k !== 'intc' && k !== 'fault')));
  const dev = snapshotDevices(m.devices, [m, ...Object.values(m.devices)], mem.buf);
  h.update(JSON.stringify(dev, function (k, v) {
    if (k === 'v' && this.t === 'ref') return '<ref>';                 // a wiring reference: identity, not state
    return ArrayBuffer.isView(v) ? Array.from(v) : v instanceof Map ? [...v] : v instanceof Set ? [...v] : typeof v === 'function' ? undefined : v;
  }));
  return h.digest('hex');
}

function detour(m, n, st, forceKind = null, onEnd = null) {
  const rand = rng(n);
  let t = performance.now();
  const snap = m.snapshot();
  st.snapMs.push(performance.now() - t); st.bytes.push(m.snapshotBytes(snap));
  const bps = [...BP], limit = S.limit, kind = forceKind ?? 'abc'[st.detours % 3], i0 = S.insns;
  let end;
  try {
    const r = m.getRegs().slice(), pc = r[9];
    if (kind === 'a') {
      for (let k = 0; k < 16; k++) if (k !== 9 && k !== 15) r[k] = rand();
      r[8] = (0xA2000000 + (rand() & 0x1fffc)) >>> 0; r[10] &= 0xffff; r[14] = 0;
    } else if (kind === 'c') for (let k = 0; k < 4; k++) r[k] = rand();
    m.setRegs(r);
    const inCode = (pc >= IMAGE_BASE && pc < IMAGE_END) || (pc >= IMAGE_BASE + 0x40000000 && pc < IMAGE_END + 0x40000000);
    const code = kind === 'a' && inCode ? (pc & ~0xfff) >>> 0 : (IMAGE_BASE & ~0xfff) >>> 0;
    const junk = (len) => { const b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = rand() & 0xff; return b; };
    if (kind !== 'c') m.dbgWrite(code, junk(4096));
    m.dbgWrite((0x60400000 + ((rand() & 0x3ff) << 12)) >>> 0, junk(4096));
    const saved = m.getRegs().slice();
    cpuStore(m, 0x98900000 + 0x40 * (1 + (rand() & 7)) + 4, rand() & 0xffff);   // a timer channel's reload register
    cpuStore(m, 0x99200000 + 4 * (rand() % 356), 1 << (rand() % 7));             // an INTC level register
    m.setRegs(saved);
    m.setBreakpoints([]);
    S.limit = S.insns + 200000;                   // the detour's bound (the snapshot restores the machine's own)
    const res = m.cont();
    const ls = m.lastStop();
    end = `${kind} ${res === 'stop' ? ls.kind : res}`;
  } catch (e) { end = `${kind} host ${e.name}`; }
  st.ends[end] = (st.ends[end] ?? 0) + 1;
  st.insns += S.insns - i0;
  if (onEnd) onEnd(end, m.getRegs().join(','));
  t = performance.now();
  m.restore(snap);
  st.restoreMs.push(performance.now() - t);
  if (S.limit !== limit) throw new Error('snapgate: the restore did not bring the insn limit back');
  m.setBreakpoints(bps);
  st.detours++;
}

// One detour of kind (b) three times from one snapshot, each with its exec trace hashed (native mode).
function crossCheck(m, n) {
  const digests = [], ends = [];
  let insns = 0;
  for (let k = 0; k < 3; k++) {
    const h = createHash('sha256');
    let c = 0;
    m.setExecTrace((pc, op) => { c++; h.update(`${pc} ${op} ${R[0]} ${R[8]} ${R[10]}\n`); }, { mode: 'native' });
    detour(m, n, { ends: {}, snapMs: [], restoreMs: [], bytes: [], insns: 0, detours: 0 }, 'b', (end, regs) => ends.push(`${end} ${regs}`));
    m.setExecTrace(null);
    digests.push(h.digest('hex')); insns = c;
  }
  return { ok: digests.every((d) => d === digests[0]) && ends.every((e) => e === ends[0]) && insns > 0, digests, ends: ends.map((e) => e.split(' ').slice(0, 2).join(' ')), insns };
}
