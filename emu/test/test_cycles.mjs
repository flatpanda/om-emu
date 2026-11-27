// Static dependency-cycle gate for emu/src/: walks all static ES `import` and `export ... from` edges
// across emu/src/**/*.mjs and asserts zero circular dependencies.
//   node emu/test/test_cycles.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SRC = path.join(ROOT, 'src');

// Strip line and block comments while preserving string literals so specifiers in comments are ignored.
function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; ) {
    const c = text[i], n = text[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) { out += text[i] + text[i + 1]; i += 2; continue; }
        out += text[i];
        if (text[i++] === q) break;
      }
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Match static ES `import ... from '...'`, `export ... from '...'`, and side-effect `import '...'`.
const STATIC_EDGE = /(?:^|[\n;])\s*(?:import(?:\s+[\s\S]*?\s+from)?|export\s+(?:\*(?:\s+as\s+\w+)?|\{[\s\S]*?\})\s+from)\s*['"]([^'"]+)['"]/g;

function staticDeps(file) {
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  const deps = [];
  for (const m of code.matchAll(STATIC_EDGE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), spec);
    deps.push(resolved);
  }
  return deps;
}

function collectMjs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectMjs(p, out);
    else if (p.endsWith('.mjs')) out.push(p);
  }
  return out.sort();
}

// Tarjan's strongly connected components on an adjacency map { node -> [dep, ...] }.
// Returns every cycle component (SCC with > 1 node, or a 1-node self-loop).
export function findCycles(graph) {
  let idx = 0;
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  const cycles = [];
  const visit = (v) => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(scc.reverse());
    }
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return cycles;
}

export function cycleUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // Self-check the cycle detector on synthetic graphs.
  const dag = new Map([['a', ['b', 'c']], ['b', ['c']], ['c', []]]);
  ok(findCycles(dag).length === 0, 'synthetic DAG should have 0 cycles');
  const cyc = new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]]);
  ok(findCycles(cyc).length === 1 && findCycles(cyc)[0].length === 3, 'synthetic 3-cycle should be detected');
  const selfLoop = new Map([['a', ['a']]]);
  ok(findCycles(selfLoop).length === 1, 'synthetic self-loop should be detected');

  // Build the static import/re-export graph for all emu/src/**/*.mjs modules.
  const files = collectMjs(SRC);
  ok(files.length > 0, 'emu/src/ should contain .mjs modules');
  const graph = new Map();
  let edges = 0;
  for (const f of files) {
    const deps = staticDeps(f);
    edges += deps.length;
    graph.set(f, deps);
  }
  const cycles = findCycles(graph);
  ok(cycles.length === 0, `found ${cycles.length} circular dependency cycle(s) in emu/src/: ${
    cycles.map((c) => c.map((p) => path.relative(ROOT, p)).join(' -> ')).join('; ')
  }`);

  return { checks, bad, files: files.length, edges, cycles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = cycleUnits();
  console.log(`cycles: ${r.files} modules, ${r.edges} static edges, ${r.cycles.length} cycles (${r.checks - r.bad.length}/${r.checks} checks)`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
