// The strict mode (src/lab/strict.mjs, src/core/mem.mjs setStrict, src/fw/strict-allow.mjs; --strict on, OM_STRICT=1):
//   strictUnits    (firmware-free) the machine with strict ranges on a synthetic block: a store into the image span
//                  reported (and a second store to the same page, the page's fast store path staying off), through the
//                  uncached view too, one outside not; a load from a read range reported, one outside not; a
//                  misaligned load and store reported and still faulted (fault 3); the controls: no strict option, the
//                  same steps report nothing (the misaligned ones still fault), and setStrict(null) after a run turns
//                  it off. The log: the classes (image-store, a store in a gap named so, init-read with the copy's
//                  address, unloaded-read with its range, misaligned), sites kept per pc with counts, an allowlist
//                  entry counted and not reported, by pc and by address, and its controls (an entry for another pc, of
//                  another kind, or an address range that misses: reported), a site on patched bytes reported despite
//                  its entry, the cap and its count; strictOn's option and OM_STRICT; strictLine; the allowlist's
//                  shape (kinds, ordered ranges, a reason)
//   strictSession  (the stock blocks; each model in a child bin/session.mjs) STOCK_SESSIONS on E143, E147 and E142 with
//                  --strict on: no new site, and accesses allowed (the allowlist is what keeps them quiet); a patch the
//                  test writes on E142 (routines in section 1's 0xFF tail called by the call op): issue #48's read of
//                  the init word 0x6025aa98 (init-read, copied to 0x61fc27d8), a byte store into section 3's range
//                  (image-store) and a misaligned word load (misaligned, the call faulting), each on patched bytes;
//                  the controls, the live copy's read and a .bss byte store, report nothing; on E143 a routine in
//                  section 6's tail loading a word past its loaded end (unloaded-read), its control a word inside
//   node emu/test/test_strict.mjs [--session]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const le = (v) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24 & 0xff];
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// The stock sessions the allowlist was built from (src/fw/strict-allow.mjs), as bin/session.mjs tokens; the EVF's
// tokens are left out on a body without an eye sensor
export const STOCK_SESSIONS = [
  'wait:1500 s1 wait:1200 s2:down wait:300 s2:up wait:5000 play wait:1500 right wait:800 play wait:1000 menu wait:1500 down wait:500 right wait:500 menu wait:1500',
  'wait:1500 info wait:600 info wait:600 main_dial:+2 sub_dial:-1 wait:800 ok wait:800 right wait:500 ok wait:800 menu wait:1500 down down down right wait:800 down wait:500 right wait:500 left left menu wait:1000 menu wait:800 eye wait:1500 s1 wait:1000 s2:down wait:300 s2:up wait:5000 power:off restart wait:1500 play wait:1500 delete wait:800 play wait:1000',
];
const NO_EVF = new Set(['E142']);

export async function strictUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { createMachine } = await import('../src/machine.mjs');
  const mem = await import('../src/core/mem.mjs');
  const { IMAGE_BASE } = await import('../src/fw/model.mjs');
  const { StrictLog, strictRanges, strictOn, strictLine, allowed } = await import('../src/lab/strict.mjs');
  const { STRICT_ALLOW } = await import('../src/fw/strict-allow.mjs');

  // the machine: a synthetic block at the lab's image base; `mov d0,(a0)` at +0x100, `mov (a0),d0` at +0x110,
  // `movhu (a0),d0`'s word cousin is not needed: a misaligned word load is `mov (a0),d0` with an odd a0
  const SIZE = 0x40000, B = IMAGE_BASE;
  const rom = new Uint8Array(SIZE).fill(0xcb);
  rom[0x100] = 0x60; rom[0x110] = 0x70;
  const ST = B + 0x100, LD = B + 0x110, IN = B + 0x2000, READS = [B + 0x8000, B + 0x9000], OUT = 0x6c000000;
  const reports = [];
  const cfg = () => ({ stores: [[B, B + SIZE]], reads: [READS], report: (kind, a, w, dir, v) => reports.push({ kind, a, w, dir, v, pc: mem.ctx.pc() }) });
  const run = (m, pc, a0, d0 = 0x11223344) => {
    const r = m.getRegs(); r[9] = pc; r[4] = a0; r[0] = d0; m.setRegs(r);
    m.step();
    return m.lastStop?.() ?? null;
  };
  const fresh = (strict) => { reports.length = 0; return createMachine({ rom, insnLimit: 0, strict }); };
  let m = fresh(cfg());
  run(m, ST, IN);
  run(m, ST, IN + 4);
  ok(reports.length === 2 && reports.every((x) => x.kind === 'store' && x.w === 4 && x.dir === 'w' && x.pc === ST) && reports[1].a === IN + 4 && reports[0].v === 0x11223344,
    `two stores into the image span reported (the page's fast path stays off): ${JSON.stringify(reports)}`);
  ok(m.dbgRead(IN, 4).join() === '68,51,34,17', 'the store itself happened');
  reports.length = 0; run(m, ST, (IN + 0x40000000) >>> 0);
  ok(reports.length === 1 && reports[0].a === (IN + 0x40000000) >>> 0, `a store through the uncached view reported: ${JSON.stringify(reports)}`);
  reports.length = 0; run(m, ST, OUT);
  ok(reports.length === 0, `a store outside the image not reported: ${JSON.stringify(reports)}`);
  run(m, LD, READS[0] + 8);
  ok(reports.length === 1 && reports[0].kind === 'read' && reports[0].a === READS[0] + 8 && reports[0].v === 0xcbcbcbcb && reports[0].pc === LD, `a load from a read range reported: ${JSON.stringify(reports)}`);
  reports.length = 0; run(m, LD, READS[1]); run(m, LD, IN);
  ok(reports.length === 0, `loads outside the read ranges (its end, the image) not reported: ${JSON.stringify(reports)}`);
  const mis = (mm, pc, a0) => { const r = mm.getRegs(); r[9] = pc; r[4] = a0; mm.setRegs(r); mm.step(); return mm.getRegs()[14]; };
  reports.length = 0;
  const f1 = mis(m, LD, OUT + 2), f2 = mis(m, ST, OUT + 1);
  ok(reports.length === 2 && reports[0].kind === 'misaligned' && reports[0].w === 4 && reports[0].dir === 'r' && reports[0].a === OUT + 2 && reports[1].dir === 'w' && f1 === 3 && f2 === 3,
    `misaligned load and store reported and faulted 3: faults ${f1} ${f2} ${JSON.stringify(reports)}`);
  // the controls: no strict option; and setStrict(null) on a machine that had it
  m = fresh(null);
  run(m, ST, IN); run(m, LD, READS[0]);
  const f3 = mis(m, LD, OUT + 2);
  ok(reports.length === 0 && f3 === 3, `control: no strict option, nothing reported (the misaligned load still faults ${f3}): ${JSON.stringify(reports)}`);
  m = fresh(cfg());
  mem.setStrict(null);
  run(m, ST, IN); run(m, LD, READS[0]);
  ok(reports.length === 0, `control: setStrict(null), nothing reported: ${JSON.stringify(reports)}`);

  // the log, with ctx's pc set by hand (base B, a block of SIZE; a preload row's source at +0x8000..+0x9000 copied to
  // 0x61000000; a gap +0x20000..+0x30000 past section 1's end)
  const loads = { gaps: [{ lo: B + 0x20000, hi: B + 0x30000, n: 1, end: B + 0x20000, word: B + 0x100 }], unshown: [] };
  const r = strictRanges({ base: B, end: B + SIZE, preload: [[0x8000, 0x1000, 0x61000000]], loads });
  ok(r.stores.length === 1 && r.stores[0].lo === B && r.reads.length === 2 && r.reads[0].cls === 'init-read' && r.reads[1].cls === 'unloaded-read', `strictRanges: ${JSON.stringify(r)}`);
  const pc0 = mem.ctx.pc, ins0 = mem.ctx.insns, mdr0 = mem.ctx.mdr;
  let pc = 0;
  mem.ctx.pc = () => pc; mem.ctx.insns = () => 7; mem.ctx.mdr = () => 0x6000abcd;
  const code = (o) => 0x50000000 + o;
  try {
    const log = (allow, patchRanges = null, max) => {
      const l = new StrictLog({ model: 'T', allow: { T: allow }, ...(max ? { max } : {}) });
      l.arm({ rom, base: B, end: B + SIZE, preload: [[0x8000, 0x1000, 0x61000000]], loads, patchRanges });
      return l;
    };
    const L = log([]);
    pc = B + 0x100; L.report('store', B + 0x4000, 4, 'w', 1); L.report('store', B + 0x4004, 4, 'w', 2);
    pc = B + 0x104; L.report('store', (B + 0x20010 + 0x40000000) >>> 0, 1, 'w', 3);
    pc = B + 0x108; L.report('read', B + 0x8010, 4, 'r', 4);
    pc = B + 0x10c; L.report('read', B + 0x20020, 4, 'r', 5);
    pc = B + 0x110; L.report('misaligned', 0x6c000002, 4, 'r', 0);
    pc = B + 0x114; L.report('read', B + 0x9000, 4, 'r', 6);         // past the read ranges: not a site
    const d = L.doc(), by = Object.fromEntries(d.findings.map((s) => [s.disasm, s]));
    ok(d.findings.length === 5 && d.findings.every((s) => s.site === h8(B + Number(s.disasm) - code(0))), `five sites, each with its run-time site: ${JSON.stringify(d.findings)}`);
    ok(by[h8(code(0x100))]?.class === 'image-store' && by[h8(code(0x100))].n === 2 && by[h8(code(0x100))].addrs?.length === 2 && by[h8(code(0x100))].ret === '0x6000abcd' && by[h8(code(0x100))].insns === 7 && !by[h8(code(0x100))].where,
      `a site per pc, counted, in the code notation: ${JSON.stringify(by[h8(code(0x100))])}`);
    ok(by[h8(code(0x104))]?.class === 'image-store' && /in the gap past section 1's loaded end/.test(by[h8(code(0x104))].where), `a store in a gap (uncached view) named so: ${JSON.stringify(by[h8(code(0x104))])}`);
    ok(by[h8(code(0x108))]?.class === 'init-read' && by[h8(code(0x108))].where === 'copied to 0x61000010 at the boot', `init-read with its copy: ${JSON.stringify(by[h8(code(0x108))])}`);
    ok(by[h8(code(0x10c))]?.class === 'unloaded-read' && /past section 1's loaded end/.test(by[h8(code(0x10c))].where), `unloaded-read with its range: ${JSON.stringify(by[h8(code(0x10c))])}`);
    ok(by[h8(code(0x110))]?.class === 'misaligned', `misaligned: ${JSON.stringify(by[h8(code(0x110))])}`);
    const line = strictLine(d);
    ok(line.startsWith('strict: 5 new site(s): image-store at 0x50000100 to ') && line.includes('x2') && line.includes('init-read at 0x50000108 from'), `strictLine: ${line}`);
    // the allowlist: by pc, by address; its controls; patched bytes
    const E = { kind: 'image-store', at: [code(0x100), code(0x102)], why: 'test' }, A = { kind: 'image-store', addr: [B + 0x4000, B + 0x4008], why: 'test' };
    for (const [list, what] of [[[E], 'by pc'], [[A], 'by address']]) {
      const l = log(list);
      pc = B + 0x100; l.report('store', B + 0x4000, 4, 'w', 1); l.report('store', B + 0x4004, 4, 'w', 1);
      const x = l.doc();
      ok(x.findings.length === 0 && x.allowed.length === 1 && x.allowed[0].n === 2 && strictLine(x) === 'strict: no new site; 2 access(es) at stock sites allowed (src/fw/strict-allow.mjs)', `allowed ${what}: ${JSON.stringify(x)}`);
    }
    for (const [list, what] of [[[{ ...E, at: [code(0x102), code(0x104)] }], 'another pc'], [[{ ...E, kind: 'init-read' }], 'another kind'], [[{ ...A, addr: [B + 0x4004, B + 0x4008] }], 'an address range that misses']]) {
      const l = log(list);
      pc = B + 0x100; l.report('store', B + 0x4000, 4, 'w', 1);
      ok(l.doc().findings.length === 1, `control: an entry for ${what} does not allow the site: ${JSON.stringify(l.doc())}`);
    }
    const P = log([E], [[0x101, 1]]);
    pc = B + 0x100; P.report('store', B + 0x4000, 4, 'w', 1);           // the instruction at +0x100 (0xcb... with rom[0x100] = 0x60, 1 byte) misses +0x101
    pc = B + 0x101; P.report('store', B + 0x4000, 4, 'w', 1);
    const pd = P.doc();
    ok(pd.allowed[0]?.n === 1 && pd.findings.length === 1 && pd.findings[0].disasm === h8(code(0x101)) && pd.findings[0].patched === true, `a site on patched bytes reported despite an entry for it (${JSON.stringify(pd)})`);
    ok(allowed([E], 'image-store', code(0x100), B) === E && allowed([E], 'image-store', code(0x102), B) === null, 'allowed: the pc range is [lo, hi)');
    const C = log([], null, 2);
    for (let k = 0; k < 4; k++) { pc = B + 0x200 + k; C.report('store', B + 0x4000, 4, 'w', 0); }
    ok(C.doc().findings.length === 2 && C.doc().dropped === 2 && strictLine(C.doc()).endsWith('2 more site(s) not kept'), `the cap: ${JSON.stringify(C.doc())}`);
  } finally { mem.ctx.pc = pc0; mem.ctx.insns = ins0; mem.ctx.mdr = mdr0; }
  // strictOn
  ok(strictOn('on', {}) && !strictOn('off', { OM_STRICT: '1' }) && strictOn(undefined, { OM_STRICT: '1' }) && strictOn(undefined, { OM_STRICT: 'on' }) && !strictOn(undefined, {}) && !strictOn(undefined, { OM_STRICT: '0' }),
    'strictOn: the option wins, else OM_STRICT 1 / on');
  ok(throws(() => strictOn('yes', {}), /strict yes: on or off/), 'strictOn: an unknown value refused');
  // the allowlist's shape
  const KINDS = new Set(['misaligned', 'image-store', 'init-read', 'unloaded-read']);
  const shape = Object.entries(STRICT_ALLOW).flatMap(([model, list]) => list.filter((e) => !KINDS.has(e.kind) || (!e.at && !e.addr) || (e.at && !(e.at[0] < e.at[1])) || (e.addr && !(e.addr[0] < e.addr[1])) || !(e.why?.length > 8)).map((e) => `${model} ${JSON.stringify(e)}`));
  ok(shape.length === 0 && ['E143', 'E147', 'E142'].every((k) => STRICT_ALLOW[k]?.length), `the allowlist's entries: ${shape.join('; ')}`);
  return { checks, bad };
}

// bin/session.mjs in a child: the summary (the last stdout line) and stderr
function session(model, args, tokens) {
  const r = spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), '--model', model, ...args, ...tokens], { encoding: 'utf8', env: process.env, maxBuffer: 64 << 20 });
  let sum = null;
  try { sum = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* reported by the caller */ }
  return { rc: r.status, sum, err: r.stderr };
}

export async function strictSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODELS, romPath } = await import('../src/fw/models.mjs');
  // the stock sessions: no new site, some accesses allowed
  for (const model of ['E143', 'E147', 'E142']) {
    let allowedN = 0;
    STOCK_SESSIONS.forEach((script, i) => {
      const tokens = script.split(' ').filter((t) => !(NO_EVF.has(model) && t === 'eye'));
      const s = session(model, ['--strict', 'on'], tokens);
      const st = s.sum?.strict;
      allowedN += st?.allowed?.reduce((x, e) => x + e.n, 0) ?? 0;
      ok(s.rc === 0 && st && st.findings.length === 0, `${model} stock session ${i + 1} with --strict on: rc ${s.rc}, ${st ? `${st.findings.length} new site(s) ${JSON.stringify(st.findings.slice(0, 4))}` : 'no strict in the summary'} ${s.rc ? s.err.slice(-300) : ''}`);
    });
    ok(allowedN > 0, `${model}: the stock sessions' accesses at allowed sites: ${allowedN} (the allowlist keeps them quiet)`);
  }
  // a patch on E142: routines in section 1's 0xFF tail (0x602108ec..0x60211000, caduceus-ep7's section table; X here)
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-strict-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const block = (model) => new Uint8Array(fs.readFileSync(path.join(EMU, '..', romPath(MODELS[model]))));   // the stock main block (checks/lib/env.mjs ORIGINAL's)
    const patchOf = (model, file, routines) => {
      const main = block(model), base = MODELS[model].image_base;
      const list = routines.map(([at, bytes, label]) => {
        const old = main.subarray(at - base, at - base + bytes.length);
        if (!old.every((x) => x === 0xff)) throw new Error(`${model} ${h8(at)}: not 0xFF in the stock block`);
        return { block: 0, offset: at - base, old: Buffer.from(old).toString('base64'), new: Buffer.from(bytes).toString('base64'), label };
      });
      fs.writeFileSync(file, JSON.stringify(list));
    };
    const LD = (a) => [0xfc, 0xa4, ...le(a), 0xdf, 0x00, 0x00];           // mov (abs32),d0; ret
    const SB = (a) => [0xfc, 0x82, ...le(a), 0xdf, 0x00, 0x00];           // movbu d0,(abs32); ret
    const R = 0x60210900;
    const e142 = path.join(tmp, 'e142.json');
    patchOf('E142', e142, [[R, LD(0x6025aa98), 'init word'], [R + 0x10, LD(0x61fc27d8), 'live copy'], [R + 0x20, SB(0x605b7400), 'section 3'], [R + 0x30, SB(0x6203c8ba), 'bss'], [R + 0x40, LD(0x601e356e), 'misaligned']]);
    const calls = [0, 0x10, 0x20, 0x30, 0x40].map((o) => `call:${h8(R + o)}:frame=0/0`);
    const s = session('E142', ['--strict', 'on', '--patch', e142], ['wait:1000', ...calls]);
    const sites = s.sum?.strict?.findings ?? [];
    const at = (o) => sites.find((x) => x.site === h8(R + o));
    ok(at(0)?.class === 'init-read' && at(0).addr === '0x6025aa98' && at(0).where === 'copied to 0x61fc27d8 at the boot' && at(0).patched === true, `E142 issue #48's read of the init word: ${JSON.stringify(at(0))}`);
    ok(at(0x20)?.class === 'image-store' && at(0x20).addr === '0x605b7400' && at(0x20).size === 1, `E142 a byte store into section 3's range: ${JSON.stringify(at(0x20))}`);
    ok(at(0x40)?.class === 'misaligned' && at(0x40).addr === '0x601e356e' && s.sum?.failed?.step === 6 && /fault 3/.test(s.sum.failed.message), `E142 a misaligned word load, reported and faulted: ${JSON.stringify(at(0x40))} ${JSON.stringify(s.sum?.failed)}`);
    ok(!at(0x10) && !at(0x30) && sites.length === 3, `E142 controls: the live copy's read and a .bss store report nothing (${sites.length} sites: ${sites.map((x) => x.site).join(' ')})`);
    ok(/strict: 3 new site\(s\): init-read at 0x501f08e0 \(patched bytes\)/.test(s.err), `E142 the stderr line: ${s.err.split('\n').find((l) => l.includes('strict:') && l.includes('site')) ?? s.err.slice(-300)}`);
    // E143: section 6's 0xFF tail (emu/test/test_sections.mjs SIX), a load past its loaded end 0x60f29000
    const e143 = path.join(tmp, 'e143.json'), T = 0x60f28f00;
    patchOf('E143', e143, [[T, LD(0x60f29100), 'gap'], [T + 0x10, LD(0x60f28f80), 'loaded']]);
    const g = session('E143', ['--strict', 'on', '--patch', e143], ['wait:500', `call:${h8(T)}:frame=0/0`, `call:${h8(T + 0x10)}:frame=0/0`]);
    const gs = g.sum?.strict?.findings ?? [];
    ok(g.rc === 0 && gs.length === 1 && gs[0].class === 'unloaded-read' && gs[0].site === h8(T) && /past section 6's loaded end 0x60f29000/.test(gs[0].where),
      `E143 a load past section 6's loaded end (unloaded-read), and its control inside reporting nothing: rc ${g.rc} ${JSON.stringify(gs)} ${g.rc ? g.err.slice(-300) : ''}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await strictUnits();
  console.log(`strict mode units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let fail = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await strictSession();
    console.log(`strict mode sessions: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
