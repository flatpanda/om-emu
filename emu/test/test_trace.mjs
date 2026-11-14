// Traces, breakpoints and watchpoints in a scripted session (host/session.mjs trace:, break:, resume; the live debug
// route's probe and hits ops, src/debug/live.mjs; the machine's exec probes, src/core/interp.mjs setProbes):
//   traceUnits    (firmware-free) the tokens and their refusals; the machine's exec probes on a blank image (each
//                 instruction at a probed pc counted once: in a continue, at a budget pause and its resume, at a
//                 breakpoint and the step off it; the registers, instruction count and memory after a probed run
//                 those of an unprobed one; control: the same comparison tells a run one instruction longer apart);
//                 the probes refused on a standalone machine; the live route's hit log (the first HITS_MAX kept, the
//                 rest counted, the counts by pc and range, a take with a limit, hits without a session), the code
//                 address rule (notation taken as notation) and routed with a host that holds stops; bin/session.mjs's
//                 usage errors for the new tokens
//   traceSession  (the process's model, through bin/session.mjs end to end) E143: a flow untraced and traced (a pc of the
//                 settings getter, the S-HEAP malloc hook's pc, a write range on a task stack): every step's lab time
//                 and frame equal (control: the same comparison tells a flow 100 ms shorter apart), the hits bounded per
//                 record with the rest counted, the hook's arrivals as kind 'hook', the totals in the summary; a
//                 breakpoint stop with reads there, break:off and resume; a stopping write watchpoint whose stop is the
//                 logging trace's first hit (pc, address, value, lab time); a break at a hooked pc refused; a run that
//                 ends at a stop (exit 0, ended_at_stop), a failed expect there and a press there (exit 1, nothing
//                 after), a call there refused, a resume without a stop; a call between ticks with a trace and a
//                 break armed at its callee (the arrival recorded in the call's record, no stop; the call's own stop
//                 at the traced pc records none) and refused with a stopping watchpoint armed; with --loaded on a
//                 trace at a pc in a gap records the arrival, then the session stops as without it; the traces
//                 re-armed after a restart;
//                 the module API: a lone step() refuses a break, atStop gives a stop its tokens and onRecord sees the
//                 stop's record first. E147 (bin/test.mjs runs it in a child with OM_EMU_MODEL=E147): S1 and S2 untraced
//                 and traced (the per-shot EXIF fill site 0x50436558, a stack write range) equal step for step, the
//                 fill site reached once, in the S2 press; a synthetic om3-patch-2 file with a run past section 10's
//                 loaded end: the summary's patch audit the same with and without a trace armed at that run; a
//                 breakpoint at the fill site stops the S2 press there and the picture is written after resume
//   node emu/test/test_trace.mjs [--units] [--session]         (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseToken, stepInputs, TokenError, HITS_PER_STEP } from '../host/session.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const BIN = path.join(EMU, 'bin/session.mjs');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const cli = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: opts.timeout ?? 300000, maxBuffer: 1 << 28, env: { ...process.env, ...(opts.env ?? {}) } });
  const lines = [];
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { lines.push({ unparsed: l }); } }
  const sum = lines.find((x) => x.summary) ?? null;
  return { rc: r.status, lines, steps: lines.filter((x) => !x.summary), sum, err: r.stderr ?? '', last: (r.stderr ?? '').trim().split('\n').at(-1) ?? '' };
};
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the steps of a run as [token, lab_ns, frame], arming steps left out: the flow both runs share
const shape = (r) => r.steps.filter((x) => !/^(trace|break):/.test(x.token)).map((x) => [x.token, x.lab_ns, x.frame]);
const same = (a, b) => JSON.stringify(shape(a)) === JSON.stringify(shape(b));

// ---- firmware-free ---------------------------------------------------------------------------------------------
export async function traceUnits() {
  const t = tester(), { ok } = t;
  // the tokens
  const tok = (s) => { try { return parseToken(s); } catch (e) { return e; } };
  ok(JSON.stringify(tok('trace:0x50436558,0x60457578')) === '{"text":"trace:0x50436558,0x60457578","kind":"trace","pcs":[1346594136,1615164792]}', `trace:PC,PC: ${JSON.stringify(tok('trace:0x50436558,0x60457578'))}`);
  ok(JSON.stringify(tok('trace:mem:0x62b4dd16:2')) === '{"text":"trace:mem:0x62b4dd16:2","kind":"trace","mem":{"addr":1656020246,"len":2,"kind":"w"}}', 'trace:mem defaults to w');
  ok(tok('break:mem:0x10:4:rw').mem?.kind === 'rw' && tok('break:mem:0x10:4:r').kind === 'break' && tok('trace:off').off === true && tok('break:off').kind === 'break' && tok('resume').kind === 'resume', 'break:mem, the offs, resume');
  for (const [s, re] of [['trace', /trace is a token's name/], ['trace:mem:0x10:0', /length "0" is not 1\.\. bytes/], ['trace:mem:0xffffffff:2', /within 32 bits/], ['trace:zz', /the pc "zz" is not a 32-bit address/],
    ['break:mem:0x10:4:x', /break:PC\[,PC\.\.\.\], break:mem:ADDR:LEN\[:r\|w\|rw\] or break:off/], ['trace:0x10,', /the pc "" is not/], ['resume:now', /resume is a token's name/]]) {
    const e = tok(s);
    ok(e instanceof TokenError && re.test(e.message), `${s}: ${e?.message ?? JSON.stringify(e)}`);
  }
  ok(['trace:0x10', 'break:off', 'resume'].every((s) => stepInputs(parseToken(s)).length === 0), 'trace, break and resume are the session\'s, no Player input of their own');

  // the machine's exec probes on a blank image: mov d0,(a0); nop; movbu (a1),d1; nop; mov d0,(a0); nop; bra . at P
  const { Debugger } = await import('../src/debug/debugger.mjs');
  const P = 0xa3000000, PROG = Uint8Array.from([0x60, 0xcb, 0xf0, 0x45, 0xcb, 0x60, 0xcb, 0xca, 0x00]);
  const env = { rom: new Uint8Array(0x1000), createHash };
  const fresh = () => {
    const d = Debugger.create(env);
    d.write(P, PROG);
    d.reset({ pc: P, d0: 7, a0: 0xa2100000, a1: 0xa2100010 });
    return d;
  };
  const state = (d) => JSON.stringify({ regs: d.regs(), mem: [...d.read(0xa2100000, 32)] });
  {
    const a = fresh();
    a.cont({ budget: 20 }); a.halt();
    const plain = state(a); a.close();
    const b = fresh(), hits = [];
    b.m.setProbes([P + 1, P + 7], (pc) => hits.push([pc, b.m.getRegs()[15]]));
    b.cont({ budget: 20 }); b.halt();
    const n = (pc) => hits.filter((h) => h[0] === pc).length, ran = b.regs().insns;
    ok(ran === 20 && n(P + 1) === 1 && n(P + 7) === ran - 6, `a continue of 20: the nop once, the bra at each of its runs after the six before it: ${n(P + 1)} ${n(P + 7)} of ${ran}`);
    ok(hits.every(([pc, k], i) => i === 0 || k > hits[i - 1][1]) && hits[0][1] === 1, `each hit before its instruction ran, one per instruction count: ${JSON.stringify(hits.slice(0, 3))}`);
    ok(state(b) === plain, `the probed run's registers and memory are the unprobed run's:\n${state(b)}\n${plain}`);
    b.close();
    const c = fresh();
    c.cont({ budget: 21 }); c.halt();
    ok(state(c) !== plain, 'control: the same comparison tells a run one instruction longer apart');
    c.close();
  }
  {
    // a budget pause arrives at the probed bra without running it: not counted, then counted once by the resume
    const d = fresh(), hits = [];
    d.m.setProbes([P + 7], (pc) => hits.push(pc));
    d.cont({ budget: 8 });
    const at8 = hits.length, pc8 = d.regs().pc;
    d.resume({ budget: 2 }); d.halt();
    ok(at8 === 2 && pc8 === P + 7 && hits.length === 4, `a pause at the probed pc: ${at8} at the pause (pc ${h8(pc8)}), ${hits.length} after a resume of 2`);
    d.close();
  }
  {
    // a breakpoint at a probed pc: the stop before it calls nothing, the step off it calls it once
    const d = fresh(), hits = [];
    d.m.setProbes([P + 1], (pc) => hits.push(pc));
    d.breakpoints([P + 1]);
    d.cont();
    const atStop = hits.length;
    d.step(1);
    const afterStep = hits.length;
    d.breakpoints([]);
    d.cont({ budget: 5 }); d.halt();
    ok(atStop === 0 && afterStep === 1 && hits.length === 1, `a breakpoint at a probed pc: ${atStop} at the stop, ${afterStep} after the step, ${hits.length} after going on`);
    d.m.setProbes([], null);
    ok(thrown(() => d.probes({ pcs: [P] }, () => {}))?.message.startsWith('probes: only on a lab session'), 'Debugger.probes refused on a standalone machine');
    d.close();
  }

  // the live route's hit log and its rules
  const { LiveDebug, HITS_MAX, codePc, notationOf } = await import('../src/debug/live.mjs');
  const { IMAGE_BASE } = await import('../src/fw/model.mjs');
  const fakePlayer = (canBlock) => ({ q: { canBlock }, session: null, phase: 'off' });
  const L = new LiveDebug(fakePlayer(false), {});
  const regs = { d0: 1, d1: 2, d2: 3, d3: 4, a0: 5, a1: 6, a2: 7, a3: 8, sp: 9, pc: IMAGE_BASE + 0x10, psw: 0, mdr: 0, lir: 0, lar: 0, fault: 0, insns: 9 };
  for (let i = 0; i < HITS_MAX + 7; i++) L._hit({ kind: 'pc', pc: IMAGE_BASE + 0x10, regs, lab_ns: i });
  L._hit({ kind: 'mem', range: 0, addr: 0x62000000, size: 2, dir: 'w', value: 0x5d81, pc: IMAGE_BASE + 0x20, regs, lab_ns: 5 });
  const h = L.take_hits(3);
  ok(h.hits.length === 3 && h.dropped === HITS_MAX + 7 + 1 - 3 && h.counts['0x50000010'] === HITS_MAX + 7 && h.counts['mem:0'] === 1,
    `the log: the first 3 taken, the rest counted: ${h.hits.length} ${h.dropped} ${JSON.stringify(h.counts)}`);
  ok(h.hits[0].pc === '0x50000010' && h.hits[0].regs.d0 === '0x00000001' && h.hits[0].lab_ns === 0 && h.hits[2].lab_ns === 2, `a hit in the disassembly notation, its registers in hex: ${JSON.stringify(h.hits[0])}`);
  const e = L.take_hits(10);
  ok(e.hits.length === 0 && e.dropped === 0 && Object.keys(e.counts).length === 0, 'a take empties the log');
  const hs = L.handle({ id: 1, op: 'hits' }), pr = L.handle({ id: 2, op: 'probe', pcs: [0x50000010] });
  ok(hs.ok === true && Array.isArray(hs.hits) && pr.ok === false && /no session/.test(pr.error.message), `hits without a session; probe needs one: ${JSON.stringify(hs).slice(0, 100)} ${JSON.stringify(pr)}`);
  ok(codePc(0x50436558, 'pc') === (0x50436558 - 0x50000000 + IMAGE_BASE) >>> 0 && codePc(IMAGE_BASE + 4, 'pc') === IMAGE_BASE + 4 && codePc(0x3ffe18ea, 'pc') === 0x3ffe18ea && notationOf(IMAGE_BASE + 4) === 0x50000004 && notationOf(0xa2100000) === 0xa2100000,
    'code addresses: notation taken as notation, run time and others as run');
  ok(new LiveDebug(fakePlayer(false), {}).routed === false && new LiveDebug(fakePlayer(false), { holdStop: () => {} }).routed === true && new LiveDebug(fakePlayer(true), {}).routed === true,
    'routed: a blocking queue or a host that holds stops');

  // bin/session.mjs's usage errors for the new tokens (exit 2 before any lab)
  for (const [args, re] of [[['trace'], /trace is a token's name/], [['break:mem:0x10:0'], /the length "0"/], [['trace:mem:0x10:4:x'], /trace:mem:ADDR:LEN\[:r\|w\|rw\]/]]) {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    ok(r.status === 2 && re.test(r.stderr) && !r.stdout, `${args.join(' ')}: exit ${r.status} ${r.stderr.slice(0, 160)}`);
  }
  return t;
}

// ---- through bin/session.mjs -----------------------------------------------------------------------------------
export async function traceSession() {
  const t = tester();
  const { MODEL } = await import('../src/fw/model.mjs');
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-trace-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const T = (...p) => path.join(tmp, ...p);
  const step = (r, token) => r.steps.find((x) => x.token === token) ?? {};
  try {
    if (MODEL === 'E143') await e143(t, { T, step });
    else if (MODEL === 'E147') await e147(t, { T, step });
    else t.ok(false, `test_trace: no session part for ${MODEL}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

async function e143({ ok }, { T, step }) {
  const GET = '0x503c49ab', MALLOC = '0x50002fdc', STACK = 'trace:mem:0x62453800:64:w';   // the settings getter; S-HEAP's malloc hook; a task stack
  const FLOW = ['wait:1500', 's1', 'wait:1200', 's2:down', 'wait:300', 's2:up', 'wait:3000', 'menu', 'wait:800'];
  const base = cli(['--model', 'E143', ...FLOW]);
  const tr = cli(['--model', 'E143', `trace:${GET},${MALLOC}`, STACK, ...FLOW]);
  ok(base.rc === 0 && tr.rc === 0 && tr.sum?.ok === true, `E143 the two runs: rc ${base.rc} ${tr.rc} ${tr.err.slice(-300)}`);
  ok(same(base, tr) && shape(base).length === FLOW.length + 1 && new Set(shape(base).map((x) => x[2])).size > 2, `E143 traced and untraced equal step for step:\n${JSON.stringify(shape(base))}\n${JSON.stringify(shape(tr))}`);
  const short = cli(['--model', 'E143', 'wait:1400', ...FLOW.slice(1)]);
  ok(short.rc === 0 && !same(base, short), 'E143 control: the comparison tells a flow 100 ms shorter apart');
  const arm = step(tr, `trace:${GET},${MALLOC}`), w = step(tr, 'wait:1500');
  ok(JSON.stringify(arm.armed?.trace?.pcs) === `["${GET}","${MALLOC}"]` && JSON.stringify(arm.hooked) === `[{"pc":"${MALLOC}","hook":"S-HEAP malloc","pass":false}]`, `E143 the arming record: ${JSON.stringify(arm)}`);
  const total = Object.values(w.hit_counts ?? {}).reduce((a, b) => a + b, 0);
  ok(w.hits?.length === HITS_PER_STEP && w.hits_dropped === total - HITS_PER_STEP && w.hit_counts?.[GET] > 100 && w.hit_counts?.[MALLOC] > 0 && w.hit_counts?.['mem 0x62453800+64:w'] > 0,
    `E143 a record's hits bounded, the rest counted: ${w.hits?.length} ${w.hits_dropped} ${JSON.stringify(w.hit_counts)}`);
  const all = tr.steps.flatMap((x) => x.hits ?? []);
  const hookHit = all.find((x) => x.kind === 'hook'), memHit = all.find((x) => x.kind === 'mem');
  ok(hookHit?.pc === MALLOC && hookHit.hook === 'S-HEAP malloc' && memHit?.range === '0x62453800+64:w' && memHit.dir === 'w' &&
    Number(memHit.addr) >= 0x62453800 && Number(memHit.addr) < 0x62453840 && /^0x5/.test(memHit.pc) && typeof memHit.regs?.sp === 'string',
    `E143 the hits' kinds: ${JSON.stringify([hookHit, memHit].map((x) => x && { ...x, regs: x.regs?.pc }))}`);
  const sums = {};
  for (const x of tr.steps) for (const [k, v] of Object.entries(x.hit_counts ?? {})) sums[k] = (sums[k] ?? 0) + v;
  ok(JSON.stringify(tr.sum?.traces?.counts) === JSON.stringify(sums) && tr.sum.traces.armed.length === 2 && tr.sum.traces.stops === 0 && tr.sum.ended_at_stop === null,
    `E143 the summary's totals and armed: ${JSON.stringify(tr.sum?.traces)}`);
  ok(base.sum?.traces === null && base.steps.every((x) => !('hits' in x)), 'E143 nothing armed: no traces in the records or the summary');

  // a breakpoint: the step ends at the stop, reads there, break:off, resume carries the rest
  const b = cli(['--model', 'E143', `break:${GET}`, 'wait:1500', 'read:0x60360bec:4', 'expect:mem:0x60360bec=00f00000', 'break:off', 'resume', 'wait:300']);
  const bs = step(b, 'wait:1500'), rs = step(b, 'resume');
  ok(b.rc === 0 && bs.stopped?.kind === 'break' && bs.stopped.pc === GET && bs.stopped.regs?.pc === h8(Number(GET) + 0x10021020) && bs.phase === 'debug' && bs.lab_ns === bs.stopped.lab_ns,
    `E143 a break: rc ${b.rc} ${JSON.stringify(bs).slice(0, 400)}`);
  ok(step(b, 'read:0x60360bec:4').phase === 'debug' && step(b, 'read:0x60360bec:4').hex === '00f00000' && rs.resumed?.step === bs.step && rs.phase === 'running' && rs.lab_ns > bs.lab_ns && b.sum?.traces?.stops === 1,
    `E143 reads at the stop, then resume: ${JSON.stringify(step(b, 'read:0x60360bec:4'))} ${JSON.stringify(rs)} ${JSON.stringify(b.sum?.traces)}`);
  // a stopping write watchpoint stops where the logging trace's first write hit is
  const lw = cli(['--model', 'E143', STACK, 'wait:300']), first = step(lw, 'wait:300').hits?.find((x) => x.kind === 'mem');
  const sw = first ? cli(['--model', 'E143', `break:mem:${first.addr}:${first.size}:w`, 'wait:300']) : null, ws = sw ? step(sw, 'wait:300').stopped : null;
  ok(first && ws?.kind === 'watch' && ws.watch.pc === first.pc && ws.watch.addr === first.addr && ws.watch.value === first.value && ws.lab_ns === first.lab_ns && sw.rc === 0 && sw.sum?.ended_at_stop?.kind === 'watch',
    `E143 a write watchpoint's stop is the trace's first hit: ${JSON.stringify(first && { ...first, regs: undefined })} | ${JSON.stringify(ws && { ...ws, regs: undefined })}`);
  // refusals and the ends of a run at a stop
  const hk = cli(['--model', 'E143', `break:${MALLOC}`, 'wait:100']);
  ok(hk.rc === 1 && /FAILED at step 1 \(break:0x50002fdc\): break: the lab's hook takes every stop at 0x50002fdc \(S-HEAP malloc\)/.test(hk.last) && hk.steps.length === 2, `E143 a break at a hooked pc: rc ${hk.rc} ${hk.last}`);
  const end = cli(['--model', 'E143', `break:${GET}`, 'wait:1500', 'read:0x60360bec:4']);
  ok(end.rc === 0 && end.sum?.ok === true && end.sum.ended_at_stop?.step === 2 && end.sum.ended_at_stop.pc === GET && /^session\.mjs: passed; 4 step\(s\) on E143; ended at the debug stop of step 2 \(break at 0x503c49ab\): nothing ran after it; no poke$/.test(end.last),
    `E143 a run that ends at a stop: rc ${end.rc} ${JSON.stringify(end.sum?.ended_at_stop)} | ${end.last}`);
  const fx = cli(['--model', 'E143', `break:${GET}`, 'wait:1500', 'expect:mem:0x60360bec=00000000', 'read:0x60360bec:4', 'resume']);
  ok(fx.rc === 1 && fx.steps.length === 4 && fx.sum?.failed?.step === 3 && fx.sum.ended_at_stop?.step === 2 && /^session\.mjs: FAILED at step 3 \(expect:mem:0x60360bec=00000000\): expect failed: .*; ended at the debug stop of step 2/.test(fx.last),
    `E143 a failed expect at a stop: rc ${fx.rc} ${fx.steps.length} | ${fx.last}`);
  const pr = cli(['--model', 'E143', `break:${GET}`, 'wait:1500', 's1']), ca = cli(['--model', 'E143', `break:${GET}`, 'wait:1500', `call:${GET}:d0=24`]), rz = cli(['--model', 'E143', 'resume']);
  ok(pr.rc === 1 && /FAILED at step 3 \(s1\): s1: at a debug stop only read:, write:, expect:/.test(pr.last) && ca.rc === 1 && /FAILED at step 3 \(call:0x503c49ab:d0=24\): call: not at a debug stop/.test(ca.last) &&
    rz.rc === 1 && /FAILED at step 1 \(resume\): resume: the session is not at a debug stop/.test(rz.last), `E143 refused at a stop, and resume without one: ${pr.last} | ${ca.last} | ${rz.last}`);
  // a call between ticks with a trace and a break armed at the getter's callee (test_call.mjs getterShape): the call
  // records its own arrival there (the registers it entered with, the lab time it ran at: a call takes none) and the
  // break does not stop it (the call op takes the live debugger's hook off while it runs); a call's own stop at the
  // traced pc records no arrival (the instruction does not run there); a stopping watchpoint armed refuses the call
  const INNER = '0x503c5c26';
  const cb = cli(['--model', 'E143', 'wait:500', `trace:${INNER}`, `break:${INNER}`, `call:${GET}:d0=24`, `call:${GET}:d0=24,stop=${INNER}`, 'break:off', 'trace:off', 'wait:100']);
  const c1 = step(cb, `call:${GET}:d0=24`), c2 = step(cb, `call:${GET}:d0=24,stop=${INNER}`), c1h = c1.hits ?? [];
  ok(cb.rc === 0 && c1.ok && c1.end === 'return' && Number(c1.d0) === 3 && !('stopped' in c1) && c1.phase === 'running' && c1h.length === 1 && c1h[0].kind === 'pc' && c1h[0].pc === INNER &&
    c1h[0].regs?.d0 === '0x00000018' && c1h[0].lab_ns === c1.lab_ns && c1.lab_ns === step(cb, 'wait:500').lab_ns,
    `E143 a call with a trace and a break armed on its path: rc ${cb.rc} ${JSON.stringify(c1).slice(0, 500)}`);
  ok(c2.ok && c2.end === 'stop' && c2.stop?.notation === INNER && !('hits' in c2) && cb.sum?.traces?.stops === 0 && cb.sum.traces.counts?.[INNER] === 1 && cb.sum.ended_at_stop === null,
    `E143 a call's stop at a traced pc: ${JSON.stringify(c2).slice(0, 300)} ${JSON.stringify(cb.sum?.traces)}`);
  const cw = cli(['--model', 'E143', 'wait:500', 'break:mem:0xa21fffc0:64:w', `call:${GET}:d0=24`]);
  ok(cw.rc === 1 && /FAILED at step 3 \(call:0x503c49ab:d0=24\): call: BadRequest: call: a stopping watchpoint is armed/.test(cw.last), `E143 a call with a stopping watchpoint armed: rc ${cw.rc} ${cw.last}`);
  // S-STALERAM (--loaded on, the patch test_session writes: a call to a jmp into a gap): the arrival in the gap is
  // recorded, then the session stops as it does untraced
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { sectionsFact } = await import('../src/lab/sim.mjs');
  const { bootLoads } = await import('../src/fw/sections.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const main = loadImage(), at = MODEL_INFO.image_base, gap = bootLoads(main, at, sectionsFact()).gaps[0].lo + 0x10;
  const SITE = 0x60F28F00, FN = 0x60F28F40, le = (v) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24 & 0xff];
  const pt = (a, bytes) => ({ block: 0, offset: a - at, old: Buffer.from(main.subarray(a - at, a - at + bytes.length)).toString('base64'), new: Buffer.from(bytes).toString('base64') });
  ok(main.subarray(SITE - at, FN - at + 8).every((x) => x === 0xff), 'E143: 0xFF at the callee patch\'s place');
  fs.writeFileSync(T('callee.json'), JSON.stringify([pt(SITE, [0xdd, ...le(FN - SITE), 0, 0]), pt(FN, [0xfc, 0xdc, ...le(gap), 0xf0, 0xf4])]));
  const g = cli(['--model', 'E143', '--patch', T('callee.json'), 'wait:500', `trace:${h8(gap)}`, `call:${h8(FN)}`]);
  const gs = step(g, `call:${h8(FN)}`), gh = gs.hits?.[0];
  ok(g.rc === 1 && gs.ok === false && /UnloadedCode/.test(gs.error ?? '') && gs.hits?.length === 1 && gh.kind === 'pc' && gh.pc === h8(gap - at + 0x50000000) && gh.regs?.pc === h8(gap),
    `E143 a trace at a pc in a gap: rc ${g.rc} ${JSON.stringify(gs).slice(0, 500)}`);
  // the traces re-armed after a restart
  const rr = cli(['--model', 'E143', `trace:${GET}`, 'wait:300', 'power:off', 'restart', 'wait:300']);
  ok(rr.rc === 0 && JSON.stringify(step(rr, 'restart').armed?.trace?.pcs) === `["${GET}"]` && rr.steps.at(-1).hit_counts?.[GET] > 0, `E143 re-armed after a restart: ${JSON.stringify(step(rr, 'restart')).slice(0, 300)} ${JSON.stringify(rr.steps.at(-1).hit_counts)}`);
  const pcHit = rr.steps.at(-1).hits?.[0];
  ok(pcHit?.kind === 'pc' && pcHit.pc === GET && pcHit.regs?.pc === h8(Number(GET) + 0x10021020) && typeof pcHit.lab_ns === 'number', `E143 a pc's hit: ${JSON.stringify(pcHit)}`);
  // the module API: a lone step() has no tokens for a stop; atStop gives them, onRecord sees the stop's record first
  const { openSession } = await import('../host/session.mjs');
  const m1 = await openSession({ model: 'E143' });
  const lone = m1.step(`break:${GET}`);
  m1.close();
  ok(lone.ok === false && /a lone step\(\) does not/.test(lone.error), `a lone step()'s break refused: ${JSON.stringify(lone)}`);
  const queue = ['read:0x60360bec:4', 'break:off', 'resume'], seen = [];
  const m2 = await openSession({ model: 'E143', atStop: () => queue.shift() ?? null, onRecord: (r) => seen.push(r.token) });
  m2.step(`break:${GET}`);
  const after = m2.step('wait:1500');
  const s2 = m2.close();
  ok(after.token === 'resume' && after.ok && JSON.stringify(seen) === `["break:${GET}","wait:1500","read:0x60360bec:4","break:off","resume"]` && s2.ok && s2.ended_at_stop === null && s2.traces.stops === 1,
    `atStop and onRecord: ${JSON.stringify(after).slice(0, 200)} ${JSON.stringify(seen)} ${JSON.stringify(s2.traces)}`);
}

async function e147({ ok }, { T, step }) {
  const FILL = '0x50436558', STACK = 'trace:mem:0x624421c0:64:w';        // the per-shot EXIF fill (study note 2.6); a task stack
  const FLOW = ['wait:1500', 's1', 'wait:1200', 's2:down', 'wait:300', 's2:up', 'wait:5000'];
  const base = cli(['--model', 'E147', ...FLOW]), tr = cli(['--model', 'E147', `trace:${FILL}`, STACK, ...FLOW]);
  ok(base.rc === 0 && tr.rc === 0 && same(base, tr), `E147 traced and untraced equal step for step: rc ${base.rc} ${tr.rc}\n${JSON.stringify(shape(base))}\n${JSON.stringify(shape(tr))}`);
  const fills = tr.steps.filter((x) => x.hit_counts?.[FILL]).map((x) => [x.token, x.hit_counts[FILL]]);
  ok(JSON.stringify(fills) === '[["s2:down",1]]' && tr.sum?.traces?.counts?.[FILL] === 1, `E147 the fill site reached once, in the S2 press: ${JSON.stringify(fills)}`);
  // a synthetic om3-patch-2 file (not caduceus bytes) with a run past section 10's loaded end (test_session's): the
  // audit the same with and without a trace armed at that run
  const { ORIGINAL, readBytes } = await import('../checks/lib/env.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const main = readBytes(ORIGINAL), PAD = 0x107f00, TAIL = 0x1ffff00, NEW = new TextEncoder().encode('om-emu session.!');
  ok(main.subarray(PAD, PAD + 16).every((x) => x === 0xff) && main.subarray(TAIL, TAIL + 16).every((x) => x === 0xff), 'E147: 0xFF padding at both runs');
  const want = main.slice();
  for (const o of [PAD, TAIL]) want.set(NEW, o);
  fs.writeFileSync(T('tail.json'), JSON.stringify({ format: 'om3-patch-2', name: 'om-emu trace test', version: 'v0', main_base: h8(MODEL_INFO.image_base), main_sha256_before: MODEL_INFO.rom_sha256,
    main_sha256_after: sha(want), runs: [PAD, TAIL].map((o) => [h8(MODEL_INFO.image_base + o), Buffer.from(NEW).toString('hex')]) }));
  const tail = h8(MODEL_INFO.image_base + TAIL);
  const pa = cli(['--model', 'E147', '--patch', T('tail.json'), 'wait:500', 's1']), pb = cli(['--model', 'E147', '--patch', T('tail.json'), `trace:${tail},${FILL}`, `trace:mem:${tail}:16:rw`, 'wait:500', 's1']);
  ok(pa.rc === 0 && pb.rc === 0 && pa.sum?.patch_audit?.unloaded?.length === 1 && JSON.stringify(pa.sum.patch_audit) === JSON.stringify(pb.sum?.patch_audit) && same(pa, pb),
    `E147 a patched build's audit with and without traces: ${JSON.stringify(pa.sum?.patch_audit)} | ${JSON.stringify(pb.sum?.patch_audit)}`);
  // a breakpoint at the fill site: the S2 press stops there; the picture is written after resume
  const b = cli(['--model', 'E147', 'wait:1500', 's1', 'wait:1200', `break:${FILL}`, 's2:down', 'break:off', 'resume', 'wait:300', 's2:up', 'wait:5000', 'expect:exif:DCIM/100OMSYS/*.JPG:Model~OM-3']);
  const bs = step(b, 's2:down');
  ok(b.rc === 0 && bs.stopped?.kind === 'break' && bs.stopped.pc === FILL && bs.stopped.regs?.pc === h8(Number(FILL) + 0x10021020) && step(b, 'resume').resumed?.step === bs.step,
    `E147 a break at the fill site: rc ${b.rc} ${JSON.stringify(bs).slice(0, 300)} | ${b.last}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = await traceUnits();
    console.log(`traces and stops units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await traceSession();
    const { MODEL } = await import('../src/fw/model.mjs');
    console.log(`traces and stops (${MODEL}, bin/session.mjs): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
