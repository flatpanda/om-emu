// The published site's path logic (bin/site.mjs) and the browser player's download command (src/fw/updater.mjs
// demand, fetchCommand): firmware-free and offline. bin/sitegate.mjs runs the built site in Chrome under a sub-path.
//   node emu/test/test_site.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { references, siteFiles, buildSite, SITE_TYPES, EMU } from '../bin/site.mjs';
import { demand, fetchCommand, UPDATER_API } from '../src/fw/updater.mjs';

export function siteTests() {
  const bad = [];
  let checks = 0;
  const ok = (c, what) => { checks++; if (!c) bad.push(what); };
  const throwsWith = (fn, re, what) => { let m = null; try { fn(); } catch (e) { m = e.message; } ok(m !== null && re.test(m), `${what}: ${m ?? 'no error'}`); };

  // references(): the forms a module and a page load by
  const mod = [
    "import { a,",
    "  b } from './x.mjs';",
    "import './side.mjs';",
    "export { c } from '../y/z.mjs';",
    "const m = await import('./dyn.mjs');",
    "const u = new URL('./worker.mjs' + location.search, import.meta.url);",
    "// import { gone } from './comment.mjs';",
    "const api = 'https://example.org/a'; // from './after-url.mjs'",
  ].join('\n');
  const specs = references(mod, 'module').map((r) => r.spec);
  ok(JSON.stringify(specs) === JSON.stringify(['./x.mjs', './side.mjs', '../y/z.mjs', './dyn.mjs', './worker.mjs']), `module references: ${JSON.stringify(specs)}`);
  ok(references(mod, 'module')[0].line === 2, 'a multi-line import is found on its from line');
  const html = '<link rel="icon" href="data:,"><a href="web/index.html">p</a> <a href="https://x.org/">e</a> <a href="#top">t</a>\n' +
    '<a href="//cdn.example/x.js">c</a> <a href="mailto:a@b.c">m</a> <img src="img/a.png">\n<script type="module">\nimport { P } from \'./page.mjs\';\n</script>';
  const hs = references(html, 'html').map((r) => r.spec);
  ok(JSON.stringify(hs) === JSON.stringify(['web/index.html', 'img/a.png', './page.mjs']), `html references: ${JSON.stringify(hs)}`);

  // siteFiles() on a made-up tree: what it follows, and each reference it refuses with its referrer
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-site-'));
  try {
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(T, rel)), { recursive: true }); fs.writeFileSync(path.join(T, rel), text); };
    put('index.html', '<a href="web/">player</a>');
    put('web/index.html', "<script type=\"module\">import './a.mjs';</script>");
    put('web/a.mjs', "import '../src/b.mjs';\nconst w = new URL('./w.mjs', import.meta.url);");
    put('web/w.mjs', "export const x = 1;");
    put('src/b.mjs', "export {};");
    put('web/unused.mjs', "export {};");
    const files = siteFiles(T);
    ok(JSON.stringify(files) === JSON.stringify(['index.html', 'src/b.mjs', 'web/a.mjs', 'web/index.html', 'web/w.mjs']), `made-up tree: ${JSON.stringify(files)}`);
    const out = path.join(T, '..', path.basename(T) + '-out');
    const r = buildSite(out, T);
    ok(r.files === 5 && fs.readFileSync(path.join(out, 'web/a.mjs'), 'utf8').startsWith("import '../src/b.mjs'"), `buildSite: ${JSON.stringify(r)}`);
    throwsWith(() => buildSite(out, T), /is not empty/, 'buildSite into a non-empty directory');
    fs.rmSync(out, { recursive: true, force: true });
    const refused = [
      ["import '/src/b.mjs';", /web\/a\.mjs:1: \/src\/b\.mjs is an absolute path/, 'an absolute path'],
      ["import 'lodash';", /is a bare specifier/, 'a bare specifier'],
      ["import '../out/x.mjs';", /out\/x\.mjs is under emu\/out\//, 'a file under out/'],
      ["import '../../x.mjs';", /is outside emu\//, 'a file outside the root'],
      ["const f = new URL('./fw.bin', import.meta.url);", /fw\.bin is not one of/, 'a .bin'],
      ["import './.hidden.mjs';", /is a dotfile/, 'a dotfile'],
      ["import './missing.mjs';", /web\/missing\.mjs does not exist/, 'a missing file'],
    ];
    for (const [code, re, what] of refused) { put('web/a.mjs', code); throwsWith(() => siteFiles(T), re, `refuses ${what}`); }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  // the real site: the landing page, the player and its Worker, and nothing a visitor does not load
  const site = siteFiles();
  for (const f of ['index.html', 'web/index.html', 'web/page.mjs', 'web/worker.mjs', 'src/fw/labfw.mjs', 'src/fw/updater.mjs', 'src/util/sha256.mjs']) ok(site.includes(f), `the site lacks ${f}`);
  for (const f of site) {
    ok(SITE_TYPES.includes(path.extname(f)), `the site holds ${f}`);
    ok(/^(?:index\.html|(?:web|src|scenarios|refs)\/)/.test(f), `the site holds ${f} (outside web/, src/, scenarios/ and refs/)`);
  }
  ok(!site.includes('web/gate.html') && !site.includes('web/play.html'), 'the site holds webgate\'s page or the node host\'s page');
  const bytes = site.reduce((a, f) => a + fs.statSync(path.join(EMU, f)).size, 0);
  ok(bytes < 8 * 2 ** 20, `the site is ${bytes} bytes`);

  // the download command: the demand tools/omfw_download.sh sends, on one shell line
  const sh = fs.readFileSync(path.join(EMU, '../tools/omfw_download.sh'), 'utf8');
  const heredoc = /<<EOF\n([\s\S]*?)\nEOF\n/.exec(sh)[1].replace('$(date +%Y%m%d%H%M%S)', '20261029120000').replace('${CODE}', 'E143') + '\n';
  ok(demand('E143', '20261029120000') === heredoc, 'demand() is not tools/omfw_download.sh\'s request');
  throwsWith(() => demand('E14', '20261029120000'), /not a body code/, 'demand() with a short code');
  throwsWith(() => demand("E143'", '20261029120000'), /not a body code/, 'demand() with a quote');
  throwsWith(() => demand('E143', '2026'), /not a YYYYMMDDhhmmss time/, 'demand() with a short time');
  const cmd = fetchCommand('E145');
  ok(!cmd.includes('\n') && cmd.startsWith('curl -fsS -A Olympus ') && cmd.includes(`' ${UPDATER_API} | `), `fetchCommand: ${cmd.slice(0, 120)}`);
  ok(cmd.includes('<hard_code>OLYE145000000000</hard_code>') && cmd.endsWith('| xargs curl -f --progress-bar -O'), 'fetchCommand: the code or the download step');
  ok((cmd.match(/'/g) ?? []).length % 2 === 0 && !demand('E145', '20260101000000').includes("'"), 'fetchCommand: the shell quoting');
  // the command's own parsing step, on a reply as the API sends it (one line, &amp; in the URL)
  const reply = '<firmware_result><detail_url>https://d.example/</detail_url><url>https://dl01.example/dslr/1450/v1103/F.BIN?Expires=1&amp;Signature=a~b_c-&amp;Key-Pair-Id=K</url></firmware_result>';
  const sedUrl = (s) => /.*<url>([^<]*)<\/url>.*/.exec(s.replace(/[\r\n]/g, ''))?.[1].replaceAll('&amp;', '&');
  ok(sedUrl(reply) === 'https://dl01.example/dslr/1450/v1103/F.BIN?Expires=1&Signature=a~b_c-&Key-Pair-Id=K', `the reply's URL: ${sedUrl(reply)}`);
  ok(cmd.includes(String.raw`sed -n 's:.*<url>\([^<]*\)</url>.*:\1:p' | sed 's/&amp;/\&/g'`), 'fetchCommand: the sed steps the line above models');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = siteTests();
  console.log(`site and download command: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
