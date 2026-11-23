// Staged section availability for patched code (--sec-ready, src/lab/secready.mjs; emu/FIDELITY-NOTES.md 7.18, 7.20):
//   secreadyUnits    (firmware-free) the static pass on a made-up image of ten 0x100-byte sections: a hook in section
//                    2 whose cave calls into section 7 is reported, with the hook, the branch and both sections; the
//                    same cave behind a read of the stage word, behind a call of the stage test, or behind a call of a
//                    patched gate routine is not (counted gated); a target in the hook's own tier (section 5) is no
//                    crossing; a cave no hook reaches is not followed; a hook that rewrote a stock call's displacement
//                    alone, and a `mov imm32,a0; calls (a0)`, are read. Control: the gated cave with the word it reads
//                    moved by 8 bytes is reported again. The run-time watch on a made-up memory: a patched instruction
//                    in section 8 with the word's bit 7 clear is recorded once per section and phase (before
//                    S-BOOTSTAGE, then 'never-readied' after staged()), either DRAM view, with its instruction count;
//                    control: the same pc with bit 7 set, and a pc off the patched bytes, record nothing
//   secreadyFirmware (the model's block: E143 here, E146 and E147 with OM_EMU_MODEL) the layout read from the image:
//                    the stage word, the copied mask and the stage test and wait (E143 0xa32df1f4, 0xa32df1f8,
//                    0x50024dcf, 0x50024de8; E146 0xa32df2cc, 0xa32df2d0, 0x50024e9a, 0x50024eb3; E147 0xa32de58c,
//                    0xa32de590, 0x50024e19, 0x50024e32); a call written over stock code in section 2 to section 6 is
//                    reported, to section 4 is not (control); a hook into a cave of section 2's 0xff fill that jumps to
//                    section 6 is reported, and not once the cave reads the stage word first (control). The watch in
//                    a lab (src/lab/hle.mjs) calling a patched `ret` in section 6: recorded with the caller (the
//                    harness's call), not with bit 5 of the stage word set (control); without the option the machine
//                    has no fetch guard and the Simulator no watch
//   secreadyCli      (E143, nav.mjs) --sec-ready without an overlay refused (rc 1); with a one-patch file (a call in
//                    section 2 to section 6) the start line and session.json's patch_audit.sec_ready report the
//                    crossing, and the closing 'sec-ready:' line is printed; control: the same run without
//                    --sec-ready has no sec_ready in its audit
//   node emu/test/test_secready.mjs [--cli]   (OM_EMU_MODEL=E146 or E147 for those bodies)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { secOrder, SecReadyAudit, secLayout, sectionOf, tier, secReadyLine, secReadyReport } from '../src/lab/secready.mjs';

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const rel32 = (from, to) => { const v = (to - from) | 0; return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; };
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

// ---- firmware-free --------------------------------------------------------------------------------------------
const BASE = 0x60000000, STAGE = 0xa0000f00, COPIED = 0xa0000f04;
const LAYOUT = { base: BASE, stage: STAGE, copied: COPIED, head: [], gates: { test: BASE + 0xf80, wait: BASE + 0xf99 },
  sections: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, start: BASE + 0x100 * i, end: BASE + 0x100 * (i + 1) })) };
// A stock image (code 0xcb at the hook sites, 0xff fill in the caves) and a patched copy built by writes
// [[offset, bytes]]; changed: the patched bytes' runs
function build(writes) {
  const stock = new Uint8Array(0x1000).fill(0xff);
  stock.fill(0xcb, 0x100, 0x180);                       // section 2's stock code
  stock.fill(0xcb, 0x000, 0x020);                       // section 1's
  stock.set([0xdd, ...rel32(0x130, 0x010), 0x00, 0x00], 0x130);     // a stock call in section 2 to section 1
  const img = stock.slice();
  for (const [o, b] of writes) img.set(b, o);
  const changed = [];
  for (let i = 0; i < img.length; i++) {
    if (img[i] === stock[i]) continue;
    const last = changed[changed.length - 1];
    if (last && last[0] + last[1] === i) last[1]++; else changed.push([i, 1]);
  }
  return { img, stock, changed };
}
const HOOK = [0x110, [0xdc, ...rel32(0x110, 0x1c0)]];             // section 2: jmp CAVE (0x1c0, section 2's fill)
const callTo = (at, to) => [0xdd, ...rel32(at, to), 0x00, 0x00];
export function secreadyUnits() {
  const T = tester(), { ok, bad } = T;
  const run = (writes) => { const b = build(writes); return secOrder(b.img, b.stock, LAYOUT, b.changed); };
  const show = (r) => JSON.stringify(r);
  // the ungated cave: call into section 7 (0x620)
  const plain = run([HOOK, [0x1c0, callTo(0x1c0, 0x620)]]);
  ok(plain.hooks === 1 && plain.crossings === 1 && plain.gated === 0 && plain.ungated.length === 1 &&
    show(plain.ungated[0]) === show({ at: h8(BASE + 0x1c0), disasm: h8(0x500001c0), from: 2, kind: 'call', target: h8(BASE + 0x620), to: 7, hook: h8(BASE + 0x110) }),
  `the ungated call from a section-2 hook's cave into section 7: ${show(plain)}`);
  // gated: the stage word read first (mov (STAGE),d1, fc a5), the stage test called, a patched gate routine called
  const read = (w) => [0xfc, 0xa5, ...le32(w)];
  const g1 = run([HOOK, [0x1c0, [...read(STAGE), ...callTo(0x1c6, 0x620)]]]);
  const g2 = run([HOOK, [0x1c0, [...callTo(0x1c0, 0xf80), ...callTo(0x1c7, 0x620)]]]);
  const g3 = run([HOOK, [0x1c0, [...callTo(0x1c0, 0x040), ...callTo(0x1c7, 0x620)]], [0x040, [...read(COPIED - 0x40000000), 0xdf, 0x00, 0x00]]]);
  for (const [r, what] of [[g1, 'the stage word read first'], [g2, 'the stage test called first'], [g3, 'a patched gate routine (the copied mask, cached view) called first']]) {
    ok(r.crossings === 1 && r.gated === 1 && r.ungated.length === 0, `${what}: gated, ${show(r)}`);
  }
  // control: the word moved by 8 bytes, no gate
  const broken = run([HOOK, [0x1c0, [...read(STAGE + 8), ...callTo(0x1c6, 0x620)]]]);
  ok(broken.ungated.length === 1 && broken.ungated[0].target === h8(BASE + 0x620), `control: the cave reading another word is ungated: ${show(broken)}`);
  // the same tier (section 5), a cave no hook reaches
  const same = run([HOOK, [0x1c0, callTo(0x1c0, 0x420)]]);
  ok(same.crossings === 0 && same.ungated.length === 0, `a call into section 5 from a section-2 hook: no crossing (tier ${tier(2)} = ${tier(5)}): ${show(same)}`);
  const lone = run([[0x1c0, callTo(0x1c0, 0x620)]]);
  ok(lone.hooks === 0 && lone.crossings === 0, `a cave no hook reaches is not followed: ${show(lone)}`);
  // a stock call's displacement rewritten alone (to section 8), and mov imm32,a0; calls (a0) (to section 9)
  const disp = run([[0x131, rel32(0x130, 0x720)]]);
  ok(disp.ungated.length === 1 && disp.ungated[0].at === h8(BASE + 0x130) && disp.ungated[0].to === 8 && disp.ungated[0].kind === 'call',
    `a hook that rewrote a stock call's displacement: ${show(disp)}`);
  const ind = run([HOOK, [0x1c0, [0xfc, 0xdc, ...le32(BASE + 0x820), 0xf0, 0xf0]]]);
  ok(ind.ungated.length === 1 && ind.ungated[0].kind === 'icall' && ind.ungated[0].to === 9, `mov imm32,a0; calls (a0) into section 9: ${show(ind)}`);
  ok(sectionOf(LAYOUT, 0xa0000150) === 2 && sectionOf(LAYOUT, BASE + 0x1000) === null, 'sectionOf: either DRAM view, outside null');
  ok(/^sec-ready: 1 ungated branch\(es\) of patched code into a later section \(of 1 crossing\(s\), 0 gated\): 0x600001c0 call -> 0x60000620 \(section 2 -> 7\)$/.test(secReadyLine(secReadyReport(plain, null))),
    `secReadyLine: ${secReadyLine(secReadyReport(plain, null))}`);
  // the run-time watch on a made-up memory: the changed bytes at 0x700 (section 8)
  const mem = { [STAGE]: 0x7f, [COPIED]: 0x3ff };
  const read32 = (a) => new Uint8Array(le32(mem[a] ?? 0));
  const w = new SecReadyAudit(LAYOUT, [[0x700, 6]], { read: read32 });
  w.guard(BASE + 0x700, 2); w.guard(BASE + 0x702, 1); w.guard(BASE + 0x702, 1);
  w.guard(BASE + 0x800, 1);                                       // off the patched bytes
  w.staged(0x7f);
  w.guard(0xa0000703, 1);                                         // the uncached view, after S-BOOTSTAGE
  w.guard(BASE + 0x704, 2);
  const f = w.findings;
  ok(f.length === 2 && f[0].kind === 'before-bootstage' && f[0].pc === h8(BASE + 0x700) && f[0].section === 8 && f[0].insns === 2 && f[0].staged === null && f[0].word === '0x0000007f' && f[0].copied === '0x000003ff' &&
    f[1].kind === 'never-readied' && f[1].pc === h8(BASE + 0x703) && f[1].insns === 2 && f[1].staged === '0x0000007f' && f[1].pieces === 1,
  `the watch: one record per section and phase: ${show(f)}`);
  mem[STAGE] = 0xff;
  const w2 = new SecReadyAudit(LAYOUT, [[0x700, 6]], { read: read32 });
  w2.guard(BASE + 0x700, 2);
  ok(w2.findings.length === 0, `control: bit 7 set, nothing recorded: ${show(w2.findings)}`);
  const rp = secReadyReport(plain, f);
  ok(rp.watched && rp.static.crossings === 1 && rp.findings.map((x) => `${x.class} ${x.site}`).join() === `ungated-branch ${h8(BASE + 0x1c0)},unready-run ${h8(BASE + 0x700)},unready-run ${h8(BASE + 0x703)}` &&
    rp.findings[0].addr === h8(BASE + 0x620) && rp.findings[0].branch === 'call' && rp.findings[1].phase === 'before-bootstage' && rp.findings[1].section === 8 && !secReadyReport(null, null).watched,
  `secReadyReport: one findings list by class, site and address: ${show(rp)}`);
  ok(secReadyLine(secReadyReport(plain, f)).includes('; patched code ran in 2 section(s) and phase(s) whose stage bit was clear: 0x60000700 (section 8, 2 instruction(s) in 1 piece(s), word 0x0000007f, caller'), `secReadyLine with runs: ${secReadyLine(secReadyReport(plain, f))}`);
  return { checks: T.checks, bad };
}

// ---- the model's block -----------------------------------------------------------------------------------------
const WANT = {
  E143: { stage: 0xa32df1f4, copied: 0xa32df1f8, test: 0x50024dcf, wait: 0x50024de8 },
  E146: { stage: 0xa32df2cc, copied: 0xa32df2d0, test: 0x50024e9a, wait: 0x50024eb3 },
  E147: { stage: 0xa32de58c, copied: 0xa32de590, test: 0x50024e19, wait: 0x50024e32 },
};
export async function secreadyFirmware() {
  const T = tester(), { ok, bad } = T;
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const want = WANT[MODEL];
  if (!want) return { checks: 0, bad: [], skipped: `${MODEL}: no section loader read` };
  const { loadImage, createHash } = await import('../checks/lib/env.mjs');
  const { sectionLoader, bootState } = await import('../src/fw/facts.mjs');
  const { HLE, CALLER } = await import('../src/lab/hle.mjs');
  const cpu = await import('../src/core/cpu.mjs');
  const stock = loadImage(), base = MODEL_INFO.image_base, DIS = 0x50000000;
  const L = secLayout(stock, base, sectionLoader(stock), bootState(stock).stage);
  const got = { stage: L.stage, copied: L.copied, test: L.gates.test - base + DIS, wait: L.gates.wait - base + DIS };
  ok(JSON.stringify(got) === JSON.stringify(want), `${MODEL}: the layout's words and gates ${JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, h8(v)])))}`);
  const sec = (n) => L.sections.find((s) => s.n === n);
  const hookAt = sec(2).start - base + 0x1000;
  ok(!stock.subarray(hookAt, hookAt + 7).every((v) => v === 0xff || v === 0), `${MODEL}: stock code at the hook site ${h8(base + hookAt)}`);
  const pass = (writes) => {
    const img = stock.slice();
    for (const [o, b] of writes) img.set(b, o);
    const changed = [];
    for (const [o, b] of writes) changed.push([o, b.length]);
    changed.sort((a, b) => a[0] - b[0]);
    return secOrder(img, stock, secLayout(img, base, sectionLoader(img), bootState(img).stage), changed);
  };
  const to6 = sec(6).start - base + 0x100, to4 = sec(4).start - base + 0x100;
  const r6 = pass([[hookAt, callTo(hookAt, to6)]]), r4 = pass([[hookAt, callTo(hookAt, to4)]]);
  ok(r6.ungated.length === 1 && r6.ungated[0].from === 2 && r6.ungated[0].to === 6 && r6.ungated[0].at === h8(base + hookAt), `${MODEL}: a call over stock code in section 2 to section 6: ${JSON.stringify(r6)}`);
  ok(r4.crossings === 0, `${MODEL}: control, the same call to section 4: ${JSON.stringify(r4)}`);
  // a cave in section 2's fill
  let cave = null;
  for (let o = sec(2).start - base; o < sec(2).end - base - 32 && cave === null; o++) if (stock.subarray(o, o + 32).every((v) => v === 0xff)) cave = o;
  ok(cave !== null, `${MODEL}: 32 bytes of 0xff fill in section 2`);
  if (cave !== null) {
    const hook = [hookAt, [0xdc, ...rel32(hookAt, cave)]];
    const open = pass([hook, [cave, [0xdc, ...rel32(cave, to6)]]]);
    const gated = pass([hook, [cave, [0xfc, 0xa5, ...le32(L.stage), 0xdc, ...rel32(cave + 6, to6)]]]);
    ok(open.ungated.length === 1 && open.ungated[0].at === h8(base + cave) && open.ungated[0].hook === h8(base + hookAt), `${MODEL}: a hook's cave jumping to section 6: ${JSON.stringify(open)}`);
    ok(gated.ungated.length === 0 && gated.gated === 1, `${MODEL}: control, the cave reading the stage word ${h8(L.stage)} first: ${JSON.stringify(gated)}`);
  }
  // the watch in a lab: a patched ret in section 6, called by the harness
  const off = sec(6).start - base + 0x1000, img = stock.slice();
  img.set([0xdf, 0x00, 0x00], off);
  const watch = (bits) => {
    const hle = new HLE({ rom: img, createHash, patchRanges: [[off, 3]], secReady: { static: null } });
    try {
      if (bits) hle.sim.write(L.stage, new Uint8Array(le32(bits)));
      hle.call(DIS + off, null, null, [0, 0]);
      return { findings: hle.sim.secReady.findings, guard: cpu.FG !== null };
    } finally { hle.close(); }
  };
  const w0 = watch(0), w5 = watch(1 << 5);
  ok(w0.guard && w0.findings.length === 1 && w0.findings[0].section === 6 && w0.findings[0].pc === h8(base + off) && w0.findings[0].caller === h8(CALLER + 7) && w0.findings[0].kind === 'before-bootstage',
    `${MODEL}: the watch records the patched ret in section 6: ${JSON.stringify(w0)}`);
  ok(w5.findings.length === 0, `${MODEL}: control, bit 5 set: ${JSON.stringify(w5)}`);
  const plain = new HLE({ rom: img, createHash, patchRanges: [[off, 3]] });
  try { ok(plain.sim.secReady === null && cpu.FG === null, `${MODEL}: without --sec-ready no watch and no fetch guard`); } finally { plain.close(); }
  return { checks: T.checks, bad };
}

// ---- nav.mjs on E143 -------------------------------------------------------------------------------------------
export async function secreadyCli() {
  const T = tester(), { ok, bad } = T;
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks: 0, bad: [], skipped: 'the CLI check runs on E143' };
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { sectionLoader, bootState } = await import('../src/fw/facts.mjs');
  const stock = loadImage(), base = MODEL_INFO.image_base;
  const L = secLayout(stock, base, sectionLoader(stock), bootState(stock).stage);
  const at = L.sections.find((s) => s.n === 2).start - base + 0x1000, to = L.sections.find((s) => s.n === 6).start - base + 0x100;
  const nb = new Uint8Array(callTo(at, to)), ob = stock.slice(at, at + nb.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-secready-'));
  const file = path.join(dir, 'hook.json');
  fs.writeFileSync(file, JSON.stringify([{ block: 'main', offset: at, old: Buffer.from(ob).toString('base64'), new: Buffer.from(nb).toString('base64'), label: 'section 2 -> 6' }]));
  const nav = new URL('../bin/nav.mjs', import.meta.url).pathname;
  const runNav = (args, out) => spawnSync(process.execPath, [nav, ...args, '--png', 'none', '--no-open', '--out', out, ''], { encoding: 'utf8', env: { ...process.env, OM_EMU_MODEL: 'E143' } });
  try {
    const none = runNav(['--sec-ready'], path.join(dir, 'none'));
    ok(none.status === 1 && /--sec-ready: no patch overlay/.test(none.stderr), `--sec-ready without an overlay: rc ${none.status} ${none.stderr.slice(-200)}`);
    const r = runNav(['--patch', file, '--sec-ready'], path.join(dir, 'on'));
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'on', 'session.json'), 'utf8'));
    const sr = doc.patch_audit?.sec_ready, fd = sr?.findings ?? [];
    ok(r.status === 0 && r.stdout.includes(`patch audit: sec-ready: 1 ungated branch(es) of patched code into a later section (of 1 crossing(s), 0 gated): ${h8(base + at)} call -> ${h8(base + to)} (section 2 -> 6)`) &&
      /\nsec-ready: 1 ungated branch/.test(r.stdout) && sr?.static?.crossings === 1 && sr.watched === true &&
      fd.filter((x) => x.class === 'ungated-branch').length === 1 && fd[0].site === h8(base + at) && fd[0].addr === h8(base + to) && fd.every((x) => x.class === 'ungated-branch' || x.class === 'unready-run'),
    `nav.mjs --patch --sec-ready: rc ${r.status} ${r.stdout.slice(0, 600)} ${r.stderr.slice(-300)}`);
    const off = runNav(['--patch', file], path.join(dir, 'off'));
    const docOff = JSON.parse(fs.readFileSync(path.join(dir, 'off', 'session.json'), 'utf8'));
    ok(off.status === 0 && docOff.patch_audit && !('sec_ready' in docOff.patch_audit) && !off.stdout.includes('sec-ready'), `control: without --sec-ready no sec_ready: rc ${off.status} ${JSON.stringify(docOff.patch_audit)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { checks: T.checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const parts = [['the units', secreadyUnits()], [`${MODEL}'s block`, await secreadyFirmware()]];
  if (process.argv.includes('--cli')) parts.push(['nav.mjs', await secreadyCli()]);
  let fail = 0;
  for (const [what, r] of parts) {
    console.log(`sec-ready: ${what}: ${r.skipped ?? `${r.checks - r.bad.length}/${r.checks}`}`);
    r.bad.forEach((x) => console.log('  ', x));
    fail += r.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
