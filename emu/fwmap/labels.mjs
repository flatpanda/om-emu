// The module labels (fwmap/E143.labels.json) and bin/fwmap.mjs report's aggregation by subsystem block.
//
// Labels are keyed by the static pass's module names. Per block, two views: primary (each labelled module whole under
// its block) and parts-adjusted (each function under the block of the part whose range holds its entry, else its
// module's), which is the main table. "Gap-relevant unexecuted" sums insns - executed insns over the functions of
// modules (or parts) labelled gap_relevant: an upper bound on code a native path would still have to reach. The CPU
// split is per function by its static cores (cpu0only, cpu0shared: CPU 0 and another, cpu1-3, none). Modules without
// a label count under the block '(unlabelled)', so the totals are the map's.
import fs from 'node:fs';

export const UNLABELLED = '(unlabelled)';
export const CORE_CLASSES = ['cpu0only', 'cpu0shared', 'cpu1-3', 'none'];

export function loadLabels(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.format !== 'fwmap-labels/1') throw new Error(`${file}: format ${doc.format}, want fwmap-labels/1`);
  return doc;
}

const coreClass = (cores) => {
  const c = new Set(cores ?? []);
  return c.has(0) ? (c.size === 1 ? 'cpu0only' : 'cpu0shared') : c.size ? 'cpu1-3' : 'none';
};
const row = () => ({ modules: 0, functions: 0, insns: 0, executed: 0, gap_insns: 0, gap_unexecuted: 0,
  cores: Object.fromEntries(CORE_CLASSES.map((k) => [k, { insns: 0, executed: 0, gap_unexecuted: 0 }])) });

// functions: [{entry (hex), insns, executed_insns, cores, module}]; modules: [{name, insns, executed_insns}];
// labels: the labels document. Returns {primary, parts: {block: row}, total, unlabelled: [module], stale: [name]}.
export function aggregate(functions, modules, labels) {
  const L = labels.modules;
  const byModule = new Map();
  for (const f of functions) { if (!byModule.has(f.module)) byModule.set(f.module, []); byModule.get(f.module).push(f); }
  const primary = {}, parts = {}, total = row();
  const named = new Map();               // block -> Set of modules with a function in it (parts view)
  const unlabelled = [];
  for (const m of modules) {
    const l = L[m.name] ?? null;
    if (l === null) unlabelled.push(m);
    const block = l ? l.block : UNLABELLED, gr = l ? !!l.gap_relevant : false;
    const p = primary[block] ??= row();
    p.modules++; p.insns += m.insns; p.executed += m.executed_insns;
    if (gr) { p.gap_insns += m.insns; p.gap_unexecuted += m.insns - m.executed_insns; }
    const ranges = (l?.parts ?? []).map((q) => { const [a, b] = q.range.split('..').map((x) => parseInt(x, 16)); return [a, b, q.block, q.gap_relevant === undefined ? gr : !!q.gap_relevant]; });
    for (const f of byModule.get(m.name) ?? []) {
      const e = parseInt(f.entry, 16);
      let b2 = block, g2 = gr;
      for (const [a, b, pb, pg] of ranges) if (a <= e && e < b) { b2 = pb; g2 = pg; break; }
      const c = coreClass(f.cores);
      for (const r of [parts[b2] ??= row(), total]) {
        r.functions++; r.insns += f.insns; r.executed += f.executed_insns;
        r.cores[c].insns += f.insns; r.cores[c].executed += f.executed_insns;
        if (g2) { r.gap_insns += f.insns; r.gap_unexecuted += f.insns - f.executed_insns; r.cores[c].gap_unexecuted += f.insns - f.executed_insns; }
      }
      if (!named.has(b2)) named.set(b2, new Set());
      named.get(b2).add(m.name);
    }
  }
  for (const [b, r] of Object.entries(parts)) r.modules = primary[b]?.modules ?? 0;      // module counts: primary keys
  total.modules = modules.length;
  const names = new Set(modules.map((m) => m.name));
  const stale = Object.keys(L).filter((n) => !names.has(n));
  const order = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].gap_unexecuted - a[1].gap_unexecuted || b[1].insns - a[1].insns));
  return { parts: order(parts), primary: order(primary), total, unlabelled, stale, modules_in_block: Object.fromEntries([...named].map(([b, s]) => [b, s.size])) };
}
