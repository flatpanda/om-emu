// What the boot loads of the main block into DRAM, read from the image in use (pure: the image, its run-time base and
// the build's fact 'sections', src/fw/facts.mjs sectionLoader). The lab copies the whole block to DRAM
// (src/machine.mjs); the camera's boot copies parts of it: the reset head's copies (headCopies) and the section
// loader's, each section from its table row's dest up to its end word (the end switch's case immediate). A patch can
// change both, as caduceus-om3 raises section 6's end word (their report), so the values are read here from the image
// in use at the places the fact pins, never from src/fw/ports.mjs; the image must still have the pinned forms there.
import { headCopies, sectionEnds, cached, SECTION_ROW, FLASH_VIEW, BASE_PAGE_OFFSET } from './facts.mjs';

const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// The byte S-STALERAM fills the unloaded ranges with (src/machine.mjs): the camera holds whatever RAM held there
// before (caduceus-om3's camera probes summed the gaps to values that changed between power-ons, their report), so no
// value is right; 0xA5 is neither the file's 0xFF padding nor zero
export const POISON = 0xA5;

// bootLoads(img, base, f): {count, copied, sections: [{n, start, end, word, src}], head: [{at, start, end}], ends:
// [{at, word, end}], gaps: [{lo, hi, n, end, word}], unshown: [{lo, hi, kind, copy, ...}]}, run-time addresses
// (cached view). sections: the table's rows with the end each end word holds in img; head: the reset head's copies;
// ends: the end words the head stores and does not load (headCopies); gaps: what the boot provably does not load, each
// section's range from its end to the next section's start (the last's to the image's end; n its number, end and word
// its end word's value and address), less the head's copies and less the piece up to a stored end that lies in it.
// unshown: what the boot is not shown to load (?: no copy the lab reads puts it in DRAM; the boot stage before the
// main block's, whose extent the lab does not read, is not ruled out): kind 'head', the
// pieces of the range from the head's first copy's start to section 1's start that no head copy covers; kind
// 'stored', the piece of a gap up to an end the head stores and never loads (n the gap's section, stored that end,
// at and word the store's instruction and the word it stores to). copy: the head copy whose end bounds the piece
// from below, or null. The image's head below the first copy's start is loaded: the reset jump enters it and every
// call before the first copy goes there, so a boot stage before the main block's put it there (I), whose extent the
// lab does not read. Throws where img no longer has the fact's forms: the switch, its count, the case immediates at
// the fact's words, the head's copies at the fact's sites; or a section not copied in place, or sections out of order.
export function bootLoads(img, base, f) {
  const words = sectionEnds(img, base, f.switch, 'bootLoads');
  if (words.length !== f.ends.length || words.some((w, i) => w !== f.ends[i])) {
    throw new Error(`bootLoads: the end switch ${h8(f.switch)} gives the end words ${words.map(h8).join(' ')}, the build's are ${f.ends.map(h8).join(' ')}`);
  }
  const at = (a) => a - base;
  const sections = words.map((word, i) => {
    const row = at(f.table) + SECTION_ROW * i, start = u32(img, row), src = u32(img, row + 4), end = u32(img, at(word));
    const file = src - FLASH_VIEW - BASE_PAGE_OFFSET;
    if (start !== base + file) throw new Error(`bootLoads: section ${i + 1} (table row ${h8(f.table + SECTION_ROW * i)}) copies block offset ${h8(file)} to ${h8(start)}, not in place (${h8(base + file)})`);
    if (end < start || end > base + img.length) throw new Error(`bootLoads: section ${i + 1}'s end word ${h8(word)} holds ${h8(end)}, outside ${h8(start)}..${h8(base + img.length)}`);
    return { n: i + 1, start, end, word, src };
  });
  for (let i = 1; i < sections.length; i++) {
    if (sections[i].start <= sections[i - 1].start) throw new Error(`bootLoads: section ${i + 1} starts at ${h8(sections[i].start)}, not after section ${i}'s ${h8(sections[i - 1].start)}`);
  }
  const hc = headCopies(img);
  const sites = hc.copies.map((c) => c.at);
  if (sites.length !== f.head.length || sites.some((s, i) => s !== f.head[i])) {
    throw new Error(`bootLoads: the reset head copies at ${sites.map(h8).join(' ')}, the build's at ${f.head.map(h8).join(' ')}`);
  }
  const head = hc.copies.map((c) => ({ at: c.at, start: c.dst, end: c.dst + c.len }));
  const less = (pieces) => {           // [lo, hi) pieces less the head's copies
    for (const c of head) pieces = pieces.flatMap(([lo, hi]) => [[lo, Math.min(hi, c.start)], [Math.max(lo, c.end), hi]]).filter(([lo, hi]) => lo < hi);
    return pieces;
  };
  const below = (lo) => head.find((c) => c.end === lo) ?? null;
  const unshown = [];
  // the head's range from its first copy to section 1, less its copies
  const first = Math.min(...head.map((c) => c.start));
  if (first < sections[0].start) for (const [lo, hi] of less([[first, sections[0].start]])) unshown.push({ lo, hi, kind: 'head', copy: below(lo), first, next: sections[0].start });
  // each section's tail range, less the head's copies and the piece up to a stored end in it
  const gaps = [];
  for (const s of sections) {
    const next = sections[s.n]?.start ?? base + img.length;
    const pieces = less(s.end < next ? [[s.end, next]] : []);
    for (const e of hc.ends) {
      const holder = pieces.find(([lo, hi]) => e.end > lo && e.end <= hi);
      if (holder) { unshown.push({ lo: holder[0], hi: e.end, kind: 'stored', copy: below(holder[0]), n: s.n, stored: e.end, at: e.at, word: e.word }); holder[0] = e.end; }
    }
    for (const [lo, hi] of pieces) if (lo < hi) gaps.push({ lo, hi, n: s.n, end: s.end, word: s.word });
  }
  unshown.sort((a, b) => a.lo - b.lo);
  return { count: sections.length, copied: f.copied, sections, head, ends: hc.ends, gaps, unshown };
}

// The range of a list of bootLoads' (gaps, unshown, or both) that holds the run-time address a (either DRAM view), or
// null.
export function gapAt(gaps, a) {
  const c = cached(a >>> 0);
  return gaps.find((g) => c >= g.lo && c < g.hi) ?? null;
}

// The words of S-STALERAM's refusal of an instruction at pc fetched from the gap g (src/machine.mjs); base: the image's
// run-time base, f the build's fact.
export function gapMessage(g, pc, base, f) {
  return `pc ${h8(pc)} runs code the boot does not load: ${h8(g.lo)}..${h8(g.hi)} lies past section ${g.n}'s loaded end ${h8(g.end)}, ` +
    `which the end word at ${h8(g.word)} holds (the immediate of the instruction at ${h8(g.word - 2 - base + FLASH_VIEW)}, case ${g.n} of the end switch ${h8(f.switch)}); ` +
    `the boot's section loader (load_section ${h8(f.loader)}) copies each section only up to its end word, so on the camera these bytes ` +
    `are stale RAM, not the image's (S-STALERAM, --loaded on): place the code inside a section's loaded range or raise that end word`;
}

// The words of S-STALERAM's refusal of an instruction at pc fetched from the range u of bootLoads' unshown.
export function unshownMessage(u, pc) {
  const from = u.copy ? `the end of the reset head's copy at ${h8(u.copy.at)} (${h8(u.copy.start)}..${h8(u.copy.end)})`
    : u.kind === 'stored' ? `section ${u.n}'s loaded end ${h8(u.lo)}` : h8(u.lo);
  const to = u.kind === 'head' ? `section 1's start ${h8(u.next)}, where the section loader's copies begin`
    : `the end ${h8(u.stored)} that the reset head stores to ${h8(u.word)} (the instruction at ${h8(u.at)}) and never loads`;
  return `pc ${h8(pc)} runs code the boot is not shown to load (?): ${h8(u.lo)}..${h8(u.hi)} lies between ${from} and ${to}; ` +
    `no copy of the reset head or the section loader puts these bytes in DRAM, and the extent of the boot stage before the main block's ` +
    `(which puts the head below ${u.kind === 'head' ? h8(u.first) : 'its first copy'} in place) is not read, so on the camera they may be stale RAM ` +
    `(S-STALERAM, --loaded on): place the code inside a head copy or a section's loaded range`;
}

// The refusal's words for a range of either list (src/lab/sim.mjs): unshownMessage for an unshown one, else gapMessage
export function rangeMessage(g, pc, base, f) { return g.kind ? unshownMessage(g, pc) : gapMessage(g, pc, base, f); }
