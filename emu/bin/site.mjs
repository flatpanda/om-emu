#!/usr/bin/env node
// The static site (.github/workflows/pages.yml publishes it to GitHub Pages, bin/sitegate.mjs tests it under a
// sub-path): emu/index.html, the landing page, and exactly the files the browser player loads, found by following
// every relative reference from it: <script type="module"> imports, src= and href= in HTML, and import, export-from,
// import() and new URL(..., import.meta.url) in modules. The tree keeps emu/'s layout (web/index.html stays next to
// ../src/), so the site works under any path prefix as emu/ works at a server's root. It holds no firmware and
// nothing of emu/out/: a reference outside emu/, into out/, to a dotfile, to a type other than SITE_TYPES, an absolute
// path (it would leave the site's sub-path) or a bare specifier (no npm packages) stops the build with its referrer.
// The firmware reaches the player only from the visitor's own file, in their browser (README "The browser player").
//   node emu/bin/site.mjs DIR        (DIR must be missing or empty; prints the file count and size)
//   node emu/bin/site.mjs --list     (the files, one per line, relative to emu/)
import fs from 'node:fs';
import path from 'node:path';

export const EMU = path.resolve(new URL('..', import.meta.url).pathname);
export const SITE_ROOTS = ['index.html'];
export const SITE_TYPES = ['.html', '.mjs', '.js', '.css', '.json', '.svg', '.png', '.ico'];

// The references of one file's text: [{spec, line}], relative or not (siteFiles judges them). kind: 'html' or 'module'.
// In modules, // comments are dropped (a reference in a comment is no load); in HTML, external links (a scheme, //host,
// #, mailto:) are not references to the site. Lines end in LF or CRLF (a checkout with core.autocrlf).
export function references(text, kind) {
  const out = [];
  const add = (spec, line) => out.push({ spec, line });
  const lines = text.split(/\r?\n/);
  const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  const URLREF = /\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*(?:\+[^,]*)?,\s*import\.meta\.url\s*\)/g;
  const ATTR = /\b(?:src|href)\s*=\s*["']([^"']+)["']/g;
  lines.forEach((l, i) => {
    const code = kind === 'module' ? l.replace(/(^|[^:'"])\/\/.*$/, '$1') : l;
    for (const m of code.matchAll(IMPORT)) add(m[1], i + 1);
    for (const m of code.matchAll(URLREF)) add(m[1], i + 1);
    if (kind === 'html') for (const m of code.matchAll(ATTR)) if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(m[1])) add(m[1], i + 1);
  });
  return out;
}

// The site's files, relative to emu/ (sorted), or throws with every bad reference. root: emu/.
export function siteFiles(root = EMU, roots = SITE_ROOTS) {
  const seen = new Set(), bad = [], queue = [...roots];
  const outDir = path.join(root, 'out') + path.sep;
  const check = (rel, from) => {
    const abs = path.join(root, rel);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return `${from}: ${rel} is outside emu/`;
    if (abs.startsWith(outDir)) return `${from}: ${rel} is under emu/out/`;
    if (rel.split('/').some((p) => p.startsWith('.'))) return `${from}: ${rel} is a dotfile`;
    if (!SITE_TYPES.includes(path.extname(rel).toLowerCase())) return `${from}: ${rel} is not one of ${SITE_TYPES.join(' ')}`;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return `${from}: ${rel} does not exist`;
    return null;
  };
  for (const r of roots) { const e = check(r, 'the site roots'); if (e) bad.push(e); }
  if (bad.length) throw new Error(bad.join('\n'));
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.html' && ext !== '.mjs' && ext !== '.js') continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const { spec, line } of references(text, ext === '.html' ? 'html' : 'module')) {
      const from = `${rel}:${line}`;
      const bare = spec.split(/[?#]/)[0];
      if (bare.startsWith('/')) { bad.push(`${from}: ${spec} is an absolute path (the site lives under a sub-path)`); continue; }
      if (!bare.startsWith('.') && ext !== '.html') { bad.push(`${from}: ${spec} is a bare specifier`); continue; }
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), bare));
      if (bare.endsWith('/') || bare === '' || bare === '.') target = path.posix.join(target, 'index.html');
      const e = check(target, from);
      if (e) bad.push(e); else queue.push(target);
    }
  }
  if (bad.length) throw new Error(bad.join('\n'));
  return [...seen].sort();
}

// Copies the site into dir (missing or empty). {files, bytes}
export function buildSite(dir, root = EMU) {
  const files = siteFiles(root);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  let bytes = 0;
  for (const f of files) {
    const to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
    bytes += fs.statSync(to).size;
  }
  return { files: files.length, bytes };
}

// A plain static server of a built site under prefix (/name/), as GitHub Pages serves a project site: index.html for a
// directory, a 301 to add a directory's slash (the prefix's too), its content types by extension, no other route and
// no other header. host: where it listens (127.0.0.1). Resolves to {server, origin, base, served: [[method, path,
// code]]}, every request answered in order (the browser gates check it).
export const PAGES_TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
export async function serveSite(dir, prefix, host = '127.0.0.1') {
  const http = await import('node:http');
  const served = [];
  const server = http.createServer((q, s) => {
    const url = new URL(q.url, 'http://x');
    const answer = (code, headers = {}) => { served.push([q.method, url.pathname, code]); s.writeHead(code, headers); };
    if (q.method !== 'GET' && q.method !== 'HEAD') { answer(405); return s.end(); }
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { answer(400); return s.end(); }
    if (p === prefix.slice(0, -1)) { answer(301, { Location: prefix }); return s.end(); }
    if (!p.startsWith(prefix)) { answer(404); return s.end(); }
    let file = path.normalize(path.join(dir, p.slice(prefix.length)));
    if (file !== dir && !file.startsWith(dir + path.sep)) { answer(404); return s.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!p.endsWith('/')) { answer(301, { Location: p + '/' }); return s.end(); }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { answer(404); return s.end(); }
    answer(200, { 'Content-Type': PAGES_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    if (q.method === 'HEAD') return s.end();
    fs.createReadStream(file).pipe(s);
  });
  await new Promise((res) => server.listen(0, host, res));
  const origin = `http://${host}:${server.address().port}`;
  return { server, origin, base: origin + prefix, served };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  try {
    if (a[0] === '--list' && a.length === 1) console.log(siteFiles().join('\n'));
    else if (a.length === 1 && !a[0].startsWith('-')) {
      const r = buildSite(path.resolve(a[0]));
      console.log(`site.mjs: ${r.files} files, ${(r.bytes / 2 ** 20).toFixed(2)} MiB in ${a[0]}`);
    } else { console.error('usage: node emu/bin/site.mjs DIR | --list'); process.exit(2); }
  } catch (e) { console.error(`site.mjs: ${e.message}`); process.exit(1); }
}
