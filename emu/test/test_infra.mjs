// Gate A1 (infrastructure): the machine buffer is reused, and a new machine on a used buffer starts from exactly the
// bytes of a machine on a never-used one; a continue with a budget pauses, refuses debugger writes and register writes
// while paused, resumes to the same stop, and abort() ends it for good; a host error inside a run stops the machine. Each buffer check runs in its own node process:
//   node emu/test/test_infra.mjs                 (parent: spawns the children below and compares)
//   node emu/test/test_infra.mjs fresh DRAM_MIB  (child: sha256 of the whole buffer after createMachine on a new buffer)
//   node emu/test/test_infra.mjs reuse           (child: kernel-1 and osd dirty DRAM, windows, low RAM and DMA, plus
//                                                   debugger writes over the whole DRAM; then sha256 after createMachine
//                                                   of 384 MiB and of 64 MiB)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as mem from '../src/core/mem.mjs';
import { createMachine, Aborted, HostStopped } from '../src/machine.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const IMAGE = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');
const SELF = new URL(import.meta.url).pathname;
const bufSha = () => createHash('sha256').update(new Uint8Array(mem.buf)).digest('hex');

async function child(mode, arg) {
  const rom = new Uint8Array(fs.readFileSync(IMAGE));
  if (mode === 'fresh') {
    createMachine({ rom, dramBytes: Number(arg) << 20 });
    console.log(JSON.stringify({ [arg]: bufSha() }));
    return;
  }
  const { runScenarios } = await import('../bin/run.mjs');
  const r = await runScenarios(['kernel-1', 'osd'], { rom });
  if (r.rc !== 0) throw new Error(`scenarios rc ${r.rc}`);
  const m = createMachine({ rom, dramBytes: 384 << 20 });
  for (let a = 0x60000000; a < 0x60000000 + (384 << 20); a += 0x7F1F3) m.dbgWrite(a, new Uint8Array([0xA5, 0x5A, a & 0xff]));
  m.dbgWrite(0x00008000, new Uint8Array(64).fill(7));
  m.devices.bus.write(0xA5670000, new Uint8Array(4096).fill(3));      // above the image copy's pages
  const out = {};
  for (const mib of [384, 64]) { createMachine({ rom, dramBytes: mib << 20 }); out[mib] = bufSha(); }
  console.log(JSON.stringify(out));
}

// The budget / resume / abort contract on a loop (inc d0; bra back) that runs into the instruction limit.
function budget() {
  const bad = [];
  const rom = new Uint8Array(fs.readFileSync(IMAGE));
  const run = (slices) => {
    const m = createMachine({ rom, insnLimit: 200000 });
    m.dbgWrite(0xA2100000, new Uint8Array([0x40, 0xca, 0xff]));
    const r = m.getRegs(); r[9] = 0xA2100000; r[8] = 0xA2200000; m.setRegs(r);
    let res = slices ? m.cont({ budget: slices }) : m.cont(), pauses = 0;
    while (res === 'paused') {
      pauses++;
      if (pauses === 3) {
        for (const [what, f] of [['setRegs', () => m.setRegs(m.getRegs())], ['dbgWrite', () => m.dbgWrite(0xA2100000, new Uint8Array(1))],
          ['step', () => m.step()], ['cont', () => m.cont()], ['setBreakpoints', () => m.setBreakpoints([])]]) {
          try { f(); bad.push(`${what} while paused did not throw`); } catch (e) { if (!/paused/.test(e.message)) bad.push(`${what}: ${e.message}`); }
        }
        m.dbgRead(0x60000000, 4);
      }
      res = m.resume({ budget: slices });
    }
    return { regs: [...m.getRegs()], pauses, stats: { conts: m.stats.conts, insns: m.stats.insns } };
  };
  const whole = run(0), sliced = run(1009);
  if (JSON.stringify(whole.regs) !== JSON.stringify(sliced.regs)) bad.push(`sliced stop ${sliced.regs} != unsliced ${whole.regs}`);
  if (sliced.stats.conts !== 1 || sliced.stats.insns !== whole.stats.insns) bad.push(`sliced stats ${JSON.stringify(sliced.stats)} vs ${JSON.stringify(whole.stats)}`);
  if (sliced.pauses < 10) bad.push(`only ${sliced.pauses} pauses`);
  if (whole.regs[14] !== 7 || whole.stats.insns < 199000) bad.push(`the loop did not run into the insn limit: fault ${whole.regs[14]}, ${whole.stats.insns} insns`);
  // abort: the next resume throws Aborted, then the machine refuses everything
  const m = createMachine({ rom, insnLimit: 200000 });
  m.dbgWrite(0xA2100000, new Uint8Array([0x40, 0xca, 0xff]));
  const r = m.getRegs(); r[9] = 0xA2100000; m.setRegs(r);
  if (m.cont({ budget: 100 }) !== 'paused') bad.push('cont({budget: 100}) did not pause');
  m.abort();
  try { m.resume(); bad.push('resume after abort did not throw'); } catch (e) { if (!(e instanceof Aborted)) bad.push(`resume after abort: ${e}`); }
  try { m.getRegs(); bad.push('getRegs after abort did not throw'); } catch (e) { if (!/aborted/.test(e.message)) bad.push(`getRegs after abort: ${e.message}`); }
  // abort() ends the machine at once: cont() then throws Aborted, not "a continue is paused"
  const loop = () => {
    const x = createMachine({ rom, insnLimit: 200000 });
    x.dbgWrite(0xA2100000, new Uint8Array([0x40, 0xca, 0xff]));
    const rx = x.getRegs(); rx[9] = 0xA2100000; x.setRegs(rx);
    return x;
  };
  const m2 = loop();
  m2.cont({ budget: 100 }); m2.abort();
  try { m2.cont(); bad.push('cont after abort did not throw'); } catch (e) { if (!(e instanceof Aborted)) bad.push(`cont after abort: ${e.message}`); }
  // abort() with nothing paused is refused and leaves no flag behind: a later chain runs to its stop
  const m3 = loop();
  try { m3.abort(); bad.push('abort with nothing paused did not throw'); } catch (e) { if (!/no paused continue/.test(e.message)) bad.push(`abort with nothing paused: ${e.message}`); }
  try {
    let res = m3.cont({ budget: 50000 });
    while (res === 'paused') res = m3.resume({ budget: 50000 });
    if (m3.getRegs()[14] !== 7) bad.push(`chain after a refused abort ended with fault ${m3.getRegs()[14]}`);
  } catch (e) { bad.push(`chain after a refused abort: ${e.message}`); }
  // a budget that cannot make progress is refused (0, negative, fractional)
  const m4 = loop();
  for (const b of [0, -1, 1.5, NaN]) {
    try { m4.cont({ budget: b }); bad.push(`cont({budget: ${b}}) did not throw`); } catch (e) { if (!(e instanceof RangeError)) bad.push(`cont({budget: ${b}}): ${e.message}`); }
  }
  if (m4.cont({ budget: 100 }) !== 'paused') bad.push('cont({budget: 100}) after refused budgets did not pause');
  try { m4.resume({ budget: 0 }); bad.push('resume({budget: 0}) did not throw'); } catch (e) { if (!(e instanceof RangeError)) bad.push(`resume({budget: 0}): ${e.message}`); }
  // a host error (here Unported from a code fetch at the interrupt controller's registers 0x99200000: execution from
  // device registers is not modelled) inside cont / step clears the chain and stops the machine: no false paused
  // continue, run and write calls throw HostStopped, reads still work, abort() has nothing to abort,
  // and the instructions run before the throw are counted
  const unported = (how) => {
    const x = createMachine({ rom, insnLimit: 200000 });
    x.dbgWrite(0xA2100000, new Uint8Array([0x60, 0xca, 0xfe]));
    const rx = x.getRegs(); rx[9] = 0x99200000; x.setRegs(rx);
    try { how(x); bad.push(`${how}: the fetch from device registers did not throw`); } catch (e) { if (e.name !== 'Unported') bad.push(`${how}: ${e.name} ${e.message}`); }
    if (x.paused()) bad.push(`${how}: paused() after a host error`);
    if (x.failed()?.name !== 'Unported') bad.push(`${how}: failed() is ${x.failed()}`);
    for (const [what, f] of [['cont', () => x.cont()], ['step', () => x.step()], ['setRegs', () => x.setRegs(x.getRegs())],
      ['dbgWrite', () => x.dbgWrite(0xA2100000, new Uint8Array(1))], ['setBreakpoints', () => x.setBreakpoints([])]]) {
      try { f(); bad.push(`${how}: ${what} after a host error did not throw`); } catch (e) { if (!(e instanceof HostStopped)) bad.push(`${how}: ${what} after a host error: ${e.name} ${e.message}`); }
    }
    try { x.resume(); bad.push(`${how}: resume after a host error did not throw`); } catch (e) { if (!(e instanceof HostStopped)) bad.push(`${how}: resume: ${e.name} ${e.message}`); }
    try { x.abort(); bad.push(`${how}: abort after a host error did not throw`); } catch (e) { if (!/no paused continue/.test(e.message)) bad.push(`${how}: abort: ${e.message}`); }
    try {
      if (x.getRegs()[9] !== 0x99200000 || x.dbgRead(0xA2100000, 1)[0] !== 0x60) bad.push(`${how}: reads after a host error`);
    } catch (e) { bad.push(`${how}: reads after a host error: ${e.name} ${e.message}`); }
    return x.stats;
  };
  const st1 = unported((x) => x.cont());
  if (st1.conts !== 1 || st1.guestMs <= 0) bad.push(`cont: stats after a host error ${JSON.stringify({ conts: st1.conts, guestMs: st1.guestMs })}`);
  unported((x) => x.cont({ budget: 100 }));
  const st3 = unported((x) => x.step());
  if (st3.steps !== 1) bad.push(`step: stats after a host error: steps ${st3.steps}`);
  return { checks: 18 + 3 * 10 + 2, bad, pauses: sliced.pauses, insns: whole.stats.insns };
}

export function infra() {
  const bad = [];
  const node = (args) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', maxBuffer: 1 << 20 });
  const shas = {};
  for (const args of [['fresh', '384'], ['fresh', '64'], ['reuse']]) {
    const c = node(args);
    if (c.status !== 0) { bad.push(`child ${args.join(' ')}: exit ${c.status} ${c.stderr.slice(-400)}`); continue; }
    shas[args.join(' ')] = JSON.parse(c.stdout.trim().split('\n').pop());
  }
  const reuse = shas.reuse ?? {};
  for (const mib of ['384', '64']) {
    const fresh = shas[`fresh ${mib}`]?.[mib];
    if (!fresh || fresh !== reuse[mib]) bad.push(`${mib} MiB machine on a used buffer: sha ${reuse[mib]?.slice(0, 16)} != never-used ${fresh?.slice(0, 16)}`);
  }
  const b = budget();
  return { checks: 2 + b.checks, bad: [...bad, ...b.bad], pauses: b.pauses, insns: b.insns };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2]) await child(process.argv[2], process.argv[3]);
  else {
    const t0 = performance.now(), r = infra();
    console.log(`infrastructure: ${r.checks - r.bad.length}/${r.checks} checks (buffer reuse 384 and 64 MiB; budget: ${r.pauses} pauses over ${r.insns} insns; abort) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    r.bad.forEach((x) => console.log('  ', x));
    process.exit(r.bad.length ? 1 : 0);
  }
}
