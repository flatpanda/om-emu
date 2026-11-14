// The debug API's call op (src/debug/call.mjs) and the exec trace's registers.
//   callUnits (firmware-free, bin/test-pure.mjs): callSpec's refusals of malformed fields and its forms (notation and
//     run-time addresses, scratch references, "=value" words), the standalone protocol's refusal, the exec-trace record's
//     d3, a0-a3 and mdr (jsonl) with the QEMU line unchanged;
//   callSession (E143 firmware, two headless Players): the settings getter 0x503c49ab natively (MODE_EXPOSE 24 is 3,
//     P, at the start: test_camapp.mjs's dial check) by its notation and run-time address, memcpy answered by the lab's
//     hook with scratch and a restored write, the budget ending a call (CallLimit) and the session's next call, the
//     registers as before; refusals (a stopping watchpoint, a debug stop); then the same inputs on a session that made
//     no call: the records, the frame and every dirty memory page equal (the negative control: a write left in place,
//     restore false, is told apart), a fault (CallFault), the memcpy request with the lab's hook taken away (the
//     control for 'hooks honoured'), and an input after them; on a third with --loaded on (S-STALERAM) a fn in a gap and
//     one in a range not shown loaded refused before they run (BadRequest) with the session going on, and a callee that
//     reaches a gap answering UnloadedCode (the session cannot go on, restored false), the next call HostStopped;
//     mid-function calls (entry, stops): a stop at the getter's callee (the registers there), the first of two stops
//     reached named, a stop on prop_get's and on memcpy's hooked entries ending before the hook answers, an entry at the
//     getter's inner CALL (the whole getter's value) and at its ret (d0 as given: the control that the entry moved the
//     run), a stop at the entry, the budget with a stop; the hook rule (a patch range on prop_get's entry) refusing
//     the plain call but not one that stops there; with --loaded on an entry and a stop in a gap or a range not shown
//     loaded refused, and on a fourth session a callee in a gap reached from an entry with stops answering
//     UnloadedCode; all before the memory comparison with the session that made no call;
//   callTokenUnits (firmware-free): host/session.mjs's call token with entry=, stop=, frame= and call:@FILE;
//   callScripted (firmware, bin/session.mjs; E143, or E147 under OM_EMU_MODEL=E147): the same forms end to end.
//   node emu/test/test_call.mjs [--units | --session | --token-units | --scripted]
import { createHash } from 'node:crypto';
import { callSpec, SCRATCH_MAX, STOPS_MAX } from '../src/debug/call.mjs';
import { CALLER, RETURN } from '../src/lab/hle.mjs';
import { parseToken, stepInputs, callFileRequest, TokenError } from '../host/session.mjs';
import { Protocol } from '../src/debug/protocol.mjs';
import { execLine, jsonLine } from '../src/debug/trace.mjs';

const tester = (tag) => {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(`${tag}: ${what}`); };
  return { bad, ok, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// ---- firmware-free ---------------------------------------------------------------------------------------------
export function callUnits() {
  const t = tester('call units');
  const { ok } = t;
  try {
    const bad = (q, re, what) => { const e = thrown(() => callSpec(q)); ok(e?.name === 'BadRequest' && re.test(e.message), `${what}: ${e ? `${e.name}: ${e.message}` : 'accepted'}`); };
    const F = '0x503c49ab';
    bad({}, /fn: a number/, 'no fn');
    bad({ fn: '0x52000000' }, /neither .* give space/, 'fn past the image');
    bad({ fn: '0x1000' }, /neither/, 'fn below both ranges');
    bad({ fn: F, space: 'flash' }, /space: 'notation' or 'runtime'/, 'space flash');
    bad({ fn: F, regs: { sp: 0 } }, /"sp" is not one of/, 'regs sp');
    bad({ fn: F, regs: { mdr: 0 } }, /"mdr" is not one of/, 'regs mdr');
    bad({ fn: F, regs: { d0: '0x1ffffffff' } }, /not a 32-bit value/, 'regs over 32 bits');
    bad({ fn: F, regs: [1] }, /regs: an object/, 'regs a list');
    bad({ fn: F, regs: { a0: 'scratch' } }, /without a scratch size/, 'a scratch reference without scratch');
    bad({ fn: F, scratch: 16, regs: { a0: 'scratch+17' } }, /outside the 16 bytes/, 'a pointer past the scratch end');
    bad({ fn: F, scratch: SCRATCH_MAX + 1 }, /is over/, 'scratch over the cap');
    bad({ fn: F, scratch: -1 }, /not a non-negative/, 'scratch -1');
    bad({ fn: F, frame: [0] }, /frame: \[mask, size\]/, 'frame of one');
    bad({ fn: F, frame: [0, 256] }, /frame\[1\]: 256 is not a byte/, 'frame size 256');
    bad({ fn: F, frame: 'a' }, /frame: a list/, 'frame a string');
    bad({ fn: F, mem: [['0xa3000000', 'abc']] }, /even-length hex/, 'mem odd hex');
    bad({ fn: F, mem: [['0xa3000000']] }, /mem\[0\]: \[addr/, 'mem entry of one');
    bad({ fn: F, mem: '0xa3000000' }, /mem: a list/, 'mem a string');
    bad({ fn: F, scratch: 4, mem: [['scratch+2', '000000']] }, /outside the 4 bytes/, 'a mem write past the scratch');
    bad({ fn: F, mem: [['0xa3000000', '=0x100000000']] }, /not a 32-bit value/, 'a mem word over 32 bits');
    bad({ fn: F, read: [['0xa3000000', -1]] }, /len: -1 is not a non-negative/, 'read len -1');
    bad({ fn: F, scratch: 8, read: [['scratch+4', 8]] }, /outside the 8 bytes/, 'a read past the scratch');
    bad({ fn: F, restore: 'yes' }, /restore: true or false/, 'restore a string');
    bad({ fn: F, limit: 0 }, /limit: 0 is not a positive/, 'limit 0');
    bad({ fn: F, stack: Array(257).fill(0) }, /257 words is over 256/, 'stack of 257 words');
    bad({ fn: F, stack: 5 }, /stack: a list/, 'stack a number');
    // the forms accepted
    const s = callSpec({ fn: F, regs: { d0: 24, a0: 'scratch + 0x10', d2: -1 }, scratch: 32, stack: ['scratch', 7], mem: [['scratch', '0102'], ['0xa3000000', '=scratch+4']], read: [['scratch+16', 16]], restore: true, limit: '0x100' });
    ok(s.target.given === 'notation' && s.target.notation === 0x503c49ab && s.target.runtime === 0x603e59cb, `notation: ${JSON.stringify(s.target)}`);
    ok(s.regs.d0 === 24 && s.regs.a0.off === 16 && s.regs.d2 === 0xffffffff && s.stack[0].off === 0 && s.stack[1] === 7, `regs and stack: ${JSON.stringify([s.regs, s.stack])}`);
    ok(s.mem[0].len === 2 && s.mem[0].bytes[1] === 2 && s.mem[1].word.off === 4 && s.mem[1].at === 0xa3000000 && s.read[0].at.off === 16 && s.restore && s.limit === 256 && s.frame === null,
      `mem, read, restore, limit: ${JSON.stringify(s.mem.map((m) => [m.at, m.len]))}`);
    const r = callSpec({ fn: '0x603e59cb' });
    ok(r.target.given === 'runtime' && r.target.notation === 0x503c49ab && !r.restore && r.limit === 1000000 && r.scratch === 0, `run-time: ${JSON.stringify(r.target)}`);
    const n = callSpec({ fn: '0x3ffe18ea', space: 'notation', frame: ['0xf0', 28] });
    ok(n.target.runtime === 0x5000290a && n.frame[0] === 0xf0 && n.frame[1] === 28, `space notation outside the image: ${JSON.stringify(n.target)} frame ${n.frame}`);
    // the mid-function fields: an entry and stop pcs, in either notation (space for neither); a plain call has none
    ok(r.entry === null && r.stops.length === 0, `a plain call: no entry, no stops: ${JSON.stringify([r.entry, r.stops])}`);
    const e = callSpec({ fn: F, entry: '0x503c49b1', stops: ['0x603e6c63', 0x503ee3bf] });
    ok(e.entry.given === 'notation' && e.entry.runtime === 0x603e59d1 && e.stops.length === 2 && e.stops[0].given === 'runtime' && e.stops[0].notation === 0x503c5c43 && e.stops[1].runtime === 0x6040f3df,
      `entry and stops: ${JSON.stringify([e.entry, e.stops])}`);
    const en = callSpec({ fn: '0x3ffe18ea', space: 'notation', stops: ['0x3ffe18ea'] });
    ok(en.stops[0].runtime === 0x5000290a, `a stop outside the image under space: ${JSON.stringify(en.stops)}`);
    bad({ fn: F, stops: ['0x1000'] }, /stops\[0\]: 0x00001000 is in neither .* give space/, 'a stop in neither range');
    bad({ fn: F, entry: '0x52000000' }, /entry: 0x52000000 is in neither/, 'an entry past the image');
    bad({ fn: F, stops: '0x503c49b1' }, /stops: a list/, 'stops a string');
    bad({ fn: F, stops: Array(STOPS_MAX + 1).fill(F) }, new RegExp(`stops: ${STOPS_MAX + 1} pcs is over ${STOPS_MAX}`), 'too many stops');
    bad({ fn: F, stop: [F] }, /stop: the stop pcs are stops/, 'the field stop (not stops)');
    bad({ fn: F, pc: F }, /pc: a pc to start at is entry/, 'the field pc (not entry)');
    bad({ fn: F, space: 'runtime', stops: [h8(CALLER + 7)] }, /stops\[0\]: .* is the harness's own trampoline/, 'a stop at the trampoline\'s return');
    bad({ fn: F, space: 'runtime', entry: h8(RETURN) }, /entry: .* is the harness's own trampoline/, 'an entry in the stubs\' trampoline');
    // a standalone machine refuses it
    const P = new Protocol({ env: { createHash }, defaultImage: 'tiny', loadImage: () => new Uint8Array(0x1000) });
    P.handle({ op: 'load' });
    const pr = P.handle({ id: 1, op: 'call', fn: F });
    ok(!pr.ok && pr.error.type === 'BadRequest' && /live route only/.test(pr.error.message), `standalone call: ${JSON.stringify(pr)}`);
    // the exec trace's record: d3, a0-a3 and mdr beside the QEMU line's registers
    const regs = { pc: '0xa3000000', d0: 1, d1: 2, d2: 3, d3: 4, a0: '0xa0a0a0a0', a1: '0xa1a1a1a1', a2: '0xa2a2a2a2', a3: '0xa3a3a3a3', mdr: '0x0d0d0d0d' };
    P.handle({ op: 'write', addr: '0xa3000000', hex: 'cbcb' });
    P.handle({ op: 'reset', regs });
    const recs = [];
    P.dbg.traceExec((x) => recs.push(x));
    P.handle({ op: 'step' });
    P.dbg.traceExec(null);
    const j = recs.length ? JSON.parse(jsonLine('exec', recs[0])) : {};
    ok(recs.length === 1 && ['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3', 'mdr'].every((k) => j[k] === h8(Number(regs[k]))) && j.sp === '0xa2200000',
      `the jsonl record: ${JSON.stringify(j)}`);
    ok(recs.length === 1 && execLine(recs[0]) === 'MN10300 pc=a3000000 op=cb sp=a2200000 d0=00000001 d1=00000002 d2=00000003 psw=0000', `the QEMU line: ${recs.length && execLine(recs[0])}`);
    P.handle({ op: 'quit' });
  } catch (e) { t.bad.push(`call units: threw ${e.stack}`); }
  return { checks: t.checks, bad: t.bad };
}

// The settings getter's shape on E143 and E147 (D: E143 0x503c49ab, E147 0x503cf0f1): `exthu d0` at GETTER, `call
// INNER,[d2,d3,a2,a3],20` (CALL d16) at GETTER+1, `ret [],4` at GETTER+6; null when the image differs
export function getterShape(image, GETTER, BASE) {
  const o = (GETTER - BASE) >>> 0;
  if (image[o] !== 0x1c || image[o + 1] !== 0xcd || image[o + 6] !== 0xdf) return null;
  return { call: GETTER + 1, inner: (GETTER + 1 + (((image[o + 2] | image[o + 3] << 8) << 16) >> 16)) >>> 0, frame: [image[o + 4], image[o + 5]], ret: GETTER + 6 };
}

// The mid-function calls on a session (ask: a debug input's answer): stops (at the getter's callee, the first of two
// reached, on prop_get's hooked entry, at memcpy's hooked entry, at the entry), entries (the getter's inner CALL and its
// ret), a budget with stops
function midCalls({ ok }, ask, { GETTER, MEMCPY, PROP_GET, SP, image, BASE, runtime, MODE_EXPOSE, P, SRC, mc }) {
  const g = getterShape(image, GETTER, BASE);
  ok(g !== null, `the getter's shape at ${h8(GETTER)}`);
  if (g === null) return;
  const q = { op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } };
  // a stop at the callee's entry: before its first instruction, after the CALL, exthu and the getter's CALL; sp
  // inside both frames
  let r = ask({ ...q, stops: [h8(g.inner)] });
  ok(r?.ok && r.end === 'stop' && r.stop?.index === 0 && r.stop.notation === h8(g.inner) && r.steps === 3 && r.stubs.length === 0 && r.regs.pc === h8(runtime(g.inner))
    && r.regs.d0 === h8(MODE_EXPOSE) && r.regs.sp === h8(SP - 4 - g.frame[1]) && r.regs.mdr === h8(runtime(g.call + 5)), `a stop at the getter's callee: ${JSON.stringify(r).slice(0, 500)}`);
  r = ask({ ...q, stops: [h8(GETTER + 9), h8(g.inner)] });
  ok(r?.ok && r.end === 'stop' && r.stop?.index === 1, `the stop reached names which: ${JSON.stringify(r?.stop)}`);
  // a stop on a hooked pc ends before the hook answers (the plain call's stubs have prop_get)
  r = ask({ ...q, stops: [h8(PROP_GET)] });
  ok(r?.ok && r.end === 'stop' && r.stop.notation === h8(PROP_GET) && r.stubs.length === 0, `a stop on prop_get's hooked entry: ${JSON.stringify(r).slice(0, 300)}`);
  r = ask({ ...mc, stops: [h8(MEMCPY)] });
  ok(r?.ok && r.end === 'stop' && r.steps === 1 && r.stubs.length === 0 && r.reads[1].hex !== SRC && r.restored === true, `a stop on memcpy's hooked entry: no copy: ${JSON.stringify(r).slice(0, 300)}`);
  // entries: at the getter's inner CALL, its value as the whole getter's; at its ret, d0 back as given (the frame the
  // CALL to the getter makes: ret [],4 returns to the harness with sp at the top, the lab's return check)
  r = ask({ ...q, entry: h8(g.call) });
  ok(r?.ok && r.end === 'return' && Number(r.regs.d0) === P && r.entry?.notation === h8(g.call) && r.fn.notation === h8(GETTER) && r.stubs.some(([n]) => n === 'prop_get'),
    `an entry at the getter's inner CALL: ${JSON.stringify(r).slice(0, 300)}`);
  r = ask({ ...q, entry: h8(g.ret) });
  ok(r?.ok && r.end === 'return' && r.regs.d0 === h8(MODE_EXPOSE) && r.steps === 2 && r.regs.sp === h8(SP), `an entry at the getter's ret: ${JSON.stringify(r).slice(0, 300)}`);
  r = ask({ ...q, entry: h8(g.ret), stops: [h8(g.ret)] });
  ok(r?.ok && r.end === 'stop' && r.steps === 1 && r.regs.sp === h8(SP - 4), `a stop at the entry: after the trampoline's CALL: ${JSON.stringify(r).slice(0, 300)}`);
  // the budget with stops not reached: CallLimit, the end and the registers where it ran out
  r = ask({ ...q, stops: [h8(PROP_GET)], limit: 5 });
  ok(r && !r.ok && r.error.type === 'CallLimit' && r.error.detail.end === 'budget' && r.error.detail.regs?.pc === r.error.detail.pc && r.error.detail.steps === 5,
    `the budget with a stop not reached: ${JSON.stringify(r).slice(0, 400)}`);
}

// ---- headless Players on E143 ------------------------------------------------------------------------------------
export async function callSession() {
  const t = tester('call session');
  const { ok } = t;
  const { loadImage, loadBlock, loadNand } = await import('../checks/lib/env.mjs');
  const { Player, ArrayQueue } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { GETTER } = await import('../src/lab/menu.mjs');
  const { MEMCPY, DATA, DATA_END, BASE, SP, runtime } = await import('../src/lab/hle.mjs');
  const { PROP_GET } = await import('../src/lab/display.mjs');
  const { PatchRanges } = await import('../src/lab/patchaudit.mjs');
  const { DRAM_OFF } = await import('../src/core/mem.mjs');
  class ScriptQueue extends ArrayQueue {          // blocks as the node host's queue does (stopping watchpoints allowed)
    get canBlock() { return true; }
    get(_t) { if (!this.length && this.feed) this.feed(this); return this.get_nowait(); }
  }
  const results = new Map();
  const base = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, onResult: (seq, r) => results.set(seq, r) };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true };
  let seq = 0;
  const open = () => { const p = new Player(args, { ...base, queue: new ScriptQueue() }); p.open_session(); return p; };
  const apply = (pl, x) => { const i = { seq: ++seq, t_wall: 0, ...x }; pl.apply(i); return results.get(i.seq); };
  const MODE_EXPOSE = 24, P = 3, SRC = '0102030405060708', AWAY = 0x63000000;
  // the same inputs on each session: their records (error, kind, the GUI state after) and the frame
  const inputs = (pl) => {
    const recs = [{ type: 'dial', id: 'main', detents: 1 }, { type: 'key', id: 'ok', action: 'down' }, { type: 'key', id: 'ok', action: 'up' }]
      .map((x) => apply(pl, x)).map((r) => JSON.stringify([r?.error, r?.record?.kind, r?.record?.state_after]));
    return { recs, frame: createHash('sha256').update(Uint32Array.from(pl.session.frame()[2])).digest('hex') };
  };
  // every dirty 64 KiB page's digest (a page never written reads as zeros, as an absent one)
  const ZERO = createHash('sha256').update(new Uint8Array(1 << 16)).digest('hex');
  const pages = (pl) => {
    const s = pl.session.lab.sim.m.snapshot(), out = new Map();
    s.mem.pages.forEach((p, i) => { const d = createHash('sha256').update(s.mem.data.subarray(i << 16, (i + 1) << 16)).digest('hex'); if (d !== ZERO) out.set(p, d); });
    return out;
  };
  const differ = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).map((p) => h8(0x60000000 + p * 65536 - DRAM_OFF));
  let A = null, B = null, C = null, D = null;
  try {
    A = open();
    const ask = (f) => apply(A, { type: 'debug', ...f })?.debug;
    const regs0 = ask({ op: 'regs' }).regs;
    // the getter by its notation and its run-time address
    let r = ask({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } });
    ok(r?.ok && Number(r.regs.d0) === P && r.fn.given === 'notation' && r.fn.runtime === h8(runtime(GETTER)) && r.steps > 0 && r.stubs.some(([n]) => n === 'prop_get') && r.regs.pc === h8(0xa2100007),
      `the getter (MODE_EXPOSE): ${JSON.stringify(r).slice(0, 400)}`);
    r = ask({ op: 'call', fn: h8(runtime(GETTER)), regs: { d0: MODE_EXPOSE } });
    ok(r?.ok && Number(r.regs.d0) === P && r.fn.given === 'runtime' && r.fn.notation === h8(GETTER), `the getter by its run-time address: ${JSON.stringify(r?.fn)} d0 ${r?.regs?.d0}`);
    // memcpy answered by the lab's hook (its run-time address holds no memcpy): scratch, a word, a write put back
    const mc = { op: 'call', fn: h8(MEMCPY), space: 'notation', scratch: 64, mem: [['scratch', SRC], ['scratch+16', '=scratch+32'], [h8(AWAY), 'aabbccdd']], restore: true,
      regs: { a0: 'scratch+32', a1: 'scratch', d0: 8 }, read: [['scratch+16', 4], ['scratch+32', 8], [h8(AWAY), 4]] };
    r = ask(mc);
    const sb = r?.scratch ? Number(r.scratch) : 0, le = (v) => Buffer.from(Uint32Array.of(v).buffer).toString('hex');
    ok(r?.ok && r.stubs.length === 1 && r.stubs[0][0] === 'memcpy' && r.stubs[0][1] === 1 && sb >= DATA && sb + 64 <= DATA_END
      && r.reads[0].hex === le(sb + 32) && r.reads[1].hex === SRC && r.reads[2].hex === 'aabbccdd' && r.restored === true,
      `memcpy through its hook: ${JSON.stringify(r).slice(0, 500)}`);
    const back = ask({ op: 'read', addr: h8(AWAY), size: 4 })?.hex, ring = ask({ op: 'read', addr: h8(sb), size: 64 })?.hex;
    ok(back === '00000000' && !ring.startsWith(SRC), `after it: the write put back (${back}), the scratch's bytes back (${ring?.slice(0, 16)})`);
    // the budget: CallLimit with its detail, then the session's next call
    r = apply(A, { type: 'debug', op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE }, limit: 5 })?.debug;
    ok(r && !r.ok && r.error.type === 'CallLimit' && r.error.detail.steps === 5 && /budget of 5 instructions/.test(r.error.message), `the budget ran out: ${JSON.stringify(r).slice(0, 400)}`);
    ok(Number(ask({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } })?.regs?.d0) === P, 'the next call after the budget');
    midCalls(t, ask, { GETTER, MEMCPY, PROP_GET, SP, image: A.session.lab.image, BASE, runtime, MODE_EXPOSE, P, SRC, mc });
    // the hook rule (src/lab/patchaudit.mjs) on the call's run: a patch range on prop_get's hooked entry refuses the
    // plain call (PatchHooked), and a stop there ends before the hook answers, so the rule is not reached
    const lab0 = A.session.lab, patch0 = lab0.patch;
    lab0.patch = new PatchRanges([[(PROP_GET - BASE) >>> 0, 1]], lab0.image);
    try {
      r = ask({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } });
      ok(r && !r.ok && r.error.type === 'PatchHooked' && r.error.message.includes('lab hook prop_get reached'), `the hook rule in a call: ${JSON.stringify(r?.error).slice(0, 300)}`);
      r = ask({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE }, stops: [h8(PROP_GET)] });
      ok(r?.ok && r.end === 'stop' && r.stubs.length === 0, `a stop on the patched hook's pc: ${JSON.stringify(r).slice(0, 300)}`);
    } finally { lab0.patch = patch0; }
    ok(JSON.stringify(ask({ op: 'regs' }).regs) === JSON.stringify(regs0), 'the 16 registers as before the calls (insns among them)');
    // refusals: a frame the image cannot give, a stopping watchpoint armed, a debug stop
    r = ask({ op: 'call', fn: '0x50000000' });
    ok(r && !r.ok && /call-site frames \[\]: give frame/.test(r.error.message), `no call site: ${JSON.stringify(r?.error)}`);
    const stime = A.session.lab.nk.kcb(36);
    ask({ op: 'watch', list: [{ addr: stime, len: 4, kind: 'w', action: 'stop' }] });
    r = ask({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } });
    ok(r && !r.ok && /stopping watchpoint is armed/.test(r.error.message), `refused with a stopping watchpoint: ${JSON.stringify(r?.error)}`);
    const held = [];
    const script = [{ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } }, { op: 'detach' }];
    A.q.feed = (q) => { const s = script.shift(); if (s) { const i = { seq: ++seq, t_wall: 0, type: 'debug', ...s }; held.push(i.seq); q.put(i); } };
    apply(A, { type: 'debug', op: 'cont' });
    apply(A, { type: 'token', token: 'WAIT:20' });
    A.q.feed = null;
    r = results.get(held[0])?.debug;
    ok(r && !r.ok && /not at a debug stop/.test(r.error.message) && results.get(held[1])?.debug?.state === 'running', `refused at a debug stop: ${JSON.stringify(r?.error)}`);
    // the inputs the session without calls will make (its memory compared below), and the negative control's
    // memory: a write left in place (restore false)
    const ia = inputs(A), pa = pages(A);
    ask({ ...mc, restore: false });
    const pw = pages(A);
    // a fault, the session after it, then the memcpy request with the lab's hook taken away (the code at memcpy's
    // run-time address is no memcpy: last, as what it runs may write anywhere)
    const regs1 = ask({ op: 'regs' }).regs;
    r = ask({ op: 'call', fn: '0x98000000', space: 'runtime', frame: [0, 0] });
    ok(r && !r.ok && r.error.type === 'CallFault' && r.error.detail.fault === 2 && r.error.detail.pc === '0x98000000', `a fault: ${JSON.stringify(r).slice(0, 300)}`);
    ok(JSON.stringify(ask({ op: 'regs' }).regs) === JSON.stringify(regs1), 'the registers as before after the fault');
    const after = apply(A, { type: 'dial', id: 'main', detents: -1 });
    ok(after && !after.error && after.record?.kind === 'dial', `an input after the failed calls: ${JSON.stringify(after).slice(0, 200)}`);
    const lab = A.session.lab, hook = lab.hooks.get(runtime(MEMCPY));
    lab.hooks.delete(runtime(MEMCPY));
    try { r = ask({ ...mc, limit: 10000 }); } finally { lab.hooks.set(runtime(MEMCPY), hook); }
    ok(r && !(r.ok && r.reads?.[1]?.hex === SRC) && !(r.ok ? r.stubs : r.error?.detail?.stubs ?? []).some(([n]) => n === 'memcpy'), `without the lab's memcpy hook: no copy: ${JSON.stringify(r).slice(0, 300)}`);
    A.close_session();
    // a session that made no call (one machine at a time: after A): the same inputs, equal records, frame and memory
    B = open();
    apply(B, { type: 'token', token: 'WAIT:20' });
    const ib = inputs(B), pb = pages(B);
    const d0 = differ(pa, pb), d1 = differ(pw, pb);
    ok(JSON.stringify(ia.recs) === JSON.stringify(ib.recs) && ia.frame === ib.frame, `the inputs after the calls as without: ${ia.recs} / ${ib.recs}, frames ${ia.frame === ib.frame}`);
    ok(pa.size > 100 && d0.length === 0, `memory as without the calls: ${pa.size} pages, differing ${d0.join(' ')}`);
    ok(d1.length === 1 && d1[0] === h8(AWAY), `the negative control, a write left in place (restore false), told apart: differing ${d1.join(' ')}`);
    B.close_session();
    // S-STALERAM (--loaded on): a fn in a gap or in a range not shown loaded is refused before it runs and the session
    // goes on (without the check the fetch guard stops the machine: the getter after it answers HostStopped); a callee
    // that reaches a gap (a jmp (a0) written at AWAY) answers UnloadedCode, says the session cannot go on and that
    // nothing was put back (restored false), and the next call answers HostStopped
    C = new Player(args, { ...base, loaded: 'on', queue: new ScriptQueue() });
    C.open_session();
    const askC = (f) => apply(C, { type: 'debug', ...f })?.debug;
    const loads = C.session.lab.sim.loads, gap = loads?.gaps[0], head = loads?.unshown.find((u) => u.kind === 'head');
    for (const [g, words] of [[gap, 'runs code the boot does not load'], [head, 'runs code the boot is not shown to load (?)']]) {
      const fn = g.lo + 0x10;
      r = askC({ op: 'call', fn: h8(fn), space: 'runtime', frame: [0, 0] });
      ok(r && !r.ok && r.error.type === 'BadRequest' && r.error.message.includes(`(run-time ${h8(fn)}): refused before it runs: pc ${h8(fn)} ${words}: ${h8(g.lo)}..${h8(g.hi)}`),
        `a fn at ${h8(fn)}: ${JSON.stringify(r?.error).slice(0, 300)}`);
      r = askC({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } });
      ok(r?.ok && Number(r.regs.d0) === P, `the getter after the refused fn at ${h8(fn)}: ${JSON.stringify(r).slice(0, 300)}`);
      // the same pc as a mid-function call's entry, and as its second stop: refused before the run, the session going on
      for (const [field, what] of [[{ entry: h8(fn) }, 'entry'], [{ stops: [h8(runtime(GETTER) + 9), h8(fn)] }, 'stops[1]']]) {
        r = askC({ op: 'call', fn: h8(runtime(GETTER)), space: 'runtime', regs: { d0: MODE_EXPOSE }, ...field });
        ok(r && !r.ok && r.error.type === 'BadRequest' && r.error.message.includes(`(run-time ${h8(runtime(GETTER))}): ${what} refused before it runs: pc ${h8(fn)} ${words}: ${h8(g.lo)}..${h8(g.hi)}`),
          `${what} at ${h8(fn)}: ${JSON.stringify(r?.error).slice(0, 300)}`);
      }
      r = askC({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE }, stops: [h8(PROP_GET)] });
      ok(r?.ok && r.end === 'stop', `a stop after the refused entry and stop at ${h8(fn)}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    r = askC({ op: 'call', fn: h8(AWAY), space: 'runtime', frame: [0, 0], mem: [[h8(AWAY), 'f0f4']], regs: { a0: h8(gap.lo + 0x10) } });
    ok(r && !r.ok && r.error.type === 'UnloadedCode' && r.error.message.includes(`pc ${h8(gap.lo + 0x10)} runs code the boot does not load`) &&
      r.error.message.includes('the session cannot go on') && r.error.detail?.restored === false && r.error.detail?.pc === h8(gap.lo + 0x10),
    `a callee in a gap: ${JSON.stringify(r).slice(0, 500)}`);
    r = askC({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE } });
    ok(r && !r.ok && r.error.type === 'HostStopped', `the call after it: ${JSON.stringify(r?.error).slice(0, 200)}`);
    try { C.close_session(); } catch { /* the machine a host error stopped refuses its close's reads */ }
    // the same callee reached from a mid-function entry with a stop it does not reach: UnloadedCode as above
    D = new Player(args, { ...base, loaded: 'on', queue: new ScriptQueue() });
    D.open_session();
    const askD = (f) => apply(D, { type: 'debug', ...f })?.debug;
    r = askD({ op: 'call', fn: h8(AWAY - 2), space: 'runtime', entry: h8(AWAY), frame: [0, 0], mem: [[h8(AWAY), 'f0f4']], regs: { a0: h8(gap.lo + 0x10) }, stops: [h8(runtime(GETTER))] });
    ok(r && !r.ok && r.error.type === 'UnloadedCode' && r.error.message.includes(`pc ${h8(gap.lo + 0x10)} runs code the boot does not load`) &&
      r.error.message.includes('the session cannot go on') && r.error.detail?.restored === false && r.error.detail?.pc === h8(gap.lo + 0x10),
    `a callee in a gap from an entry with stops: ${JSON.stringify(r).slice(0, 500)}`);
    r = askD({ op: 'call', fn: h8(GETTER), regs: { d0: MODE_EXPOSE }, stops: [h8(PROP_GET)] });
    ok(r && !r.ok && r.error.type === 'HostStopped', `the call with stops after it: ${JSON.stringify(r?.error).slice(0, 200)}`);
  } catch (e) { t.bad.push(`call session: threw ${e.stack}`); }
  finally { for (const p of [A, B, C, D]) { try { if (p?.session) p.close_session(); } catch (e) { if (p !== C && p !== D) throw e; } } }
  return { checks: t.checks, bad: t.bad };
}

// ---- the session tool's call token (host/session.mjs): the mid-function forms -------------------------------------
// callTokenUnits (firmware-free): call:FN's entry=, stop= and frame= keys and their refusals, the old spelling's step
// and input unchanged, call:@FILE's step, its request's checks (callFileRequest) and its Player input.
export function callTokenUnits() {
  const t = tester('call token units');
  const { ok } = t;
  try {
    const tok = (s) => { try { return parseToken(s); } catch (e) { return e; } };
    const st = tok('call:0x503c49ab:d0=24,entry=0x503c49b1,stop=0x503c5c26,stop=0x603e6c63,frame=0xf0/20,limit=500');
    ok(st.kind === 'call' && st.entry === 0x503c49b1 && JSON.stringify(st.stops) === JSON.stringify([0x503c5c26, 0x603e6c63]) && JSON.stringify(st.frame) === '[240,20]' && st.limit === 500 && st.regs.d0 === 24,
      `entry, stops, frame: ${JSON.stringify(st)}`);
    ok(JSON.stringify(stepInputs(st)) === `[{"type":"debug","op":"call","fn":${0x503c49ab},"regs":{"d0":24},"limit":500,"entry":${0x503c49b1},"stops":[${0x503c5c26},${0x603e6c63}],"frame":[240,20]}]`,
      `their input: ${JSON.stringify(stepInputs(st))}`);
    const old = tok('call:0x503c49ab:d0=24');
    ok(JSON.stringify(old) === `{"text":"call:0x503c49ab:d0=24","kind":"call","fn":${0x503c49ab},"regs":{"d0":24},"limit":null,"space":null}`
      && JSON.stringify(stepInputs(old)) === `[{"type":"debug","op":"call","fn":${0x503c49ab},"regs":{"d0":24}}]`, `the old spelling unchanged: ${JSON.stringify([old, stepInputs(old)])}`);
    for (const [s, re] of [['call:0x10:frame=1', /frame=MASK\/SIZE/], ['call:0x10:frame=0x100/4', /frame=MASK\/SIZE/], ['call:0x10:frame=0/4,frame=0/8', /frame= given twice/],
      ['call:0x10:entry=1,entry=2', /entry= given twice/], ['call:0x10:stop=0x1ffffffff', /stop=0x1ffffffff is not a 32-bit value/], ['call:0x10:stops=1', /"stops=1" is not one of/]]) {
      const e = tok(s);
      ok(e instanceof TokenError && re.test(e.message), `${s}: ${e?.message ?? JSON.stringify(e)}`);
    }
    const f = tok('call:@spec.json');
    ok(f.kind === 'call' && f.file === 'spec.json', `call:@FILE: ${JSON.stringify(f)}`);
    const unread = (() => { try { stepInputs(f); return null; } catch (e) { return e; } })();
    ok(unread instanceof TokenError && /read from the file by openSession/.test(unread.message), `its input before the file is read: ${unread?.message}`);
    const req = { fn: '0x503c49ab', regs: { d0: 24 }, stops: ['0x503c5c26'], scratch: 16, mem: [['scratch', '11223344']], read: [['scratch', 4]] };
    ok(JSON.stringify(callFileRequest(f.text, 'spec.json', JSON.stringify(req))) === JSON.stringify(req), 'a request read');
    ok(JSON.stringify(stepInputs({ ...f, request: req })) === JSON.stringify([{ type: 'debug', op: 'call', ...req }]), `its input: ${JSON.stringify(stepInputs({ ...f, request: req }))}`);
    for (const [text, re] of [['{"fn": 1,', /spec.json: not JSON/], ['[1]', /a JSON object of the call op's fields/], ['{"fn": "0x10", "stop": []}', /"stop" not among the call op's fields/],
      ['{"op": "call", "fn": "0x10"}', /"op" not among/]]) {
      const e = (() => { try { callFileRequest(f.text, 'spec.json', text); return null; } catch (x) { return x; } })();
      ok(e instanceof TokenError && re.test(e.message), `${text}: ${e?.message}`);
    }
  } catch (e) { t.bad.push(`call token units: threw ${e.stack}`); }
  return { checks: t.checks, bad: t.bad };
}

// callScripted (firmware, bin/session.mjs on this process's model: E143, or E147 in a process of its own): the
// getter's call with a stop at its callee, an entry at its inner CALL (the value of the whole getter) and at its ret (d0
// as given), a call:@FILE request with scratch, a write, a read and a stop (a poke in the summary), the old spelling
// beside them (end return, no entry); the refusals before the boot (exit 2): a malformed frame=, a call:@FILE that is
// missing, has a field the op does not have, or one the op refuses.
export async function callScripted() {
  const t = tester('call scripted');
  const { ok } = t;
  const fs = await import('node:fs'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { GETTER } = await import('../src/lab/menu.mjs');
  const { BASE } = await import('../src/lab/hle.mjs');
  const EMU = path.resolve(new URL('..', import.meta.url).pathname);
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-call-' + process.pid), T = (...p) => path.join(tmp, ...p);
  const cli = (args) => {
    const r = spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), '--model', MODEL, '--out', T('out'), ...args], { encoding: 'utf8', timeout: 300000 });
    const lines = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { unparsed: l }; } });
    return { rc: r.status, steps: lines.filter((x) => !x.summary), sum: lines.find((x) => x.summary) ?? null, err: r.stderr ?? '' };
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(T('out'), { recursive: true });
  try {
    const g = getterShape(loadImage(), GETTER, BASE);
    ok(g !== null, `${MODEL}: the getter's shape at ${h8(GETTER)}`);
    if (g === null) return t;
    const G = h8(GETTER), req = { fn: G, regs: { d0: 24 }, scratch: 16, mem: [['scratch', '11223344']], read: [['scratch', 4]], restore: true, stops: [h8(g.inner)] };
    fs.writeFileSync(T('out', 'req.json'), JSON.stringify(req));
    const toks = [`call:${G}:d0=24`, `call:${G}:d0=24,stop=${h8(g.inner)}`, `call:${G}:d0=24,entry=${h8(g.call)}`, `call:${G}:d0=24,entry=${h8(g.ret)},frame=0/4`, 'call:@req.json'];
    const r = cli(['wait:500', ...toks]);
    const step = (tk) => r.steps.find((x) => x.token === tk) ?? {};
    const [plain, stop, mid, ret, file] = toks.map(step);
    ok(r.rc === 0 && r.sum?.ok === true && r.steps.length === 7, `${MODEL}: rc ${r.rc} ${r.err.slice(-500)}`);
    ok(plain.end === 'return' && !('entry' in plain) && !('stop' in plain) && /^0x[0-9a-f]{8}$/.test(plain.d0 ?? ''), `${MODEL} the old spelling: ${JSON.stringify(plain).slice(0, 300)}`);
    ok(stop.end === 'stop' && stop.stop?.notation === h8(g.inner) && stop.steps === 3 && stop.stubs?.length === 0 && stop.d0 === h8(24), `${MODEL} a stop: ${JSON.stringify(stop).slice(0, 300)}`);
    ok(mid.end === 'return' && mid.entry === h8(g.call) && mid.d0 === plain.d0, `${MODEL} an entry at the inner CALL (${plain.d0}): ${JSON.stringify(mid).slice(0, 300)}`);
    ok(ret.end === 'return' && ret.entry === h8(g.ret) && ret.d0 === h8(24) && ret.steps === 2, `${MODEL} an entry at the ret: ${JSON.stringify(ret).slice(0, 300)}`);
    ok(file.end === 'stop' && file.reads?.[0]?.hex === '11223344' && /^0x[0-9a-f]{8}$/.test(file.scratch ?? '') && file.stop?.index === 0, `${MODEL} call:@FILE: ${JSON.stringify(file).slice(0, 300)}`);
    ok(r.sum?.calls?.length === 5 && r.sum.pokes?.length === 1 && r.sum.pokes[0].token === 'call:@req.json' && r.sum.pokes[0].mem?.[0]?.[1] === '11223344' && /POKED: 1 write\(s\) \(step 6 call:@req\.json\)/.test(r.err),
      `${MODEL} the summary: calls ${r.sum?.calls?.length}, pokes ${JSON.stringify(r.sum?.pokes)}, ${r.err.trim().split('\n').at(-1)}`);
    // refused before the boot (exit 2, no step run)
    fs.writeFileSync(T('out', 'typo.json'), JSON.stringify({ fn: G, stop: [h8(g.inner)] }));
    fs.writeFileSync(T('out', 'far.json'), JSON.stringify({ fn: G, stops: ['0x1000'] }));
    for (const [tk, re] of [[`call:${G}:frame=4`, /frame=MASK\/SIZE/], ['call:@none.json', /none\.json: cannot read it \(ENOENT\)/], ['call:@typo.json', /"stop" not among the call op's fields/],
      ['call:@far.json', /stops\[0\]: 0x00001000 is in neither/]]) {
      const x = cli(['wait:100', tk]);
      ok(x.rc === 2 && re.test(x.err) && x.steps.length === 0, `${MODEL} ${tk}: rc ${x.rc} ${x.err.slice(0, 300)}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2];
  for (const [name, f] of [['--units', callUnits], ['--session', callSession], ['--token-units', callTokenUnits], ['--scripted', callScripted]]) {
    if (which && which !== name) continue;
    const r = await f();
    console.log(`${name.slice(2)}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    if (r.bad.length) process.exitCode = 1;
  }
}
