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
import { STRICT_ALLOW } from '../fw/strict-allow.mjs';
import { PatchRanges } from './patchaudit.mjs';

const CODE = 0x50000000;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the classes a finding names (its `class`)
export const STRICT_CLASSES = ['misaligned', 'image-store', 'init-read', 'unloaded-read'];
export const STRICT_SITES_MAX = 256;           // distinct new sites kept; more are counted (dropped)

// The mode from an option value ('on', 'off', true, false, undefined) and the environment's OM_STRICT ('1' or 'on'):
// the option wins when given
export function strictOn(opt, environ = Reflect.get(globalThis, 'process')?.env ?? {}) {
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
    this.dropped = 0;
    this.r = null;
  }
  // rom: the run-time image in use, base / end the block's span, preload the board's rows, loads the loaded-ranges
  // mode's ranges (or null), patchRanges the overlay's changed [offset, length] (or null)
  arm({ rom, base, end, preload = [], loads = null, patchRanges = null }) {
    const r = strictRanges({ base, end, preload, loads });
    this.r = { ...r, base: base >>> 0, end: end >>> 0, patch: patchRanges ? new PatchRanges(patchRanges, rom, base) : null };
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
    if (this.sites.size >= this.max) { this.dropped += 1; return; }
    this.sites.set(key, { class: cls, site: h8(pc), disasm: h8(at), addr: h8(a), addrs: [h8(a)], size: w, dir, value: h8(v), ret: h8(ctx.mdr()),
      insns: ctx.insns(), n: 1, ...(where ? { where } : {}), ...(patched ? { patched: true } : {}) });
  }
  // {findings: [...] in first-seen order, allowed: [{kind, at, why, n}], dropped}. A finding is the report shape the
  // patch audit's sec_ready shares (src/lab/secready.mjs secReadyReport): {class, site (the instruction's run-time
  // pc), disasm (its code notation), addr (the address accessed), ...}
  doc() {
    const span = (r) => (r ? `${h8(r[0])}..${h8(r[1])}` : 'any');
    const allowedList = [...this.allowedCounts].map(([e, n]) => ({ kind: e.kind, at: span(e.at), addr: span(e.addr), why: e.why, n }));
    return { model: this.model, findings: [...this.sites.values()].map(({ addrs, ...s }) => (addrs.length > 1 ? { ...s, addrs } : s)), allowed: allowedList, dropped: this.dropped };
  }
}

// The doc as one line (the hosts' stderr)
export function strictLine(d) {
  const allowedN = d.allowed.reduce((x, e) => x + e.n, 0);
  const tail = `${allowedN ? `; ${allowedN} access(es) at stock sites allowed (src/fw/strict-allow.mjs)` : ''}${d.dropped ? `; ${d.dropped} more site(s) not kept` : ''}`;
  const f = d.findings;
  if (!f.length) return `strict: no new site${tail}`;
  const some = f.slice(0, 8).map((s) => `${s.class} at ${s.disasm}${s.patched ? ' (patched bytes)' : ''} ${s.dir === 'w' ? 'to' : 'from'} ${s.addr}${s.n > 1 ? ` x${s.n}` : ''}${s.where ? ` (${s.where})` : ''}, ret ${s.ret}`);
  return `strict: ${f.length} new site(s): ${some.join('; ')}${f.length > 8 ? `; and ${f.length - 8} more` : ''}${tail}`;
}
