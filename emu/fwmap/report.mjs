// bin/fwmap.mjs report: the static map joined with the coverage of the last cover run and the module labels. Per
// function and per module what ran (executed instruction starts, entered or not, the direct call sites that ran, the
// stand-ins that fired there), per MMIO region emu's model status (the live createMachine() region table and the
// board's stub pages), the ranked lists of what never ran, and the aggregation by subsystem block (labels.mjs).
import { decode, CODE_BASE } from './isa.mjs';
import { regionKey } from './static.mjs';
import { aggregate, CORE_CLASSES, UNLABELLED } from './labels.mjs';

const off = (h) => parseInt(h, 16) - CODE_BASE;
const hx = (o) => '0x' + ((o + CODE_BASE) >>> 0).toString(16);
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

// emu's view of device space: the 4 KiB pages of 0x80000000..0x9fffffff a modelled device (or lab RAM) covers in a
// live machine's region table, and the board's stub pages (allowed when a lab opts in).
async function emuPages(img) {
  const { createMachine } = await import('../src/machine.mjs');
  const mem = await import('../src/core/mem.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  createMachine({ rom: img });
  const pages = new Map();
  for (let a = 0x80000000; a < 0xa0000000; a += 0x1000) {
    const r = mem.findRegion(a) ?? mem.findRegion(a + 0x800) ?? mem.findRegion(a + 0xffc);
    if (r && !/lab-stub-window/.test(r.name)) pages.set(a >>> 0, r.name);
  }
  return { pages, stub: new Set(BOARD.stub_pages.map((x) => x >>> 0)) };
}

// img: the main block; base: the run-time image base; st: the static outputs {functions, modules, summary, state,
// owner, phaseOf}; executed: Uint8Array per body offset (alias bits), outside: executed offsets past the block;
// groups: the cover run's groups document (or null); labels: the labels document; top: the lists' length.
export async function buildReport({ img, base, st, executed, outside = 0, groups, labels, top = 40 }) {
  const N = img.length;
  const F = st.functions, { state, owner, phaseOf } = st;
  const fByEntry = new Map(F.map((f, i) => [off(f.entry), i]));

  // ---- coverage per function
  let execTotal = 0;
  const execByPhase = [0, 0, 0, 0, 0], execNotCode = { 0: 0, 2: 0 };
  const fExec = new Int32Array(F.length);
  for (let o = 0; o < N; o++) {
    if (!executed[o]) continue;
    execTotal++;
    if (state[o] !== 1) { execNotCode[state[o]]++; continue; }
    execByPhase[phaseOf[o]]++;
    if (owner[o] >= 0) fExec[owner[o]]++;
  }
  // functions whose direct call (or tail jump) site ran
  const calledByExecuted = new Map();
  for (let o = 0; o < N; o++) {
    if (!executed[o] || state[o] !== 1) continue;
    const d = decode(img, o);
    if (!(d.kind === 'call' || d.kind === 'jmp') || d.target < 0 || d.target >= N) continue;
    if (d.kind === 'jmp' && !fByEntry.has(d.target)) continue;
    const fi = fByEntry.has(d.target) ? fByEntry.get(d.target) : owner[d.target];
    if (fi >= 0) { if (!calledByExecuted.has(fi)) calledByExecuted.set(fi, []); calledByExecuted.get(fi).push(hx(o)); }
  }
  // for each function, the entered functions that call it directly (the call site itself may not have run)
  const calledByEnteredFn = new Map();
  F.forEach((f, i) => { if (!fExec[i]) return; for (const c of f.callees) { const j = fByEntry.get(off(c)); if (j !== undefined && j !== i) { if (!calledByEnteredFn.has(j)) calledByEnteredFn.set(j, []); calledByEnteredFn.get(j).push(f.entry); } } });

  // ---- stand-ins: the hooks that fired in the cover run (run-time pcs), by the function they act on
  const standIns = new Map(), hookRows = [];
  const add = (fi, r) => { if (!standIns.has(fi)) standIns.set(fi, []); standIns.get(fi).push(r); };
  for (const h of groups?.stubs ?? []) {
    const rt = parseInt(h.pc, 16) >>> 0, o = (rt - base) >>> 0;
    const r = { name: h.name, runtime: h8(rt), fires: h.fires, groups: h.groups };
    if (o < N) {
      r.at = hx(o);
      const fi = state[o] === 1 ? owner[o] : -1, d = state[o] === 1 ? decode(img, o) : null;
      if (fByEntry.has(o)) {
        const fe = fByEntry.get(o);
        r.kind = fExec[fe] ? 'entry hook; the function also ran natively (observer or conditional stand-in)' : 'entry hook; the function never ran natively (replaced)';
        r.function = hx(o); add(fe, r);
      } else if (d && d.kind === 'call' && d.target >= 0 && d.target < N) {
        r.kind = 'call site (callee skipped or answered here)';
        r.function = fi >= 0 ? F[fi].entry : null;
        const ci = fByEntry.has(d.target) ? fByEntry.get(d.target) : owner[d.target];
        r.callee = ci >= 0 ? F[ci].entry : hx(d.target);
        if (ci >= 0) add(ci, { ...r, via: 'call site' });
        if (fi >= 0) add(fi, r);
      } else {
        r.kind = state[o] === 1 ? 'mid-function (observer, return address or partial stand-in)' : 'not an instruction of the map';
        r.function = fi >= 0 ? F[fi].entry : null;
        if (fi >= 0) add(fi, r);
      }
    } else r.kind = 'outside the image (lab trampoline or the local window)';
    hookRows.push(r);
  }

  // ---- MMIO status
  const emu = await emuPages(img);
  const pageStatus = (p) => emu.pages.has(p) ? `modelled:${emu.pages.get(p)}` : emu.stub.has(p) ? 'lab-stub' : 'unmodelled';
  const regions = new Map();
  const fisOf = new Map();
  F.forEach((f, i) => { if (!fisOf.has(f.module)) fisOf.set(f.module, []); fisOf.get(f.module).push(i); });
  for (const fis of fisOf.values()) for (const i of fis) {
    const f = F[i];
    for (const [a, n] of f.mmio) {
      const v = parseInt(a, 16) >>> 0, rg = regionKey(v);
      let R = regions.get(rg.start);
      if (!R) regions.set(rg.start, R = { region: rg, modules: new Map(), functions: new Set(), executed: new Set(), refs: 0, pages: new Map() });
      inc(R.modules, f.module, n); R.functions.add(i); R.refs += n; inc(R.pages, (v & ~0xfff) >>> 0, n);
      if (fExec[i]) R.executed.add(i);
    }
  }
  for (const R of regions.values()) {
    const st2 = new Map();
    for (const [p, n] of R.pages) inc(st2, pageStatus(p), n);
    R.status = [...st2].sort((a, b) => b[1] - a[1]);
    const kinds = new Set([...st2.keys()].map((k) => k.split(':')[0]));
    R.summary = kinds.size === 1 ? [...kinds][0] : 'mixed';
  }

  // ---- functions
  const fx = F.map((f, i) => ({
    ...f, executed_insns: fExec[i], entered: fExec[i] > 0,
    executed_call_sites: calledByExecuted.has(i) ? calledByExecuted.get(i).slice(0, 5) : undefined,
    entered_callers: !fExec[i] && calledByEnteredFn.has(i) ? calledByEnteredFn.get(i).slice(0, 5) : undefined,
    stand_in: standIns.has(i) ? standIns.get(i).map((r) => ({ name: r.name, at: r.at, kind: r.kind, fires: r.fires, ...(r.via ? { via: r.via, caller: r.function } : {}) })) : undefined,
  }));

  // ---- modules (the static records with the coverage in)
  const modules = st.modules.map((m) => {
    const fis = fisOf.get(m.name);
    let exec = 0, entered = 0, calledNotEntered = 0;
    const stand = [];
    for (const i of fis) {
      exec += fExec[i]; if (fExec[i]) entered++;
      if (!fExec[i] && calledByEnteredFn.has(i)) calledNotEntered++;
      if (standIns.has(i)) for (const s of standIns.get(i)) stand.push({ name: s.name, at: s.at, kind: s.kind, fires: s.fires, function: F[i].entry, ...(s.via ? { via: s.via } : {}) });
    }
    const mmio = m.mmio.map((x) => { const R = regions.get(parseInt(x.region, 16) >>> 0); return { region: x.region, name: R.region.name, refs: x.refs, emu: R.summary }; });
    return {
      name: m.name, kind: m.kind, overlay_segments: m.overlay_segments, paths: m.paths, gap_neighbours: m.gap_neighbours, ranges: m.ranges,
      functions: m.functions, attribution: m.attribution, insns: m.insns,
      executed_insns: exec, executed_share: m.insns ? +(exec / m.insns).toFixed(4) : 0, functions_entered: entered, entered: entered > 0,
      functions_not_entered_with_entered_caller: calledNotEntered,
      mmio, touches_unmodelled_mmio: mmio.some((x) => x.emu === 'unmodelled' || x.emu === 'mixed'),
      sysreg: m.sysreg, kernel_objects: m.kernel_objects, sample_strings: m.sample_strings,
      fan_in: m.fan_in, fan_in_modules: m.fan_in_modules, fan_out: m.fan_out, fan_out_modules: m.fan_out_modules,
      stand_ins: stand.length ? stand : undefined, cores: m.cores, tasks: m.tasks,
    };
  });
  const byName = new Map(modules.map((m) => [m.name, m]));
  const totalInsns = st.summary.attribution.instructions;
  let execInMap = 0; for (let i = 0; i < F.length; i++) execInMap += fExec[i];
  const headline = {
    functions: F.length, instructions: totalInsns,
    modules: modules.length, source_modules: modules.filter((m) => m.kind === 'source').length, gap_clusters: modules.filter((m) => m.kind === 'gap').length,
    executed_instructions: execInMap, executed_share: +(execInMap / totalInsns).toFixed(4),
    functions_entered: fx.filter((f) => f.entered).length,
    modules_entered: modules.filter((m) => m.entered).length, source_modules_entered: modules.filter((m) => m.entered && m.kind === 'source').length,
    attribution_functions: st.summary.attribution.attribution_functions, attribution_instructions: st.summary.attribution.attribution_instructions,
  };

  const regionDoc = [...regions.values()].sort((a, b) => a.region.start - b.region.start).map((R) => ({
    region: h8(R.region.start), end: h8(R.region.end), name: R.region.name, source: R.region.src ?? undefined,
    refs: R.refs, functions: R.functions.size, functions_executed: R.executed.size,
    modules: [...R.modules].sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ module: m, refs: n, entered: !!byName.get(m)?.entered })),
    emu: R.summary, emu_pages: R.status,
    pages_4k: [...R.pages].sort((a, b) => a[0] - b[0]).slice(0, 64).map(([p, n]) => [h8(p), n, pageStatus(p).split(':')[0]]),
  }));

  // ---- ranked lists
  const byInsns = (a, b) => b.insns - a.insns;
  const notEntered = modules.filter((m) => !m.entered);
  const lists = {
    a_largest_not_entered: notEntered.slice().sort(byInsns).slice(0, top).map((m) => ({ name: m.name, kind: m.kind, insns: m.insns, functions: m.functions, first: m.ranges[0][0], neighbours: m.gap_neighbours, mmio: m.mmio.slice(0, 3).map((x) => x.name ?? x.region), cores: m.cores })),
    b_called_by_entered_not_entered: notEntered.filter((m) => m.functions_not_entered_with_entered_caller > 0).sort(byInsns).slice(0, top).map((m) => {
      const fis = fisOf.get(m.name).filter((i) => calledByEnteredFn.has(i));
      const callerMods = new Map();
      for (const i of fis) for (const c of calledByEnteredFn.get(i)) inc(callerMods, F[fByEntry.get(off(c))].module);
      return { name: m.name, kind: m.kind, insns: m.insns, functions: m.functions, called: fis.length,
        caller_modules: [...callerMods].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([x, n]) => `${x} (${n})`),
        sample: fis.slice(0, 3).map((i) => ({ fn: F[i].entry, from: calledByEnteredFn.get(i).slice(0, 2), executed_call_site: calledByExecuted.has(i), stand_in: standIns.has(i) ? standIns.get(i).map((s) => s.name) : undefined })) };
    }),
    functions_bypassed: F.map((f, i) => i).filter((i) => !fExec[i] && calledByExecuted.has(i)).map((i) => ({ fn: F[i].entry, module: F[i].module, insns: F[i].insns, call_sites: calledByExecuted.get(i).slice(0, 3), stand_in: standIns.has(i) ? [...new Set(standIns.get(i).map((s) => s.name))] : undefined })),
    c_not_entered_unmodelled_mmio: notEntered.filter((m) => m.touches_unmodelled_mmio).sort(byInsns).slice(0, top).map((m) => ({ name: m.name, kind: m.kind, insns: m.insns, functions: m.functions,
      unmodelled: m.mmio.filter((x) => x.emu !== 'modelled').slice(0, 5).map((x) => `${x.name ?? x.region} (${x.refs})`) })),
    hooks: hookRows,
  };
  const validation = {
    contiguity: st.summary.contiguity,
    coverage: { executed_in_image: execTotal, executed_not_instruction_start_in_map: execNotCode[0] + execNotCode[2], of_which_not_code: execNotCode[0],
      of_which_instruction_interior: execNotCode[2], executed_outside_image: outside,
      executed_by_discovery_phase: { roots_calls: execByPhase[1], ptr_imm: execByPhase[2], ptr_data: execByPhase[3], seeds: execByPhase[4] } },
  };
  const blocks = aggregate(fx, modules, labels);
  const outside_normal = new Set(labels.outside_normal_use ?? []);
  blocks.normal_use = Object.entries(blocks.parts).filter(([b]) => !outside_normal.has(b)).reduce((s, [, r]) => ({ insns: s.insns + r.insns, executed: s.executed + r.executed, gap_unexecuted: s.gap_unexecuted + r.gap_unexecuted }), { insns: 0, executed: 0, gap_unexecuted: 0 });
  blocks.outside_normal_use = [...outside_normal];
  return { functions: fx, modules, headline, regions: regionDoc, lists, validation, blocks };
}

// ---- the report as Markdown
const n = (x) => x.toLocaleString('en-US');
const pct = (a, b) => `${b ? (100 * a / b).toFixed(2) : '0.00'}%`;
const esc = (s) => String(s ?? '').replaceAll('|', '\\|');
export function markdown(r, { summary, groups, cover, model, rows = 25 }) {
  const hd = r.headline, B = r.blocks, T = hd.instructions;
  const nb = (m) => (m?.kind === 'gap' && m.gap_neighbours ? ` (between ${m.gap_neighbours[0] ?? 'start'} and ${m.gap_neighbours[1] ?? 'end'})` : '');
  const mod = new Map(r.modules.map((m) => [m.name, m]));
  const blockRow = (b, x, k) => `| ${k} | ${esc(b)} | ${n(x.modules)} | ${n(x.insns)} | ${pct(x.insns, T)} | ${n(x.executed)} | ${pct(x.executed, x.insns)} | ${n(x.gap_unexecuted)} |`;
  const out = [];
  out.push(`# fwmap report: ${model}`, '');
  out.push(`Generated by \`node emu/bin/fwmap.mjs report\` (emu/README.md, "The firmware map"). Addresses are disassembly notation (body offset + 0x50000000).`, '');
  out.push('## Headline', '', '| | |', '|---|---|');
  out.push(`| functions | ${n(hd.functions)} |`);
  out.push(`| instructions in the map | ${n(hd.instructions)} (${n(summary.code_bytes)} code bytes of ${n(summary.image_bytes)}) |`);
  out.push(`| modules | ${n(hd.modules)}: ${n(hd.source_modules)} named + ${n(hd.gap_clusters)} gap pieces |`);
  out.push(`| instructions executed | ${n(hd.executed_instructions)} = **${pct(hd.executed_instructions, T)}** of the map |`);
  out.push(`| normal-use instructions executed | ${n(B.normal_use.executed)} of ${n(B.normal_use.insns)} = ${pct(B.normal_use.executed, B.normal_use.insns)} (without ${B.outside_normal_use.join(', ')}) |`);
  out.push(`| functions entered | ${n(hd.functions_entered)} of ${n(hd.functions)} (${pct(hd.functions_entered, hd.functions)}) |`);
  out.push(`| modules entered | ${n(hd.modules_entered)} of ${n(hd.modules)}; named modules ${n(hd.source_modules_entered)} of ${n(hd.source_modules)} |`);
  out.push(`| gap-relevant unexecuted | ${n(B.total.gap_unexecuted)} (${pct(B.total.gap_unexecuted, T)} of the map) |`, '');
  if (groups) {
    out.push('## Coverage run', '');
    if (cover?.parts?.length) out.push(cover.parts.map((p) => `\`node ${p.argv.join(' ')}\`: exit ${p.rc}, ${p.seconds} s`).join('; ') + '.', '');
    out.push(`${n(groups.threads)} node threads; ${n(groups.executed_all)} executed instruction starts in the block (${n(groups.executed_without_mutants)} without the mutant and fault-injection runs).`, '');
    out.push('| group | threads | executed |', '|---|---|---|');
    for (const [g, v] of Object.entries(groups.groups)) out.push(`| ${g} | ${v.threads} | ${n(v.executed)} |`);
    out.push('');
  }
  out.push('## By block (parts-adjusted; sorted by gap-relevant unexecuted)', '');
  out.push('Module counts are primary-key counts. Gap-relevant unexecuted: insns minus executed over the functions of modules (or parts) labelled gap_relevant, an upper bound on code a native path would still have to reach.', '');
  out.push('| # | block | modules | insns | share of map | executed | executed share | gap-relevant unexecuted |', '|---|---|---|---|---|---|---|---|');
  Object.entries(B.parts).forEach(([b, x], k) => out.push(blockRow(b, x, k + 1)));
  out.push(blockRow('total', B.total, ''), '');
  out.push('## By core (function level, static task reachability; insns / executed / gap-relevant unexecuted)', '');
  out.push(`| block | ${CORE_CLASSES.join(' | ')} |`, `|---|${CORE_CLASSES.map(() => '---').join('|')}|`);
  for (const [b, x] of [...Object.entries(B.parts), ['total', B.total]]) out.push(`| ${esc(b)} | ${CORE_CLASSES.map((c) => `${n(x.cores[c].insns)} / ${n(x.cores[c].executed)} / ${n(x.cores[c].gap_unexecuted)}`).join(' | ')} |`);
  out.push('');
  out.push('## Labels', '');
  out.push(`${n(r.modules.length - B.unlabelled.length)} of ${n(r.modules.length)} modules carry a label. Modules without one (counted under ${UNLABELLED}): ${B.unlabelled.length ? B.unlabelled.map((m) => `${esc(m.name)} (${n(m.insns)} insns, ${n(m.executed_insns)} executed)`).join(', ') : 'none'}. Labels whose module the map does not have: ${B.stale.length ? B.stale.map(esc).join(', ') : 'none'}.`, '');
  out.push(`## (a) Largest modules never entered (top ${rows})`, '', '| # | module | kind | insns | functions | MMIO (top) | cores |', '|---|---|---|---|---|---|---|');
  r.lists.a_largest_not_entered.slice(0, rows).forEach((x, i) => out.push(`| ${i + 1} | ${esc(x.name)}${esc(nb(mod.get(x.name)))} | ${x.kind} | ${n(x.insns)} | ${x.functions} | ${esc((x.mmio ?? []).join(', '))} | ${x.cores ? Object.keys(x.cores).join(' ') : ''} |`));
  out.push('', `## (b) Modules not entered with a direct caller that was entered (top ${rows})`, '', '| # | module | insns | functions called | caller modules (edges) |', '|---|---|---|---|---|');
  r.lists.b_called_by_entered_not_entered.slice(0, rows).forEach((x, i) => out.push(`| ${i + 1} | ${esc(x.name)}${esc(nb(mod.get(x.name)))} | ${n(x.insns)} | ${x.called} | ${esc(x.caller_modules.join(', '))} |`));
  out.push('', 'Functions whose direct call site ran but which never ran natively (stand-ins and skipped calls):', '', '| function | module | insns | executed call sites | stand-in |', '|---|---|---|---|---|');
  for (const x of r.lists.functions_bypassed) out.push(`| ${x.fn} | ${esc(x.module)} | ${x.insns} | ${x.call_sites.join(', ')} | ${esc((x.stand_in ?? []).join(', '))} |`);
  out.push('', `## (c) Modules never entered that touch MMIO emu does not model (top ${rows})`, '', '| # | module | insns | unmodelled regions (refs) |', '|---|---|---|---|');
  r.lists.c_not_entered_unmodelled_mmio.slice(0, rows).forEach((x, i) => out.push(`| ${i + 1} | ${esc(x.name)}${esc(nb(mod.get(x.name)))} | ${n(x.insns)} | ${esc(x.unmodelled.join(', '))} |`));
  const v = r.validation.coverage;
  out.push('', '## Checks', '');
  out.push(`- Map vs execution: ${n(v.executed_in_image)} executed instruction starts in the block, ${n(v.executed_in_image - v.executed_not_instruction_start_in_map)} of them instruction starts of the map; ${v.of_which_instruction_interior} fall inside a mapped instruction and ${v.of_which_not_code} are not code in the map (\`fwmap static --update-seeds\` takes the executed starts the map misses as seeds). By discovery phase: ${Object.entries(v.executed_by_discovery_phase).map(([k, x]) => `${k} ${n(x)}`).join(', ')}.`);
  const d = summary.data_as_code_check;
  out.push(`- Data decoded as code: of ${n(d.referenced_strings)} C strings (8+ characters) that code references, ${n(d.strings_overlapping_code)} overlap decoded code (${n(d.string_bytes_decoded_as_code)} bytes); ${d.suspect_functions} functions cover such a string (\`suspect\`).`);
  const c = r.validation.contiguity;
  out.push(`- Contiguity: of ${n(c.modules_direct)} modules named by file strings, ${c.runs_per_module_histogram['1'] ?? 0} form a single run of their direct functions; ${c.spans_with_foreign_direct_functions} spans hold another module's direct function.`, '');
  return out.join('\n');
}
