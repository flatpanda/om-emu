// The boot's stage bits (src/lab/menu.mjs S-BOOTSTAGE, stage_bits; docs/hle-gaps.md 4.6.4), on the bodies whose section
// loader src/fw/facts.mjs sectionLoader reads (E143, E146, E147):
//   bootstageImage   (the model's block, no lab) the boot job the bits follow, read from the image: CPU 2's USTART_L2
//                    copies section n (load_section, the fact's loader) and posts the per-section step for it, in
//                    order 1..10, each post to CPU 0 but section 8's, to CPU 1, with the stage wait for 7 before
//                    section 8's post and for 8 before section 9's, and no other wait; the step (the pointer it
//                    posts) ends in the stage word's `or`, and its switch calls a constructor block for sections 1, 2,
//                    4, 6, 7, 8 and 9: 1's the empty entry (its case's `cmp 1,d0` leaves Z set and the entry's `beq`
//                    returns), 4's and 9's with no constructors, 2's, 6's, 7's and 8's with the tables of the fact
//                    ctorTables in order; each of those lies in its section's loaded range (src/fw/sections.mjs
//                    bootLoads) and no table of the fact lies in another section's, the rule stage_bits reads.
//                    Controls on copies of the block: the wait before section 8's post made one for stage 6, and that
//                    post made one to CPU 0, each read as such
//   bootstageSession (a play session through host/session.mjs) after the open the stage word holds 0x7f, sections 1
//                    to 7, and S-BOOTSTAGE is in use; on E143 (audio auto) H-AUDSTART is in use and leaves the word
//                    as it is. The controls, stage_bits on the same lab: section 7's constructors reported failed
//                    0x3f, section 6's 0x1f, run_static_ctors not run 0x1f (the memory managers' table, section 2's,
//                    runs at every lab's start)
//   node emu/test/test_bootstage.mjs [--session]   (OM_EMU_MODEL=E146 or E147 for those bodies)
import { callAt, bootState, sectionLoader, ctorTables } from '../src/fw/facts.mjs';
import { bootLoads } from '../src/fw/sections.mjs';

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const DIS = 0x50000000;
// the stage test `mov (W),d1; add -1,d0; mov 1,d2; asl d0,d2; mov d2,d0; and d1,d0; beq; mov 1,d0; bra; clr d0;
// retf [d2],4` (src/fw/facts.mjs bootState); the wait follows it (`mov d0,d2; mov d2,d0; call TEST`, sleeps between)
const TEST_TAIL = [0x28, 0xff, 0x8a, 0x01, 0xf2, 0x92, 0x88, 0xf2, 0x04, 0xc8, 0x06, 0x80, 0x01, 0xca, 0x03, 0x00, 0xde, 0x80, 0x04];
const TEST_LEN = 6 + TEST_TAIL.length;
const at = (img, o, bytes) => bytes.every((b, i) => b === null || img[o + i] === b);

// The boot job as the image gives it (base: the run-time base): {events: 'L1 P0:1 ...', step, cases: [[n, {table, n} | 'empty' | 'entry']], or}
export function bootJob(img, base) {
  const f = sectionLoader(img), { stage } = bootState(img);
  if (f === null || stage === null) return null;
  let test = null;
  for (let o = 0; o + TEST_LEN <= img.length; o++) {
    if (img[o] === 0xfc && img[o + 1] === 0xa5 && u32(img, o + 2) === stage && at(img, o + 6, TEST_TAIL)) { if (test !== null) throw new Error('two stage tests'); test = o; }
  }
  const wait = test + TEST_LEN, load = f.loader - DIS;
  if (callAt(img, wait + 2)?.to !== test) throw new Error(`no stage wait after the test at ${h8(DIS + test)}`);
  const calls = [];
  for (let o = 0; o < img.length - 8; o++) { const c = callAt(img, o); if (c && (c.to === load || c.to === wait)) calls.push([o, c.to]); }
  const loads = calls.filter(([o, t]) => t === load && img[o - 2] === 0x80).map(([o]) => [o, img[o - 1]]);
  if (loads.length !== 10) throw new Error(`load_section has ${loads.length} callers with mov n,d0`);
  const lo = loads[0][0], hi = loads[loads.length - 1][0] + 0x60;
  const events = [];
  for (const [o, n] of loads) events.push([o, `L${n}`]);
  for (const [o, t] of calls) if (t === wait && o > lo && o < hi && img[o - 2] === 0x80) events.push([o, `W${img[o - 1]}`]);
  // the posts: `mov n,a1` (95 nn) within 6 bytes before a call, the core from what follows it (clr d0: 0, mov 1,d0: 1)
  let post = null, step = null;
  for (let o = lo; o < hi; o++) {
    const c = callAt(img, o);
    if (!c) continue;
    const p = [...Array(5).keys()].map((k) => o - 2 - k).find((q) => img[q] === 0x95 && img[q + 1] >= 1 && img[q + 1] <= 10);
    if (p === undefined) continue;
    if (post === null) post = c.to;
    if (c.to !== post) throw new Error(`a post at ${h8(DIS + o)} calls ${h8(DIS + c.to)}, the first ${h8(DIS + post)}`);
    const mid = [...img.subarray(p + 2, o)], core = mid[0] === 0x00 ? 0 : mid[0] === 0x80 && mid[1] === 0x01 ? 1 : null;
    if (core === null) throw new Error(`the post at ${h8(DIS + o)}: no clr d0 or mov 1,d0 after its mov n,a1`);
    events.push([o, `P${core}:${img[p + 1]}`]);
  }
  // the step: the pointer USTART_L2 loads into a2 (`mov imm32,a2`, fc de) before its first post
  for (let o = lo; o < hi && step === null; o++) if (img[o] === 0xfc && img[o + 1] === 0xde) step = u32(img, o + 2) - base;
  events.sort((a, b) => a[0] - b[0]);
  // the step's `or` into the stage word and its switch on n before it: `cmp k,d0; beq` to a call of the block
  let or = null;
  for (let o = step; o < step + 0x200 && or === null; o++) {
    if (img[o] === 0xfc && img[o + 1] === 0xa5 && u32(img, o + 2) === stage && img[o + 6] === 0xf2 && img[o + 7] === 0x14 && img[o + 8] === 0xfc && img[o + 9] === 0x81 && u32(img, o + 10) === stage) or = o;
  }
  const cases = [];
  if (or !== null) {
    for (let o = or - 0x90; o < or; o++) {
      if (img[o] !== 0xa0 || img[o + 2] !== 0xc8) continue;
      const k = img[o + 1], c = callAt(img, o + 2 + ((img[o + 3] << 24) >> 24));
      if (!c) continue;
      const T = c.to;
      const block = at(img, T, [0xfc, 0xce, null, null, null, null, 0xaa, 0x00, 0xc8, null, 0xfc, 0xde]) ? { table: u32(img, T + 12), n: u32(img, T + 2) / 4 }
        : img[T] === 0xc8 ? 'entry' : null;
      cases.push([k, block === null ? `other at ${h8(DIS + T)}` : block.n === 0 ? 'empty' : block]);
    }
  }
  return { events: events.map(([, e]) => e).join(' '), sites: new Map(events.map(([o, e]) => [e, o])), step: DIS + step, or: or === null ? null : DIS + or, cases, f };
}

export async function bootstageImage() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { loadImage } = await import('../checks/lib/env.mjs');
  const img = loadImage(), job = bootJob(img, MODEL_INFO.image_base);
  if (job === null) { ok(!['E143', 'E146', 'E147'].includes(MODEL), `${MODEL}: no section loader read`); return { checks, bad }; }
  const want = [...Array(10).keys()].map((i) => i + 1).map((n) => `L${n} ${n === 8 ? 'W7 ' : n === 9 ? 'W8 ' : ''}P${n === 8 ? 1 : 0}:${n}`).join(' ');
  ok(job.events === want, `${MODEL}: USTART_L2's copies, waits and posts ${job.events}, want ${want}`);
  ok(job.or !== null, `${MODEL}: the step ${h8(job.step)} has no or into the stage word`);
  const tables = ctorTables(img), sections = bootLoads(img, MODEL_INFO.image_base, job.f).sections;
  const byCase = new Map(job.cases);
  ok(JSON.stringify([...byCase.keys()].sort((a, b) => a - b)) === '[1,2,4,6,7,8,9]', `${MODEL}: the step's cases ${[...byCase.keys()]}, want 1 2 4 6 7 8 9`);
  ok(byCase.get(1) === 'entry' && byCase.get(4) === 'empty' && byCase.get(9) === 'empty', `${MODEL}: cases 1, 4 and 9 ${JSON.stringify([1, 4, 9].map((k) => byCase.get(k)))}`);
  const withCtors = [2, 6, 7, 8].map((k) => byCase.get(k));
  ok(JSON.stringify(withCtors.map((b) => [b?.table, b?.n])) === JSON.stringify(tables), `${MODEL}: the tables of cases 2, 6, 7, 8 ${JSON.stringify(withCtors)}, the fact's ${JSON.stringify(tables)}`);
  // the rule stage_bits reads: a table of the fact is section n's step's iff it lies in section n's loaded range
  for (const s of sections) {
    const inRange = tables.filter(([t]) => t >= s.start && t < s.end).map(([t]) => t), b = byCase.get(s.n);
    ok(JSON.stringify(inRange) === JSON.stringify(typeof b === 'object' ? [b.table] : []), `${MODEL}: section ${s.n} (${h8(s.start)}..${h8(s.end)}) holds the tables ${inRange.map(h8)}, its case ${JSON.stringify(b)}`);
  }
  // the controls, on copies of the block: the wait before section 8's post made a wait for stage 6, and that post's
  // `mov 1,d0` made `clr d0; nop` (to CPU 0): each read as such
  const w7 = job.sites.get('W7'), p8 = job.sites.get('P1:8');
  const changed = (o, bytes) => { const c = img.slice(); c.set(bytes, o); return bootJob(c, MODEL_INFO.image_base).events; };
  ok(img[w7 - 2] === 0x80 && img[w7 - 1] === 7 && changed(w7 - 1, [6]) === want.replace('W7', 'W6'), `${MODEL}: the control, the wait for stage 7 made one for 6`);
  ok(img[p8 - 2] === 0x80 && img[p8 - 1] === 1 && changed(p8 - 2, [0x00, 0xcb]) === want.replace('P1:8', 'P0:8'), `${MODEL}: the control, section 8's post made one to CPU 0`);
  return { checks, bad };
}

export async function bootstageSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { bootFacts, CTOR_TABLES } = await import('../src/lab/menu.mjs');
  const { openSession } = await import('../host/session.mjs');
  const s = await openSession({});
  try {
    const lab = s.player.session.lab, word = bootFacts().stage;
    const v = lab.sim.u32(word), used = s.player.stand_ins_in_use();
    ok(v === 0x7f && lab.stage_bits_set === 0x7f && used.includes('S-BOOTSTAGE'), `${MODEL}: the stage word ${h8(word)} reads ${h8(v)} after the open (S-BOOTSTAGE ${lab.stage_bits_set}, in use ${used.includes('S-BOOTSTAGE')}), want 0x7f`);
    if (MODEL === 'E143') ok(used.includes('H-AUDSTART'), 'E143: H-AUDSTART in use (audio auto)');
    // the controls: stage_bits on the lab's own constructor record, one table reported failed or none run
    const results = lab.ctor_results;
    const failing = (m) => results.map((c) => (c.module === m && c.index === 0 ? { ...c, status: 'FAIL (test)' } : c));
    ok(CTOR_TABLES.length === 2 && results.length === CTOR_TABLES[0][1] + CTOR_TABLES[1][1], `${MODEL}: run_static_ctors ran ${results.length} constructors`);
    for (const [rec, want, what] of [[failing(1), 0x3f, 'section 7\'s first constructor failed'], [failing(0), 0x1f, 'section 6\'s first constructor failed'], [[], 0x1f, 'run_static_ctors not run']]) {
      lab.ctor_results = rec;
      const got = lab.stage_bits();
      ok(got === want, `${MODEL}: ${what}: stage_bits ${h8(got)}, want ${h8(want)}`);
    }
    lab.ctor_results = results;
  } finally { s.close?.(); }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const i = await bootstageImage();
  console.log(`the boot's stage bits on ${MODEL}'s block: ${i.checks - i.bad.length}/${i.checks}`);
  i.bad.forEach((x) => console.log('  ', x));
  let fail = i.bad.length;
  if (process.argv.includes('--session')) {
    const s = await bootstageSession();
    console.log(`the boot's stage bits in a ${MODEL} session: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
