// bin/fwmap.mjs static: the static map of a main block, a pure function of the image and the pinned seeds. Functions
// (discover.mjs entries, their extents by intraprocedural walks), per-function features (call graph, indirect sites,
// MMIO / system-register / data references, kernel calls, strings), the module each function is attributed to, and
// per-module aggregates. Addresses in the records are disassembly notation (body offset + CODE_BASE) as hex strings.
import { decode, operands, constLoad, u32, CODE_BASE } from './isa.mjs';
import { discover, taskEntries, count } from './discover.mjs';
import { KERNEL_API, apiType, OBJECT_NAMES, OVERLAY_SEGMENTS, REGION_NAMES } from './e143.mjs';

const hx = (o) => '0x' + ((o + CODE_BASE) >>> 0).toString(16);
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const off = (h) => parseInt(h, 16) - CODE_BASE;
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

// The kernel object names: Map(type -> Map(id -> name)), id = cpu << 12 | index.
export function objectNames(img, base) {
  const out = new Map();
  for (let type = 0; type < 8; type++) {
    const m = new Map();
    for (let cpu = 0; cpu < 4; cpu++) {
      const p = u32(img, OBJECT_NAMES - base + 0x20 * type + 4 * cpu);
      if (p < base || p - base >= img.length) continue;
      for (let o = p - base, k = 0; k < 2000; k++, o += 26) {
        let name = '';
        for (let i = 0; i < 24 && img[o + i]; i++) name += String.fromCharCode(img[o + i]);
        const index = img[o + 24] | img[o + 25] << 8;
        if (!name || !/^[\x20-\x7e]+$/.test(name)) break;
        m.set(cpu << 12 | index, name);
      }
    }
    if (m.size) out.set(type, m);
  }
  return out;
}

// The overlay segment (1..10) of a body offset, 0 outside them.
const SEGS = OVERLAY_SEGMENTS.map(([a, b]) => [a - CODE_BASE, b - CODE_BASE]);
export const segOf = (o) => { for (let i = 0; i < SEGS.length; i++) if (o >= SEGS[i][0] && o < SEGS[i][1]) return i + 1; return 0; };
// The named region of an MMIO address, else its 64 KiB page: {start, end, name, src}.
export function regionKey(a) {
  for (const r of REGION_NAMES) if (a >= r.start && a < r.end) return r;
  const start = (a & ~0xffff) >>> 0;
  return { start, end: start + 0x10000, name: null, src: null };
}

// The map: {functions (records), modules (records), summary, state, owner (function index per instruction start),
// phaseOf, seedsTaken}.
export function staticMap(img, { base, seeds = [], log = () => {} }) {
  const N = img.length;
  const D = discover(img, { base, log, seeds });
  const { state, phaseOf } = D;
  const API = new Map(Object.entries(KERNEL_API).map(([k, v]) => [v, k]));
  const NAMES = objectNames(img, base);

  // ---- functions: entries sorted; an instruction belongs to the function whose walk reaches it (the nearest entry at
  // or below it when several do), else to the nearest entry below it (by address)
  const entryList = [...D.entries.keys()].sort((a, b) => a - b);
  const isEntry = new Uint8Array(N);
  for (const e of entryList) isEntry[e] = 1;
  const fidx = new Map(entryList.map((e, i) => [e, i]));
  const owner = new Int32Array(N).fill(-1);
  const ownKind = new Uint8Array(N);            // 1 walk, 2 by address
  const visit = new Int32Array(N).fill(-1);
  const better = (cur, cand, o) => {
    const ec = entryList[cur], en = entryList[cand];
    if (en <= o && ec <= o) return en > ec ? cand : cur;
    if (en <= o) return cand;
    if (ec <= o) return cur;
    return en < ec ? cand : cur;
  };
  const switchAt = D.switchSites;
  for (let fi = 0; fi < entryList.length; fi++) {
    const stack = [entryList[fi]];
    while (stack.length) {
      let o = stack.pop();
      for (;;) {
        if (o < 0 || o >= N || state[o] !== 1 || visit[o] === fi) break;
        if (isEntry[o] && o !== entryList[fi]) break;            // fall-through or jump into another function: its own
        visit[o] = fi;
        owner[o] = owner[o] === -1 ? fi : better(owner[o], fi, o);
        ownKind[o] = 1;
        const d = decode(img, o);
        if (d.kind === 'cond') stack.push(d.target);
        if (d.kind === 'jmp') { o = d.target; continue; }
        if (d.kind === 'ijmp') { const sw = switchAt.get(o); if (sw) for (const t of sw.targets) stack.push(t); break; }
        if (d.kind === 'ret' || d.kind === 'lra' || d.kind === 'stop') break;
        o += d.len;
      }
    }
  }
  let byAddress = 0, unowned = 0;
  for (let o = 0, k = 0, cur = -1; o < N; o++) {
    while (k < entryList.length && entryList[k] <= o) cur = k++;
    if (state[o] !== 1 || owner[o] !== -1) continue;
    if (cur >= 0) { owner[o] = cur; ownKind[o] = 2; byAddress++; } else unowned++;
  }
  log(`functions: ${entryList.length}; instructions owned by address (no walk reaches them): ${byAddress}; before the first entry: ${unowned}`);

  // ---- per-function features in one address-order pass
  const F = entryList.map((e) => ({
    entry: e, end: e, insns: 0, by_address: 0, ranges: [], callees: new Map(), tail: new Set(), ext_calls: new Map(), icall: 0, ijmp: 0, switches: 0,
    mmio: new Map(), sysreg: new Map(), data: new Map(), api: [], phases: [0, 0, 0, 0, 0],
  }));
  const branchTarget = new Uint8Array(N);
  for (let o = 0; o < N; o++) {
    if (state[o] !== 1) continue;
    const d = decode(img, o);
    if ((d.kind === 'cond' || d.kind === 'jmp') && d.target >= 0 && d.target < N) branchTarget[d.target] = 1;
  }
  for (const sw of switchAt.values()) for (const t of sw.targets) if (t < N) branchTarget[t] = 1;
  // constants in 0x8xxxxxxx / 0x9xxxxxxx that are not device addresses: add/cmp immediates, the float bit patterns
  // 0x9999999x (0.15, 0.3, 0.6 ...), sign masks 0x8000xxxx, any 0x8xxxxxxx loaded into a data register, 0x90000000
  const notAddress = (v, how) => how === 'add32' || how === 'cmp32' || (v >>> 4) === 0x9999999 || (v >>> 8) === 0x999999
    || (v >>> 16) === 0x8000 || v === 0x90000000 || (how === 'imm32d' && v >= 0x80000000 && v < 0x90000000);
  const regs = new Map();
  let lastFi = -1, prevTerm = true;
  for (let o = 0; o < N; o++) {
    if (state[o] !== 1) continue;
    const fi = owner[o];
    if (fi < 0) continue;
    const f = F[fi];
    const d = decode(img, o);
    if (fi !== lastFi || branchTarget[o] || prevTerm) regs.clear();
    lastFi = fi;
    f.insns++; if (ownKind[o] === 2) f.by_address++;
    f.phases[phaseOf[o]]++;
    const last = f.ranges[f.ranges.length - 1];
    if (last && last[1] === o) last[1] = o + d.len; else f.ranges.push([o, o + d.len]);
    if (o + d.len > f.end) f.end = o + d.len;
    for (const x of operands(img, o)) {
      const v = x.v >>> 0;
      if (x.how === 'abs16' && v >= 0x8000 && v < 0x9000) inc(f.sysreg, v);
      else if (notAddress(v, x.how)) { /* a float bit pattern or a mask, not an address */ }
      else if (v >= 0x90000000 && v < 0xa0000000) inc(f.mmio, v);
      else if (v >= 0x80000000 && v < 0x90000000 && (x.how === 'abs32' || x.how === 'imm32a' || x.how === 'd32')) inc(f.mmio, v);
      else if ((x.how === 'imm32a' || x.how === 'imm32d' || x.how === 'abs32') && v >= base && v - base < N) inc(f.data, v - base);
    }
    if (d.kind === 'call') {
      if (d.target >= 0 && d.target < N) {
        const callee = isEntry[d.target] ? fidx.get(d.target) : owner[d.target];
        if (callee !== undefined && callee >= 0) inc(f.callees, callee);
        const api = API.get(d.target);
        if (api) {
          const a0 = regs.get('d0');
          f.api.push([api, a0 === undefined ? null : a0, hx(o)]);
        }
      } else inc(f.ext_calls, (d.target + CODE_BASE) >>> 0);
    }
    if (d.kind === 'jmp' && d.target >= 0 && d.target < N && isEntry[d.target] && d.target !== f.entry) { const callee = fidx.get(d.target); f.tail.add(callee); inc(f.callees, callee); }
    if (d.kind === 'icall') f.icall++;
    if (d.kind === 'ijmp') { if (switchAt.has(o)) f.switches++; else f.ijmp++; }
    // the constants in d0..d3 / a0..a3 along the basic block, for the kernel calls' ids
    const c = constLoad(img, o);
    if (c) regs.set(c.reg, c.v);
    else if (img[o] === 0xfc && (img[o + 1] & 0xfc) === 0xa4) regs.set('d' + (img[o + 1] & 3), `mem:${h8(u32(img, o + 2))}`);   // mov (abs32),Dn
    else if (d.kind === 'call' || d.kind === 'icall') { regs.delete('d0'); regs.delete('d1'); regs.delete('a0'); regs.delete('a1'); }
    else {
      // any other write to d0/d1 kills the tracked value (conservative: the destination field of the common forms)
      const op = img[o];
      if (op >= 0x80 && op <= 0x8f) regs.delete('d' + (op & 3));
      else if (op >= 0x58 && op <= 0x5b) regs.delete('d' + (op & 3));
      else if (op >= 0x70 && op <= 0x7f) regs.delete('d' + ((op >> 2) & 3));
      else if (op >= 0xe0 && op <= 0xef) regs.delete('d' + (op & 3));
      else if (op >= 0x10 && op <= 0x1f) { /* extb .. exthu: the register keeps its role */ }
      else if (op >= 0xf0) { regs.delete('d0'); regs.delete('d1'); }
    }
    prevTerm = d.kind === 'jmp' || d.kind === 'ret' || d.kind === 'ijmp' || d.kind === 'lra' || d.kind === 'stop';
  }
  log('features done');

  // ---- strings at data references (C strings of printable ASCII, at least 4 characters)
  const strCache = new Map();
  function cstr(o) {
    if (strCache.has(o)) return strCache.get(o);
    let s = '', k = o;
    for (; k < N && k - o < 200; k++) { const c = img[k]; if (c === 0) break; if ((c < 0x20 && c !== 10 && c !== 9 && c !== 13) || c > 0x7e) { s = null; break; } s += String.fromCharCode(c); }
    const r = s !== null && img[k] === 0 && s.length >= 4 ? s : null;
    strCache.set(o, r);
    return r;
  }
  // data decoded as code: strings of 8+ characters that discovered code references and that the map also decodes
  const suspect = new Set();
  const DAC = (() => {
    let refs = 0, inCode = 0, bytesInCode = 0;
    const seen = new Set();
    for (const f of F) for (const o of f.data.keys()) {
      if (seen.has(o)) continue; seen.add(o);
      const s = cstr(o);
      if (s === null || s.length < 8) continue;
      refs++;
      let c = 0; for (let k = 0; k < s.length; k++) if (state[o + k] !== 0) { c++; if (state[o + k] === 1 && owner[o + k] >= 0) suspect.add(owner[o + k]); }
      if (c) { inCode++; bytesInCode += c; }
    }
    return { referenced_strings: refs, strings_overlapping_code: inCode, string_bytes_decoded_as_code: bytesInCode, suspect_functions: suspect.size };
  })();
  const FILE_RE = /^(?:[\w.\-]+\/)*([\w.\-+]+\.(?:c|cpp|cc|cxx))$/;
  const HDR_RE = /^(?:[\w.\-]+\/)*([\w.\-+]+\.(?:h|hpp))$/;
  const tasks = taskEntries(img, base);
  const taskAt = new Map();
  for (const t of tasks) { if (!taskAt.has(t.entry)) taskAt.set(t.entry, []); taskAt.get(t.entry).push({ cpu: t.cpu, id: '0x' + t.id.toString(16), name: NAMES.get(0)?.get(t.id) ?? null }); }

  const recs = F.map((f, i) => {
    const strings = [], files = [];
    for (const [o, n] of f.data) {
      const s = cstr(o);
      if (s === null) continue;
      const m = FILE_RE.exec(s);
      if (m) files.push([m[1], s, hx(o), n]); else if (!HDR_RE.test(s)) strings.push(s);
    }
    const mmio = [...f.mmio].sort((a, b) => a[0] - b[0]);
    const mmioRegions = new Set(mmio.map(([a]) => h8(regionKey(a).start)));
    return {
      entry: hx(f.entry), end: hx(f.end), insns: f.insns, insns_by_address: f.by_address,
      ranges: f.ranges.length > 1 ? f.ranges.map(([a, b]) => [hx(a), hx(b)]) : undefined,
      evidence: [...D.entries.get(f.entry)].sort(), pointer_quality: D.quality.get(f.entry) ?? undefined,
      discovery_phases: f.phases.slice(1),
      task: taskAt.get(f.entry) ?? undefined,
      callees: [...f.callees.keys()].sort((a, b) => a - b).map((c) => hx(entryList[c])),
      tail_calls: f.tail.size ? [...f.tail].map((c) => hx(entryList[c])) : undefined,
      external_calls: f.ext_calls.size ? [...f.ext_calls].map(([t, n]) => [h8(t), n]) : undefined,
      indirect_sites: { icall: f.icall, ijmp_unresolved: f.ijmp, switch: f.switches },
      mmio: mmio.map(([a, n]) => [h8(a), n]),
      mmio_regions: mmioRegions.size ? [...mmioRegions] : undefined,
      sysreg: f.sysreg.size ? [...f.sysreg].sort((a, b) => a[0] - b[0]).map(([a, n]) => ['0x' + a.toString(16), n]) : undefined,
      kernel: f.api.length ? f.api.map(([api, id, at]) => {
        const t = apiType(api);
        const name = typeof id === 'number' && t !== null ? NAMES.get(t)?.get(id) ?? null : null;
        return { api, id: typeof id === 'number' ? '0x' + (id >>> 0).toString(16) : id, name, at };
      }) : undefined,
      files: files.length ? files : undefined,
      strings: strings.length ? strings.slice(0, 12) : undefined,
      suspect: suspect.has(i) ? 'covers a string that code references (data decoded as code)' : undefined,
    };
  });
  const att = attribute(recs, tasks);
  const insnTotal = count(state);
  const byPhase = [0, 0, 0, 0, 0]; for (let o = 0; o < N; o++) if (state[o] === 1) byPhase[phaseOf[o]]++;
  const evidenceCount = {}; for (const s of D.entries.values()) { const k = [...s].sort().join('+'); evidenceCount[k] = (evidenceCount[k] ?? 0) + 1; }
  let codeBytes = 0; for (let o = 0; o < N; o++) if (state[o]) codeBytes++;
  const summary = {
    image_bytes: N, seeds_given: seeds.length, seeds_taken: D.seedsTaken.length,
    instructions: insnTotal, instructions_by_phase: { roots_calls: byPhase[1], ptr_imm: byPhase[2], ptr_data: byPhase[3], seeds: byPhase[4] },
    code_bytes: codeBytes, functions: entryList.length, entry_evidence: evidenceCount,
    instructions_owned_by_walk: insnTotal - byAddress - unowned, instructions_owned_by_address: byAddress, instructions_unowned: unowned,
    data_as_code_check: DAC,
    switch_tables: switchAt.size, unresolved_ijmp: D.unresolvedIjmp.size, labels: D.labels.size,
    rejected_candidates: Object.fromEntries([...D.rejected].sort((a, b) => b[1] - a[1])),
    external_call_targets: [...D.external].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t, n]) => [h8((t + CODE_BASE) >>> 0), n]),
    attribution: att.headline, contiguity: att.contiguity,
  };
  return { functions: att.functions, modules: att.modules, summary, state, owner, phaseOf, seedsTaken: D.seedsTaken };
}

// ---- module attribution: direct file / class strings, then the contiguity fill and call affinity at the edges of the
// runs left, repeated until stable; what is left forms gap pieces (gap@<first entry>), cut at holes of GAP_HOLE bytes
// without code and at the overlay segment boundaries. Then per module: ranges, attribution kinds, MMIO, system
// registers, kernel objects, strings, call fan-in / fan-out, cores, tasks.
const GAP_HOLE = 0x100;
const SANDWICH_MAX = 0x10000;         // a run of more than 64 KiB between two functions of one module stays a gap
function attribute(F, tasks) {
  const fByEntry = new Map(F.map((f, i) => [off(f.entry), i]));
  const FILE_OF = new Array(F.length).fill(null), KIND = new Array(F.length).fill(null);
  const knownFiles = new Map();            // basename -> full strings
  for (const f of F) if (f.files) for (const [b, full] of f.files) { if (!knownFiles.has(b)) knownFiles.set(b, new Set()); knownFiles.get(b).add(full); }
  const stem = new Map([...knownFiles.keys()].map((b) => [b.replace(/\.(c|cpp|cc|cxx)$/, ''), b]));
  let conflicts = 0;
  F.forEach((f, i) => {
    if (f.files) {
      const votes = new Map();
      for (const [b, , , n] of f.files) inc(votes, b, n);
      const best = [...votes].sort((a, b) => b[1] - a[1]);
      if (best.length > 1) conflicts++;
      FILE_OF[i] = best[0][0]; KIND[i] = 'direct-file';
    } else if (f.strings) {
      for (const s of f.strings) {
        const m = /([A-Za-z_][A-Za-z0-9_]*)::~?[A-Za-z_]\w*/.exec(s);
        if (m && stem.has(m[1])) { FILE_OF[i] = stem.get(m[1]); KIND[i] = 'direct-class'; break; }
      }
      // a class named in a string whose source file name the image does not hold: a module named after the class
      if (FILE_OF[i] === null) for (const s of f.strings) {
        const m = /\b([A-Z][A-Za-z0-9]*_?[A-Za-z0-9_]*)::~?[A-Za-z_]\w*/.exec(s);
        if (m && m[1].length >= 4) { FILE_OF[i] = `${m[1]} (class)`; KIND[i] = 'direct-class-name'; break; }
      }
    }
  });
  // the attribution's assumption, checked: runs of directly attributed functions in address order
  const order = F.map((f, i) => i).sort((a, b) => off(F[a].entry) - off(F[b].entry));
  const direct = order.filter((i) => FILE_OF[i] !== null && KIND[i] === 'direct-file');
  const runs = new Map();
  for (let k = 0; k < direct.length; k++) if (k === 0 || FILE_OF[direct[k]] !== FILE_OF[direct[k - 1]]) inc(runs, FILE_OF[direct[k]]);
  const runHist = {};
  for (const n of runs.values()) { const b = n === 1 ? '1' : n === 2 ? '2' : n <= 5 ? '3-5' : '6+'; runHist[b] = (runHist[b] ?? 0) + 1; }
  const worst = [...runs].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const span = new Map();
  for (const i of direct) { const s = span.get(FILE_OF[i]) ?? [Infinity, -1]; s[0] = Math.min(s[0], off(F[i].entry)); s[1] = Math.max(s[1], off(F[i].end)); span.set(FILE_OF[i], s); }
  let spanClean = 0, spanDirty = 0;
  const dirtySamples = [];
  {
    const entriesSorted = direct.map((i) => [off(F[i].entry), FILE_OF[i]]);
    for (const [m, [a, b]] of span) {
      const foreign = entriesSorted.filter(([e, mm]) => e > a && e < b && mm !== m);
      if (foreign.length) { spanDirty++; if (dirtySamples.length < 20) dirtySamples.push({ module: m, span: [hx(a), hx(b)], foreign: foreign.length, sample: [...new Set(foreign.map((x) => x[1]))].slice(0, 4) }); } else spanClean++;
    }
  }
  const sandwichSizes = new Map();
  // an unattributed run between two functions of the same module, at most SANDWICH_MAX apart, takes that module
  const sandwich = (kind) => {
    let k = 0, n = 0;
    while (k < order.length) {
      if (FILE_OF[order[k]] !== null) { k++; continue; }
      let j = k;
      while (j < order.length && FILE_OF[order[j]] === null) j++;
      const before = k > 0 ? FILE_OF[order[k - 1]] : null, after = j < order.length ? FILE_OF[order[j]] : null;
      const bytes = j < order.length && k > 0 ? off(F[order[j]].entry) - off(F[order[k - 1]].end) : Infinity;
      if (before !== null && before === after && bytes <= SANDWICH_MAX) {
        for (let q = k; q < j; q++) { FILE_OF[order[q]] = before; KIND[order[q]] = kind; n++; }
        inc(sandwichSizes, j - k <= 1 ? '1' : j - k <= 5 ? '2-5' : j - k <= 20 ? '6-20' : j - k <= 100 ? '21-100' : '101+');
      }
      k = j;
    }
    return n;
  };
  // call affinity: the first (last) function of an unattributed run between modules A and B whose direct call edges
  // (either way) to attributed functions reach A (B) only takes that module, growing inward (static functions are
  // called from their own unit). Acting anywhere in a run cascaded (a kernel wrapper called from per_acc.c pulled the
  // whole kernel area into per_acc.c), so only the edges.
  const callers = F.map(() => []);
  F.forEach((f, i) => { for (const c of f.callees) { const j = fByEntry.get(off(c)); if (j !== undefined) callers[j].push(i); } });
  const affinity = () => {
    let k = 0, n = 0;
    while (k < order.length) {
      if (FILE_OF[order[k]] !== null) { k++; continue; }
      let j = k;
      while (j < order.length && FILE_OF[order[j]] === null) j++;
      const before = k > 0 ? FILE_OF[order[k - 1]] : null, after = j < order.length ? FILE_OF[order[j]] : null;
      const ties = (i) => {
        const seen = new Map();
        for (const c of F[i].callees) { const x = fByEntry.get(off(c)); if (x !== undefined && FILE_OF[x] !== null) inc(seen, FILE_OF[x]); }
        for (const x of callers[i]) if (FILE_OF[x] !== null) inc(seen, FILE_OF[x]);
        return seen;
      };
      let lo = k, hi = j - 1;
      while (lo <= hi && before !== null) {
        const t = ties(order[lo]);
        if (t.size === 1 && t.has(before)) { FILE_OF[order[lo]] = before; KIND[order[lo]] = 'call-affinity'; n++; lo++; } else break;
      }
      while (hi >= lo && after !== null) {
        const t = ties(order[hi]);
        if (t.size === 1 && t.has(after)) { FILE_OF[order[hi]] = after; KIND[order[hi]] = 'call-affinity'; n++; hi--; } else break;
      }
      k = j;
    }
    return n;
  };
  const fillLog = [['contiguity', sandwich('contiguity')]];
  for (let round = 0; round < 8; round++) {
    const a = affinity(), c = sandwich('contiguity');
    fillLog.push([`affinity round ${round}`, a, c]);
    if (!a && !c) break;
  }
  const gapOf = new Array(F.length).fill(null);
  {
    let k = 0;
    while (k < order.length) {
      if (FILE_OF[order[k]] !== null) { k++; continue; }
      let j = k;
      while (j < order.length && FILE_OF[order[j]] === null) j++;
      const before = k > 0 ? FILE_OF[order[k - 1]] : null, after = j < order.length ? FILE_OF[order[j]] : null;
      let start = k;
      for (let q = k; q < j; q++) {
        const cut = q + 1 === j || off(F[order[q + 1]].entry) - off(F[order[q]].end) >= GAP_HOLE || segOf(off(F[order[q + 1]].entry)) !== segOf(off(F[order[q]].entry));
        if (!cut) continue;
        const name = `gap@${F[order[start]].entry}`;
        for (let r = start; r <= q; r++) { gapOf[order[r]] = { name, before, after }; KIND[order[r]] = 'gap'; }
        start = q + 1;
      }
      k = j;
    }
  }
  const moduleOf = F.map((f, i) => FILE_OF[i] ?? gapOf[i].name);
  const kindCount = {}; for (const k of KIND) kindCount[k] = (kindCount[k] ?? 0) + 1;
  const kindInsns = {}; F.forEach((f, i) => { kindInsns[KIND[i]] = (kindInsns[KIND[i]] ?? 0) + f.insns; });

  // cores: the forward closure of the direct call graph from each core's static task entries
  const fIndexOfEntryHex = new Map(F.map((f, i) => [f.entry, i]));
  const callees = F.map((f) => f.callees.map((c) => fIndexOfEntryHex.get(c)).filter((x) => x !== undefined));
  const coreMask = new Uint8Array(F.length);
  for (const t of tasks) {
    const fi = fByEntry.get(t.entry);
    if (fi === undefined) continue;
    const stack = [fi], bit = 1 << t.cpu;
    while (stack.length) { const x = stack.pop(); if (coreMask[x] & bit) continue; coreMask[x] |= bit; for (const c of callees[x]) stack.push(c); }
  }

  const functions = F.map((f, i) => ({
    entry: f.entry, end: f.end, insns: f.insns, module: moduleOf[i], attribution: KIND[i],
    gap_neighbours: gapOf[i] ? [gapOf[i].before, gapOf[i].after] : undefined,
    evidence: f.evidence, pointer_quality: f.pointer_quality, discovery_phases: f.discovery_phases, insns_by_address: f.insns_by_address || undefined,
    ranges: f.ranges, task: f.task,
    cores: coreMask[i] ? [0, 1, 2, 3].filter((c) => coreMask[i] & (1 << c)) : undefined,
    callees: f.callees, tail_calls: f.tail_calls, external_calls: f.external_calls, indirect_sites: f.indirect_sites,
    mmio: f.mmio, mmio_regions: f.mmio_regions, sysreg: f.sysreg, kernel: f.kernel, files: f.files, strings: f.strings, suspect: f.suspect,
  }));

  // ---- modules, in address order of their first range
  const M = new Map();
  F.forEach((f, i) => {
    let m = M.get(moduleOf[i]);
    if (!m) M.set(moduleOf[i], m = { name: moduleOf[i], fis: [] });
    m.fis.push(i);
  });
  const fanIn = new Map();
  for (let i = 0; i < F.length; i++) for (const c of callees[i]) { const a = moduleOf[i], b = moduleOf[c]; if (a !== b) { if (!fanIn.has(b)) fanIn.set(b, new Map()); inc(fanIn.get(b), a); } }
  const modules = [];
  for (const m of M.values()) {
    const fis = m.fis.sort((a, b) => off(F[a].entry) - off(F[b].entry));
    const ranges = [];
    for (const i of fis) {
      const a = off(F[i].entry), b = off(F[i].end);
      const last = ranges[ranges.length - 1];
      if (last && a <= last[1] + 16) last[1] = Math.max(last[1], b); else ranges.push([a, b]);
    }
    let insns = 0;
    const kinds = {}, mmio = new Map(), sysreg = new Map(), kern = new Map(), strings = new Set(), fanOut = new Map(), cores = new Map(), tasksIn = [];
    for (const i of fis) {
      const f = F[i];
      insns += f.insns;
      kinds[KIND[i]] = (kinds[KIND[i]] ?? 0) + 1;
      for (const [a, n] of f.mmio) inc(mmio, h8(regionKey(parseInt(a, 16) >>> 0).start), n);
      if (f.sysreg) for (const [a, n] of f.sysreg) inc(sysreg, a, n);
      if (f.kernel) for (const k of f.kernel) inc(kern, `${k.api}(${k.id ?? '?'}${k.name ? ' ' + k.name : ''})`);
      if (f.strings) for (const s of f.strings) if (strings.size < 40) strings.add(s);
      for (const c of callees[i]) { const mm = moduleOf[c]; if (mm !== m.name) inc(fanOut, mm); }
      if (coreMask[i]) for (let c = 0; c < 4; c++) if (coreMask[i] & (1 << c)) inc(cores, c);
      if (f.task) for (const t of f.task) tasksIn.push({ ...t, entry: f.entry });
    }
    const fin = fanIn.get(m.name);
    const gap = m.name.startsWith('gap@');
    modules.push({
      name: m.name, kind: gap ? 'gap' : 'source', overlay_segments: [...new Set(fis.map((i) => segOf(off(F[i].entry))))].sort((a, b) => a - b),
      paths: [...new Set(fis.flatMap((i) => (F[i].files ?? []).map((x) => x[1])))].slice(0, 4),
      gap_neighbours: gap ? [gapOf[fis[0]].before, gapOf[fis[0]].after] : undefined,
      ranges: ranges.map(([a, b]) => [hx(a), hx(b)]),
      functions: fis.length, attribution: kinds, insns,
      mmio: [...mmio].sort((a, b) => b[1] - a[1]).map(([region, refs]) => ({ region, refs })),
      sysreg: sysreg.size ? [...sysreg].sort((a, b) => b[1] - a[1]).slice(0, 12) : undefined,
      kernel_objects: kern.size ? [...kern].sort((a, b) => b[1] - a[1]).slice(0, 30) : undefined,
      sample_strings: [...strings].slice(0, 8),
      fan_in: fin ? [...fin].sort((a, b) => b[1] - a[1]).slice(0, 10) : [], fan_in_modules: fin ? fin.size : 0,
      fan_out: [...fanOut].sort((a, b) => b[1] - a[1]).slice(0, 10), fan_out_modules: fanOut.size,
      cores: cores.size ? Object.fromEntries([...cores].sort((a, b) => a[0] - b[0]).map(([k, v]) => [`cpu${k}`, v])) : undefined,
      tasks: tasksIn.length ? tasksIn : undefined,
    });
  }
  modules.sort((a, b) => parseInt(a.ranges[0][0], 16) - parseInt(b.ranges[0][0], 16));
  const headline = {
    functions: F.length, instructions: F.reduce((s, f) => s + f.insns, 0),
    modules: modules.length, source_modules: modules.filter((m) => m.kind === 'source').length, gap_clusters: modules.filter((m) => m.kind === 'gap').length,
    attribution_functions: kindCount, attribution_instructions: kindInsns, fill: fillLog,
  };
  const contiguity = {
    note: 'directly attributed functions (file string) in address order; a module that forms one run is laid out contiguously as far as its direct functions show',
    modules_direct: runs.size, runs_per_module_histogram: runHist, most_split: worst,
    spans_without_foreign_direct_function: spanClean, spans_with_foreign_direct_functions: spanDirty, span_samples: dirtySamples,
    functions_with_two_file_strings: conflicts,
    contiguity_fills_by_run_length: Object.fromEntries(sandwichSizes),
  };
  return { functions, modules, headline, contiguity };
}
