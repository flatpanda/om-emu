// The boot's section loader and what it leaves behind (src/fw/facts.mjs sectionLoader, headCopies; src/fw/sections.mjs
// bootLoads; src/machine.mjs's unloaded option; src/lab/menu.mjs S-SECLOADED; S-STALERAM, --loaded):
//   sectionsUnits    (firmware-free) on a synthetic block with E143's forms (a reset head with three copies, one end
//                    word it stores and never loads, load_section, its end switch with three cases, the table): the
//                    rule's fact, none without a loader and two refused, a case of another form refused; the head's
//                    copies (add, sub a0 and imm16 lengths), an unknown length and a copy not in place refused; the
//                    reader's sections, head copies and gaps (a head copy splits a gap, the stored end closes one up
//                    to it), a raised end word read from the image in use (its gap gone, and with 0x1000 more a gap
//                    still), an end past the image, a changed count, a moved head copy and a row not in place
//                    refused; the machine with the gaps: the fill in both DRAM views, the flash view as it is, an
//                    instruction in a gap refused by the step and by the decode (UnloadedCode, the message's words),
//                    one ending in a gap refused, one outside run; and the control: no unloaded option, the gap's
//                    bytes run; loadedRanges' modes (off, auto without a patch, a mode it does not know)
//   sectionsSession  (E143's block; E147's in a child with OM_EMU_MODEL) the stock block's gaps hold only 0xFF and
//                    the reader's ranges as read; bin/debug.mjs with a patch the test writes: a call from section 6's
//                    tail to a routine past its end stops in loaded mode (the default with --patch) with the gap,
//                    the end and the end word named, exit 1; the controls: the same with --loaded off runs (d0 the
//                    routine's), with the end word raised runs (and the gap's rest reads 0xA5), the routine in the
//                    loaded tail runs; on E143 also S-SECLOADED in a nav session: the copied mask 0x3ff, and 0 with the
//                    stand-in left out (lab.no_secloaded)
//   node emu/test/test_sections.mjs [--session]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sectionLoader, headCopies, SECTIONS_E143 } from '../src/fw/facts.mjs';
import { bootLoads, gapAt, gapMessage, POISON } from '../src/fw/sections.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const le = (v) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24 & 0xff];
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A synthetic main block with E143's forms at made-up places (base: E143's run-time base, so the lab's IMAGE_BASE)
export const BASE = 0x60021020, SIZE = 0x40000;
const COPY = 0x300, LOAD = 0x400, SWITCH = 0x480, CASES = 0x4c0, JT = 0x520, TABLE = 0x600, MASK = 0xA3000010;
const W1 = 0x62960798, W2 = 0x6296079c, W3 = 0x629607a0;   // the head's end words: two loaded, one not
const SECS = [[0x10000, 0x14000], [0x20000, 0x22000], [0x30000, 0x38000]];     // [start, end) offsets
const HEAD = [[0x0fe0, 0x8000], [0x16000, 0x1000], [0x3a000, 0x1000]];         // [offset, length]
const CLOSED = 0x1c000;                                                          // W3's end: a range ends there
export function synthBlock() {
  const b = new Uint8Array(SIZE).fill(0xff);
  let p = 0;
  const put = (...x) => { b.set(x.flat(), p); p += x.flat().length; };
  p = 0x82; put(0xfc, 0xdc, le(BASE + 0xa5), 0xf0, 0xf4);                       // the reset jump (imageBase)
  p = 0xa5;
  const rt = (o) => BASE + o, unc = (o) => (BASE + o + 0x40000000) >>> 0, fl = (o) => 0x50000020 + o;
  put(0xfc, 0xcc, le(rt(HEAD[0][0] + HEAD[0][1])), 0xfc, 0x81, le(W1));        // mov END1,d0; mov d0,(W1)
  put(0xfc, 0xcc, le(unc(HEAD[1][0] + HEAD[1][1])), 0xfc, 0x81, le(W2));       // (the uncached view, for sub a0)
  put(0xfc, 0xcc, le(rt(CLOSED)), 0xfc, 0x81, le(W3));                          // stored, never loaded
  const call = (to) => { const at = p; put(0xcd, (to - at) & 0xff, (to - at) >> 8 & 0xff, 0x00, 0x00); return at; };
  const sites = [];
  put(0xfc, 0xa4, le(W1), 0xfc, 0xdc, le(unc(HEAD[0][0])), 0xfc, 0xdd, le(fl(HEAD[0][0])), 0xfc, 0xc0, le(-rt(HEAD[0][0]) >>> 0), 0xfc, 0xcd, le(0x10200));
  sites.push(call(COPY));
  put(0xfc, 0xa4, le(W2), 0xfc, 0xdc, le(unc(HEAD[1][0])), 0xfc, 0xdd, le(fl(HEAD[1][0])), 0xf1, 0x10, 0xfc, 0xcd, le(0x10200));
  sites.push(call(COPY));
  put(0xfc, 0xdc, le(unc(HEAD[2][0])), 0xfc, 0xdd, le(fl(HEAD[2][0])), 0x2c, HEAD[2][1] & 0xff, HEAD[2][1] >> 8, 0xfc, 0xcd, le(0x10200));
  sites.push(call(COPY));
  put(0xdf, 0x00, 0x00);                                                          // ret
  p = COPY; put(0xdf, 0x00, 0x00);
  p = LOAD; put(0xf1, 0xe3, 0x8f, 0xff, 0xe3); call(SWITCH); put(0x82, 0x8c, 0x14, 0xf9, 0x14, 0x0c, 0xf1, 0xe2, 0xfc, 0xd2, le(rt(TABLE)));
  put(0x72, 0xcb, 0xcb, 0x17, 0x80, 0x01, 0xf2, 0x9c, 0xfc, 0xa5, le(MASK), 0xf2, 0x14, 0xfc, 0x81, le(MASK), 0xdf, 0xf0, 0x14);
  p = SWITCH; put(0x04, 0xa0, 0x01, 0xc0, 0x20, 0xa0, SECS.length, 0xc1, 0x1c, 0x28, 0xff, 0x54, 0xfc, 0xdc, le(rt(JT)), 0xf3, 0x80, 0xf0, 0xf4);
  // the cases in another order than the sections', as the builds' are
  const order = [2, 0, 1];
  order.forEach((n, k) => { p = CASES + 8 * k; put(0xfc, 0xcc, le(rt(SECS[n][1])), 0xca, 0x00); p = JT + 4 * n; put(le(rt(CASES + 8 * k))); });
  SECS.forEach(([s], n) => { p = TABLE + 12 * n; put(le(rt(s)), le(fl(s)), le(0)); });
  const ends = SECS.map((_, n) => rt(CASES + 8 * order.indexOf(n) + 2));
  return { b, sites: sites.map((o) => 0x50000000 + o), ends };
}

export function sectionsUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { b, sites, ends } = synthBlock();
  const f = sectionLoader(b);
  const want = { loader: 0x50000000 + LOAD, switch: 0x50000000 + SWITCH, table: BASE + TABLE, copied: MASK, ends, head: sites };
  ok(same(f, want), `sectionLoader: ${JSON.stringify(f)}, want ${JSON.stringify(want)}`);
  // none without a loader; two refused; a case of another form refused
  const none = b.slice(); none.fill(0xff, LOAD, LOAD + 0x80);
  ok(sectionLoader(none) === null, 'sectionLoader: a block without load_section reads none');
  const two = b.slice(); two.copyWithin(0x800, LOAD, LOAD + 0x80);
  ok(throws(() => sectionLoader(two), /2 section loads/), 'sectionLoader: two loaders refused');
  const badCase = b.slice(); badCase[CASES + 8 + 1] = 0xcd;
  ok(throws(() => sectionLoader(badCase), /case \d at .* is not 'mov imm32,d0'/), "sectionLoader: a case that is not 'mov imm32,d0' refused");
  // the head's copies: the three length forms, the end stored and not loaded
  const hc = headCopies(b);
  ok(same(hc.copies.map((c) => [c.dst - BASE, c.len]), HEAD) && same(hc.ends.map((e) => [e.word, e.end]), [[W3, BASE + CLOSED]]),
    `headCopies: ${JSON.stringify(hc)}`);
  const unknown = b.slice(); unknown.set(le(0x629607b0), sites[0] - 0x50000000 - 28);   // mov (W),d0 of a word never stored
  ok(throws(() => headCopies(unknown), /length unknown/), 'headCopies: a copy of unknown length refused');
  const moved = b.slice(); moved.set(le(BASE + HEAD[1][0] + 0x40000000 + 0x100), sites[1] - 0x50000000 - 18);   // its a0
  ok(throws(() => headCopies(moved), /not in place/), 'headCopies: a copy not in place refused');

  // the reader: sections, head copies, gaps
  const L = bootLoads(b, BASE, f);
  ok(L.count === 3 && L.copied === MASK && same(L.sections.map((s) => [s.n, s.start - BASE, s.end - BASE, s.word]), SECS.map(([s, e], i) => [i + 1, s, e, ends[i]])),
    `bootLoads' sections: ${JSON.stringify(L.sections)}`);
  const wantGaps = [[0x14000, 0x16000, 1], [CLOSED, 0x20000, 1], [0x22000, 0x30000, 2], [0x38000, 0x3a000, 3], [0x3b000, SIZE, 3]];
  ok(same(L.gaps.map((g) => [g.lo - BASE, g.hi - BASE, g.n]), wantGaps) && L.gaps.every((g) => g.end === BASE + SECS[g.n - 1][1] && g.word === ends[g.n - 1]),
    `bootLoads' gaps: ${JSON.stringify(L.gaps.map((g) => [h8(g.lo), h8(g.hi), g.n]))}`);
  ok(gapAt(L.gaps, BASE + 0x25000)?.n === 2 && gapAt(L.gaps, BASE + 0x25000 + 0x40000000)?.n === 2 && gapAt(L.gaps, BASE + 0x21fff) === null && gapAt(L.gaps, BASE + 0x16800) === null,
    'gapAt: a gap in both views, none in a section or a head copy');
  // a raised end word (as caduceus-om3 raises section 6's), read from the image in use
  const raised = b.slice(); raised.set(le(BASE + 0x30000), ends[1] - BASE);
  const R = bootLoads(raised, BASE, f);
  ok(R.sections[1].end === BASE + 0x30000 && !R.gaps.some((g) => g.n === 2), `a raised end word: section 2 ends ${h8(R.sections[1].end)}, gaps ${JSON.stringify(R.gaps.map((g) => g.n))}`);
  const part = b.slice(); part.set(le(BASE + 0x23000), ends[1] - BASE);
  ok(bootLoads(part, BASE, f).gaps.find((g) => g.n === 2)?.lo === BASE + 0x23000, 'an end raised by 0x1000: the gap starts there');
  const past = b.slice(); past.set(le(BASE + SIZE + 4), ends[2] - BASE);
  ok(throws(() => bootLoads(past, BASE, f), /section 3's end word .* outside/), 'an end past the image refused');
  const count = b.slice(); count[SWITCH + 6] = 2;
  ok(throws(() => bootLoads(count, BASE, f), /gives the end words .*, the build's are/), "a changed count refused (the switch's end words against the fact's)");
  ok(throws(() => bootLoads(b, BASE, { ...f, head: sites.slice(1) }), /the reset head copies at/), "head copies at other sites than the fact's refused");
  const row = b.slice(); row.set(le(0x50000020 + 0x20100), TABLE + 12 + 4);
  ok(throws(() => bootLoads(row, BASE, f), /section 2 .* not in place/), 'a table row not in place refused');
  const msg = gapMessage(L.gaps[2], BASE + 0x25000, BASE, f);
  ok(msg.includes(`section 2's loaded end ${h8(BASE + 0x22000)}`) && msg.includes(`end word at ${h8(ends[1])}`) && msg.includes(`end switch ${h8(0x50000000 + SWITCH)}`) &&
    msg.includes(`load_section ${h8(0x50000000 + LOAD)}`), `gapMessage: ${msg}`);
  return machineUnits(b, L, f, { checks, bad, ok });
}

// The machine with the gaps (createMachine's unloaded option) and its control, on the synthetic block; loadedRanges
async function machineUnits(b, L, f, r) {
  const { createMachine, UnloadedCode } = await import('../src/machine.mjs');
  const { loadedRanges } = await import('../src/lab/sim.mjs');
  const { ok } = r;
  const rom = b.slice();
  const g2 = L.gaps.find((g) => g.n === 2), s1end = L.sections[0].end;
  rom.set([0xcb, 0xcb], g2.lo - BASE);                    // nops in the gap: the file's bytes, not the camera's
  rom.set([0xcb, 0xcb], s1end - BASE - 2);                 // nops up to section 1's end, then its gap's poison
  rom.set([0xfc, 0xcc, 0, 0, 0, 0], s1end - BASE - 0x10);  // an instruction ending at s1end - 0xa
  rom.set([0xfc, 0xcc, 0, 0, 0, 0], s1end - BASE - 3);     // one that runs into the gap (6 bytes from end - 3)
  const message = (g, pc) => gapMessage(g, pc, BASE, f);
  const run = (unloaded, pc, how) => {
    const m = createMachine({ rom, insnLimit: 0, unloaded });
    const regs = m.getRegs(); regs[9] = pc; m.setRegs(regs);
    try { if (how === 'step') m.step(); else { m.setBreakpoints([pc + 2]); m.cont({ budget: 4 }); } return { m, err: null, pc: m.getRegs()[9] >>> 0 }; } catch (e) { return { m, err: e }; }
  };
  const un = { gaps: L.gaps, fill: 0xA5, message };
  const a = run(un, g2.lo, 'step');
  ok(a.err instanceof UnloadedCode && a.err.pc === g2.lo && a.err.gap === g2 && /pc 0x[0-9a-f]+ runs code the boot does not load: .* past section 2's loaded end/.test(a.err.message),
    `a step in a gap: ${a.err?.name}: ${a.err?.message?.slice(0, 160)}`);
  const fill = a.m.dbgRead(g2.lo, 4), unc = a.m.dbgRead((g2.lo + 0x40000000) >>> 0, 4), flash = a.m.dbgRead(0x50000000 + (g2.lo - BASE), 4);
  ok(fill.every((x) => x === POISON) && unc.every((x) => x === POISON) && flash[0] === 0xcb, `the gap's DRAM ${[...fill]} (uncached ${[...unc]}), the flash view ${[...flash]}`);
  const kept = a.m.dbgRead(L.sections[1].start, 4);
  ok(same([...kept], [...rom.subarray(L.sections[1].start - BASE, L.sections[1].start - BASE + 4)]), 'a section\'s DRAM holds the image\'s bytes');
  const d = run(un, (g2.lo + 0x40000000) >>> 0, 'cont');
  ok(d.err instanceof UnloadedCode, `a continue into a gap through the uncached view (the decode): ${d.err?.name ?? 'ran'}`);
  const cross = run(un, s1end - 3, 'step');
  ok(cross.err instanceof UnloadedCode && cross.err.gap.n === 1, `an instruction that runs into a gap: ${cross.err?.name ?? 'ran'}`);
  const fine = run(un, s1end - 0x10, 'step');
  ok(fine.err === null && fine.pc === s1end - 0x10 + 6, `an instruction in a section runs: ${fine.err?.message ?? h8(fine.pc)}`);
  // the control: without the option the gap's bytes are the file's and run
  const c = run(null, g2.lo, 'step');
  ok(c.err === null && c.pc === g2.lo + 1 && c.m.dbgRead(g2.lo, 1)[0] === 0xcb, `no unloaded option: the gap's nop runs (${c.err?.message ?? h8(c.pc)})`);
  const c2 = run(null, (g2.lo + 0x40000000) >>> 0, 'cont');
  ok(c2.err === null, `no unloaded option: a continue there runs (${c2.err?.message ?? 'ok'})`);
  // loadedRanges' modes (the lab's E143 fact is not this block's: modes that read nothing only)
  ok(loadedRanges({ rom, loaded: 'off', patch: {} }) === null && loadedRanges({ rom }) === null && loadedRanges({ rom, loaded: 'auto' }) === null,
    'loadedRanges: off, and auto without a patch, read nothing');
  ok(throws(() => loadedRanges({ rom, loaded: 'yes' }), /loaded yes: on, off or auto/), 'loadedRanges: an unknown mode refused');
  return { checks: r.checks, bad: r.bad };
}

// bin/debug.mjs with a patch the test writes, on the model the process runs (OM_EMU_MODEL): a call at SITE (section 6's
// tail, 0xFF in the stock block) to a routine `mov 0x12345678,d0; ret` at ROUTINE
const SIX = { E143: { site: 0x60F28F00, tail: 0x60F28F40 }, E147: { site: 0x60F49700, tail: 0x60F49740 } };
function patchFile(main, base, file, site, routine, endWord = null, newEnd = 0) {
  const p = (at, bytes, label) => ({ block: 0, offset: at - base, old: Buffer.from(main.subarray(at - base, at - base + bytes.length)).toString('base64'), new: Buffer.from(bytes).toString('base64'), label });
  const list = [p(site, [0xdd, ...le((routine - site) >>> 0), 0x00, 0x00], 'call'), p(routine, [0xfc, 0xcc, ...le(0x12345678), 0xdf, 0x00, 0x00], 'routine')];
  if (endWord !== null) list.push(p(endWord, le(newEnd), 'end word'));
  fs.writeFileSync(file, JSON.stringify(list));
}

export async function sectionsSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { sectionsFact } = await import('../src/lab/sim.mjs');
  const { loadImage, loadBlock } = await import('../checks/lib/env.mjs');
  const main = loadImage(), base = MODEL_INFO.image_base, f = sectionsFact();
  // the stock block: its gaps hold only the file's 0xFF padding (what the loaders leave out is padding)
  const L = bootLoads(main, base, f);
  const nonFF = L.gaps.reduce((n, g) => n + main.subarray(g.lo - base, g.hi - base).reduce((k, x) => k + (x !== 0xff), 0), 0);
  ok(L.count === 10 && L.gaps.length && nonFF === 0, `${MODEL}: ${L.count} sections, ${L.gaps.length} gaps, ${nonFF} bytes in them not 0xFF`);
  if (MODEL === 'E143') ok(same(f, SECTIONS_E143), 'E143: the fact is SECTIONS_E143');
  const six = L.sections[5], gap6 = L.gaps.find((g) => g.n === 6), at = SIX[MODEL];
  ok(gap6 && gap6.lo === six.end && at && main.subarray(at.site - base, six.end - base).every((x) => x === 0xff), `${MODEL}: section 6 ends ${h8(six.end)}, its tail from ${h8(at?.site)} 0xFF`);
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-sections-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const routine = six.end + 0x10, stop = at.site + 7;
    const gapFile = path.join(tmp, 'gap.json'), raisedFile = path.join(tmp, 'raised.json'), tailFile = path.join(tmp, 'tail.json');
    patchFile(main, base, gapFile, at.site, routine);
    patchFile(main, base, raisedFile, at.site, routine, six.word, six.end + 0x1000);
    patchFile(main, base, tailFile, at.site, at.tail);
    const dbg = (file, ...extra) => spawnSync(process.execPath, [path.join(EMU, 'bin/debug.mjs'), '--entry', h8(at.site), '--stop', h8(stop), '--patch', file, ...extra], { encoding: 'utf8', env: process.env });
    const d0 = (r) => { try { return JSON.parse(r.stdout).registers.d0; } catch { return null; } };
    const g = dbg(gapFile);
    ok(g.status === 1 && g.stderr.includes(`FirmwareError: pc ${h8(routine)} runs code the boot does not load: ${h8(gap6.lo)}..${h8(gap6.hi)} lies past section 6's loaded end ${h8(six.end)}, which the end word at ${h8(six.word)} holds`),
      `${MODEL}: a routine past section 6's end in loaded mode: rc ${g.status} ${g.stderr.split('\n').find((l) => /Error/.test(l))?.slice(0, 300)}`);
    const off = dbg(gapFile, '--loaded', 'off');
    ok(off.status === 0 && d0(off) === '0x12345678', `${MODEL}: --loaded off runs it: rc ${off.status} d0 ${d0(off)} ${off.stderr.slice(-200)}`);
    const raised = dbg(raisedFile, '--read', `${h8(six.end + 0x1000)}:4`);
    let mem = null;
    try { mem = JSON.parse(raised.stdout).memory; } catch { /* reported below */ }
    ok(raised.status === 0 && d0(raised) === '0x12345678' && mem?.[h8(six.end + 0x1000)] === 'a5a5a5a5', `${MODEL}: with the end word raised it runs, the gap's rest 0xA5: rc ${raised.status} d0 ${d0(raised)} ${JSON.stringify(mem)} ${raised.stderr.slice(-200)}`);
    const tail = dbg(tailFile, '--loaded', 'on');
    ok(tail.status === 0 && d0(tail) === '0x12345678', `${MODEL}: in section 6's loaded tail it runs: rc ${tail.status} d0 ${d0(tail)} ${tail.stderr.slice(-200)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // S-SECLOADED in a nav session on E143, and its negative control
  if (MODEL === 'E143') {
    const { labEnv } = await import('../checks/lib/env.mjs');
    const { NavSession } = await import('../src/lab/nav.mjs');
    class Without extends NavSession { lab_created(lab) { lab.no_secloaded = true; } }
    for (const [Cls, want, what] of [[NavSession, 0x3ff, 'S-SECLOADED'], [Without, 0, 'without S-SECLOADED']]) {
      const s = new Cls(labEnv({ resBlock: loadBlock() }), { tag: 'sections', open_menu: false, png: 'none' }).enter();
      try {
        const v = s.lab.sim.u32(f.copied);
        ok(v === want && (s.lab.sections_copied ?? 0) === (want ? 10 : 0), `E143 ${what}: the copied mask ${h8(f.copied)} reads ${h8(v)}, want ${h8(want)}`);
      } finally { s.close(); }
    }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await sectionsUnits();
  console.log(`section loader units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let fail = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await sectionsSession();
    console.log(`section loader on ${(await import('../src/fw/model.mjs')).MODEL}: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
