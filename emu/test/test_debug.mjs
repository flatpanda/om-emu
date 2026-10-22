// The debug API's units: the watchpoint mechanism (fast entries off on watched pages, a store that does not re-enable
// them, read/write/access kinds, stop after the accessing instruction, a log entry that changes nothing), the snapshot
// round trip, the JSON-lines errors, the trace-file, watch-log and stderr limits, and the debugger on a lab session
// with disasm's line filter.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const [name, f] of [['watch', watchUnits], ['snapshot', snapshotUnits], ['protocol', protocolUnits], ['limits', limitUnits], ['attach', attachUnits]]) {
    const r = f();
    console.log(`${name}: ${JSON.stringify({ ...r, bad: r.bad.length })}`);
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  process.exit(n ? 1 : 0);
}
