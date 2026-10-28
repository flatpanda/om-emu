#!/usr/bin/env node
// The Cortex-M4 core (emu/src/core/m4/) against QEMU: generated cases (gen.mjs, emu/test/m4cases.mjs) run on the JS
// core and on qemu-system-arm -M mps2-an386 (a Cortex-M4 with FPU) through its gdbstub, and their end states are
// compared: registers, xPSR, MSP / PSP, PRIMASK / BASEPRI / FAULTMASK / CONTROL, S0..S31 and FPSCR, CFSR / HFSR and
// the 8 KiB data window. A case that leaves the shared layout on the JS core (an access outside the window, a branch
// out of the code) is dropped before QEMU runs it. Inside the om-emu VM only (QEMU is never run on the host, and
// never runs firmware: the cases are generated code).
//   orb -m om-emu node tools/m4-oracle/oracle.mjs [--cases N] [--seed S] [--record FILE] [--show N] [--port P]
//   orb -m om-emu node tools/m4-oracle/oracle.mjs --case SEED      (one case's two results in full)
// --record writes QEMU's results of the compared cases as test/fixtures/m4_vectors.json's format (test_m4.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Rsp, hexBytes, le32 } from './rsp.mjs';
import { buckets, genCase, encsOf } from './gen.mjs';
import { runJs, differ, initialState, lowImage, bootImage, endOf, CODE, WINDOW, WSIZE, STUB, PROLOGUE, PROLOGUE_END } from '../../emu/test/m4cases.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const N = Number(opt('--cases', '2000')), SEED = Number(opt('--seed', '1')), SHOW = Number(opt('--show', '10'));
const RECORD = opt('--record', null), PORT = Number(opt('--port', String(12000 + (process.pid % 2000))));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4oracle-'));
fs.writeFileSync(path.join(dir, 'boot.bin'), bootImage());
const qemu = spawn('qemu-system-arm', ['-M', 'mps2-an386', '-cpu', 'cortex-m4', '-nographic', '-monitor', 'none', '-serial', 'none',
  '-S', '-gdb', `tcp:127.0.0.1:${PORT}`, '-kernel', path.join(dir, 'boot.bin')], { stdio: ['ignore', 'ignore', 'inherit'] });
const version = execFileSync('qemu-system-arm', ['--version'], { encoding: 'utf8' }).split('\n')[0];
const rsp = await Rsp.connect(PORT);

const hex = (v) => '0x' + (v >>> 0).toString(16);
const regsHex = (r, xpsr) => hexBytes(new Uint8Array(new Int32Array([...r, xpsr]).buffer));
async function monitor(cmd) {
  const reply = new Promise((res) => { const loop = (x) => (x === 'OK' || x.startsWith('E') ? res(x) : rsp.waiters.unshift(loop)); rsp.waiters.push(loop); });
  rsp.send(`qRcmd,${Buffer.from(cmd).toString('hex')}`);
  return reply;
}
async function stopPc() { return le32((await rsp.readAll()).slice(15 * 8, 16 * 8)) >>> 0; }
for (let n = 2; n < 16; n++) await rsp.breakAt(STUB(n));
await rsp.breakAt(PROLOGUE_END);

// QEMU's priority bits: BASEPRI written 0xff through the prologue reads back with the implemented bits only
async function prologue(st) {
  const r = new Int32Array(16);
  r[0] = st.psp; r[1] = st.basepri; r[2] = st.primask; r[3] = st.control; r[4] = st.msp; r[13] = st.msp; r[15] = PROLOGUE;
  await rsp.writeAll(regsHex(r, 0x01000000));
  const c = await rsp.cont();
  const pc = await stopPc();
  if (c.timedOut || pc !== PROLOGUE_END) throw new Error(`the prologue stopped at ${hex(pc)}`);
}
await monitor('system_reset');
await prologue({ psp: WINDOW + 0x800, basepri: 0xff, primask: 0, control: 0, msp: WINDOW + 0x1000 });
const basepriFF = await rsp.readReg(47) & 0xff;
const prioBits = 8 - Math.log2((~basepriFF & 0xff) + 1);

async function runQemu(kase) {
  const st = initialState(kase.seed);
  for (const [k, v] of Object.entries(kase.set || {})) st.r[Number(k)] = v | 0;
  await monitor('system_reset');
  await rsp.writeMem(CODE, lowImage(kase.code).subarray(CODE, CODE + 0x100));
  await rsp.writeMem(WINDOW, st.window);
  if (st.fp) await rsp.writeMem(0xe000ed88, Uint8Array.of(0, 0, 0xf0, 0));
  await prologue(st);
  const r = Int32Array.from(st.r); r[15] = CODE;
  await rsp.writeAll(regsHex(r, st.xpsr));
  for (let i = 0; i < 16; i++) await rsp.request(`P${(26 + i).toString(16)}=${hexBytes(new Uint8Array(new Int32Array([st.s[2 * i], st.s[2 * i + 1]]).buffer))}`);
  await rsp.writeReg(42, st.fpscr);
  const end = endOf(kase);
  await rsp.breakAt(end);
  const c = await rsp.cont();
  await rsp.unbreak(end);
  const g = await rsp.readAll();
  const regs = []; for (let k = 0; k < 17; k++) regs.push(le32(g.slice(8 * k, 8 * k + 8)));
  const sys = []; for (const n of [43, 44, 45, 46, 47, 48]) sys.push(await rsp.readReg(n));
  const s = [];
  for (let i = 0; i < 16; i++) { const h = await rsp.request(`p${(26 + i).toString(16)}`); s.push(le32(h.slice(0, 8)), le32(h.slice(8, 16))); }
  const fpscr = await rsp.readReg(42);
  const win = await rsp.readMem(WINDOW, WSIZE);
  const fsr = await rsp.readMem(0xe000ed28, 8);
  const mem = [];
  for (let i = 0; i < WSIZE; i++) if (win[i] !== st.window[i]) mem.push([i, win[i]]);
  const u = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
  return { timedOut: c.timedOut, pc: regs[15] >>> 0, r: regs.slice(0, 16), xpsr: regs[16], msp: sys[0], psp: sys[1], primask: sys[2], control: sys[3],
    basepri: sys[4], faultmask: sys[5], s, fpscr, cfsr: u(fsr, 0), hfsr: u(fsr, 4), mem };
}

const bk = buckets();
const ONE = opt('--case', null);
if (ONE !== null) {                          // one case's two results in full
  const kase = genCase(Number(ONE), bk), js = runJs(kase, { prioBits });
  console.log(JSON.stringify({ kase, encs: encsOf(kase), init: (({ r, xpsr, msp, psp, control, primask, basepri, fp, fpscr }) => ({ r: Array.from(r, hex), xpsr: hex(xpsr), msp: hex(msp), psp: hex(psp), control, primask, basepri, fp, fpscr: hex(fpscr) }))(initialState(kase.seed)) }));
  if (js.drop) console.log('JS drops it:', js.drop);
  else {
    const q = await runQemu(kase);
    const view = (x) => ({ pc: hex(x.pc), r: x.r.map(hex), xpsr: hex(x.xpsr), msp: hex(x.msp), psp: hex(x.psp), control: x.control, primask: x.primask, basepri: x.basepri, cfsr: hex(x.cfsr), hfsr: hex(x.hfsr), mem: x.mem.slice(0, 40) });
    console.log('JS  ', JSON.stringify(view(js)), 'steps', js.steps);
    console.log('QEMU', JSON.stringify(view(q)));
    console.log(differ(q, js));
  }
  rsp.close(); qemu.kill(); process.exit(0);
}
const drops = new Map(), perEnc = new Map(), bad = [], recorded = [];
let compared = 0;
const byExc = new Map();                     // compared cases that ended in an exception entry, by exception
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const kase = genCase(SEED + i, bk);
  const js = runJs(kase, { prioBits });
  if (js.drop) { const k = js.drop.replace(/0x[0-9a-f]+/g, 'X'); drops.set(k, (drops.get(k) || 0) + 1); continue; }
  const q = await runQemu(kase);
  compared++;
  if (q.pc !== endOf(kase)) byExc.set(q.xpsr & 0x1ff, (byExc.get(q.xpsr & 0x1ff) || 0) + 1);
  const d = q.timedOut ? ['QEMU did not stop'] : differ(q, js);
  for (const e of new Set(encsOf(kase))) { const x = perEnc.get(e) || { n: 0, bad: 0 }; x.n++; if (d.length) x.bad++; perEnc.set(e, x); }
  if (d.length) bad.push({ kase, d, encs: encsOf(kase) });
  if (RECORD && !q.timedOut) recorded.push({ seed: kase.seed, code: kase.code, set: kase.set, out: pack(q, kase) });
}
console.log(`${version}; mps2-an386, ${prioBits} priority bits; ${N} cases from seed ${SEED} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`compared ${compared}, dropped ${N - compared}, mismatches ${bad.length}; ended in an exception entry: ${[...byExc.entries()].sort((a, b) => a[0] - b[0]).map(([e, n]) => `${n} (exception ${e})`).join(', ') || 'none'}`);
for (const [k, n] of [...drops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  dropped ${String(n).padStart(5)}  ${k}`);
for (const b of bad.slice(0, SHOW)) console.log(`  MISMATCH seed ${b.kase.seed} [${b.encs.join('; ')}] code ${b.kase.code.map((h) => h.toString(16).padStart(4, '0')).join(' ')}${Object.keys(b.kase.set).length ? ' set ' + JSON.stringify(b.kase.set) : ''}: ${b.d.slice(0, 4).join('; ')}`);
const encs = [...bk.keys()];
const never = encs.filter((e) => !perEnc.has(e));
console.log(`encodings: ${encs.length} in the generator's buckets, ${perEnc.size} compared at least once, ${[...perEnc.values()].filter((x) => x.bad).length} with a mismatch; never compared: ${never.length ? never.join(', ') : 'none'}`);
if (RECORD) {
  fs.writeFileSync(RECORD, JSON.stringify({ about: 'Cortex-M4 differential vectors: generated cases (tools/m4-oracle/gen.mjs; initial state from emu/test/m4cases.mjs initialState(seed)) and QEMU\'s end state for each', qemu: version, machine: 'mps2-an386', prioBits, cases: recorded }) + '\n');
  console.log(`recorded ${recorded.length} cases to ${RECORD}`);
}
rsp.close(); qemu.kill();
process.exit(bad.length ? 1 : 0);

// the fixture's form of a result: the changed r0..r14 and S registers as [index, value], pc, the system registers, the
// window's changes as runs [offset, bytes...]
function pack(q, kase) {
  const st = initialState(kase.seed);
  for (const [k, v] of Object.entries(kase.set || {})) st.r[Number(k)] = v | 0;
  const r = []; q.r.forEach((v, k) => { if (k < 15 && (v | 0) !== st.r[k]) r.push([k, v | 0]); });
  const s = []; q.s.forEach((v, k) => { if ((v | 0) !== st.s[k]) s.push([k, v | 0]); });
  const runs = [];
  for (const [o, v] of q.mem) { const last = runs[runs.length - 1]; if (last && last[0] + last.length - 1 === o) last.push(v); else runs.push([o, v]); }
  return { pc: q.pc, r, xpsr: q.xpsr, msp: q.msp, psp: q.psp, primask: q.primask, basepri: q.basepri, faultmask: q.faultmask,
    control: q.control, s, fpscr: q.fpscr, cfsr: q.cfsr, hfsr: q.hfsr, mem: runs };
}
