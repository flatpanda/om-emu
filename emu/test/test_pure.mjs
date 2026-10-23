// The worker-safety rule of src/, scenarios/, refs/ and web/, the browser player's Worker and page modules
// (README "Layout"): pure ES modules, no node: imports, no process, Buffer, fs or crypto; hashing and file access are
// passed in from bin/ (or, in the Worker, src/util/sha256.mjs and the File the page hands over). Plus the import rules
// below, and web/ imports only src/, scenarios/ and web/. host/ (the node host of bin/play.mjs
// and bin/nav.mjs, node-only) is imported by none of src/, scenarios/, refs/ and web/.
// And the retired py-prefixed helpers stay retired: no module under src/, scenarios/, refs/, web/, host/, checks/,
// fwmap/ or bin/ is named py*.mjs, imports one, or uses a name of py and a capital letter outside its comments.
//   node emu/test/test_pure.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RULES = [[/from\s+['"]node:/, 'node: import'], [/\brequire\s*\(/, 'require()'], [/\bprocess\./, 'process'],
  [/\bBuffer\b/, 'Buffer'], [/from\s+['"](fs|crypto|path|os|child_process)['"]/, 'node built-in import'], [/import\(\s*['"]node:/, 'dynamic node: import']];
// The independent references (refs/) import only refs/; src/ and scenarios/ import neither refs/ nor checks/
// (checks/ and bin/ are node code that may import all of them).
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;
function importRule(file, code) {
  const dir = path.relative(ROOT, file).split(path.sep)[0], out = [];
  for (const m of code.matchAll(IMPORT)) {
    const spec = m[1];
    if (!spec.startsWith('.')) { if (dir === 'refs') out.push(`refs/ imports ${spec}`); continue; }
    const target = path.relative(ROOT, path.resolve(path.dirname(file), spec)).split(path.sep)[0];
    if (dir === 'refs' && target !== 'refs') out.push(`refs/ imports ${spec} (outside refs/)`);
    if ((dir === 'src' || dir === 'scenarios') && (target === 'refs' || target === 'checks' || target === 'web' || target === 'host')) out.push(`${dir}/ imports ${spec} (${target}/)`);
    if (dir === 'web' && !['src', 'scenarios', 'web'].includes(target)) out.push(`web/ imports ${spec} (${target}/)`);
  }
  return out;
}
const PURE = ['src', 'scenarios', 'refs', 'web'];
const PY_NAME = /\bpy[A-Z]\w*/, PY_MODULE = /(?:^|\/)py[^/]*\.mjs$/;
function retiredNames(rel, code) {
  const out = [];
  const m = PY_NAME.exec(code);
  if (m) out.push(`the name ${m[0]}`);
  for (const x of code.matchAll(IMPORT)) if (PY_MODULE.test(x[1])) out.push(`imports ${x[1]}`);
  return out;
}
export function purity() {
  const bad = [];
  let files = 0;
  for (const dir of [...PURE, 'host', 'checks', 'fwmap', 'bin']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name), rel = path.relative(ROOT, p);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.mjs')) {
          files++;
          if (PY_MODULE.test(rel)) bad.push(`${rel}: a py-prefixed module`);
          fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '');
            if (PURE.includes(dir)) {
              for (const [re, what] of RULES) if (re.test(code)) bad.push(`${rel}:${i + 1}: ${what}`);
              for (const what of importRule(p, code)) bad.push(`${rel}:${i + 1}: ${what}`);
            }
            for (const what of retiredNames(rel, code)) bad.push(`${rel}:${i + 1}: ${what}`);
          });
        }
      }
    };
    walk(path.join(ROOT, dir));
  }
  return { files, bad };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = purity();
  console.log(`purity: ${r.files} modules in src/, scenarios/, refs/, web/, host/, checks/, fwmap/ and bin/, ${r.bad.length} violations`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
