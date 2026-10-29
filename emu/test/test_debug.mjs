// The debug API's units: the watchpoint mechanism (fast entries off on watched pages, a store that does not re-enable
// them, read/write/access kinds, stop after the accessing instruction, a log entry that changes nothing), the snapshot
// round trip, the JSON-lines errors, the trace-file, watch-log and stderr limits, the debugger on a lab session
// with disasm's line filter, and (firmware-free, also in bin/test-pure.mjs) the trace rules and edge cases no firmware
// session reaches (traceRuleUnits).
//   node emu/test/test_debug.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Debugger } from '../src/debug/debugger.mjs';
import { Protocol } from '../src/debug/protocol.mjs';
import { openSink } from '../bin/debug.mjs';
import * as mem from '../src/core/mem.mjs';
import { S } from '../src/core/cpu.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const ORIG = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');
let romCache = null;
const rom = () => romCache ??= new Uint8Array(fs.readFileSync(ORIG));

// ---- watchpoint units --------------------------------------------------------------------------------------------
export function watchUnits() {
  try { return watchUnitsBody(); } catch (e) { return { checks: 1, bad: [`watchUnits: threw ${e.name}: ${e.message}`] }; }
}
function watchUnitsBody() {
  const bad = [];
  let n = 0;
  const check = (what, ok, detail = '') => { n++; if (!ok) bad.push(`watch: ${what}${detail ? ` (${detail})` : ''}`); };
  const d = Debugger.create({ rom: rom(), createHash });
  const m = d.m;
  // mov d0,(a0); nop; movbu (a1),d0 [f0 45: a1 -> d1? use f0 41: movbu (a0)->?] ... a small program at 0xa3000000
  const prog = Uint8Array.from([0x60, 0xcb, 0xf0, 0x45, 0xcb, 0x60, 0xcb, 0xca, 0x00]);
  const fresh = (regs) => { d.write(0xa3000000, prog); d.reset({ pc: 0xa3000000, d0: 0x1234, a0: 0xa2100000, a1: 0x97000000, ...regs }); };
  const page = 0xa2100000 >>> 16;
  // the store's page gets its fast store entry first (an unwatched store), then the watch must take it away
  fresh({}); m.step();
  check('the first store enables the page fast store entry', mem.WP[page] >= 0);
  d.watch([{ id: 'w', lo: 0xa2100000, len: 4, kind: 'w' }]);
  check('a watched page has no fast entries', mem.WP[page] < 0 && mem.RP[page] < 0);
  fresh({});
  let o = d.cont({ budget: 100 });
  check('write watch: stop', o.stop === 'watch' && o.watch?.id === 'w' && o.regs.pc === 0xa3000001 && o.regs.insns === 1, JSON.stringify(o));
  check('write watch: reported address and value', o.watch?.hit === 0xa2100000 && o.watch?.addr === 0xa2100000 && o.watch?.value === 0x1234 && o.watch?.dir === 'w' && o.watch?.pc === 0xa3000000);
  // a store elsewhere on the watched page must not re-enable its fast entry (slowSt's lazy enable skips watched pages)
  d.reset({ pc: 0xa3000000, d0: 7, a0: 0xa2100100 });
  m.step();
  check('a store elsewhere on a watched page leaves the fast entry off', mem.WP[page] < 0);
  fresh({});
  o = d.cont({ budget: 100 });
  check('the watch still hits after that store', o.stop === 'watch');
  // read watch on an MMIO register (the ISC lock byte) and a read watch that a write must not trigger
  d.watch([{ id: 'r', lo: 0x97000000, len: 1, kind: 'r' }, { id: 'ro', lo: 0xa2100000, len: 4, kind: 'r' }]);
  fresh({});
  o = d.cont({ budget: 100 });
  check('MMIO read watch: stop after the read', o.stop === 'watch' && o.watch?.id === 'r' && o.regs.pc === 0xa3000004 && o.watch?.dir === 'r', JSON.stringify(o.watch));
  // access watch with a breakpoint at the next pc: the watch is reported (the pending debug stop comes first)
  d.watch([{ id: 'a', lo: 0xa2100002, len: 1, kind: 'rw' }]);
  fresh({});
  o = d.cont({ stops: [0xa3000001], budget: 100 });
  check('access watch before a breakpoint at the next pc', o.stop === 'watch' && o.watch?.hit === 0xa2100002 && o.watch?.addr === 0xa2100000 && o.regs.pc === 0xa3000001, JSON.stringify(o));
  o = d.cont({ budget: 100 });
  check('the next continue stops at that breakpoint at once', o.stop === 'break' && o.regs.pc === 0xa3000001 && o.regs.insns === 1, JSON.stringify(o));
  d.breakpoints([]);
  // a step reports the hit without stopping anything else
  fresh({});
  o = d.step();
  check('step: the hit is reported', o.stop === 'watch' && o.regs.pc === 0xa3000001 && S.kick === false, JSON.stringify(o));
  o = d.step();
  check('the next step does nothing (the pending debug interrupt)', o.stop === 'break' && o.regs.pc === 0xa3000001 && o.regs.insns === 1, JSON.stringify(o));
  // the range's edges (verify round 1 finding 23): a store at hi does not hit, and a range across a 64 KiB page
  // boundary masks both pages, so a store on the second page, whose fast store entry was on, hits
  d.watch([{ id: 'e', lo: 0xa2100000, len: 4, kind: 'w' }]);
  fresh({ a0: 0xa2100004 });
  o = d.cont({ stops: [0xa3000002], budget: 100 });
  check('a store at the range end (hi) does not hit', o.stop === 'break' && o.regs.insns === 2, JSON.stringify(o));
  d.breakpoints([]);
  d.watch([]);
  fresh({}); m.step();
  check('an unwatched store enables the page fast store entry again', mem.WP[page] >= 0);
  d.watch([{ id: 'x', lo: 0xa20ffffc, len: 8, kind: 'w' }]);
  check('a range across a page boundary masks both pages', mem.WP[page] < 0 && mem.RP[page] < 0 && mem.RP[page - 1] < 0);
  fresh({});
  o = d.cont({ budget: 100 });
  check('a store on the second page of a page-crossing range hits', o.stop === 'watch' && o.watch?.id === 'x' && o.watch?.hit === 0xa20ffffc && o.watch?.addr === 0xa2100000, JSON.stringify(o));
  // log entries record and do nothing else: same run with and without them
  d.watch([]);
  check('clearing the watches gives the read entry back', mem.RP[page] >= 0);
  fresh({});
  const plain = d.cont({ budget: 50 }); d.abort();
  const d2 = Debugger.create({ rom: rom(), createHash });
  d2.write(0xa3000000, prog); d2.reset({ pc: 0xa3000000, d0: 0x1234, a0: 0xa2100000, a1: 0x97000000 });
  d2.watch([{ id: 'l', lo: 0xa2100000, len: 4, kind: 'rw', action: 'log' }, { id: 'l2', lo: 0x97000000, len: 1, kind: 'r', action: 'log' }]);
  const logged = d2.cont({ budget: 50 });
  const log = d2.watchLog();
  check('log watches change nothing', JSON.stringify(logged.regs) === JSON.stringify(plain.regs) && logged.stop === 'paused', `${JSON.stringify(logged.regs)} vs ${JSON.stringify(plain.regs)}`);
  check('log watches record every hit', log.length === 3 && log[0].id === 'l' && log[1].id === 'l2' && log[2].id === 'l', JSON.stringify(log));
  d2.abort();
  // a log entry must not cause an interrupt look: gate mode 1 at a pc that is not a breakpoint, a request pending
  // that only the gate refuses, and a loop whose store (log-watched) comes right before the gate pc: the arrival is
  // mid-TB, which is not a look point, so the request stays pending (3,000 instructions); an extra look would accept
  const gated = (log) => {
    const g = Debugger.create({ rom: rom(), createHash }, { insnLimit: 0 });
    g.write(0xa3000000, Uint8Array.from([0x60, 0xcb, 0xca, 0xfe]));          // mov d0,(a0); nop (the gate pc); bra back
    g.reset({ pc: 0xa3000000 });
    g.cpuStore(0x99200000 + 4 * 100, 1 << 3);                               // IRQ 100 at level 3
    g.write(0x89A00008, Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0xa3]));        // gate mode 1, gate pc 0xa3000001
    g.write(0x89A03000 + 100, Uint8Array.of(1));                              // its test line ...
    g.cpuStore(0x89A20000, 1);                                                // ... applied (doorbell command 1)
    g.reset({ pc: 0xa3000000, a0: 0xa2100000, psw: 0x0f00 });
    if (log) g.watch([{ id: 'log', lo: 0xa2100000, len: 4, kind: 'w', action: 'log' }]);
    const r = g.cont({ budget: 3000 });
    const out = { stop: r.stop, fault: r.fault, regs: r.regs, accepted: g.u32(0x89A00014), log: g.watchLog().length };
    if (g.paused()) g.abort();
    return out;
  };
  const g0 = gated(false), g1 = gated(true);
  check('a log watch before a mid-TB gate-pc arrival takes no look', g0.stop === 'paused' && g0.accepted === 0 && JSON.stringify({ ...g1, log: 0 }) === JSON.stringify(g0) && g1.log > 100, `${JSON.stringify(g0)} / ${JSON.stringify(g1)}`);
  // one-instruction mode (every instruction a one-instruction TB, run.mjs's step() branch): the same stop
  const d3 = Debugger.create({ rom: rom(), createHash }, { oneInsn: true });
  d3.write(0xa3000000, prog); d3.reset({ pc: 0xa3000000, d0: 0x1234, a0: 0xa2100000, a1: 0x97000000 });
  d3.watch([{ id: 'w1', lo: 0xa2100000, len: 4, kind: 'w' }]);
  o = d3.cont({ budget: 100 });
  check('one-instruction mode: write watch stop', o.stop === 'watch' && o.watch?.id === 'w1' && o.regs.pc === 0xa3000001 && o.regs.insns === 1, JSON.stringify(o));
  d3.close();
  // the MMIO trace's sub-word stores and debugger read sizes (verify round 1 finding 24; no gate session makes them):
  // a byte and a halfword CPU store of a register with high bits trace the stored value (memory_region_ops_write's
  // value is the access's), and debugger reads of 1 and 2 bytes trace their own size (cpu -1)
  const d4 = Debugger.create({ rom: rom(), createHash });
  const recs = [];
  d4.traceMmio((r) => recs.push(r));
  for (const [code, a] of [[[0xf0, 0x50], 0x97000000], [[0xf0, 0x70], 0x99200514]]) {   // movbu / movhu d0,(a0)
    d4.write(0xa3000000, Uint8Array.from([...code, 0xcb]));
    d4.reset({ pc: 0xa3000000, d0: 0x12345678, a0: a });
    try { d4.step(); } catch { /* a refused width: its write line comes before the device */ }
  }
  for (const [a, len] of [[0x97000000, 1], [0x99200514, 2]]) { try { d4.read(a, len); } catch { /* E14: its line is traced too */ } }
  const cpuW = recs.filter((r) => r.cpu === 0 && r.dir === 'w').map((r) => [r.addr, r.value, r.size]);
  const dbgR = recs.filter((r) => r.cpu === -1 && r.dir === 'r').map((r) => [r.addr, r.size]);
  check('MMIO trace: sub-word CPU stores trace the stored byte and halfword', JSON.stringify(cpuW) === JSON.stringify([[0x97000000, 0x78, 1], [0x99200514, 0x5678, 2]]), JSON.stringify(cpuW));
  check('MMIO trace: debugger reads of 1 and 2 bytes trace their size', JSON.stringify(dbgR) === JSON.stringify([[0x97000000, 1], [0x99200514, 2]]), JSON.stringify(dbgR));
  d4.close();
  return { checks: n, bad };
}

// ---- snapshot units ------------------------------------------------------------------------------------------------
export function snapshotUnits() {
  try { return snapshotUnitsBody(); } catch (e) { return { checks: 1, bad: [`snapshotUnits: threw ${e.name}: ${e.message}`] }; }
}
function snapshotUnitsBody() {
  const bad = [];
  let n = 0;
  const check = (what, ok, detail = '') => { n++; if (!ok) bad.push(`snapshot: ${what}${detail ? ` (${detail})` : ''}`); };
  // inc d0; mov d0,(a0); add 4,a0; bra back (stores walk upward through fresh pages), a breakpoint on the bra
  const d1 = Debugger.create({ rom: rom(), createHash }, { insnLimit: 0 });
  d1.write(0xa3000000, Uint8Array.from([0x40, 0x60, 0x50, 0xca, 0xfd]));
  d1.reset({ pc: 0xa3000000, a0: 0xa2400000 });
  d1.breakpoints([0xa3000003]);
  const lap = () => { d1.step(); d1.cont(); };        // off the breakpoint, then once round the loop
  d1.cont();
  for (let i = 0; i < 100; i++) lap();
  const h = d1.snapshot();
  const before = { regs: d1.regs(), bytes: d1.read(0xa2400000, 0x800) };
  const digest = () => {
    const hs = createHash('sha256');
    d1.traceExec((r) => hs.update(`${r.pc},${r.d0},${r.psw}\n`));
    for (let i = 0; i < 20000; i++) lap();
    d1.traceExec(null);
    return { h: hs.digest('hex'), regs: JSON.stringify(d1.regs()), far: d1.read(0xa2410000, 16) };
  };
  const a = digest();
  check('the run went on past the snapshot', d1.regs().a0 > 0xa2410000);
  d1.restore(h);
  check('restore brings the registers back', JSON.stringify(d1.regs()) === JSON.stringify(before.regs));
  check('restore brings memory back', Buffer.from(d1.read(0xa2400000, 0x800)).equals(Buffer.from(before.bytes)));
  check('restore zeroes the pages written after the snapshot', d1.read(0xa2410000, 16).every((x) => x === 0));
  const b = digest();
  d1.restore(h);
  const c = digest();
  check('a snapshot restored twice runs identically', a.h === b.h && b.h === c.h && a.regs === b.regs && b.regs === c.regs, `${a.h.slice(0, 12)} ${b.h.slice(0, 12)} ${c.h.slice(0, 12)}`);
  // refusals: while paused, and while attached
  d1.breakpoints([]);
  d1.cont({ budget: 10 });
  let refused = false;
  try { d1.snapshot(); } catch { refused = true; }
  check('snapshot refused while a continue is paused', refused);
  d1.abort();
  const att = Debugger.attach(Debugger.create({ rom: rom(), createHash }).sim);
  refused = false;
  try { att.snapshot(); } catch { refused = true; }
  check('snapshot refused while attached', refused);
  return { checks: n, bad };
}

// ---- protocol units ----------------------------------------------------------------------------------------------
export function protocolUnits() {
  try { return protocolUnitsBody(); } catch (e) { return { checks: 1, bad: [`protocolUnits: threw ${e.name}: ${e.message}`] }; }
}
function protocolUnitsBody() {
  const bad = [];
  const sinks = new Map();
  const host = { env: { createHash }, defaultImage: ORIG, loadImage: () => rom(),
    // bin/debug.mjs's openSink: with prepare the file is replaced only at commit; 'fail/...' cannot be opened
    openSink: (p, { prepare = false } = {}) => {
      if (p.startsWith('fail/')) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      const lines = [];
      if (!prepare) sinks.set(p, lines);
      return { write: (l) => lines.push(l), close() {}, commit() { sinks.set(p, lines); }, discard() {} };
    }, disasm: null };
  const P = new Protocol(host);
  const ask = (q) => P.handle(q);
  let n = 0;
  const expect = (q, f, what) => { n++; const r = ask(q); if (!f(r)) bad.push(`protocol: ${what}: ${JSON.stringify(r).slice(0, 300)}`); return r; };
  expect({ id: 1, op: 'regs' }, (r) => !r.ok && r.error.type === 'BadRequest' && r.id === 1, 'an op before load');
  expect({ id: 2, op: 'load' }, (r) => r.ok, 'load');
  expect({ id: 3, op: 'nope' }, (r) => !r.ok && r.error.type === 'BadRequest', 'unknown op');
  expect({ id: 4, op: 'read', addr: '0x40000000', size: 4 }, (r) => !r.ok && r.error.type === 'RuntimeError' && /E14/.test(r.error.message), 'unassigned read');
  expect({ id: 5, op: 'reset', regs: { q9: 1 } }, (r) => !r.ok && r.error.type === 'ValueError', 'unknown register');
  expect({ id: 6, op: 'write', addr: '0xa3000000', hex: '40caff' }, (r) => r.ok, 'write');
  expect({ id: 7, op: 'reset', regs: { pc: '0xa3000000' } }, (r) => r.ok, 'reset');
  expect({ id: 8, op: 'trace', exec: 'e', mmio: 'm', irq: 'i', mode: 'native' }, (r) => r.ok, 'trace on');
  expect({ id: 9, op: 'cont', budget: 30 }, (r) => r.ok && r.stop === 'paused', 'budgeted continue');
  expect({ id: 10, op: 'resume', budget: 30 }, (r) => r.ok && r.stop === 'paused', 'resume');
  expect({ id: 11, op: 'snapshot' }, (r) => !r.ok, 'snapshot while paused');
  expect({ id: 12, op: 'abort' }, (r) => r.ok, 'abort');
  expect({ id: 13, op: 'regs' }, (r) => !r.ok && r.error.type === 'Aborted', 'after abort');
  if (!(sinks.get('e')?.length >= 60 && /^MN10300 pc=a3000000 op=40 /.test(sinks.get('e')[0]))) bad.push(`protocol: exec trace lines ${sinks.get('e')?.length}`);
  expect({ id: 14, op: 'load' }, (r) => r.ok, 'load again after an abort');
  expect({ id: 15, op: 'lab', time: true }, (r) => r.ok && r.time === 0, 'lab time');
  expect({ id: 16, op: 'lab', advance: 1000000 }, (r) => r.ok && r.time === 1000000 && r.result === 0, 'lab advance');
  // a refused trace hook opens no file (an earlier trace at that path is kept), and undoes the other hooks it set
  sinks.set('kept', ['an earlier trace']);
  expect({ id: 17, op: 'trace', mmio: 'mm', exec: 'kept', mode: 'one-insn' }, (r) => !r.ok && /oneInsn/.test(r.error.message), 'trace one-insn mode without oneInsn');
  n++;
  if (JSON.stringify(sinks.get('kept')) !== '["an earlier trace"]' || sinks.has('mm')) bad.push(`protocol: a refused trace opened files: ${JSON.stringify([...sinks.keys()])}`);
  // jsonl records: addresses and values as "0x..." strings
  expect({ id: 18, op: 'write', addr: '0xa3000000', hex: '40caff' }, (r) => r.ok, 'write again');
  expect({ id: 19, op: 'reset', regs: { pc: '0xa3000000' } }, (r) => r.ok, 'reset again');
  expect({ id: 20, op: 'trace', exec: 'j', format: 'jsonl' }, (r) => r.ok, 'jsonl trace');
  expect({ id: 21, op: 'step', n: 2 }, (r) => r.ok, 'steps');
  expect({ id: 22, op: 'trace', off: true }, (r) => r.ok, 'trace off');
  n++;
  const j0 = JSON.parse(sinks.get('j')?.[0] ?? '{}');
  // (fix1) a request that fails on a later key changes no file and keeps the trace that was running
  expect({ id: 220, op: 'trace', exec: 't1' }, (r) => r.ok, 'trace t1');
  expect({ id: 221, op: 'trace', exec: 'kept', mmio: 'fail/m' }, (r) => !r.ok && /ENOENT/.test(r.error.message), 'trace with an unopenable mmio file');
  expect({ id: 222, op: 'step', n: 2 }, (r) => r.ok, 'steps after the failed trace');
  expect({ id: 223, op: 'trace', off: true }, (r) => r.ok, 'trace off again');
  n++;
  if (JSON.stringify(sinks.get('kept')) !== '["an earlier trace"]' || sinks.get('t1')?.length !== 2) bad.push(`protocol: a failed trace request: kept ${JSON.stringify(sinks.get('kept'))}, the running trace's lines ${sinks.get('t1')?.length} (want 2)`);
  if (j0.pc !== '0xa3000000' || j0.op !== '0x40' || !/^0x[0-9a-f]{8}$/.test(j0.sp) || !/^0x[0-9a-f]{4}$/.test(j0.psw) || typeof j0.insns !== 'number') bad.push(`protocol: jsonl record ${JSON.stringify(j0)}`);
  // stack: from SP, from 'at', the tag at initialSp; the old 'sp' field refused with the new names
  expect({ id: 23, op: 'reset', regs: { pc: '0xa3000000', sp: '0xa2100000' } }, (r) => r.ok, 'reset with sp');
  expect({ id: 24, op: 'write', addr: '0xa2100100', hex: '11223344' }, (r) => r.ok, 'stack word');
  expect({ id: 25, op: 'stack', words: 1, at: '0xa2100100', initialSp: '0xa2100100' }, (r) => r.ok && r.stack[0] === 'at+0x000 0xa2100100: 0x44332211 <- initial sp', 'stack at');
  expect({ id: 26, op: 'stack', words: 1 }, (r) => r.ok && r.stack[0].startsWith('sp+0x000 0xa2100000: '), 'stack from SP');
  expect({ id: 27, op: 'stack', words: 1, sp: '0xa2100100' }, (r) => !r.ok && r.error.type === 'BadRequest' && /initialSp/.test(r.error.message), 'stack sp refused');
  expect({ id: 28, op: 'quit' }, (r) => r.ok && P.done, 'quit');
  return { checks: n + 1, bad };
}

// ---- fix2: trace files restarted or shared, the watch log's cap, the stderr ring's drop (bin/debug.mjs's real sinks) -
export function limitUnits() {
  const bad = [];
  let n = 0;
  fs.mkdirSync(path.join(os.homedir(), '.cache/om-emu-tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache/om-emu-tmp/test-debug-'));
  try {
    const P = new Protocol({ env: { createHash }, defaultImage: ORIG, loadImage: () => rom(), openSink, disasm: null, resolvePath: (p) => path.resolve(p) });
    const ask = (q) => P.handle(q);
    const expect = (q, f, what) => { n++; const r = ask(q); if (!f(r)) bad.push(`limits: ${what}: ${JSON.stringify(r).slice(0, 300)}`); return r; };
    const lines = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
    const at = (f) => path.join(dir, f);
    expect({ op: 'load' }, (r) => r.ok, 'load');
    expect({ op: 'write', addr: '0xa3000000', hex: '40caff' }, (r) => r.ok, 'write a loop');
    expect({ op: 'reset', regs: { pc: '0xa3000000' } }, (r) => r.ok, 'reset');
    // a trace restarted on its own file starts empty: the replaced trace's buffered lines are written before the
    // truncate (they came back after it)
    expect({ op: 'trace', exec: at('same.txt') }, (r) => r.ok, 'trace same.txt');
    expect({ op: 'step', n: 20 }, (r) => r.ok, 'step 20');
    expect({ op: 'trace', exec: at('same.txt') }, (r) => r.ok, 'trace same.txt again');
    expect({ op: 'step', n: 2 }, (r) => r.ok, 'step 2');
    expect({ op: 'trace', off: true }, (r) => r.ok, 'trace off');
    n++;
    if (lines('same.txt').length !== 2) bad.push(`limits: a trace restarted on its file holds ${lines('same.txt').length} lines (want 2)`);
    // two keys on one file share it; a file a running trace keeps writing is refused, nothing changed
    expect({ op: 'trace', exec: at('both.txt'), irq: at('both.txt') }, (r) => r.ok, 'exec and irq on one file');
    expect({ op: 'trace', mmio: at('both.txt') }, (r) => !r.ok && r.error.type === 'BadRequest' && /running/.test(r.error.message), 'mmio on the running traces\' file');
    expect({ op: 'step', n: 3 }, (r) => r.ok, 'step 3');
    expect({ op: 'trace', off: true }, (r) => r.ok, 'trace off again');
    n++;
    if (lines('both.txt').length !== 3) bad.push(`limits: exec and irq sharing a file: ${lines('both.txt').length} lines (want the 3 exec lines)`);
    // the watch log keeps the newest hits: 250,000 logged (a store and a branch per hit), 100,000 dropped at 200,000
    expect({ op: 'load', insnLimit: 0 }, (r) => r.ok, 'load without a limit');
    expect({ op: 'reset', regs: { pc: '0xa3000000', a0: '0xa2100000' } }, (r) => r.ok, 'reset for the store loop');
    expect({ op: 'write', addr: '0xa3000000', hex: '60caff' }, (r) => r.ok, 'mov d0,(a0); bra');
    expect({ op: 'watch', list: [{ addr: '0xa2100000', len: 4, kind: 'w', action: 'log' }] }, (r) => r.ok, 'a log watchpoint');
    expect({ op: 'cont', budget: 500000 }, (r) => r.ok && r.stop === 'paused', '500,000 instructions');
    expect({ op: 'watchLog' }, (r) => r.ok && r.entries.length === 100000 && r.more === 50000 && r.dropped === 100000 && r.entries[0].insns > 100000, 'watchLog: the oldest 100,000 kept, 50,000 more, 100,000 dropped');
    expect({ op: 'watchLog', limit: 10 }, (r) => r.ok && r.entries.length === 10 && r.more === 49990 && r.dropped === 0, 'watchLog limit 10');
    expect({ op: 'abort' }, (r) => r.ok, 'abort');
    // the stderr ring: 1,100 faulting continues write 2,200 lines; since 0 answers the kept ones and how many are gone
    expect({ op: 'load' }, (r) => r.ok, 'load for stderr');
    expect({ op: 'write', addr: '0xa3000000', hex: '70' }, (r) => r.ok, 'a faulting read');
    for (let i = 0; i < 1100; i++) { ask({ op: 'reset', regs: { pc: '0xa3000000', a0: '0x98e0009c' } }); ask({ op: 'cont' }); }
    expect({ op: 'stderr' }, (r) => r.ok && r.count === 2200 && r.first === 1000 && r.dropped === 1000 && r.lines.length === 1200, 'stderr since 0 after the ring dropped 1,000');
    expect({ op: 'stderr', since: 2100 }, (r) => r.ok && r.first === 2100 && r.dropped === 0 && r.lines.length === 100, 'stderr since 2100');
    expect({ op: 'quit' }, (r) => r.ok, 'quit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { checks: n, bad };
}

// ---- the debugger on a lab session, and disasm's line filter ---------------------------------------------------------
export function attachUnits() {
  const bad = [];
  let n = 0;
  const check = (what, ok, extra = '') => { n++; if (!ok) bad.push(`attach: ${what} ${extra}`); };
  const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
  const base = Debugger.create({ rom: rom(), createHash });
  const lab = Debugger.attach(base.sim, { lab: {} });
  check('breakpoints refused on a lab session', /refused while attached to a lab session/.test(thrown(() => lab.breakpoints([0x50000000]))?.message ?? ''));
  check('a stopping watchpoint refused on a lab session', /refused/.test(thrown(() => lab.watch([{ lo: 0x9bb90060, len: 4, kind: 'w' }]))?.message ?? ''));
  check('a log watchpoint accepted on a lab session', thrown(() => lab.watch([{ lo: 0x9bb90060, len: 4, kind: 'w', action: 'log' }])) === null);
  check('breakpoints() read accepted on a lab session', thrown(() => lab.breakpoints()) === null);
  const plain = Debugger.attach(base.sim, {});              // debug.mjs's command line: a Simulator of its own
  check('breakpoints accepted without a lab', thrown(() => plain.breakpoints([0x50000000])) === null);
  plain.watch([]);
  base.close();                                            // one machine at a time
  // disasm: the window plus 6 bytes goes to the callback; lines past the window, objdump's out-of-bounds lines and bare
  // 'addr:' lines are dropped
  let got = null;
  const d = Debugger.create({ rom: rom(), createHash }, {
    disasm: (addr, bytes) => {
      got = [addr, bytes.length];
      return ['50000000:\tf3 58       \tmov\td1,(d2,a0)', '50000002:\tfc dc 4c dd \tAddress 0x50000002 is out of bounds.', '50000006:',
        '50000006:\tfc ff 8c 00 \tcalls\t0x50000095', '5000000a:\t00 00', '5000000c:\tfc cd a8 88 \tmov\t1630701736,d1', '50000010:\t32 61'];
    } });
  const lines = d.disasm(0x50000000, 8);
  check('disasm reads 6 bytes past the window', got && got[0] === 0x50000000 && got[1] === 14, JSON.stringify(got));
  // (fix1) a continuation line (bytes, no mnemonic) is its instruction's tail: appended, never a line; dropped with an
  // instruction past the window
  check('disasm keeps only instructions in the window, whole', JSON.stringify(lines) === JSON.stringify(['50000000:\tf3 58       \tmov\td1,(d2,a0)', '50000006:\tfc ff 8c 00 00 00 \tcalls\t0x50000095']), JSON.stringify(lines));
  d.close();
  return { checks: n, bad };
}

// ---- the trace rules and edge cases no firmware session reaches (firmware-free: a machine on a blank image) -------
// ROADMAP "Debug API follow-ups" items 1-3. No session of the golden workload, the native lens, the HDMI plug or the
// E144 bring-up makes a halfword device access (X, 2026-10-29: every sub-word CPU access there is the ISC lock bytes
// and the HDMI EDID bytes), so the halfword gate is a JSON-lines session of its own on the lab stub's registers, which
// take every width:
//   halfwordSession  movhu and movbu stores and loads on stub registers through the Protocol (the interpreter's inline
//                    forms in a continue, the helper's in single steps) and debugger reads of 2 bytes: the qemu-format
//                    lines with the stored halfword and byte (sub-word values of a register with high bits), the
//                    loads' values, cpu 0 with the instruction's pc and cpu -1 for the debugger
//   stubFetch        code run from the lab stub: a memory_region_ops_read line of size 1 per byte read, the
//                    translator's reads of every byte in order, then the helper's of op, the prefix byte and the
//                    operands it decodes; an exec line per instruction; the data access between them; at the insn
//                    limit the translator's reads, then fault 7 (2 for a byte the stub denies)
//   busWindow        CPU accesses through the bus window's pages off bus DRAM: a live-view range is RAM (the store
//                    reaches the bus, the loads read it back) and an unbacked range a bus fault, with no trace line
//                    either way; debugger reads there neither
//   fetchFault       a code-fetch fault in an instruction's bytes (its op byte, the prefix byte, byte 1 of a form
//                    without a prefix, a later operand byte): no exec line in either trace mode or a single step, fault
//                    2 at the instruction's pc with the first byte it cannot read as the address, not counted; at the
//                    insn limit fault 2 too, not 7 (a fault in byte 1 of a two-byte form was counted, with an exec line
//                    in one-insn mode only, before 2026-10-29: FIDELITY-NOTES 3.3)
//   entryWatch       a stopping watchpoint on the stack slot an interrupt entry stores the pc to: the continue stops
//                    after the entry, before the handler's first instruction (the stop's pc the handler's, the hit's
//                    pc and insns the interrupted instruction's), and a continue from there runs as without the watch
const BLANK = new Uint8Array(0x1000);
const STUB_ALLOW = 0x89900100;                       // the lab stub's allow table (src/dev/stub.mjs): {base, size, flags}
const le32s = (...ws) => Buffer.concat(ws.map((w) => { const b = Buffer.alloc(4); b.writeUInt32LE(w >>> 0); return b; }));
export function traceRuleUnits() {
  const bad = [];
  let n = 0;
  const check = (what, ok, detail = '') => { n++; if (!ok) bad.push(`trace rules: ${what}${detail ? ` (${detail})` : ''}`); };
  for (const [name, f] of [['halfwordSession', halfwordSession], ['stubFetch', stubFetch], ['busWindow', busWindow], ['fetchFault', fetchFault], ['entryWatch', entryWatch]]) {
    try { f(check); } catch (e) { check(`${name} threw ${e.name}: ${e.message}`, false); }
  }
  return { checks: n, bad };
}
const fresh = (opts = {}) => Debugger.create({ rom: BLANK, createHash }, opts);
const h8 = (v) => (v >>> 0).toString(16).padStart(8, '0');

function halfwordSession(check) {
  const files = new Map();
  const P = new Protocol({ env: { createHash }, defaultImage: 'blank', loadImage: () => BLANK, disasm: null,
    openSink: (p) => { const l = []; files.set(p, l); return { write: (x) => l.push(x), close() {}, commit() {}, discard() {} }; } });
  const ask = (q) => { const r = P.handle(q); if (!r.ok) throw new Error(`${q.op}: ${r.error.type} ${r.error.message}`); return r; };
  // movhu d0,(a0); movhu (a0),d1; movbu d0,(a1); movbu (a1),d2; nop
  const prog = 'f070f064f051f049cb', regs = { pc: '0xa3000000', d0: '0x12345678', a0: '0x98000002', a1: '0x98000005' };
  ask({ op: 'load' });
  ask({ op: 'write', addr: STUB_ALLOW, hex: le32s(0x98000000, 0x1000, 1).toString('hex') });
  ask({ op: 'write', addr: '0xa3000000', hex: prog });
  ask({ op: 'reset', regs });
  ask({ op: 'trace', mmio: 'run' });
  const c = ask({ op: 'cont', stops: ['0xa3000008'] });
  check('halfword session: the continue ends at the breakpoint with the loads\' values', c.stop === 'break' && c.regs.d1 === '0x00005678' && c.regs.d2 === '0x00000078', JSON.stringify(c.regs));
  ask({ op: 'trace', mmio: 'steps' });
  ask({ op: 'reset', regs });
  const s = ask({ op: 'step', n: 4 });
  check('halfword session: four single steps end where the continue did', s.regs.pc === '0xa3000008' && s.regs.d1 === '0x00005678' && s.regs.d2 === '0x00000078', JSON.stringify(s.regs));
  ask({ op: 'trace', mmio: 'debugger' });
  const r2 = ask({ op: 'read', addr: '0x98000002', size: 2 }), r4 = ask({ op: 'read', addr: '0x98000004', size: 2 });
  check('halfword session: debugger reads of 2 bytes', r2.hex === '7856' && r4.hex === '0078', `${r2.hex} ${r4.hex}`);
  ask({ op: 'trace', off: true });
  const line = (dir, cpu, a, v, size, pc) => `memory_region_ops_${dir} cpu ${cpu} addr 0x${a.toString(16)} value 0x${v.toString(16)} size ${size} name 'om1.lab-stub' pc ${pc === null ? '-' : h8(pc)}`;
  const cpu = [line('write', 0, 0x98000002, 0x5678, 2, 0xa3000000), line('read', 0, 0x98000002, 0x5678, 2, 0xa3000002),
    line('write', 0, 0x98000005, 0x78, 1, 0xa3000004), line('read', 0, 0x98000005, 0x78, 1, 0xa3000006)];
  const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
  check('halfword session: the continue\'s lines (inline forms): the stored halfword and byte, the loads, the pcs', same(files.get('run'), cpu), JSON.stringify(files.get('run')));
  check('halfword session: the single steps\' lines (the helper) are the same', same(files.get('steps'), cpu), JSON.stringify(files.get('steps')));
  check('halfword session: the debugger\'s reads trace cpu -1 at their size', same(files.get('debugger'), [line('read', -1, 0x98000002, 0x5678, 2, null), line('read', -1, 0x98000004, 0x7800, 2, null)]), JSON.stringify(files.get('debugger')));
  ask({ op: 'quit' });
}

function stubFetch(check) {
  const d = fresh(), P0 = 0x98000100;
  d.write(STUB_ALLOW, le32s(0x98000000, 0x1000, 1));
  // nop; add 5,d0; movhu (a0),d1; nop, stored into the stub by CPU word stores (it refuses debugger writes), and the
  // halfword the movhu reads
  for (const [a, w] of [[P0, 0xf00528cb], [P0 + 4, 0xcbcbcb64], [0x98000000, 0xbeef0000]]) d.cpuStore(a, w);
  d.reset({ pc: P0, a0: 0x98000002 });
  const mmio = [], exec = [];
  d.traceMmio((r) => mmio.push([r.dir, r.addr, r.size, r.value, r.pc, r.cpu, r.name]));
  d.traceExec((r) => exec.push(r.pc));
  const o = d.cont({ stops: [P0 + 6] });
  d.traceMmio(null); d.traceExec(null);
  check('stub fetch: the program ran to the breakpoint', o.stop === 'break' && o.regs.pc === P0 + 6 && o.regs.d0 === 5 && o.regs.d1 === 0xbeef && o.regs.insns === 4, JSON.stringify(o.regs));
  const code = [0xcb, 0x28, 0x05, 0xf0, 0x64, 0xcb];
  const byte = (at, pc) => ['r', P0 + at, 1, code[at], P0 + pc, 0, 'om1.lab-stub'];
  const want = [byte(0, 0), byte(0, 0),                                     // nop: the translator's read, the helper's
    byte(1, 1), byte(2, 1), byte(1, 1), byte(2, 1),                         // add 5,d0: op and imm8, then op and imm8
    byte(3, 3), byte(4, 3), byte(3, 3), byte(4, 3), ['r', 0x98000002, 2, 0xbeef, P0 + 3, 0, 'om1.lab-stub'],
    byte(5, 5), byte(5, 5)];
  check('stub fetch: each code byte read is a size-1 line, the translator\'s reads then the helper\'s', JSON.stringify(mmio) === JSON.stringify(want), JSON.stringify(mmio));
  check('stub fetch: an exec line per instruction', JSON.stringify(exec) === JSON.stringify([P0, P0 + 1, P0 + 3, P0 + 5]), JSON.stringify(exec));
  d.close();
  // at the insn limit the instruction is fetched as the translator fetches it, through the device, then fault 7 (before
  // 2026-10-29 the fetch's MMIO signal escaped as a host error that stopped the machine); a byte the stub denies is a
  // fetch fault, 2
  for (const [how, allowed] of [['cont', true], ['step', true], ['cont', false]]) {
    const e = fresh({ insnLimit: 1 });
    e.write(STUB_ALLOW, le32s(0x98000000, 0x1000, 1));
    e.cpuStore(P0, 0xf00528cb);
    if (!allowed) e.write(STUB_ALLOW, le32s(0x98000000, P0 + 2 - 0x98000000, 1));   // byte 1 of add 5,d0 left out
    e.reset({ pc: P0 });
    const lines = [];
    e.traceMmio((r) => lines.push([r.addr - P0, r.size, r.err]));
    const o = how === 'cont' ? e.cont() : (e.step(), e.step());
    const want = allowed ? { stop: 'limit', fault: 7, insns: 2, lines: [[0, 1, false], [0, 1, false], [1, 1, false], [2, 1, false]] }
      : { stop: 'fault', fault: 2, insns: 1, lines: [[0, 1, false], [0, 1, false], [1, 1, false], [2, 1, true]] };
    const got = { stop: o.stop, fault: o.fault, insns: o.regs.insns, lines };
    check(`stub fetch at the insn limit (${how}${allowed ? '' : ', a denied byte'}): ${want.stop} ${want.fault}, the bytes read once each through the stub`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
    e.close();
  }
}

function busWindow(check) {
  const d = fresh(), mmio = [];
  d.traceMmio((r) => mmio.push([r.dir, r.addr, r.value, r.size, r.name]));
  d.cpuStore(0x98100058, 0x12161514);          // the window register: segment 0x12, bus 0x90000000 at 0xB8000000
  // mov d0,(a0); mov (a0),d1; movbu (a0),d2; mov (a1),d3 with a0 on the live-view range 0x95F6C000.. (bus 0x95F70000)
  // and a1 on bus 0x90000000, which no range backs
  d.write(0xa3000000, Uint8Array.from([0x60, 0x74, 0xf0, 0x48, 0x7d]));
  d.reset({ pc: 0xa3000000, d0: 0x12345678, a0: 0xbdf70000, a1: 0xb8000000 });
  const o = d.cont({ budget: 10 });
  const t = new Uint8Array(4);
  d.m.devices.bus.read(0x95f70000, t);
  check('bus window: the live-view page is RAM through the window (the store on the bus, both loads read it)', o.regs.d1 === 0x12345678 && o.regs.d2 === 0x78 && Buffer.from(t).toString('hex') === '78563412', `${JSON.stringify(o.regs)} bus ${Buffer.from(t).toString('hex')}`);
  check('bus window: the load from the unbacked page is a bus fault', o.stop === 'fault' && o.fault === 2 && o.regs.pc === 0xa3000004, JSON.stringify(o));
  let unbacked = null;
  try { d.read(0xb8000000, 4); } catch (e) { unbacked = e.message; }
  check('bus window: debugger reads through it (the live-view page read, the unbacked one E14)', Buffer.from(d.read(0xbdf70000, 4)).toString('hex') === '78563412' && /E14/.test(unbacked ?? ''), String(unbacked));
  check('bus window: no trace line but the window register\'s store', JSON.stringify(mmio) === JSON.stringify([['w', 0x98100058, 0x12161514, 4, 'om1.buswin']]), JSON.stringify(mmio));
  d.close();
}

function fetchFault(check) {
  // [bytes, where the first byte goes, the first byte the fetch cannot read]: 0x40000 is the first unassigned byte after
  // the lab's low RAM
  const END = 0x40000;
  const forms = [['the op byte', [], END], ['byte 1 of add imm8,d0 (28 xx)', [0x28], END], ['byte 1 of bra (ca xx)', [0xca], END],
    ['byte 1 of mov imm16,d0 (2c xx xx)', [0x2c], END], ['byte 2 of mov imm16,d0', [0x2c, 0x01], END],
    ['the prefix byte (f0 xx)', [0xf0], END], ['an imm32 byte of mov imm32,d0 (fc cc xx xx xx xx)', [0xfc, 0xcc, 0x01], END]];
  for (const [what, bytes, addr] of forms) {
    const at = END - bytes.length - 2, pc = END - bytes.length;          // two nops, then the instruction
    const got = {};
    for (const mode of ['cont', 'native', 'one-insn', 'step', 'limit']) {
      const d = fresh({ oneInsn: mode === 'one-insn', ...(mode === 'limit' ? { insnLimit: 2 } : {}) });
      d.write(at, Uint8Array.from([0xcb, 0xcb, ...bytes]));
      d.reset({ pc: at });
      const lines = [];
      if (mode !== 'cont' && mode !== 'limit') d.traceExec((r) => lines.push(r.pc), { mode: mode === 'one-insn' ? 'one-insn' : 'native' });
      let o;
      if (mode === 'step') { for (let i = 0; i < 4; i++) { o = d.step(); if (o.stop !== 'break') break; } } else o = d.cont({ budget: 50 });
      got[mode] = { stop: o.stop, fault: o.fault, pc: o.regs.pc, insns: o.regs.insns, lines, trap: o.stderr.at(-1) };
      d.close();
    }
    const trap = `om-emu: MN10300 trap reason=2 pc=0x${h8(pc)} address=0x${h8(addr)}`;
    const want = { stop: 'fault', fault: 2, pc, insns: 2, trap };
    const ok = Object.entries(got).every(([mode, g]) => Object.entries(want).every(([k, v]) => g[k] === v) && (mode === 'cont' || mode === 'limit' || JSON.stringify(g.lines) === JSON.stringify([at, at + 1])));
    check(`fetch fault in ${what}: fault 2 at the first byte not read, not counted, no exec line (continue, native, one-insn, step, insn limit)`, ok, JSON.stringify(got));
  }
}

function entryWatch(check) {
  const SP0 = 0xa2200000, MAIN = 0xa3000000;
  const run = (watched) => {
    const d = fresh({ insnLimit: 0 });
    const handler = (S.vectorPage | 0x0100) >>> 0;
    d.write(MAIN, Uint8Array.from([0xcb, 0xca, 0xff]));               // nop; bra back to it
    d.write(handler, Uint8Array.from([0x40, 0xca, 0xff]));            // the handler: inc d0; bra back to it
    d.write(0x8000 + 4 * 3, Uint8Array.from([0x00, 0x01]));           // IVAR3: the handler at the vector page + 0x100
    d.reset({ pc: MAIN });
    d.cpuStore(0x99200000 + 4 * 100, 1 << 3);                         // IRQ 100 at level 3
    d.write(0x89A00008, Uint8Array.of(2));                            // gate mode 2: every look may accept
    d.write(0x89A03000 + 100, Uint8Array.of(1));                      // its test line ...
    d.cpuStore(0x89A20000, 1);                                        // ... applied (doorbell command 1)
    d.reset({ pc: MAIN, sp: SP0, psw: 0x0f00 });
    const irqs = [];
    d.traceIrq((r) => irqs.push(r.kind));
    if (watched) d.watch([{ id: 'pc slot', lo: SP0 - 4, len: 4, kind: 'w' }]);
    const first = d.cont({ budget: 40 });
    const out = { first, handler, irqs, stack: [d.u32(SP0 - 8), d.u32(SP0 - 4)] };
    out.end = watched ? d.cont({ budget: 40 }) : first;
    if (d.paused()) d.halt();
    d.close();
    return out;
  };
  const plain = run(false), w = run(true), f = w.first;
  check('watch in an interrupt entry: the continue stops after the entry, before the handler\'s first instruction',
    f.stop === 'watch' && f.regs.pc === w.handler && f.regs.sp === SP0 - 8 && (f.regs.psw & 0x0f00) === 0x0300 && f.regs.insns === 0 && f.regs.d0 === 0, JSON.stringify(f.regs));
  check('watch in an interrupt entry: the hit is the pc store, with the interrupted instruction\'s pc and insns',
    f.watch?.id === 'pc slot' && f.watch.addr === SP0 - 4 && f.watch.dir === 'w' && f.watch.size === 4 && f.watch.value === MAIN && f.watch.pc === MAIN && f.watch.insns === 0, JSON.stringify(f.watch));
  check('watch in an interrupt entry: the entry\'s frame is on the stack at the stop', w.stack[0] === 0x0f00 && w.stack[1] === MAIN, JSON.stringify(w.stack));
  check('watch in an interrupt entry: a continue from the stop runs as the continue without the watch (one acceptance)',
    w.end.stop === 'paused' && JSON.stringify(w.end.regs) === JSON.stringify(plain.end.regs) && plain.end.regs.d0 === 20 && JSON.stringify(w.irqs) === JSON.stringify(plain.irqs) && plain.irqs.join() === 'accepted',
    `${JSON.stringify(w.end.regs)} vs ${JSON.stringify(plain.end.regs)}; irqs ${w.irqs} / ${plain.irqs}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const [name, f] of [['watch', watchUnits], ['snapshot', snapshotUnits], ['protocol', protocolUnits], ['limits', limitUnits], ['attach', attachUnits], ['trace rules', traceRuleUnits]]) {
    const r = f();
    console.log(`${name}: ${JSON.stringify({ ...r, bad: r.bad.length })}`);
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  process.exit(n ? 1 : 0);
}
