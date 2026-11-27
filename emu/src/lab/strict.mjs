// The strict mode (--strict on, OM_STRICT=1; off by default): three classes of CPU access that the lab runs as the
// code asks but that failed on cameras running modified firmware (caduceus-ep7 docs/FIRMWARE_GUIDE.md section 10,
// their report), reported per site (the accessing instruction's pc) through the patch audit's channel (the status's
// and the session summary's `strict`, beside `patch_audit`; strictLine for the hosts' stderr lines):
//   misaligned      a 16- or 32-bit data access off its alignment. The MN103 manual leaves its operation "not
//                   guaranteed" (docs/mn10300-isa-spec.md 2.5); the CPU core faults it (fault 3) and the session stops
//                   whether strict or not (emu/FIDELITY-NOTES.md 3.1). Strict adds the site record, so the stop shows
//                   in the same list as the other classes. caduceus-ep7's camera crashed on one (0x601e356c, E142)
//   image-store     a store into the main code block's run-time span [IMAGE_BASE, IMAGE_END), either DRAM view: the
//                   loaded code image (a gap the boot does not load included, named so). caduceus-ep7's camera crashed
//                   on a byte store into section 3's range (their test 7a); their sweep of E142's absolute stores
//                   found none into the image (their report)
//   cave-store      a store into a range the patch made the boot load: a section's range from its stock end to the
//                   end its end word holds in the patched image, where the patch raised that word (caduceus-om3's
//                   section 6, 0x60f49800..0x6103f000 on E147, their report). Known with the stock image at hand
//                   (env.stockRom) whenever the build's section end words are read: from bootLoads in the loaded-ranges
//                   mode (E143, E146, E147), or directly from fact sections.ends on the flash-copy family (E125, E130,
//                   E133, E137, E140, E142) and when --loaded is off. There the patch keeps its own variables, so these
//                   stores are one finding per range (ownRanges, the sites counted) and never take a stock-range
//                   image-store's place under the cap
//   init-read       a load from the source of a boot copy of image data to another address (src/fw/board.mjs preload:
//                   the E144 family's reset head copies, E142 among them; the lab makes them at the load, src/fw/
//                   expand.mjs relocate, so every CPU load of a source comes after its copy). caduceus-ep7's issue #48:
//                   their code read E142's init word 0x6025aa98 (preload row 2's source) where the boot had put it at
//                   0x61fc27d8, read 0 on the camera and jumped to pc 0
//   unloaded-read   in the loaded-ranges mode (S-STALERAM, --loaded), a load from a range the boot does not load or is
//                   not shown to load (src/fw/sections.mjs bootLoads' gaps and unshown): it reads S-STALERAM's fill,
//                   which the mode alone does not report (src/lab/patchaudit.mjs unloadedRuns)
// Stock firmware's own sites of these classes are data (src/fw/strict-allow.mjs STRICT_ALLOW, built from stock
// sessions): a site in its model's list is counted as allowed, not reported, unless its instruction lies on bytes a
// patch overlay changed (src/lab/patchaudit.mjs PatchRanges.code). Everything is CPU accesses (src/core/mem.mjs
// setStrict): the lab's own reads and writes (stand-ins, the debugger, DMA) never report.
import { ctx } from '../core/mem.mjs';
import { SECTIONS_E143 } from '../fw/facts.mjs';
import { FACTS } from '../fw/ports.mjs';
import { STRICT_ALLOW } from '../fw/strict-allow.mjs';
import { PatchRanges } from './patchaudit.mjs';

const sectionEndsFor = (model) => (model === 'E143' ? SECTIONS_E143 : FACTS[model]?.sections)?.ends ?? null;

const CODE = 0x50000000;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the classes a finding names (its `class`)
export const STRICT_CLASSES = ['misaligned', 'image-store', 'cave-store', 'init-read', 'unloaded-read'];
export const STRICT_SITES_MAX = 256;           // distinct new sites kept per class; more are counted (dropped)
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// The mode from an option value ('on', 'off', true, false, undefined) and the environment's OM_STRICT ('1' or 'on'):
// the option wins when given
export function strictOn(opt, environ = {}) {
  if (opt === true || opt === 'on') return true;
  if (opt === false || opt === 'off') return false;
  if (opt !== undefined && opt !== null && opt !== 'auto') throw new Error(`strict ${opt}: on or off`);
  return environ.OM_STRICT === '1' || environ.OM_STRICT === 'on';
}

// The ranges of a run (cached-view run-time addresses, [lo, hi)): stores, the block's span; reads, each preload row's
// source ({lo, hi, cls: 'init-read', dst}) and, with loads (src/lab/sim.mjs loadedRanges' result, or null), its gaps
// and unshown ranges ({lo, hi, cls: 'unloaded-read', range})
export function strictRanges({ base, end, preload = [], loads = null }) {
  const reads = preload.map(([file, len, dst]) => ({ lo: base + file, hi: base + file + len, cls: 'init-read', dst }));
  for (const g of [...(loads?.gaps ?? []), ...(loads?.unshown ?? [])]) {
    reads.push({ lo: g.lo, hi: g.hi, cls: 'unloaded-read', range: g.kind ? `not shown loaded (${g.kind})` : `past section ${g.n}'s loaded end ${h8(g.end)}` });
  }
  reads.sort((a, b) => a.lo - b.lo);
  return { stores: [{ lo: base >>> 0, hi: end >>> 0 }], reads, gaps: loads ? [...loads.gaps, ...(loads.unshown ?? [])] : [] };
}

// The ranges a patch made the boot load (cave-store): loads, the patched image's (src/fw/sections.mjs bootLoads, or
// null), stock the stock run-time image (or null), base its run-time address; where loads is null (the flash-copy
// family, whose reset head copies are not read so bootLoads does not run: E125, E130, E133, E137, E140, E142, or
// --loaded off), rom (the patched image) and ends (the section end words' run-time addresses, fact sections.ends,
// section 1 first) give the same check directly. Each section whose end word holds a higher end in the patched image
// than in the stock one gives [stock end, patched end) ({lo, hi, n, word, stock}); [] without stock or without
// either loads or (rom and ends).
export function ownRanges(loads, stock, base, rom = null, ends = null) {
  if (!stock) return [];
  const out = [];
  if (loads) {
    for (const s of loads.sections ?? []) {
      const o = s.word - base;
      if (o < 0 || o + 4 > stock.length) continue;
      const was = u32(stock, o);
      if (s.end > was) out.push({ lo: was, hi: s.end, n: s.n, word: s.word, stock: was });
    }
    return out;
  }
  if (!rom || !ends?.length) return out;
  const hi = base + rom.length;
  for (let i = 0; i < ends.length; i++) {
    const word = ends[i] >>> 0, o = word - base;
    if (o < 0 || o + 4 > stock.length || o + 4 > rom.length) continue;
    const was = u32(stock, o), now = u32(rom, o);
    if (now > was && was >= base && now <= hi) out.push({ lo: was, hi: now, n: i + 1, word, stock: was });
  }
  return out;
}

// The first of a model's allowlist entries ({kind, at: [lo, hi) code notation, addr: [lo, hi) run-time, why}; at or
// addr absent: any) matching a site (kind, its code-notation pc, its run-time address in the cached view), or null
export function allowed(list, kind, at, addr) {
  for (const e of list ?? []) {
    if (e.kind !== kind) continue;
    if (e.at && (at < e.at[0] || at >= e.at[1])) continue;
    if (e.addr && (addr < e.addr[0] || addr >= e.addr[1])) continue;
    return e;
  }
  return null;
}

// One run's strict log, across its sessions (a host makes one and passes it as env.strict; src/lab/sim.mjs makes one
// for OM_STRICT=1 when the host passes none). arm() for each machine gives src/core/mem.mjs setStrict's config.
export class StrictLog {
  constructor({ model, allow = STRICT_ALLOW, max = STRICT_SITES_MAX } = {}) {
    this.model = model; this.allow = allow[model] ?? []; this.max = max;
    this.sites = new Map();          // `${kind}:${pc}` -> site record
    this.allowedCounts = new Map();  // allowlist entry -> accesses
    this.caves = new Map();          // own range's lo -> its cave-store finding (its sites in a Map by pc)
    this.perClass = new Map();       // class -> sites kept
    this.dropped = 0;
    this.r = null;
  }
  // rom: the run-time image in use, base / end the block's span, preload the board's rows, loads the loaded-ranges
  // mode's ranges (or null), patchRanges the overlay's changed [offset, length] (or null), stock the stock run-time
  // image (or null: no cave-store range), ends optional section end-word addresses when loads is null (default:
  // fact sections.ends for this.model, so flash-copy-family bodies get cave-store without bootLoads)
  arm({ rom, base, end, preload = [], loads = null, patchRanges = null, stock = null, ends = null }) {
    const r = strictRanges({ base, end, preload, loads });
    const b = base >>> 0;
    this.r = { ...r, base: b, end: end >>> 0, patch: patchRanges ? new PatchRanges(patchRanges, rom, base) : null,
      own: patchRanges ? ownRanges(loads, stock, b, rom, ends ?? sectionEndsFor(this.model)) : [] };
    return { stores: r.stores.map((x) => [x.lo, x.hi]), reads: r.reads.map((x) => [x.lo, x.hi]), report: (kind, a, w, dir, v) => this.report(kind, a, w, dir, v) };
  }
  // src/core/mem.mjs's report: kind 'misaligned', 'store' or 'read'; a the access's address (either view)
  report(kind, a, w, dir, v) {
    const { base, end } = this.r;
    const c = a >= 0xA0000000 && a < 0xC0000000 ? (a - 0x40000000) >>> 0 : a >>> 0;
    let cls = kind === 'misaligned' ? 'misaligned' : kind === 'store' ? 'image-store' : null, where = null;
    if (kind === 'read') {
      const x = this.r.reads.find((g) => c >= g.lo && c < g.hi);
      if (!x) return;
      cls = x.cls;
      where = x.cls === 'init-read' ? `copied to ${h8(x.dst + (c - x.lo))} at the boot` : x.range;
    } else if (kind === 'store') {
      const g = this.r.gaps.find((x) => c >= x.lo && c < x.hi);
      if (g) where = g.kind ? `in a range not shown loaded (${g.kind})` : `in the gap past section ${g.n}'s loaded end ${h8(g.end)}`;
      const own = g ? null : this.r.own.find((x) => c >= x.lo && c < x.hi);
      if (own) { this.cave(own, a, w, v, c); return; }
    }
    const pc = ctx.pc() >>> 0;
    const pcc = pc >= 0xA0000000 && pc < 0xC0000000 ? (pc - 0x40000000) >>> 0 : pc;
    const at = pcc >= base && pcc < end ? (pcc - base + CODE) >>> 0 : pc;
    const patched = this.r.patch !== null && this.r.patch.code(pcc) !== null;
    if (!patched) {
      const e = allowed(this.allow, cls, at, c);
      if (e) { this.allowedCounts.set(e, (this.allowedCounts.get(e) ?? 0) + 1); return; }
    }
    const key = `${cls}:${pc}`;
    const s = this.sites.get(key);
    if (s) { s.n += 1; if (!s.addrs.includes(h8(a)) && s.addrs.length < 8) s.addrs.push(h8(a)); return; }
    const kept = this.perClass.get(cls) ?? 0;
    if (kept >= this.max) { this.dropped += 1; return; }
    this.perClass.set(cls, kept + 1);
    this.sites.set(key, { class: cls, site: h8(pc), disasm: h8(at), addr: h8(a), addrs: [h8(a)], size: w, dir, value: h8(v), ret: h8(ctx.mdr()),
      insns: ctx.insns(), n: 1, ...(where ? { where } : {}), ...(patched ? { patched: true } : {}) });
  }
  // the pc in the code notation (pcc the cached view's) and whether its instruction is on patched bytes
  where(pc) {
    const { base, end } = this.r;
    const pcc = pc >= 0xA0000000 && pc < 0xC0000000 ? (pc - 0x40000000) >>> 0 : pc;
    return { at: pcc >= base && pcc < end ? (pcc - base + CODE) >>> 0 : pc, patched: this.r.patch !== null && this.r.patch.code(pcc) !== null };
  }
  // a store into an own range (cave-store): one finding per range, the first and the last site, the sites by pc
  cave(own, a, w, v, c) {
    const pc = ctx.pc() >>> 0;
    let f = this.caves.get(own.lo);
    if (!f) {
      const { at, patched } = this.where(pc);
      f = { class: 'cave-store', site: h8(pc), disasm: h8(at), addr: h8(a), size: w, dir: 'w', value: h8(v), ret: h8(ctx.mdr()), insns: ctx.insns(), n: 0,
        range: `${h8(own.lo)}..${h8(own.hi)}`, where: `section ${own.n}'s range from its stock end ${h8(own.stock)} to the end the patch's end word at ${h8(own.word)} holds`,
        bySite: new Map(), lo: c, hi: c, last: null };
      this.caves.set(own.lo, f);
      this.sites.set(`cave-store:${own.lo}`, f);
    }
    f.n += 1;
    if (c < f.lo) f.lo = c;
    if (c > f.hi) f.hi = c;
    let s = f.bySite.get(pc);
    if (!s) { const { at, patched } = this.where(pc); f.bySite.set(pc, s = { site: h8(pc), disasm: h8(at), addr: h8(a), size: w, patched }); }
    f.last = s;
  }
  // a cave-store finding as the doc gives it: sites, the distinct pcs; patched, those on patched bytes; stock_sites,
  // the others (at most 8, {site, disasm, addr, size}); span, the cached-view addresses stored; last, the last site;
  // digest, FNV-1a of the sorted lines "disasm addr size" of its sites (blind to the counts)
  caveDoc(f) {
    const { bySite, lo, hi, last, ...rest } = f;
    const all = [...bySite.values()], other = all.filter((s) => !s.patched);
    let x = 0x811c9dc5;
    for (const ch of all.map((s) => `${s.disasm} ${s.addr} ${s.size}`).sort().join('\n')) x = Math.imul(x ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    return { ...rest, sites: all.length, patched: all.length - other.length, stock_sites: other.slice(0, 8).map(({ patched, ...s }) => s),
      span: [h8(lo), h8(hi)], last: { site: last.site, disasm: last.disasm, addr: last.addr }, digest: x.toString(16).padStart(8, '0') };
  }
  // {findings: [...] in first-seen order, allowed: [{kind, at, why, n}], dropped}. A finding is the report shape the
  // patch audit's sec_ready shares (src/lab/secready.mjs secReadyReport): {class, site (the instruction's run-time
  // pc), disasm (its code notation), addr (the address accessed), ...}
  doc() {
    const span = (r) => (r ? `${h8(r[0])}..${h8(r[1])}` : 'any');
    const allowedList = [...this.allowedCounts].map(([e, n]) => ({ kind: e.kind, at: span(e.at), addr: span(e.addr), why: e.why, n }));
    return { model: this.model, findings: [...this.sites.values()].map((s) => (s.class === 'cave-store' ? this.caveDoc(s) : (({ addrs, ...x }) => (addrs.length > 1 ? { ...x, addrs } : x))(s))), allowed: allowedList, dropped: this.dropped };
  }
}

// The doc as one line (the hosts' stderr)
export function strictLine(d) {
  const allowedN = d.allowed.reduce((x, e) => x + e.n, 0);
  const tail = `${allowedN ? `; ${allowedN} access(es) at stock sites allowed (src/fw/strict-allow.mjs)` : ''}${d.dropped ? `; ${d.dropped} more site(s) not kept` : ''}`;
  const f = d.findings;
  if (!f.length) return `strict: no new site${tail}`;
  const some = f.slice(0, 8).map((s) => s.class === 'cave-store'
    ? `cave-store into ${s.range} (${s.where}): ${s.sites} site(s) x${s.n}, first at ${s.disasm} to ${s.addr}, last at ${s.last.disasm} to ${s.last.addr}`
    : `${s.class} at ${s.disasm}${s.patched ? ' (patched bytes)' : ''} ${s.dir === 'w' ? 'to' : 'from'} ${s.addr}${s.n > 1 ? ` x${s.n}` : ''}${s.where ? ` (${s.where})` : ''}, ret ${s.ret}`);
  return `strict: ${f.length} new site(s): ${some.join('; ')}${f.length > 8 ? `; and ${f.length - 8} more` : ''}${tail}`;
}
