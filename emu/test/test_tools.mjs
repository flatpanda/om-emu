// The scripted session's debugging tools beyond traces and stops (host/session.mjs, src/debug/live.mjs and call.mjs):
//   toolsUnits    (firmware-free) the tokens trace:PC:stack=N and dump:ADDR:LEN:FILE and their refusals; the live
//                 route's probe stack (its checks, the words read at the hit from sp up, a word that cannot be read
//                 ending them, none for a hit the log drops); the machine's CPU context (cpuContext keeps the PSW
//                 hazard a mov to psw leaves, which setRegs clears; setCpuContext puts it back); bin/session.mjs's
//                 usage errors for --a15, --device, --osd-errors and the new tokens
//   toolsSession  (the process's model, through bin/session.mjs end to end) E143: a flow untraced and traced with a
//                 16-word stack capture at the settings getter, every step's lab time and frame equal (control: the
//                 comparison tells a flow 100 ms shorter apart), each hit's 16 words those a read: of its sp at a
//                 breakpoint on the same arrival gives; dump: across READ_MAX (the file's bytes, length and digest,
//                 a read: of a slice equal), at a stop, and with --loaded on across a gap (the record's unloaded range,
//                 the fill there); a breakpoint at the S-HEAP malloc hook's pc stops before the hook answers (the
//                 record names it) and the run after resume is the unstopped run's step for step; a call of the
//                 settings getter at a breakpoint's stop answers as between ticks, and the run after it (every
//                 step's lab time and frame, the harness stack at the stop and 64 MiB of DRAM at the end) is the run
//                 without the call (controls, by hand: with the harness stack not put back the resumed step faults;
//                 the CPU context's part is the unit's); a call at a stop that reaches another hook answers
//                 CallHooked and the run ends there; a call at a watchpoint's stop, in a continue and in the
//                 harness's single step of a pass-through observer (a pending stop), answers as between ticks and the
//                 run after it (every step, the harness stack and 64 MiB of DRAM) is the run without it; --a15 off publishes
//                 no frame where on publishes one; --device evf and the eye sensor's switch: shot: takes the EVF's
//                 frame; the lv and eye tokens switch the display (eye:down refused); --osd-errors: a step whose engine refused a picture fails by default and only reports
//                 with report (the refusal counted through the module API; test_osdwrap.mjs makes real ones); on
//                 E118, whose stock INFO meets BMP_LUT refusals, the default is report and fail fails the step.
//                 E147 (bin/test.mjs runs it in a child with OM_EMU_MODEL=E147): a 32-word stack capture at the
//                 per-shot EXIF fill site through S2, untraced and traced equal; a call of E147's settings getter at
//                 a breakpoint on the fill site, the run after it (lab time, frame, the JPEG's EXIF) the run without
//                 it; --device evf's first shot from the EVF
//   node emu/test/test_tools.mjs [--units] [--session]         (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseToken, stepInputs, TokenError, STACK_WORDS, DUMP_MAX } from '../host/session.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const BIN = path.join(EMU, 'bin/session.mjs');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const cli = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: opts.timeout ?? 1800000, maxBuffer: 1 << 28, env: { ...process.env, ...(opts.env ?? {}) } });
  const lines = [];
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { lines.push({ unparsed: l }); } }
  const sum = lines.find((x) => x.summary) ?? null;
  return { rc: r.status, lines, steps: lines.filter((x) => !x.summary), sum, err: r.stderr ?? '', last: (r.stderr ?? '').trim().split('\n').at(-1) ?? '' };
};
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const sha = (b) => createHash('sha256').update(b).digest('hex');
// the steps of a run as [token, lab_ns, frame], the steps given left out: the flow two runs share
const shape = (r, skip = /^(trace|break|dump|call|read):/) => r.steps.filter((x) => !skip.test(x.token)).map((x) => [x.token, x.lab_ns, x.frame]);
const same = (a, b, skip) => JSON.stringify(shape(a, skip)) === JSON.stringify(shape(b, skip));

// ---- firmware-free ---------------------------------------------------------------------------------------------
export async function toolsUnits() {
  const t = tester(), { ok } = t;
  const tok = (s) => { try { return parseToken(s); } catch (e) { return e; } };
  ok(JSON.stringify(tok('trace:0x503c49ab,0x60457578:stack=16')) === '{"text":"trace:0x503c49ab,0x60457578:stack=16","kind":"trace","pcs":[1346128299,1615164792],"stack":16}',
    `trace:PC,PC:stack=N: ${JSON.stringify(tok('trace:0x503c49ab,0x60457578:stack=16'))}`);
  ok(JSON.stringify(tok('dump:0x60000000:0x110000:ram.bin')) === '{"text":"dump:0x60000000:0x110000:ram.bin","kind":"dump","addr":1610612736,"len":1114112,"file":"ram.bin"}', 'dump:ADDR:LEN:FILE');
  ok(tok(`dump:0x60000000:${DUMP_MAX}:a/b.bin`).len === DUMP_MAX && stepInputs(tok('dump:0x10:4:x.bin')).length === 0, 'dump: up to DUMP_MAX; the session\'s, no Player input of its own');
  for (const [s, re] of [['trace:0x10:stack=0', /stack=0 is not 1\.\.256 words/], [`trace:0x10:stack=${STACK_WORDS + 1}`, /is not 1\.\.256 words/], ['trace:0x10:stack=x', /stack=x is not/],
    ['break:0x10:stack=4', /stack=N is trace's/], ['dump:0x10:0:x.bin', /length "0" is not 1\.\.67108864 bytes/], [`dump:0x10:${DUMP_MAX + 1}:x.bin`, /is not 1\.\.67108864/],
    ['dump:0xffffff00:0x200:x.bin', /runs past 32 bits/], ['dump', /dump is a token's name|dump:ADDR:LEN:FILE/], ['dump:0x10:4', /dump:ADDR:LEN:FILE/], ['trace:mem:0x10:4:stack=2', /trace:PC\[,PC\.\.\.\]\[:stack=N\]/]]) {
    const e = tok(s);
    ok(e instanceof TokenError && re.test(e.message), `${s}: ${e?.message ?? JSON.stringify(e)}`);
  }
  // an unknown token's refusal lists the forms this file adds
  const nt = tok('nope:x');
  ok(nt instanceof TokenError && /not a token/.test(nt.message) && nt.message.includes('dump:ADDR:LEN:FILE') && nt.message.includes('[:stack=N]'),
    `an unknown token's refusal names dump: and trace's stack=: ${nt?.message}`);

  // the live route's probe stack on a fake lab: the checks, the words from sp up at the hit, a short read, a dropped hit
  const { LiveDebug, HITS_MAX, STACK_WORDS_MAX } = await import('../src/debug/live.mjs');
  const { IMAGE_BASE } = await import('../src/fw/model.mjs');
  ok(STACK_WORDS_MAX === STACK_WORDS, `the token's bound is the route's: ${STACK_WORDS} ${STACK_WORDS_MAX}`);
  const RAM = new Uint8Array(64).map((_, i) => i), LO = 0x1000;           // words 0x03020100, 0x07060504, ... at LO
  const fakeDbg = { probes() {}, read(a, n) { if (a < LO || a + n > LO + RAM.length) throw new Error('E14'); return RAM.slice(a - LO, a - LO + n); },
    u32(a) { const b = this.read(a, 4); return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; } };
  const L = new LiveDebug({ q: { canBlock: false }, session: null, phase: 'off' }, {});
  L.lab = { hooks: new Map() }; L.dbg = fakeDbg;
  const PC = IMAGE_BASE + 0x40, P2 = IMAGE_BASE + 0x80;
  const bad = (q) => thrown(() => L._probe(q))?.message ?? 'accepted';
  ok(/stack\[0\]: 0x50000080 is not among pcs/.test(bad({ pcs: [PC], stack: [[P2, 4]] })) && /stack\[0\]: 257 words is over 256/.test(bad({ pcs: [PC], stack: [[PC, 257]] })) &&
    /stack\[0\] words/.test(bad({ pcs: [PC], stack: [[PC, 0]] })) && /stack\[0\]: \[pc, words\]/.test(bad({ pcs: [PC], stack: [[PC]] })), 'probe stack: refused off pcs, over the bound, of no words, malformed');
  const pr = L._probe({ pcs: [0x50000040, P2], stack: [[0x50000040, 3]] });
  ok(JSON.stringify(pr.stack) === '[["0x50000040",3]]', `probe stack in the notation: ${JSON.stringify(pr)}`);
  const regs = (sp) => ({ d0: 0, d1: 0, d2: 0, d3: 0, a0: 0, a1: 0, a2: 0, a3: 0, sp, pc: PC, psw: 0, mdr: 0, lir: 0, lar: 0, fault: 0, insns: 0 });
  L._hit({ kind: 'pc', pc: PC, regs: regs(LO + 4), lab_ns: 1 });
  L._hit({ kind: 'pc', pc: PC, regs: regs(LO + 56), lab_ns: 2 });                 // two words left before the end
  L._hit({ kind: 'pc', pc: P2, regs: regs(LO), lab_ns: 3 });                      // no stack asked at P2
  L._hit({ kind: 'mem', range: 0, addr: 0, size: 4, dir: 'w', value: 0, pc: PC, regs: regs(LO), lab_ns: 4 });
  const h = L.take_hits();
  ok(JSON.stringify(h.hits.map((x) => x.stack ?? null)) === '[["0x07060504","0x0b0a0908","0x0f0e0d0c"],["0x3b3a3938","0x3f3e3d3c"],null,null]',
    `the words at each hit from sp up, a read past the end ending them, none at other pcs and for memory hits: ${JSON.stringify(h.hits.map((x) => x.stack ?? null))}`);
  let reads = 0;
  L.dbg = { ...fakeDbg, read(a, n) { reads++; return fakeDbg.read(a, n); } };
  for (let i = 0; i < HITS_MAX + 2; i++) L._hit({ kind: 'pc', pc: PC, regs: regs(LO), lab_ns: i });
  const d = L.take_hits(1);
  ok(reads === HITS_MAX && d.dropped === HITS_MAX + 1 && d.hits[0].stack.length === 3, `a hit the log drops reads no stack: ${reads} reads, ${d.dropped} dropped`);
  L._probe({});
  L._hit({ kind: 'pc', pc: PC, regs: regs(LO), lab_ns: 0 });
  ok(!('stack' in L.take_hits().hits[0]), 'the probes off: no stack words kept');

  // the machine's CPU context: mov d0,psw leaves the PSW hazard, which setRegs clears and setCpuContext puts back
  const { Debugger } = await import('../src/debug/debugger.mjs');
  const { R, HAZ } = await import('../src/core/cpu.mjs');
  const A = 0xa3000000, dbg = Debugger.create({ rom: new Uint8Array(0x1000), createHash });
  dbg.write(A, Uint8Array.from([0xf2, 0xf3, 0xcb, 0xcb]));                        // mov d0,psw; nop; nop
  dbg.reset({ pc: A, d0: 0 });
  dbg.step(1);
  const m = dbg.m, ctx = m.cpuContext(), haz = R[HAZ];
  m.setRegs(m.getRegs());
  const cleared = R[HAZ];
  m.setCpuContext(ctx);
  ok(haz !== 0 && ctx.R[HAZ] === haz && cleared === 0 && R[HAZ] === haz && m.getRegs()[9] === A + 2, `the hazard after mov d0,psw ${haz}, setRegs ${cleared}, setCpuContext ${R[HAZ]}`);
  dbg.close();

  // bin/session.mjs's usage errors (exit 2 before any lab)
  for (const [args, re] of [[['--a15', 'x'], /--a15/], [['--device', 'lcd'], /--device/], [['--osd-errors', 'x'], /--osd-errors/], [['dump:0x10:0:a.bin'], /the length "0"/], [['break:0x10:stack=2'], /stack=N is trace's/]]) {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    ok(r.status === 2 && re.test(r.stderr) && !r.stdout, `${args.join(' ')}: exit ${r.status} ${r.stderr.slice(0, 160)}`);
  }
  return t;
}

// ---- through bin/session.mjs -----------------------------------------------------------------------------------
export async function toolsSession() {
  const t = tester();
  const { MODEL } = await import('../src/fw/model.mjs');
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-tools-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const T = (...p) => path.join(tmp, ...p);
  const step = (r, token) => r.steps.find((x) => x.token === token) ?? {};
  try {
    if (MODEL === 'E143') await e143(t, { T, step });
    else if (MODEL === 'E147') await e147(t, { T, step });
    else t.ok(false, `test_tools: no session part for ${MODEL}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

async function e143({ ok }, { T, step }) {
  const GET = '0x503c49ab', MALLOC = '0x50002fdc';                       // the settings getter; S-HEAP's malloc hook
  const FLOW = ['wait:1500', 's1', 'wait:1200', 'menu', 'wait:800', 'down', 'wait:300'];
  // the stack capture: the run unchanged, each hit's words those at its sp
  const base = cli(['--model', 'E143', ...FLOW]), tr = cli(['--model', 'E143', `trace:${GET}:stack=16`, ...FLOW]), short = cli(['--model', 'E143', 'wait:1400', ...FLOW.slice(1)]);
  ok(base.rc === 0 && tr.rc === 0 && same(base, tr) && new Set(shape(base).map((x) => x[2])).size > 2, `E143 untraced and traced with stack=16 equal step for step: rc ${base.rc} ${tr.rc}\n${JSON.stringify(shape(base))}\n${JSON.stringify(shape(tr))}`);
  ok(short.rc === 0 && !same(base, short), 'E143 control: the comparison tells a flow 100 ms shorter apart');
  const hits = tr.steps.flatMap((x) => x.hits ?? []);
  ok(hits.length > 100 && hits.every((x) => x.stack?.length === 16 && x.stack.every((w) => /^0x[0-9a-f]{8}$/.test(w))) && step(tr, `trace:${GET}:stack=16`).armed?.trace?.stack?.[GET] === 16,
    `E143 every hit carries 16 words: ${hits.length} hits, ${JSON.stringify(hits[0]?.stack)}`);
  const { openSession } = await import('../host/session.mjs');
  let at = null;
  const s = await openSession({ model: 'E143', atStop: (rec) => { if (at) return null; at = rec.stopped; return `read:${rec.stopped.regs.sp}:64`; } });
  s.step(`break:${GET}`);
  s.step('wait:1500');
  const words = s.records.find((x) => x.token.startsWith('read:'))?.hex, h0 = step(tr, 'wait:1500').hits?.[0];
  s.close();
  const le = (hex) => Array.from({ length: hex.length / 8 }, (_, i) => h8(parseInt(hex.slice(8 * i + 6, 8 * i + 8) + hex.slice(8 * i + 4, 8 * i + 6) + hex.slice(8 * i + 2, 8 * i + 4) + hex.slice(8 * i, 8 * i + 2), 16)));
  ok(at && h0 && at.lab_ns === h0.lab_ns && at.regs.sp === h0.regs.sp && JSON.stringify(le(words ?? '')) === JSON.stringify(h0.stack),
    `E143 the first hit's words are a read: of its sp at a breakpoint on the same arrival: ${JSON.stringify(h0?.stack)} | ${words}`);

  // dump: across READ_MAX, a read: of a slice equal; with --loaded on across a gap, the record says so
  const dp = cli(['--model', 'E143', '--out', T('d'), 'wait:500', 'dump:0x60000000:0x18000:sub/d.bin', 'read:0x60010000:0x8000']);
  const dr = step(dp, 'dump:0x60000000:0x18000:sub/d.bin'), file = fs.existsSync(T('d', 'sub/d.bin')) ? fs.readFileSync(T('d', 'sub/d.bin')) : Buffer.alloc(0);
  ok(dp.rc === 0 && dr.ok && file.length === 0x18000 && dr.len === 0x18000 && dr.sha256 === sha(file) && dr.file === T('d', 'sub/d.bin') && !('unloaded' in dr) &&
    file.subarray(0x10000).toString('hex') === step(dp, 'read:0x60010000:0x8000').hex, `E143 a dump across READ_MAX: rc ${dp.rc} ${JSON.stringify(dr).slice(0, 300)}`);
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { sectionsFact } = await import('../src/lab/sim.mjs');
  const { bootLoads, POISON } = await import('../src/fw/sections.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const g = bootLoads(loadImage(), MODEL_INFO.image_base, sectionsFact()).gaps[0];
  const gu = cli(['--model', 'E143', '--loaded', 'on', '--out', T('g'), 'wait:500', `dump:${h8(g.lo - 16)}:64:g.bin`]);
  const gr = step(gu, `dump:${h8(g.lo - 16)}:64:g.bin`), gb = fs.existsSync(T('g', 'g.bin')) ? fs.readFileSync(T('g', 'g.bin')) : Buffer.alloc(0);
  ok(gu.rc === 0 && g.hi - g.lo >= 48 && JSON.stringify(gr.unloaded) === JSON.stringify([{ lo: h8(g.lo), hi: h8(g.lo + 48), kind: 'gap' }]) && gr.fill === `0x${POISON.toString(16)}` &&
    gb.length === 64 && gb.subarray(16).every((x) => x === POISON), `E143 a dump across a gap under --loaded on: rc ${gu.rc} ${JSON.stringify(gr).slice(0, 400)}`);

  // a breakpoint at a hooked pc: the stop before the hook answers, a dump there, the run after it unchanged
  const hb = cli(['--model', 'E143', '--out', T('h'), `break:${MALLOC}`, 'wait:1500', 'dump:0x62453800:0x100:stk.bin', 'break:off', 'resume', ...FLOW.slice(1)]);
  const hs = step(hb, 'wait:1500'), hr = step(hb, 'resume'), b0 = step(base, 'wait:1500');
  ok(hb.rc === 0 && hs.stopped?.kind === 'break' && hs.stopped.pc === MALLOC && hs.stopped.hook === 'S-HEAP malloc' && JSON.stringify(step(hb, `break:${MALLOC}`).hooked_breaks) === `[{"pc":"${MALLOC}","hook":"S-HEAP malloc"}]` &&
    hs.lab_ns < b0.lab_ns && step(hb, 'dump:0x62453800:0x100:stk.bin').ok, `E143 a break at the malloc hook: rc ${hb.rc} ${JSON.stringify(hs.stopped ?? hs).slice(0, 300)} | ${hb.last}`);
  ok(hr.lab_ns === b0.lab_ns && hr.frame === b0.frame && JSON.stringify(shape(hb).slice(-(FLOW.length - 1))) === JSON.stringify(shape(base).slice(-(FLOW.length - 1))),
    `E143 the run after the hook's stop is the unstopped run's: ${JSON.stringify([hr.lab_ns, hr.frame])} ${JSON.stringify([b0.lab_ns, b0.frame])}`);

  // a call at a breakpoint's stop: the getter's answer, and the run after it the run without it
  const HS = 'dump:0x62180000:0x80004:hs.bin', RAM = 'dump:0x60000000:0x4000000:ram.bin', TAIL = ['resume', ...FLOW.slice(1), RAM];
  const ca = cli(['--model', 'E143', '--out', T('ca'), `break:${GET}`, 'wait:1500', 'break:off', HS, ...TAIL]);
  const cb = cli(['--model', 'E143', '--out', T('cb'), `break:${GET}`, 'wait:1500', 'break:off', `call:${GET}:d0=24`, HS, ...TAIL]);
  const cc = step(cb, `call:${GET}:d0=24`);
  ok(ca.rc === 0 && cb.rc === 0 && cc.ok && Number(cc.d0) === 3 && cc.phase === 'debug' && JSON.stringify(cc.stubs) === '[["prop_get",1]]', `E143 a call at the stop: rc ${ca.rc} ${cb.rc} ${JSON.stringify(cc).slice(0, 300)} | ${cb.last}`);
  ok(same(ca, cb) && step(ca, HS).sha256 === step(cb, HS).sha256 && step(ca, RAM).sha256 && step(ca, RAM).sha256 === step(cb, RAM).sha256 && step(cb, 'resume').lab_ns === b0.lab_ns,
    `E143 the run after a call at the stop is the run without it: ${JSON.stringify([step(ca, HS).sha256, step(cb, HS).sha256, step(ca, RAM).sha256, step(cb, RAM).sha256])}\n${JSON.stringify(shape(ca))}\n${JSON.stringify(shape(cb))}`);
  const ch = cli(['--model', 'E143', `break:${GET}`, 'wait:1500', `call:${MALLOC}:d0=16`, 'resume']);
  ok(ch.rc === 1 && /FAILED at step 3 \(call:0x50002fdc:d0=16\): call: CallHooked: .*reached the lab's hook S-HEAP malloc at 0x50002fdc.*; ended at the debug stop of step 2/.test(ch.last), `E143 a call at a stop that reaches another hook: rc ${ch.rc} ${ch.last}`);
  // a call at a watchpoint's stop: in a continue (the stop after the accessing instruction) and in the harness's single
  // step of a pass-through observer (obs-vt4, whose movm pushes: the step leaves a debug stop pending, which the call's
  // own continue would take at once; control, by hand: without the drop the call ends at the trampoline, FirmwareError
  // 'stopped at 0xa2100000'); each answers as between ticks and the run after it is the run without it
  const lw = cli(['--model', 'E143', 'trace:mem:0x62453800:64:w', 'wait:300']), first = step(lw, 'wait:300').hits?.find((x) => x.kind === 'mem');
  const CW = first ? [`break:mem:${first.addr}:${first.size}:w`, 'wait:300', 'break:off'] : [], CTAIL = ['resume', ...FLOW, RAM];
  const cwa = cli(['--model', 'E143', '--out', T('cwa'), ...CW, ...CTAIL]), cwb = cli(['--model', 'E143', '--out', T('cwb'), ...CW, `call:${GET}:d0=24`, ...CTAIL]);
  const cwc = step(cwb, `call:${GET}:d0=24`), cws = step(cwb, 'wait:300').stopped;
  ok(first && cwa.rc === 0 && cwb.rc === 0 && cws?.kind === 'watch' && cws.watch?.addr === first.addr && cwc.ok && Number(cwc.d0) === 3 && JSON.stringify(cwc.stubs) === '[["prop_get",1]]' &&
    same(cwa, cwb) && step(cwa, RAM).sha256 && step(cwa, RAM).sha256 === step(cwb, RAM).sha256,
  `E143 a call at a continue's watch stop: rc ${cwa.rc} ${cwb.rc} ${JSON.stringify(cws)} ${JSON.stringify(cwc).slice(0, 300)} | ${cwb.last}\n${JSON.stringify(shape(cwa))}\n${JSON.stringify(shape(cwb))}`);
  const VT4 = '0x50b4f28b', UPTO = FLOW.slice(0, 4);                       // obs-vt4: reached in the MENU press
  const vt = cli(['--model', 'E143', `trace:${VT4}`, ...UPTO]), vh = step(vt, 'menu').hits?.[0];
  const SW = vh ? [`break:${VT4}`, ...UPTO, 'break:off', `break:mem:${h8(Number(vh.regs.sp) - 4)}:4:w`, 'resume', 'break:off'] : [], STAIL = ['resume', ...FLOW.slice(4), RAM];
  const swa = cli(['--model', 'E143', '--out', T('swa'), ...SW, HS, ...STAIL]), swb = cli(['--model', 'E143', '--out', T('swb'), ...SW, `call:${GET}:d0=24`, HS, ...STAIL]);
  const swc = step(swb, `call:${GET}:d0=24`), sws = step(swb, 'resume').stopped, d1 = step(base, 'down');
  ok(vh && swa.rc === 0 && swb.rc === 0 && step(swb, 'menu').stopped?.hook === 'obs-vt4' && sws?.kind === 'watch' && sws.watch?.pc === VT4 && sws.pc === h8(Number(VT4) + 2) &&
    swc.ok && Number(swc.d0) === 3 && JSON.stringify(swc.stubs) === '[["prop_get",1]]',
  `E143 a call at a single step's watch stop: rc ${swa.rc} ${swb.rc} ${JSON.stringify(sws)} ${JSON.stringify(swc).slice(0, 300)} | ${swb.last}`);
  ok(same(swa, swb) && step(swa, HS).sha256 === step(swb, HS).sha256 && step(swa, RAM).sha256 && step(swa, RAM).sha256 === step(swb, RAM).sha256 &&
    step(swb, 'down').lab_ns === d1.lab_ns && step(swb, 'down').frame === d1.frame,
  `E143 the run after a call at a single step's watch stop is the run without it: ${JSON.stringify([step(swa, HS).sha256, step(swb, HS).sha256, step(swa, RAM).sha256, step(swb, RAM).sha256])}\n${JSON.stringify(shape(swa))}\n${JSON.stringify(shape(swb))}`);

  // --a15, --device and the eye sensor: shot: takes the shown device's frame
  const off = cli(['--model', 'E143', '--out', T('a'), '--a15', 'off', 'wait:1500', 'info', 'wait:300', 'shot:a.png']), on = cli(['--model', 'E143', '--out', T('a'), '--a15', 'on', 'wait:1500', 'info', 'wait:300', 'shot:a.png']);
  ok(off.rc === 1 && /FAILED at step 4 \(shot:a\.png\): no frame published yet/.test(off.last) && !off.sum?.stand_ins?.includes('A15') && on.rc === 0 && step(on, 'shot:a.png').device === 'tft' && on.sum?.stand_ins?.includes('A15'),
    `E143 --a15 off publishes no frame, on does: ${off.last} | ${on.last}`);
  const ev = cli(['--model', 'E143', '--out', T('e'), '--device', 'evf', 'wait:1500', 'info', 'wait:300', 'shot:a.png', 'switch:eye=0', 'wait:800', 'shot:b.png', 'switch:eye=1', 'wait:800', 'shot:c.png']);
  const [sa, sb, sc] = ['shot:a.png', 'shot:b.png', 'shot:c.png'].map((x) => step(ev, x));
  ok(ev.rc === 0 && sa.device === 'evf' && JSON.stringify(sa.size) === '[1600,1200]' && sb.device === 'tft' && JSON.stringify(sb.size) === '[900,600]' && sc.device === 'evf' && sa.frame === sc.frame && ev.sum?.stand_ins?.includes('H-STOREFIRST'),
    `E143 --device evf and the eye sensor: ${ev.last} ${JSON.stringify([sa, sb, sc].map((x) => [x.device, x.size, x.frame]))}`);

  // the display controls as tokens: lv and eye switch the display at their press (a down and the settle; control,
  // before 2026-11-14: the step failed, the player dropping the key's up), eye:down refused
  const lv = cli(['--model', 'E143', '--out', T('l'), 'wait:1500', 'lv', 'shot:a.png', 'lv', 'shot:b.png', 'eye', 'shot:c.png']), ed = cli(['--model', 'E143', 'eye:down']);
  ok(lv.rc === 0 && JSON.stringify(['shot:a.png', 'shot:b.png', 'shot:c.png'].map((x) => step(lv, x).device)) === '["evf","tft","evf"]' && ed.rc === 2 && /eye:down: eye switches the display at its press/.test(ed.err),
    `E143 lv and eye switch the display, eye:down refused: ${lv.last} ${JSON.stringify(['shot:a.png', 'shot:b.png', 'shot:c.png'].map((x) => step(lv, x).device))} | rc ${ed.rc} ${ed.last}`);

  // --osd-errors: a refusal fails the step by default, report only lists it (the engine's count raised by hand here)
  for (const policy of ['fail', 'report']) {
    const m = await openSession({ model: 'E143', ...(policy === 'report' ? { osdErrors: 'report' } : {}) });
    m.step('wait:300');
    const eng = m.player.session.lab.sim.m.devices.engine;
    eng.failures.BMP_TOKEN = (eng.failures.BMP_TOKEN ?? 0) + 1;
    const r = m.step('wait:100'), next = m.step('wait:100'), sm = m.close();
    if (policy === 'fail') {
      ok(!r.ok && JSON.stringify(r.osd_errors) === '{"BMP_TOKEN":1}' && /^the OSD engine refused 1 picture\(s\) \(BMP_TOKEN 1\), not drawn; --osd-errors report only reports them$/.test(r.error) && !next.ok && !sm.ok && sm.osd_errors_policy === 'fail',
        `E143 an OSD refusal fails the step by default: ${JSON.stringify(r).slice(0, 300)} ${sm.ok}`);
    } else ok(r.ok && JSON.stringify(r.osd_errors) === '{"BMP_TOKEN":1}' && next.ok && !('osd_errors' in next) && sm.ok && sm.osd_errors_policy === 'report', `E143 --osd-errors report: ${JSON.stringify(r).slice(0, 300)}`);
  }
  // the default per body (host/session.mjs OSD_FAIL_BODIES): E118's stock INFO meets BMP_LUT refusals (X, 2026-11-14),
  // so there the default is report (the step passes and lists them) and --osd-errors fail fails it (control: with fail
  // as every body's default the first run fails at INFO, by hand)
  const r118 = cli(['--model', 'E118', 'wait:1500', 'info', 'wait:300']), f118 = cli(['--model', 'E118', '--osd-errors', 'fail', 'wait:1500', 'info', 'wait:300']);
  ok(r118.rc === 0 && r118.sum?.osd_errors_policy === 'report' && step(r118, 'info').osd_errors?.BMP_LUT > 0 && f118.rc === 1 && f118.sum?.osd_errors_policy === 'fail'
    && /FAILED at step 2 \(info\): the OSD engine refused \d+ picture\(s\) \(BMP_LUT \d+\)/.test(f118.last),
    `E118 the default report, --osd-errors fail: ${r118.last} ${JSON.stringify(step(r118, 'info').osd_errors)} | ${f118.last}`);
}

async function e147({ ok }, { T, step }) {
  const FILL = '0x50436558', GET = '0x503cf0f1';                         // the per-shot EXIF fill (study note 2.6); the settings getter
  const FLOW = ['wait:1500', 's1', 'wait:1200', 's2:down', 'wait:300', 's2:up', 'wait:5000'];
  const base = cli(['--model', 'E147', ...FLOW]), tr = cli(['--model', 'E147', `trace:${FILL}:stack=32`, ...FLOW]);
  const fh = tr.steps.flatMap((x) => x.hits ?? []);
  ok(base.rc === 0 && tr.rc === 0 && same(base, tr) && fh.length === 1 && fh[0].stack?.length === 32, `E147 untraced and traced with stack=32 equal step for step, the fill's hit with its words: rc ${base.rc} ${tr.rc} ${JSON.stringify(fh.map((x) => x.stack?.length))}`);
  const X = 'exif:DCIM/100OMSYS/*.JPG', pre = ['wait:1500', 's1', 'wait:1200', `break:${FILL}`, 's2:down', 'break:off'], post = ['resume', 'wait:300', 's2:up', 'wait:5000', X];
  const a = cli(['--model', 'E147', ...pre, ...post]), b = cli(['--model', 'E147', ...pre, `call:${GET}:d0=24`, ...post]);
  const c = step(b, `call:${GET}:d0=24`), ea = step(a, X).exif, eb = step(b, X).exif;
  const strip = (e) => e && Object.fromEntries(Object.entries(e).filter(([k]) => !/^DateTime/.test(k)));
  ok(a.rc === 0 && b.rc === 0 && c.ok && c.phase === 'debug' && step(a, 's2:down').stopped?.pc === FILL && same(a, b) && ea && JSON.stringify(strip(ea)) === JSON.stringify(strip(eb)),
    `E147 a call at the fill site's stop, the run after it the run without it: rc ${a.rc} ${b.rc} ${JSON.stringify(c).slice(0, 300)} | ${b.last}\n${JSON.stringify(shape(a))}\n${JSON.stringify(shape(b))}`);
  const ev = cli(['--model', 'E147', '--out', T('e'), '--device', 'evf', 'wait:1500', 'shot:a.png']);
  ok(ev.rc === 0 && step(ev, 'shot:a.png').device === 'evf' && JSON.stringify(step(ev, 'shot:a.png').size) === '[1024,768]', `E147 --device evf: ${ev.last} ${JSON.stringify(step(ev, 'shot:a.png'))}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = await toolsUnits();
    console.log(`session tools units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await toolsSession();
    const { MODEL } = await import('../src/fw/model.mjs');
    console.log(`session tools (${MODEL}, bin/session.mjs): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
