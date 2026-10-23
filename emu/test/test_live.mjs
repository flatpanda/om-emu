// The debug API's live route to a play session (F31, src/debug/live.mjs) and the protocol's argument checks.
//   liveUnits (firmware-free, bin/test-pure.mjs): the protocol's malformed fields as BadRequest (a stops string, a
//     value over 32 bits, a step count of 0 or -1, and their siblings), halt of a paused continue, the trace filters,
//     a lab watch log's lab_ns and n, an attached Protocol's refusals, POST /api/debug's refusals and answers, and the
//     browser driver's wait while halted;
//   liveSession (E143 firmware, a headless Player): refused without --debug-api; halt with an input held and resume;
//     a stopping watchpoint and a breakpoint hit inside an input's run, reads, steps and cont while held there, then
//     detach, the input answered as without the debugger; a control letting a stop go; cont's maxMs; the refusals of a
//     queue that does not block;
//   liveHost (E143 firmware, bin/play.mjs over HTTP): /api/debug halt, reads, a stop, step, detach on a session pacing
//     against the wall clock, and bin/debug.mjs --attach's JSON lines.
//   node emu/test/test_live.mjs [--units | --session | --host]
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Debugger } from '../src/debug/debugger.mjs';
import { Protocol } from '../src/debug/protocol.mjs';
import { PlayApi } from '../src/lab/playapi.mjs';
import { Driver, IDLE_WAIT_MS } from '../web/driver.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
// the watch units' program at 0xa3000000: mov d0,(a0); nop; movbu (a1),d1; nop; mov d0,(a0); nop; bra . (a loop)
const PROG = Uint8Array.from([0x60, 0xcb, 0xf0, 0x45, 0xcb, 0x60, 0xcb, 0xca, 0x00]);
const tester = (tag) => {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(`${tag}: ${what}`); };
  return { bad, ok, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

// ---- firmware-free ---------------------------------------------------------------------------------------------
export async function liveUnits() {
  const t = tester('live units');
  const { ok } = t;
  try {
    const lines = new Map();               // an in-memory trace file per path
    const sink = (p) => { lines.set(p, []); return { write: (l) => lines.get(p).push(l), close() {}, commit() {}, discard() {} }; };
    const P = new Protocol({ env: { createHash }, defaultImage: 'tiny', loadImage: () => new Uint8Array(0x1000), openSink: sink, disasm: null });
    let id = 0;
    const ask = (q) => P.handle({ id: ++id, ...q });
    const bad = (q, re, what) => { const r = ask(q); ok(!r.ok && r.error.type === 'BadRequest' && re.test(r.error.message), `${what}: ${JSON.stringify(r)}`); };
    const good = (q, what, pred = () => true) => { const r = ask(q); ok(r.ok && pred(r), `${what}: ${JSON.stringify(r).slice(0, 300)}`); return r; };
    good({ op: 'load' }, 'load');
    good({ op: 'write', addr: '0xa3000000', hex: Buffer.from(PROG).toString('hex') }, 'write the program');
    const fresh = () => good({ op: 'reset', regs: { pc: '0xa3000000', d0: 7, a0: '0xa2100000', a1: '0x97000000' } }, 'reset');
    fresh();
    // the ROADMAP's three, then their siblings
    bad({ op: 'cont', stops: '0x502d0341' }, /stops: a list/, 'cont stops as a string');
    bad({ op: 'setReg', name: 'd0', value: '0x1ffffffff' }, /not a 32-bit value/, 'setReg over 32 bits');
    bad({ op: 'step', n: 0 }, /not a positive integer/, 'step n 0');
    bad({ op: 'step', n: -1 }, /not a positive integer/, 'step n -1');
    good({ op: 'setReg', name: 'd1', value: -1 }, 'setReg -1 (a signed 32-bit value)');
    ok(ask({ op: 'reg', name: 'd1' }).value === '0xffffffff', 'setReg -1 is 0xffffffff');
    bad({ op: 'setReg', name: 'd1', value: -0x80000001 }, /not a 32-bit value/, 'setReg below -2^31');
    bad({ op: 'break', pcs: '0x50000000' }, /pcs: a list/, 'break pcs as a string');
    bad({ op: 'break', pcs: ['0x100000000'] }, /not a 32-bit address/, 'break at an address over 32 bits');
    bad({ op: 'setRegs', regs: 'd0' }, /regs: an object/, 'setRegs regs as a string');
    bad({ op: 'setRegs', regs: { d0: 2 ** 32 } }, /not a 32-bit value/, 'setRegs over 32 bits');
    bad({ op: 'reset', regs: { pc: '0x150000000' } }, /not a 32-bit value/, 'reset over 32 bits');
    bad({ op: 'cpuStore', addr: '0xa2100000', value: '0x1ffffffff' }, /not a 32-bit value/, 'cpuStore value over 32 bits');
    bad({ op: 'read', addr: '0x100000000', size: 4 }, /not a 32-bit address/, 'read past 32 bits');
    bad({ op: 'read', addr: '0xa2100000', size: -1 }, /not a non-negative integer/, 'read size -1');
    bad({ op: 'write', addr: -4, hex: '00' }, /not a 32-bit address/, 'write at -4');
    bad({ op: 'watch', list: '0xa2100000' }, /list: a list/, 'watch list as a string');
    bad({ op: 'watch', list: [5] }, /list\[0\]: an object/, 'watch entry that is a number');
    bad({ op: 'watch', list: [{ addr: '0xa2100000', len: 0 }] }, /len: 0 is not a positive integer/, 'watch len 0');
    bad({ op: 'step', n: 1.5 }, /a number/, 'step n 1.5');
    bad({ op: 'cont', budget: 0 }, /budget: 0 is not a positive integer/, 'cont budget 0');
    bad({ op: 'cont', maxMs: -1 }, /maxMs/, 'cont maxMs -1');
    bad({ op: 'stack', words: -1 }, /words/, 'stack words -1');
    bad({ op: 'stderr', since: -1 }, /since/, 'stderr since -1');
    bad({ op: 'watchLog', limit: -1 }, /limit/, 'watchLog limit -1');
    bad({ op: 'disasm', addr: '0xa3000000', n: 0 }, /n: 0 is not a positive integer/, 'disasm n 0');
    bad({ op: 'lab', advance: -5 }, /advance/, 'lab advance -5');
    good({ op: 'step', n: 1 }, 'step n 1', (r) => r.stop === 'break' && r.regs.pc === '0xa3000001');
    // the library's own checks (the command line and other callers)
    const d = P.dbg;
    ok(thrown(() => d.setReg('d0', 2 ** 32))?.name === 'ValueError', 'Debugger.setReg over 32 bits: ValueError');
    ok(thrown(() => d.step(0))?.name === 'ValueError', 'Debugger.step(0): ValueError');
    // halt: a paused continue ended, the machine runnable
    fresh();
    good({ op: 'cont', budget: 5 }, 'a budget continue pauses', (r) => r.stop === 'paused');
    good({ op: 'halt' }, 'halt ends it', (r) => r.stop === 'halt');
    good({ op: 'step' }, 'the machine runs after a halt', (r) => r.stop === 'break');
    ok(!ask({ op: 'halt' }).ok, 'halt without a paused continue is an error');
    // trace filters: the exec trace of one pc, the MMIO trace of one direction and range
    fresh();
    good({ op: 'trace', exec: 'e.log', format: 'jsonl', filter: { exec: { pcs: ['0xa3000002'] } }, mmio: 'm.log', pc: false }, 'trace with filters');
    good({ op: 'cont', budget: 40 }, 'a run to the closing loop');
    good({ op: 'halt' }, 'halt');
    good({ op: 'trace', off: true }, 'trace off');
    const ex = lines.get('e.log'), mm = lines.get('m.log');
    ok(ex.length === 1 && JSON.parse(ex[0]).pc === '0xa3000002', `exec filter pcs: only 0xa3000002 (${ex.length} lines)`);
    ok(mm.length === 1, `mmio unfiltered: the one read (${mm.length} lines)`);
    fresh();
    good({ op: 'trace', mmio: 'w.log', filter: { mmio: { dir: 'w' } } }, 'mmio filter dir w');
    good({ op: 'trace', mmio: 'r.log', filter: { mmio: { dir: 'r', from: '0x97000000', to: '0x97000001' } } }, 'mmio filter dir r, range');
    good({ op: 'cont', budget: 40 }, 'a run to the closing loop');
    good({ op: 'halt' }, 'halt');
    good({ op: 'trace', off: true }, 'trace off');
    ok(lines.get('w.log').length === 0 && lines.get('r.log').length === 1, `mmio filters: writes ${lines.get('w.log').length} (want 0), reads in range ${lines.get('r.log').length}`);
    bad({ op: 'trace', exec: 'x.log', from: 1, filter: { exec: { from: 2 } } }, /both/, 'from given twice');
    bad({ op: 'trace', mmio: 'x.log', filter: { mmio: { dir: 'x' } } }, /dir/, 'mmio filter dir x');
    bad({ op: 'trace', irq: 'x.log', filter: { irq: { irqs: 7 } } }, /irqs: a list/, 'irq filter irqs as a number');
    bad({ op: 'trace', irq: 'x.log', filter: { dma: {} } }, /not exec, mmio or irq/, 'a filter of no trace');
    // an attached Debugger: a lab's watch log carries lab_ns and n; the attached Protocol's refusals
    const lab = Debugger.attach(d.sim, { lab: {} });
    lab.watch([{ lo: 0xa2100000, len: 4, kind: 'w', action: 'log' }]);
    fresh();
    d.cont({ budget: 40 });
    d.halt();
    const log = lab.watchLog();
    ok(log.length === 2 && log.every((e, i) => e.n === i + 1 && e.lab_ns === 0), `lab watch log: n 1.. and lab_ns: ${JSON.stringify(log.slice(0, 2))}`);
    lab.watch([]);
    const AP = new Protocol({ env: {} }, { attached: lab });
    for (const q of [{ op: 'load' }, { op: 'reset' }, { op: 'snapshot' }, { op: 'cpuStore', addr: 0, value: 0 }, { op: 'lab', advance: 1 }, { op: 'quit' }]) {
      const r = AP.handle(q);
      ok(!r.ok && r.error.type === 'BadRequest' && /not on a live session/.test(r.error.message), `attached ${JSON.stringify(q)} refused: ${JSON.stringify(r)}`);
    }
    ok(AP.handle({ op: 'lab', time: true }).ok && AP.handle({ op: 'regs' }).ok, 'attached lab {time} and regs answered');
    ok(/writes no trace files/.test(AP.handle({ op: 'trace', exec: 'x.log' }).error?.message ?? ''), 'attached trace without openSink refused');
    P.handle({ op: 'quit' });
    // POST /api/debug: refused without --debug-api, a body that is not an object, the answer and the timeout
    const res = new Map();
    const fake = (debug_api) => ({ a: { debug_api }, wall: () => 0, input_seq: 0,
      submit(inp) { this.last = inp; return ++this.input_seq; }, wait_result: async (seq) => res.get(seq) ?? null });
    const post = async (pl, body, q = '') => { const r = await new PlayApi(pl).handle({ method: 'POST', path: `/api/debug${q}`, headers: {}, body: JSON.stringify(body) }); return [r.status, JSON.parse(new TextDecoder().decode(r.body))]; };
    let [st, body] = await post(fake(false), { op: 'regs' });
    ok(st === 403 && body.error === '--debug-api', `/api/debug without --debug-api: ${st} ${JSON.stringify(body)}`);
    const pl = fake(true);
    [st] = await post(pl, [1]);
    ok(st === 400, `/api/debug with a list body: ${st}`);
    res.set(1, { record: null, error: null, dropped: false, debug: { id: 7, ok: true, state: 'running' } });
    [st, body] = await post(pl, { id: 7, op: 'state', type: 'key' });
    ok(st === 200 && body.state === 'running' && pl.last.type === 'debug' && pl.last.op === 'state', `/api/debug answer: ${JSON.stringify(body)}, queued ${JSON.stringify(pl.last)}`);
    [st, body] = await post(pl, { id: 8, op: 'cont' }, '?timeout=0');
    ok(st === 200 && body.id === 8 && body.error?.type === 'Timeout', `/api/debug timeout: ${JSON.stringify(body)}`);
    res.set(3, { record: null, error: 'no session (off)', dropped: false });
    [st, body] = await post(pl, { id: 9, op: 'regs' });
    ok(body.error?.type === 'Refused' && /no session/.test(body.error.message), `/api/debug refused by the Player: ${JSON.stringify(body)}`);
    // the browser's driver: a halted session waits for a debug input or control, its other inputs held
    const dp = { q: [{ type: 'key' }], held: [], live: { halted: true }, ready: false, debug_ready() { return this.ready; }, stopping: () => false };
    const drv = new Driver(dp, { now: () => 0, setTimer: () => 0, clearTimer() {}, macrotask: (f) => f() });
    ok(drv.delay() === IDLE_WAIT_MS, `driver: halted with a key queued waits ${drv.delay()} ms`);
    dp.ready = true;
    ok(drv.delay() === 0, 'driver: halted with a debug input queued: at once');
  } catch (e) { t.bad.push(`live units: threw ${e.stack}`); }
  return { checks: t.checks, bad: t.bad };
}

// ---- a headless Player on E143 -----------------------------------------------------------------------------------
export async function liveSession() {
  const t = tester('live session');
  const { ok } = t;
  const { loadImage, loadBlock } = await import('../checks/lib/env.mjs');
  const { Player, ArrayQueue } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  // a queue that blocks as the node host's does: get() asks the script for the next input (nothing: null)
  class ScriptQueue extends ArrayQueue {
    get canBlock() { return true; }
    get(_t) { if (!this.length && this.feed) this.feed(this); return this.get_nowait(); }
  }
  const results = new Map();
  const base = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000, onResult: (seq, r) => results.set(seq, r) };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true };
  let seq = 0;
  const inp = (x) => ({ seq: ++seq, t_wall: 0, ...x });
  const open = (queue, a = args) => { const p = new Player(a, { ...base, queue }); p.open_session(); return p; };
  try {
    // without --debug-api: refused, and nothing of the route is made
    let pl = open(new ScriptQueue(), { ...args, debug_api: false });
    let x = inp({ type: 'debug', op: 'regs' });
    pl.apply(x);
    ok(results.get(x.seq)?.error === 'debug inputs need --debug-api' && pl.live === null, `refused without --debug-api: ${JSON.stringify(results.get(x.seq))}`);
    pl.close_session();

    const q = new ScriptQueue();
    pl = open(q);
    const ask = (f) => { const i = inp({ type: 'debug', id: seq + 1, ...f }); pl.apply(i); return results.get(i.seq)?.debug; };
    const run = (token) => { const i = inp({ type: 'token', token }); pl.apply(i); return results.get(i.seq); };
    ok(!('debug' in pl.status_doc) && pl.session.lab.sim.debug === null, 'a session no debug input reached: no debug status, no Simulator hook');
    let r = ask({ op: 'state' });
    ok(r?.ok && r.state === 'running' && r.routed === true, `state: ${JSON.stringify(r)}`);
    ok(/only at a debug stop/.test(ask({ op: 'step' })?.error?.message ?? ''), 'step between ticks refused');
    ok(/writes no trace files/.test(ask({ op: 'trace', exec: 'x.log' })?.error?.message ?? ''), 'trace refused without the host\'s files');
    ok(/no disassembler/.test(ask({ op: 'disasm', addr: '0x50000000' })?.error?.message ?? ''), 'disasm refused without the host\'s disassembler');
    ok(/not on a live session/.test(ask({ op: 'lab', advance: 1000 })?.error?.message ?? ''), 'lab advance refused');
    r = ask({ op: 'tasks' });
    ok(r?.ok && r.tasks.length > 4 && r.tasks.some((k) => k.state !== 'DMT') && r.tasks.every((k) => /^0x[0-9a-f]{8}$/.test(k.entry)), `tasks: ${JSON.stringify(r?.tasks?.slice(0, 3))}`);
    r = ask({ op: 'standins', limit: 3 });
    ok(r?.ok && r.calls.length === 3 && r.in_use.includes('S-CAMAPP'), `standins: ${JSON.stringify(r).slice(0, 200)}`);
    // halt: a key input queued meanwhile stays held until resume
    r = ask({ op: 'halt' });
    ok(r?.ok && r.stop === 'halt' && r.at === 'tick' && pl.phase === 'debug', `halt: ${JSON.stringify(r).slice(0, 200)} phase ${pl.phase}`);
    const key = inp({ type: 'dial', id: 'main', detents: 1 });
    const st = inp({ type: 'debug', op: 'state' });
    q.put(key); q.put(st);
    pl.tick();
    ok(results.get(st.seq)?.debug?.state === 'halted' && !results.has(key.seq), 'halted: the debug input ran, the dial waits');
    const rs = inp({ type: 'debug', op: 'resume' });
    q.put(rs);
    pl.tick();
    ok(results.get(rs.seq)?.debug?.state === 'running' && pl.phase === 'running', `resume: ${JSON.stringify(results.get(rs.seq))}`);
    pl.tick();
    ok(results.has(key.seq) && !results.get(key.seq).error, `the dial ran after the resume: ${JSON.stringify(results.get(key.seq)).slice(0, 160)}`);
    // a log watchpoint on the system time: lab_ns and n
    const lab = pl.session.lab, stime = lab.nk.kcb(36);
    ask({ op: 'watch', list: [{ addr: stime, len: 4, kind: 'w', action: 'log' }] });
    ok(lab.sim.debug === null, 'a log watchpoint arms no Simulator hook');
    ok(!run('WAIT:20').error, 'WAIT:20 with a log watchpoint');
    const wl = ask({ op: 'watchLog' })?.entries ?? [];
    ok(wl.length >= 15 && wl.every((e, i) => e.n === wl[0].n + i && (i === 0 || e.lab_ns > wl[i - 1].lab_ns)), `watch log: n consecutive, lab_ns rising: ${wl.length} entries ${JSON.stringify(wl.slice(0, 2))}`);
    // a stopping watchpoint hit inside a WAIT: held there, reads, steps, cont to the next hit, detach
    ask({ op: 'watch', list: [{ addr: stime, len: 4, kind: 'w', action: 'stop' }] });
    const script = [{ op: 'state' }, { op: 'regs' }, { op: 'step', n: 2 }, { op: 'read', addr: stime, size: 4 }, { op: 'cont' }, { op: 'detach' }];
    const sent = [];
    q.feed = (qq) => { const s = script.shift(); if (s) { const i = inp({ type: 'debug', ...s }); sent.push(i.seq); qq.put(i); } };
    const cont = inp({ type: 'debug', op: 'cont' });
    pl.apply(cont);
    ok(!results.has(cont.seq), 'cont answers at the next stop, not at once');
    let w = run('WAIT:20');
    const c = results.get(cont.seq)?.debug, ans = sent.map((s) => results.get(s)?.debug);
    ok(c?.stop === 'watch' && c.at === 'run' && c.during === 'continue' && c.watch?.addr === `0x${stime.toString(16).padStart(8, '0')}` && c.regs.pc !== c.watch.pc,
      `cont: a watch stop after the store: ${JSON.stringify(c).slice(0, 300)}`);
    ok(ans[0]?.state === 'stopped' && ans[1]?.regs?.pc === c.regs.pc, `held: state ${ans[0]?.state}, regs at the stop`);
    ok(ans[2]?.stop === 'break' && Number(ans[2].regs.insns) === Number(c.regs.insns) + 2, `step 2: ${JSON.stringify(ans[2]).slice(0, 200)}`);
    ok(ans[3]?.hex?.length === 8, `read: ${JSON.stringify(ans[3])}`);
    ok(ans[4]?.stop === 'watch' && ans[4].stops === 2 && Number(ans[4].watch.value) === Number(c.watch.value) + 1, `cont: the next tick's store: ${JSON.stringify(ans[4]?.watch)}`);
    ok(ans[5]?.state === 'running' && lab.sim.debug === null, `detach: ${JSON.stringify(ans[5])}`);
    ok(!w.error && w.record?.kind !== undefined && pl.phase === 'running', `the WAIT finished as without the debugger: ${JSON.stringify(w).slice(0, 200)}`);
    // a breakpoint at the store's pc: stop, a step over it, the next tick's hit
    const pc = c.watch.pc;
    script.push({ op: 'step' }, { op: 'cont' }, { op: 'break', pcs: [] }, { op: 'cont' });
    sent.length = 0;
    const b = inp({ type: 'debug', op: 'cont', stops: [pc] });
    pl.apply(b);
    w = run('WAIT:20');
    const bc = results.get(b.seq)?.debug, bans = sent.map((s) => results.get(s)?.debug);
    ok(bc?.stop === 'break' && bc.regs.pc === pc, `cont {stops}: a break at ${pc}: ${JSON.stringify(bc).slice(0, 200)}`);
    ok(bans[0]?.stop === 'break' && bans[0].regs.pc !== pc, `step off the breakpoint: ${bans[0]?.regs?.pc}`);
    ok(bans[1]?.stop === 'break' && bans[1].regs.pc === pc && bans[1].stops === bc.stops + 1, `the next hit: ${JSON.stringify(bans[1]).slice(0, 160)}`);
    ok(!w.error && pl.phase === 'running', `the WAIT finished: ${w.error}`);
    // a control lets a stop go: the breakpoints cleared, the control runs after the tick
    script.push({ op: 'state' });
    sent.length = 0;
    q.feed = (qq) => {
      const s = script.shift();
      if (s) { const i = inp({ type: 'debug', ...s }); sent.push(i.seq); qq.put(i); return; }
      if (!qq.restart) { qq.restart = inp({ type: 'control', op: 'restart' }); qq.put(qq.restart); }
    };
    pl.apply(inp({ type: 'debug', op: 'break', pcs: [pc] }));
    w = run('WAIT:20');
    const restart = q.restart;
    ok(!w.error && pl.live.let_go === 'control restart' && pl.live.pcs.size === 0 && !results.has(restart.seq), `a control let the stop go: ${pl.live.let_go}, WAIT ${w.error}`);
    pl.tick();
    ok(results.get(restart.seq)?.record?.kind === 'control' && pl.session.lab !== lab && ask({ op: 'state' })?.stops === 0, 'the restart ran next: a new session, its debugger fresh');
    // cont's maxMs: a halt at the next tick boundary
    q.feed = null;
    const mc = inp({ type: 'debug', op: 'cont', maxMs: 0 });
    pl.apply(mc);
    pl.tick();
    const m = results.get(mc.seq)?.debug;
    ok(m?.stop === 'halt' && m.reason === 'maxMs' && pl.live.halted, `cont maxMs 0: ${JSON.stringify(m).slice(0, 160)}`);
    ask({ op: 'resume' });
    pl.close_session();
    // a queue that does not block (the browser's Worker, the gates): no debug stops, halt and the reads remain
    pl = open(new ArrayQueue());
    ok(/does not block/.test(ask({ op: 'break', pcs: [pc] })?.error?.message ?? ''), 'break refused on a queue that does not block');
    ok(/does not block/.test(ask({ op: 'watch', list: [{ addr: stime, len: 4, action: 'stop' }] })?.error?.message ?? ''), 'a stopping watchpoint refused there');
    ok(ask({ op: 'watch', list: [{ addr: stime, len: 4, action: 'log' }] })?.ok && ask({ op: 'halt' })?.stop === 'halt', 'a log watchpoint and halt accepted there');
    x = inp({ type: 'dial', id: 'main', detents: 1 });
    pl.q.put(x);
    ok(/halted \(debug\) and no debug input/.test(thrown(() => pl.tick())?.message ?? ''), 'a headless halted session with only a dial queued: refused, not a spin');
    pl.close_session();
  } catch (e) { t.bad.push(`live session: threw ${e.stack}`); }
  return { checks: t.checks, bad: t.bad };
}

// ---- bin/play.mjs over HTTP ----------------------------------------------------------------------------------------
export async function liveHost() {
  const t = tester('live host');
  const { ok } = t;
  const { startPlay } = await import('./test_host.mjs');
  const { KCB } = await import('../src/lab/kernel.mjs');
  const pl = await startPlay('live', []);
  try {
    const dbg = async (q, timeout = 60) => pl.json('POST', `/api/debug?timeout=${timeout}`, q);
    let r = await dbg({ id: 1, op: 'halt' });
    ok(r.id === 1 && r.ok && r.stop === 'halt', `halt: ${JSON.stringify(r).slice(0, 160)}`);
    const st = await pl.status();
    ok(st.phase === 'debug' && st.debug?.state === 'halted', `status while halted: ${st.phase} ${JSON.stringify(st.debug)}`);
    r = await dbg({ op: 'read', addr: KCB[0] + 36, size: 4 });
    const stime = Buffer.from(r.hex, 'hex').readUInt32LE(0);
    r = await dbg({ op: 'watch', list: [{ addr: stime, len: 4, kind: 'w', action: 'stop' }] });
    ok(r.ok && r.count === 1, `a stopping watchpoint on the system time 0x${stime.toString(16)}: ${JSON.stringify(r)}`);
    r = await dbg({ op: 'cont' });
    ok(r.ok && r.stop === 'watch' && r.at === 'run', `cont from the halt: a watch stop: ${JSON.stringify(r).slice(0, 200)}`);
    r = await dbg({ op: 'step', n: 3 });
    ok(r.ok && r.stop === 'break', `step 3: ${JSON.stringify(r).slice(0, 120)}`);
    r = await dbg({ op: 'disasm', addr: r.regs.pc, n: 8 });
    ok(r.ok ? r.lines.length >= 1 : /not found/.test(r.error.message), `disasm (tools/mn10300-objdump when present): ${JSON.stringify(r).slice(0, 160)}`);
    // the JSON-lines client on the same session
    const cli = spawn(process.execPath, [path.join(EMU, 'bin/debug.mjs'), '--attach', `${pl.base}/?t=${pl.token}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    cli.stdout.on('data', (d) => { out += d; });
    cli.stdin.end('{"id": "a", "op": "state"}\nnot json\n{"id": "b", "op": "stack", "words": 2}\n{"id": "c", "op": "detach"}\n');
    const rc = await new Promise((res) => cli.on('exit', res));
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    ok(rc === 0 && lines.length === 4 && lines[0].id === 'a' && lines[0].state === 'stopped' && lines[1].error?.type === 'BadRequest' && lines[2].stack?.length === 2 && lines[3].state === 'running',
      `--attach: rc ${rc}, ${out.slice(0, 400)}`);
    const after = await pl.waitPhase((s) => s.phase === 'running' && s.debug?.state === 'running', 30);
    ok(after.debug.stops >= 1 && after.debug.watchpoints === 0, `running on after detach: ${JSON.stringify(after.debug)}`);
    r = await pl.input({ type: 'token', token: 'GET:1881' });
    ok(r && !r.error, `an input after the debugger: ${JSON.stringify(r).slice(0, 120)}`);
  } catch (e) { t.bad.push(`live host: threw ${e.stack}`); }
  finally { await pl.close(); }
  return { checks: t.checks, bad: t.bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2];
  for (const [name, f] of [['--units', liveUnits], ['--session', liveSession], ['--host', liveHost]]) {
    if (which && which !== name) continue;
    const r = await f();
    console.log(`${name.slice(2)}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    if (r.bad.length) process.exitCode = 1;
  }
}
