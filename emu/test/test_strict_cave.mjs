// The strict mode's cave-store class (src/lab/strict.mjs ownRanges, StrictLog; firmware-free): on a synthetic block,
// the ranges a patch made the boot load (a section's end word raised over the stock image's) and the log's handling
// of stores into them:
//   ownRanges     a raised end word gives [stock end, patched end); a lowered or unchanged one, none; no loads or no
//                 stock image, none
//   aggregated    stores into the own range from several pcs are one cave-store finding: its range, the sites counted
//                 (on patched bytes and not), the stock sites listed, first and last site, the span of the addresses,
//                 a digest blind to the counts and moved by an address; strictLine names it
//   per site      a store into a stock section's range in the same log stays an image-store finding per site, and one
//                 in the gap past the raised end stays image-store with its gap named
//   cap per class with a cap of 2, many cave sites and image-store sites: the image-store sites kept up to the cap
//                 whatever the cave stores, the rest counted as dropped
//   controls      no overlay (patchRanges null) or no stock image: the same stores are image-store per site
//   node emu/test/test_strict_cave.mjs
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const le = (v) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24 & 0xff];

export async function strictCaveUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const mem = await import('../src/core/mem.mjs');
  const { IMAGE_BASE } = await import('../src/fw/model.mjs');
  const { MODELS } = await import('../src/fw/models.mjs');
  const { FACTS } = await import('../src/fw/ports.mjs');
  const { StrictLog, ownRanges, strictLine, STRICT_CLASSES } = await import('../src/lab/strict.mjs');

  // a block of SIZE at B: section 1 [B, B + 0x10000) with its end word at +0x40 (stock end +0x8000, patched +0xc000);
  // section 2 [B + 0x10000, ...) with its end word at +0x44 (stock and patched +0x18000); a gap past each end
  const SIZE = 0x40000, B = IMAGE_BASE;
  const stock = new Uint8Array(SIZE).fill(0xcb), rom = stock.slice();
  stock.set(le(B + 0x8000), 0x40); stock.set(le(B + 0x18000), 0x44);
  rom.set(le(B + 0xc000), 0x40); rom.set(le(B + 0x18000), 0x44);
  const sections = [{ n: 1, start: B, end: B + 0xc000, word: B + 0x40 }, { n: 2, start: B + 0x10000, end: B + 0x18000, word: B + 0x44 }];
  const loads = { sections, gaps: [{ lo: B + 0xc000, hi: B + 0x10000, n: 1, end: B + 0xc000, word: B + 0x40 }, { lo: B + 0x18000, hi: B + SIZE, n: 2, end: B + 0x18000, word: B + 0x44 }], unshown: [] };
  const patchRanges = [[0x41, 1], [0x200, 0x10]];      // the end word's byte +1 and code at +0x200..+0x210

  ok(STRICT_CLASSES.includes('cave-store'), `STRICT_CLASSES lists cave-store: ${STRICT_CLASSES}`);
  const own = ownRanges(loads, stock, B);
  ok(own.length === 1 && own[0].lo === B + 0x8000 && own[0].hi === B + 0xc000 && own[0].n === 1 && own[0].word === B + 0x40, `ownRanges: section 1's raised piece: ${JSON.stringify(own)}`);
  const lowered = stock.slice(); lowered.set(le(B + 0xe000), 0x40);
  ok(ownRanges(loads, lowered, B).length === 0, 'ownRanges: an end word the patch lowered gives none');
  ok(ownRanges(loads, rom, B).length === 0, 'ownRanges: the stock image equal to the patched one gives none');
  ok(ownRanges(null, stock, B).length === 0 && ownRanges(loads, null, B).length === 0, 'ownRanges: no loads or no stock image, none');
  // flash-copy family (loads null, section end words read directly from rom and stock via ends)
  const ends = [B + 0x40, B + 0x44];
  const ownFc = ownRanges(null, stock, B, rom, ends);
  ok(ownFc.length === 1 && ownFc[0].lo === B + 0x8000 && ownFc[0].hi === B + 0xc000 && ownFc[0].n === 1 && ownFc[0].word === B + 0x40 && ownFc[0].stock === B + 0x8000,
    `ownRanges (ends fallback): section 1's raised piece without loads: ${JSON.stringify(ownFc)}`);
  ok(ownRanges(null, lowered, B, rom, ends).length === 0 && ownRanges(null, rom, B, rom, ends).length === 0,
    'ownRanges (ends fallback): lowered or unchanged end word gives none');
  const oob = rom.slice(); oob.set(le(B + SIZE + 4), 0x40);
  ok(ownRanges(null, stock, B, oob, ends).length === 0, 'ownRanges (ends fallback): patched end past image end ignored');
  ok(ownRanges(null, stock, B, null, ends).length === 0 && ownRanges(null, stock, B, rom, []).length === 0,
    'ownRanges (ends fallback): missing rom or empty ends gives none');

  const pc0 = mem.ctx.pc, ins0 = mem.ctx.insns, mdr0 = mem.ctx.mdr;
  let pc = 0;
  mem.ctx.pc = () => pc; mem.ctx.insns = () => 7; mem.ctx.mdr = () => 0x6000abcd;
  const code = (o) => 0x50000000 + o;
  const log = ({ ranges = patchRanges, st = stock, max } = {}) => {
    const l = new StrictLog({ model: 'T', allow: { T: [] }, ...(max ? { max } : {}) });
    l.arm({ rom, base: B, end: B + SIZE, preload: [], loads, patchRanges: ranges, stock: st });
    return l;
  };
  // the steps: patched code at +0x200 and +0x204 and stock code at +0x300 store into the cave; stock code at +0x310
  // stores into section 2's range; +0x320 into the gap past section 1's raised end
  const steps = (L, moved = false) => {
    pc = B + 0x200; L.report('store', B + 0x8100, 4, 'w', 1); L.report('store', B + 0x8104, 4, 'w', 2);
    pc = B + 0x204; L.report('store', (B + 0x9000 + 0x40000000) >>> 0, 2, 'w', 3);
    pc = B + 0x300; L.report('store', B + (moved ? 0xa004 : 0xa000), 1, 'w', 4);
    pc = B + 0x310; L.report('store', B + 0x12000, 1, 'w', 5);
    pc = B + 0x320; L.report('store', B + 0xd000, 4, 'w', 6);
    pc = B + 0x204; L.report('store', B + 0x8008, 2, 'w', 7);
  };
  try {
    const L = log();
    steps(L);
    const d = L.doc(), cave = d.findings.filter((f) => f.class === 'cave-store'), per = d.findings.filter((f) => f.class === 'image-store');
    ok(d.findings.length === 3 && cave.length === 1 && per.length === 2, `one cave-store finding and two image-store sites: ${JSON.stringify(d.findings)}`);
    const c = cave[0];
    ok(c.range === `${h8(B + 0x8000)}..${h8(B + 0xc000)}` && /section 1's range from its stock end/.test(c.where) && c.n === 5 && c.sites === 3 && c.patched === 2,
      `the cave finding's range, count and sites: ${JSON.stringify(c)}`);
    ok(c.site === h8(B + 0x200) && c.disasm === h8(code(0x200)) && c.addr === h8(B + 0x8100) && c.last.disasm === h8(code(0x204)) && c.last.addr === h8(B + 0x40009000),
      `first and last site: ${JSON.stringify(c)}`);
    ok(JSON.stringify(c.stock_sites) === JSON.stringify([{ site: h8(B + 0x300), disasm: h8(code(0x300)), addr: h8(B + 0xa000), size: 1 }]), `the stock site listed: ${JSON.stringify(c.stock_sites)}`);
    ok(c.span[0] === h8(B + 0x8008) && c.span[1] === h8(B + 0xa000), `the span in the cached view: ${JSON.stringify(c.span)}`);
    const s2 = per.find((f) => f.disasm === h8(code(0x310))), gap = per.find((f) => f.disasm === h8(code(0x320)));
    ok(s2 && s2.addr === h8(B + 0x12000) && !s2.where && !s2.patched, `a store into section 2's stock range stays image-store per site: ${JSON.stringify(s2)}`);
    ok(gap && /in the gap past section 1's loaded end/.test(gap.where), `a store into the gap past the raised end stays image-store: ${JSON.stringify(gap)}`);
    const line = strictLine(d);
    ok(line.includes(`cave-store into ${c.range}`) && line.includes('3 site(s) x5') && line.includes(`image-store at ${h8(code(0x310))}`), `strictLine: ${line}`);
    // the digest: blind to counts (a second pass of the same steps), moved by an address
    const L2 = log(); steps(L2); steps(L2);
    const L3 = log(); steps(L3, true);
    const c2 = L2.doc().findings.find((f) => f.class === 'cave-store'), c3 = L3.doc().findings.find((f) => f.class === 'cave-store');
    ok(c2.digest === c.digest && c2.n === 10 && c3.digest !== c.digest, `the digest: counts left out (${c2.digest}), an address moved told apart (${c3.digest} vs ${c.digest})`);
    // the cap per class: 2 kept per class; 20 cave sites, then 4 stock-range sites
    const C = log({ max: 2 });
    for (let k = 0; k < 20; k++) { pc = B + 0x200 + k; C.report('store', B + 0x8000 + 4 * k, 4, 'w', 0); }
    for (let k = 0; k < 4; k++) { pc = B + 0x400 + k; C.report('store', B + 0x12000, 4, 'w', 0); }
    const cd = C.doc();
    ok(cd.findings.filter((f) => f.class === 'image-store').length === 2 && cd.findings.find((f) => f.class === 'cave-store')?.sites === 20 && cd.dropped === 2,
      `the cap per class: two image-store sites kept behind 20 cave sites, two dropped: ${JSON.stringify(cd.findings.map((f) => [f.class, f.disasm, f.sites]))} dropped ${cd.dropped}`);
    // the controls: no overlay; no stock image: every store per site
    for (const [what, opt] of [['no overlay', { ranges: null }], ['no stock image', { st: null }]]) {
      const X = log(opt); steps(X);
      const xd = X.doc();
      ok(xd.findings.length === 5 && xd.findings.every((f) => f.class === 'image-store'), `control, ${what}: five image-store sites: ${JSON.stringify(xd.findings.map((f) => [f.class, f.disasm]))}`);
    }
    // flash-copy family: StrictLog armed with loads: null and explicit ends aggregates cave-store without bootLoads
    const fcLog = ({ ranges = patchRanges, st = stock } = {}) => {
      const l = new StrictLog({ model: 'T', allow: { T: [] } });
      l.arm({ rom, base: B, end: B + SIZE, preload: [], loads: null, patchRanges: ranges, stock: st, ends });
      return l;
    };
    const F = fcLog();
    pc = B + 0x200; F.report('store', B + 0x8100, 4, 'w', 1);
    pc = B + 0x300; F.report('store', B + 0xa000, 1, 'w', 2);
    pc = B + 0x310; F.report('store', B + 0x12000, 1, 'w', 3);
    const fd = F.doc(), fcCave = fd.findings.filter((f) => f.class === 'cave-store'), fcPer = fd.findings.filter((f) => f.class === 'image-store');
    ok(fd.findings.length === 2 && fcCave.length === 1 && fcCave[0].range === `${h8(B + 0x8000)}..${h8(B + 0xc000)}` && fcCave[0].sites === 2 && fcCave[0].patched === 1 && fcPer.length === 1,
      `flash-copy fallback (loads null, ends): one cave-store and one image-store: ${JSON.stringify(fd.findings)}`);
    const Fno = fcLog({ ranges: null });
    pc = B + 0x200; Fno.report('store', B + 0x8100, 4, 'w', 1);
    ok(Fno.doc().findings.length === 1 && Fno.doc().findings[0].class === 'image-store', 'flash-copy control: no overlay gives image-store');
    // real flash-copy-family model lookup (E142: FACTS.E142.sections.ends resolved automatically when loads is null)
    const e142Base = MODELS.E142.image_base >>> 0, e142Word = FACTS.E142.sections.ends[0] >>> 0, e142Off = e142Word - e142Base;
    const e142Stock = new Uint8Array(SIZE).fill(0xcb), e142Rom = e142Stock.slice();
    e142Stock.set(le(e142Base + 0x30000), e142Off);
    e142Rom.set(le(e142Base + 0x34000), e142Off);
    const E142 = new StrictLog({ model: 'E142', allow: { E142: [] } });
    E142.arm({ rom: e142Rom, base: e142Base, end: e142Base + SIZE, preload: [], loads: null, patchRanges: [[e142Off, 4], [0x200, 4]], stock: e142Stock });
    pc = e142Base + 0x200; E142.report('store', e142Base + 0x31000, 4, 'w', 9);
    const e142Doc = E142.doc();
    ok(e142Doc.findings.length === 1 && e142Doc.findings[0].class === 'cave-store' && e142Doc.findings[0].range === `${h8(e142Base + 0x30000)}..${h8(e142Base + 0x34000)}`,
      `E142 automatic sections.ends lookup with loads null: ${JSON.stringify(e142Doc.findings)}`);
  } finally { mem.ctx.pc = pc0; mem.ctx.insns = ins0; mem.ctx.mdr = mdr0; }
  return { bad, checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await strictCaveUnits();
  console.log(`strict cave-store: units ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length ? 1 : 0);
}
