// The publication audit (bin/pubaudit.mjs), without firmware: a throwaway git repository in a temporary directory
// with a clean first commit, a second commit that plants one bad blob, path or message per rule, and a third commit
// by an identity that is not noreply; a made-up firmware image (a plain file and a scrambled .BIN container) stands in
// for the real one.
//   pubauditTests  each rule fires on its planted blob and nowhere else; the clean commit alone is clean; --since
//                  and A..B leave out what the base holds; listings and quoted strings under their budgets pass;
//                  the public SHA-256 table is not firmware; a reviewed exception removes exactly its finding; no
//                  firmware gives a warning and no firmware finding
// The private markers it plants are put together at run time, so this file passes the audit itself.
//   node emu/test/test_pubaudit.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { audit, publicTables, LISTING_BUDGET, TEXT_RUN_MAX } from '../bin/pubaudit.mjs';
import { PERM } from '../src/fw/olyfw.mjs';

// xorshift32: the same bytes on every run
function prng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const hex = (u8) => Buffer.from(u8).toString('hex');

// the made-up firmware: 64 KiB of noise with a text region, a short string and the SHA-256 round constants; and a
// .BIN container holding one scrambled block
function makeFirmware(dir) {
  const next = prng(0x5eed1234);
  const plain = new Uint8Array(1 << 16).map(() => next() & 0xff);
  const words = ['shutter', 'release', 'focus', 'menu', 'panel', 'state', 'ready', 'trigger', 'lens', 'mode'];
  let prose = '';
  while (prose.length < 320) prose += `${words[next() % words.length]} `;
  prose = prose.slice(0, 320);
  plain.set(new TextEncoder().encode(prose), 0x4000);
  plain[0x4000 + 320] = 0;
  const string = 'CamDrv_ObserverNotify_ShortString(%d) not ready 0123456789';
  plain.set(new TextEncoder().encode(string), 0x6000);
  plain[0x6000 + string.length] = 0;
  const sha = publicTables()[0];
  plain.set(sha, 0x8000);
  fs.writeFileSync(path.join(dir, 'FAKE_PLAIN.bin'), plain);
  const body = new Uint8Array(4096).map(() => next() & 0xff);
  const scrambled = new Uint8Array(body.length);
  for (let g = 0; g < body.length; g += 16) for (let k = 0; k < 16; k++) scrambled[g + PERM[k]] = body[g + k] ^ 0xff;
  const head = new Uint8Array(32), dv = new DataView(head.buffer);
  head[0] = 0x4f; head[1] = 0x45;               // 'OE'
  dv.setUint32(12, body.length, true);
  dv.setUint16(20, 0x0100, true);               // scrambled code
  const bin = new Uint8Array(32 + body.length + 32);
  bin.set(head, 0); bin.set(scrambled, 32); bin.set(head, 32 + body.length);
  fs.writeFileSync(path.join(dir, 'FAKE_CONTAINER.BIN'), bin);
  return { plain, body, prose, string, sha };
}

// an objdump-style listing of bytes, 4 per line, from address `at`
const objdump = (u8, at) => Array.from({ length: Math.ceil(u8.length / 4) }, (_, i) =>
  `  ${(at + 4 * i).toString(16)}:\t${hex(u8.subarray(4 * i, 4 * i + 4)).replace(/(..)/g, '$1 ')}\tmov\td0,d1`).join('\n');
// an xxd-style dump, 16 bytes per line in groups of 2
const xxd = (u8, at) => Array.from({ length: Math.ceil(u8.length / 16) }, (_, i) =>
  `${(at + 16 * i).toString(16).padStart(8, '0')}: ${hex(u8.subarray(16 * i, 16 * i + 16)).replace(/(....)/g, '$1 ').trim()}  ................`).join('\n');

export async function pubauditTests() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pubaudit-'));
  const saved = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    const repo = path.join(tmp, 'repo'), fwDir = path.join(tmp, 'fw');
    fs.mkdirSync(repo); fs.mkdirSync(fwDir);
    const fwImg = makeFirmware(fwDir);
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...args], { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    const write = (p, data) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), data); };
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'tester');
    git('config', 'user.email', 'tester@users.noreply.github.com');

    // 1. clean: code, a digest, a fill, a noreply address, a quoted short string, a short listing, the SHA-256 table
    const sha = Array.from({ length: 64 }, (_, i) => `0x${new DataView(fwImg.sha.buffer).getUint32(4 * i, true).toString(16).padStart(8, '0')}`);
    const clean = {
      'README.md': '# demo\n\nCo-Authored-By: Someone <noreply@anthropic.com>\n',
      'src/main.mjs': 'export const add = (a, b) => a + b;\n',
      'golden.json': JSON.stringify({ digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', fill: 'a5'.repeat(200) }) + '\n',
      'docs/strings.md': `The firmware logs \`${fwImg.string}\` when it waits.\n`,
      'docs/excerpt.dis': `${objdump(fwImg.plain.subarray(0x3800, 0x3800 + 96), 0x3800)}\n`,
      'src/sha.mjs': `const K = [\n  ${sha.join(', ')}];\n`,
    };
    for (const [p, d] of Object.entries(clean)) write(p, d);
    write('.gitignore', '*.secret\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'clean start');
    const c1 = git('rev-parse', 'HEAD');

    // 2. one plant per rule
    const home = ['', 'Users', 'alice', 'work'].join('/'), session = ['.claude', 'settings.json'].join('/');
    const next = prng(0xabcdef01);
    const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const token = Array.from({ length: 48 }, () => B62[next() % 62]).join('');
    const chunk = (o, n = 64) => fwImg.plain.subarray(o, o + n);
    const planted = {
      'fw/notes.txt': 'not firmware, but under fw/\n',
      'emu/out/trace.txt': 'run output\n',
      [session]: '{}\n',
      'notes.txt.swp': 'swap\n',
      'keys.secret': 'ignored by the repository\n',
      'big.txt': 'x'.repeat(5000) + '\n',
      'blob.dat': Uint8Array.from([0, 1, 2, ...chunk(0x1000), 0, 0]),
      'docs/home.md': `see ${home}/notes\n`,
      'docs/mail.md': `write to ${'alice'}@${'corp.io'}\n`,
      'docs/marker.md': `the ${'zebra'}-${'owl'} project\n`,
      'docs/conf.md': `the ${'quokka'}-${'den'} host\n`,
      'docs/gh.md': `token ${'gh'}${'p_'}${'a1B2'.repeat(9)}\n`,
      'docs/key.md': `${'-----BEGIN '}${'OPENSSH PRIVATE'}${' KEY-----'}\n`,
      'docs/entropy.md': `value ${token}\n`,
      'docs/hexlit.md': `${hex(new Uint8Array(70).map(() => next() & 0xff))}\n`,
      'docs/datauri.md': `![x](${'data:'}${'image/png;base64,'}iVBORw0KGgo=)\n`,
      'docs/fwhex.md': `bytes: ${hex(chunk(0x2000))}\n`,
      'src/table.c': `static const unsigned char t[] = {\n  ${Array.from(chunk(0x2100), (b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}\n};\n`,
      'src/words.mjs': `export const W = [${Array.from({ length: 16 }, (_, i) => `0x${new DataView(chunk(0x2200).buffer, chunk(0x2200).byteOffset).getUint32(4 * i, true).toString(16).padStart(8, '0')}`).join(', ')}];\n`,
      'data/dec.json': `${JSON.stringify(Array.from(chunk(0x2300)))}\n`,
      'docs/b64.md': `${Buffer.from(chunk(0x2400)).toString('base64')}\n`,
      'docs/scrambled.md': `${hex(fwImg.body.subarray(0x100, 0x140))}\n`,
      'docs/big.dis': `${objdump(chunk(0x3000, LISTING_BUDGET + 96), 0x3000)}\n`,
      'docs/dump.txt': `${xxd(chunk(0x5000, LISTING_BUDGET + 96), 0x5000)}\n`,
      'docs/prose.md': `${fwImg.prose}\n`,
    };
    for (const [p, d] of Object.entries(planted)) write(p, d);
    git('add', '-A');
    git('add', '-f', 'keys.secret');
    git('update-index', '--add', '--cacheinfo', `160000,${c1},sub`);
    git('commit', '-q', '-m', `plant everything\n\nnotes in ${home}/plan.txt`);
    const c2 = git('rev-parse', 'HEAD');
    git('config', '--add', 'pubaudit.marker', `${'quokka'}-${'den'}`);

    // 3. not a noreply identity
    write('docs/later.md', 'later\n');
    git('add', '-A');
    git('-c', `user.email=${'alice'}@${'corp.io'}`, 'commit', '-q', '-m', 'later');

    const opts = { repo, fw: [fwDir], markers: [`${'zebra'}-${'owl'}`], maxSize: 4096 };
    const full = await audit({ ...opts, refs: ['HEAD'] });
    const has = (r, rule, p, re = null) => r.findings.some((f) => f.rule === rule && f.path === p && (!re || re.test(f.detail)));
    const expect = [
      ['path', 'fw/notes.txt'], ['path', 'emu/out/trace.txt'], ['path', session], ['path', 'notes.txt.swp'],
      ['path', 'keys.secret', /gitignore/], ['gitlink', 'sub'], ['size', 'big.txt'], ['binary', 'blob.dat'],
      ['private-path', 'docs/home.md'], ['private-path', '(commit message)'], ['email', 'docs/mail.md'],
      ['marker', 'docs/marker.md'], ['marker', 'docs/conf.md'], ['secret', 'docs/gh.md', /GitHub/],
      ['secret', 'docs/key.md', /private key/], ['secret', 'docs/entropy.md', /high-entropy/], ['hex-literal', 'docs/hexlit.md'],
      ['base64', 'docs/datauri.md'], ['identity', '(commit)'],
      ['firmware', 'blob.dat', /raw content/], ['firmware', 'docs/fwhex.md', /hex run/], ['firmware', 'src/table.c', /number list/],
      ['firmware', 'src/words.mjs', /number list/], ['firmware', 'data/dec.json', /number list/], ['firmware', 'docs/b64.md', /base64/],
      ['firmware', 'docs/scrambled.md', /descrambled/], ['firmware', 'docs/big.dis', /listing/], ['firmware', 'docs/dump.txt', /listing/],
      ['firmware', 'docs/prose.md', /of the text/],
    ];
    for (const [rule, p, re] of expect) ok(has(full, rule, p, re), `${rule} fires on ${p}${re ? ` (${re.source})` : ''}`);
    const cleanHits = full.findings.filter((f) => f.path in clean || f.path === '.gitignore' || f.path === 'docs/later.md');
    ok(!cleanHits.length, `no finding on the clean files (${cleanHits.map((f) => `${f.rule} ${f.path}`).join(', ')})`);
    ok(full.warnings.length === 0 && full.fwFiles === 2, 'both made-up firmware files are read, no warning');

    const base = await audit({ ...opts, refs: [c1] });
    ok(base.findings.length === 0, `the clean commit alone is clean (${base.findings.map((f) => `${f.rule} ${f.path}`).join(', ')})`);
    ok(clean['docs/excerpt.dis'] && 96 <= LISTING_BUDGET && fwImg.string.length <= TEXT_RUN_MAX, 'the clean listing and string are within their budgets');

    for (const r of [await audit({ ...opts, refs: ['HEAD'], since: [c2] }), await audit({ ...opts, refs: [`${c2}..HEAD`] })]) {
      ok(r.commits === 1 && r.findings.length === 1 && r.findings[0].rule === 'identity', `since the plant commit: only the identity (${r.findings.map((f) => `${f.rule} ${f.path}`).join(', ')})`);
    }

    const blobId = git('rev-parse', `${c2}:blob.dat`);
    const allowed = await audit({ ...opts, refs: ['HEAD'], allow: [{ rule: 'binary', path: 'blob.dat', blob: blobId.slice(0, 12), reason: 'test' }] });
    ok(!has(allowed, 'binary', 'blob.dat') && has(allowed, 'firmware', 'blob.dat'), 'a reviewed exception removes its finding only');
    ok(allowed.findings.length === full.findings.length - 1, 'and nothing else');
    const wrongBlob = await audit({ ...opts, refs: ['HEAD'], allow: [{ rule: 'binary', path: 'blob.dat', blob: 'f'.repeat(12), reason: 'test' }] });
    ok(has(wrongBlob, 'binary', 'blob.dat'), 'an exception pinned to another blob does not apply');

    const noFw = await audit({ ...opts, refs: ['HEAD'], fw: [path.join(tmp, 'none')] });
    ok(noFw.warnings.some((w) => /firmware rule did not run/.test(w)) && !noFw.findings.some((f) => f.rule === 'firmware'), 'no firmware: a warning, no firmware findings');

    const k = publicTables()[0], dv = new DataView(k.buffer);
    ok(dv.getUint32(0, true) === 0x428a2f98 && dv.getUint32(252, true) === 0xc67178f2, 'the SHA-256 round constants are computed right (first and last)');
  } finally {
    if (saved.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.g;
    if (saved.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.s;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await pubauditTests();
  console.log(`publication audit: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
