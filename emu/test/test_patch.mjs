// Patch overlays (src/fw/patch.mjs, --patch FILE on bin/play.mjs, bin/nav.mjs and bin/debug.mjs):
//   patchUnits    (firmware-free) both file shapes read (om-c's {block, offset, old, new} in base64, the ND128
//                 manifest's {decoded_body_offset, before, after} in hex, artifacts/nd128/manifest.json itself), every
//                 malformed patch refused, the block references (indices, names), and on synthetic blocks: old bytes
//                 that differ refused, overlaps refused (in one file and across two, adjacent patches taken), a range
//                 outside the loaded part refused, and the applied overlay: the bytes, the stock blocks untouched, the
//                 counts and both digests; a --replay of a session.json that records a patch refused without an
//                 overlay (src/lab/player.mjs replayPatchRefusal), taken with one, and a session.jsonl not checked
//   patchSession  (E143's blocks) a patch file the test writes: 16 bytes of the main block's 0xFF tail padding
//                 (0x1ffff00, never run: the code ends at 0x1a70c3b) changed and 8 bytes of the resource block's index
//                 written as they are; bin/debug.mjs, which loads no resource block, refuses that file and reads the
//                 new bytes of the main block's patch alone at their run-time and flash addresses; bin/play.mjs prints
//                 the patched line, its status and GET /api/session carry the summary (the main block's sha256 the test
//                 computes, the resource block's the stock prefix's), the live debug route reads
//                 the new bytes after the bring-up, the session runs, a model switch is refused, and session.json has
//                 the summary but no patch among its args; bin/nav.mjs prints the line and its session.json the summary;
//                 a file whose old bytes differ, an overlap and a file that cannot be read are refused by all three
//                 tools (exit 1) before any lab; play.mjs --replay of the patched session.json without --patch is
//                 refused before the server starts
//   node emu/test/test_patch.mjs [--session]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PatchRefused, readPatchText, applyPatches, patchLayout, resolveBlock, patchLine } from '../src/fw/patch.mjs';
import { createHash } from '../src/util/sha256.mjs';
import { replayPatchRefusal } from '../src/lab/player.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.dirname(EMU);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const b64 = (b) => Buffer.from(b).toString('base64');
const refusal = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof PatchRefused) return e.message; throw e; } };

export function patchUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const refuses = (fn, re, what) => { const m = refusal(fn); ok(m !== null && re.test(m), `${what}: ${m ?? 'taken'}`); };
  // a synthetic body: a main block of 256 bytes, the resource block right after it (offset 256 + 64 = 0x140), 128
  // bytes of which the lab reads (res_len) out of 192
  const info = { rom_len: 256, res_len: 128, res_block: 'blk00000140.OE.0101.bin' };
  const layout = patchLayout(info);
  const main = Uint8Array.from({ length: 256 }, (_, i) => i), resource = Uint8Array.from({ length: 192 }, (_, i) => 255 - i);
  const blocks = { main, resource };
  const text = (list) => JSON.stringify(list);
  const p = (block, offset, old, nw, label) => ({ block, offset, old: b64(old), new: b64(nw), ...(label ? { label } : {}) });
  const apply = (lists) => applyPatches(blocks, lists.flatMap(([src, list]) => readPatchText(text(list), src)), { layout, createHash });

  // the shapes
  const om = readPatchText(text([p(0, 16, [16, 17], [0xaa, 0xbb], 'two'), { ...p('resource', '0x4', [251], [0]) }]), 'a.json');
  ok(om.length === 2 && om[0].offset === 16 && om[0].label === 'two' && om[0].new[1] === 0xbb && om[1].offset === 4 && om[1].label === null && om[1].source === 'a.json' && om[1].n === 1,
    `om-c's shape: ${JSON.stringify(om.map((x) => [x.block, x.offset, x.label, [...x.old], [...x.new]]))}`);
  const wrapped = readPatchText(JSON.stringify({ id: 'x', patches: [p(0, 1, [1], [2])] }), 'w.json');
  ok(wrapped.length === 1 && wrapped[0].offset === 1, 'an object with a patches list');
  const nd = readPatchText(JSON.stringify({ patches: [{ decoded_body_offset: '0x20', before: '2021', after: 'cafe' }] }), 'm.json');
  ok(nd.length === 1 && nd[0].block === 'main' && nd[0].offset === 0x20 && nd[0].new[0] === 0xca && nd[0].old[1] === 0x21, "the ND128 manifest's shape");
  const manifest = path.join(REPO, 'artifacts/nd128/manifest.json');
  const m = readPatchText(fs.readFileSync(manifest, 'utf8'), 'manifest.json');
  ok(m.length === 2 && m[0].offset === 0x2d00f1 && m[0].old.length === 58 && m[1].offset === 0x2d165d && m[1].new.length === 3 && m.every((x) => x.block === 'main'),
    `artifacts/nd128/manifest.json: ${JSON.stringify(m.map((x) => [x.offset, x.old.length]))}`);

  // malformed files and patches
  refuses(() => readPatchText('{', 'f'), /not JSON/, 'not JSON');
  refuses(() => readPatchText('{"x": 1}', 'f'), /a list of patches/, 'no list');
  refuses(() => readPatchText('[]', 'f'), /no patches/, 'an empty list');
  refuses(() => readPatchText('[3]', 'f'), /patch 0: not an object/, 'a patch that is not an object');
  refuses(() => readPatchText(text([{ block: 0, offset: 1, old: 'AQ==' }]), 'f'), /no new/, 'no new');
  refuses(() => readPatchText(text([{ block: 0, offset: 1, old: 'AQ=', new: 'Ag==' }]), 'f'), /old is not base64/, 'old not base64');
  refuses(() => readPatchText(text([{ block: 0, offset: 1, old: 'AQ==', new: 'AgM=' }]), 'f'), /1 bytes, new 2/, 'old and new of two lengths');
  refuses(() => readPatchText(text([{ block: 0, offset: 1, old: '', new: '' }]), 'f'), /0 bytes/, 'empty old and new');
  refuses(() => readPatchText(text([{ block: 0, offset: -1, old: 'AQ==', new: 'Ag==' }]), 'f'), /offset -1/, 'a negative offset');
  refuses(() => readPatchText(text([{ block: 0, offset: 1.5, old: 'AQ==', new: 'Ag==' }]), 'f'), /offset 1.5/, 'an offset that is not an integer');
  refuses(() => readPatchText(text([{ block: 0, offset: 1, old: 'AQ==', new: 'Ag==', label: 7 }]), 'f'), /label/, 'a label that is not a string');
  refuses(() => readPatchText(text([{ decoded_body_offset: '0x1', before: '0', after: '1' }]), 'f'), /before is not hex/, 'odd hex');
  refuses(() => readPatchText(text([{ offset: 1 }]), 'f'), /neither/, 'a patch of neither shape');

  // block references
  ok(resolveBlock(0, layout) === 'main' && resolveBlock(1, layout) === 'resource' && resolveBlock('main', layout) === 'main', 'indices 0 and 1, main');
  ok(resolveBlock('blk00000000', layout) === 'main' && resolveBlock('OLY_E_143_1900_0000_0000.BIN.blk00000140.OE.0101.bin', layout) === 'resource', 'block names');
  refuses(() => resolveBlock(2, layout), /block 2: the lab loads only/, 'index 2');
  refuses(() => resolveBlock('blk00000400', layout), /not a block the lab loads/, 'another block name');
  refuses(() => resolveBlock(-1, layout), /the lab loads only/, 'index -1');
  refuses(() => resolveBlock(null, layout), /an index/, 'block null');
  const gap = patchLayout({ ...info, res_block: 'blk00000400.OE.0101.bin' });
  refuses(() => resolveBlock(1, gap), /block 1/, 'index 1 where the resource block does not follow the main block');
  ok(resolveBlock('resource', gap) === 'resource', 'the resource block by name where it does not follow');

  // the rules
  refuses(() => apply([['a.json', [p(0, 16, [16, 18], [0, 0])]]]), /a.json patch 0: old bytes differ from the stock main block at 0x00000011 \(0x11, the patch expects 0x12\)/, 'old bytes that differ');
  ok(main[16] === 16 && main[17] === 17, 'a refusal leaves the stock block as it was');
  refuses(() => apply([['a.json', [p(0, 10, [10, 11, 12], [0, 0, 0], 'x'), p(0, 12, [12], [1], 'y')]]]), /a.json patch 0 \(x\) .* and a.json patch 1 \(y\) .* overlap in the main block/, 'an overlap in one file');
  refuses(() => apply([['a.json', [p(1, 0, [255, 254], [0, 0])]], ['b.json', [p('resource', 1, [254], [9])]]]), /a.json patch 0 .* and b.json patch 0 .* overlap in the resource block/, 'an overlap across two files');
  refuses(() => apply([['a.json', [p(0, 255, [255, 0], [0, 0])]]]), /outside the main code block \(256 bytes\)/, 'past the main block\'s end');
  refuses(() => apply([['a.json', [p(1, 127, [128, 127], [0, 0])]]]), /outside the resource block's part the lab reads \(128 bytes\)/, "past the resource block's prefix");
  refuses(() => applyPatches({ main }, readPatchText(text([p(1, 0, [255], [0])]), 'a.json'), { layout, createHash }), /the resource block is not loaded here/, 'a block the caller did not load');

  // an overlay
  const r = apply([['a.json', [p(0, 10, [10, 11, 12], [10, 0xee, 0xef], 'x'), p(0, 13, [13], [0x77])]], ['b.json', [p('resource', 0, [255], [255])]]]);
  ok(r.blocks.main !== main && r.blocks.main[10] === 10 && r.blocks.main[11] === 0xee && r.blocks.main[12] === 0xef && r.blocks.main[13] === 0x77 && r.blocks.main[14] === 14, 'the patched main block');
  ok(main[11] === 11 && main[13] === 13, 'the stock main block untouched');
  const want = main.slice(); want.set([0xee, 0xef, 0x77], 11);
  const s = r.summary, mb = s.blocks.find((b) => b.block === 'main'), rb = s.blocks.find((b) => b.block === 'resource');
  ok(s.applied === 3 && s.bytes === 3 && s.files.join() === 'a.json,b.json' && s.blocks.length === 2, `the summary's counts: ${JSON.stringify(s)}`);
  ok(mb.sha256 === sha(want) && mb.stock_sha256 === sha(main) && mb.patches === 2 && mb.name === 'blk00000000.OE.0100.bin', "the main block's digests");
  ok(rb.sha256 === sha(resource.subarray(0, 128)) && rb.stock_sha256 === rb.sha256 && rb.name === 'blk00000140.OE.0101.bin', "the resource block's digests: over the prefix the lab reads, unchanged by a patch that writes what is there");
  const only = apply([['a.json', [p(0, 0, [0], [1])]]]);
  ok(only.blocks.resource === resource && only.summary.blocks.length === 1, 'an unpatched block is the caller\'s own');
  ok(/^3 patches \(3 bytes changed\) from a.json, b.json; main block sha256 [0-9a-f]{16} \(stock [0-9a-f]{16}\), resource block sha256 /.test(patchLine(s)) && /^1 patch \(/.test(patchLine(only.summary)), `patchLine: ${patchLine(s)}`);

  // a --replay of a patched session: its session.json's patch without an overlay refused, with one taken
  const logged = JSON.stringify({ args: {}, inputs: [], patch: only.summary });
  const why = replayPatchRefusal('out/x/session.json', logged, null);
  ok(why !== null && why.startsWith('--replay out/x/session.json: the session ran on patched firmware (1 patch (1 bytes changed) from a.json; main block sha256 ') && /refused without --patch/.test(why),
    `a patched session.json without --patch: ${why}`);
  ok(replayPatchRefusal('session.json', logged, only.summary) === null, 'a patched session.json with an overlay');
  ok(replayPatchRefusal('session.json', JSON.stringify({ args: {}, inputs: [] }), null) === null, 'a stock session.json');
  ok(replayPatchRefusal('session.json', JSON.stringify({ inputs: [], patch: {} }), null) === '--replay session.json: the session ran on patched firmware (a patch overlay): refused without --patch (give the same --patch FILE again)',
    'a patch field patchLine cannot read is still refused');
  ok(replayPatchRefusal('session.jsonl', logged, null) === null && replayPatchRefusal('session.json', '{', null) === null,
    'a session.jsonl and a malformed file are not this check\'s');
  return { checks, bad };
}

// ---- E143's blocks ---------------------------------------------------------------------------------------------------
const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 300000, ...opts });

export async function patchSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { ORIGINAL, BLOCK, readBytes } = await import('../checks/lib/env.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const { startPlay } = await import('./test_host.mjs');
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-patch-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const main = readBytes(ORIGINAL), res = readBytes(BLOCK);
    const TAIL = 0x1ffff00, run = MODEL_INFO.image_base + TAIL, flash = 0x50000000 + TAIL;
    const tail = main.subarray(TAIL, TAIL + 16);
    ok(tail.every((x) => x === 0xff) && main.subarray(0x1a70c3c).every((x) => x === 0xff), 'the main block\'s tail from 0x1a70c3c is 0xFF padding');
    const NEW = Buffer.from('om-emu patch test');               // 17 bytes: 16 used
    const file = path.join(tmp, 'tiny.json');
    fs.writeFileSync(file, JSON.stringify([
      { block: 0, offset: TAIL, old: b64(tail), new: b64(NEW.subarray(0, 16)), label: 'tail padding' },
      { block: 'resource', offset: 0, old: b64(res.subarray(0, 8)), new: b64(res.subarray(0, 8)), label: 'index head as it is' },
    ]));
    const want = main.slice(); want.set(NEW.subarray(0, 16), TAIL);
    const wantSha = sha(want), stockRes = sha(res.subarray(0, MODEL_INFO.res_len));
    const hexNew = NEW.subarray(0, 16).toString('hex');
    const summaryOk = (s) => s && s.applied === 2 && s.bytes === 16 && s.files.length === 1 && s.files[0] === file &&
      s.blocks.length === 2 && s.blocks[0].block === 'main' && s.blocks[0].sha256 === wantSha && s.blocks[0].stock_sha256 === MODEL_INFO.rom_sha256 &&
      s.blocks[1].block === 'resource' && s.blocks[1].sha256 === stockRes && s.blocks[1].stock_sha256 === stockRes;

    // bin/debug.mjs: it loads no resource block, so the file's resource patch is refused; the main block's patch alone:
    // the bytes in the machine at both addresses, the summary in its JSON
    const mainOnly = path.join(tmp, 'main.json');
    fs.writeFileSync(mainOnly, JSON.stringify([{ block: 0, offset: TAIL, old: b64(tail), new: b64(NEW.subarray(0, 16)), label: 'tail padding' }]));
    const dr = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--stop', '0x502d0336', '--patch', file]);
    ok(dr.status === 1 && /^debug.mjs: --patch refused: .*tiny.json patch 1 \(index head as it is\): the resource block is not loaded here/.test(dr.stderr) && !dr.stdout,
      `debug.mjs refuses a resource-block patch: rc ${dr.status} ${dr.stderr.slice(0, 300)}`);
    const d = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--stop', '0x502d0336', '--patch', mainOnly, '--read', `${run}:16`, '--read', `${flash}:16`]);
    let dj = null;
    try { dj = JSON.parse(d.stdout); } catch { /* reported below */ }
    const hx = (a) => '0x' + a.toString(16).padStart(8, '0');
    const ds = dj?.patch;
    ok(d.status === 0 && dj && dj.memory[hx(run)] === hexNew && dj.memory[hx(flash)] === hexNew && /debug.mjs: patched: 1 patch \(16 bytes changed\)/.test(d.stderr) &&
      ds && ds.applied === 1 && ds.bytes === 16 && ds.blocks.length === 1 && ds.blocks[0].block === 'main' && ds.blocks[0].sha256 === wantSha,
      `debug.mjs --patch: rc ${d.status} ${JSON.stringify(dj?.memory)} ${JSON.stringify(ds)} ${d.stderr.slice(0, 300)}`);

    // bin/play.mjs: the line, the status, the session options, the bytes after the bring-up, session.json
    const pl = await startPlay('patch', ['--idle', 'off', '--patch', file]);
    try {
      ok(pl.lines.some((l) => l.startsWith('play: patched firmware: 2 patches (16 bytes changed) from ' + file + `; main block sha256 ${wantSha.slice(0, 16)}`)), `play's patched line: ${pl.lines.join(' | ')}`);
      const st = await pl.waitPhase((x) => x.phase === 'running' && x.gui_name, 120);
      ok(summaryOk(st.patch), `the status's patch: ${JSON.stringify(st.patch)}`);
      ok(st.phase === 'running' && st.error === null && typeof st.gui === 'string', `the session runs: ${st.phase} ${st.gui} ${st.gui_name} ${JSON.stringify(st.error)}`);
      const sess = await pl.json('GET', '/api/session');
      ok(summaryOk(sess.patch), `GET /api/session's patch: ${JSON.stringify(sess.patch)}`);
      const rd = await pl.json('POST', '/api/debug', { id: 1, op: 'read', addr: hx(run), size: 16 });
      ok(rd.ok && rd.hex === hexNew, `the live route reads the patched bytes after the bring-up: ${JSON.stringify(rd)}`);
      const sw = await pl.req('POST', '/api/model', { model: 'E146' });
      ok(sw.status === 409 && /--patch cannot switch/.test(String(sw.body)), `a model switch refused: ${sw.status} ${String(sw.body)}`);
    } finally {
      const rc = await pl.close();
      ok(rc === 0, `play exit ${rc}: ${pl.errs.join('').slice(-400)}`);
    }
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(pl.out, 'session.json'), 'utf8')); } catch { /* reported below */ }
    ok(doc && summaryOk(doc.patch) && !('patch' in doc.args), `session.json: patch ${JSON.stringify(doc?.patch)?.slice(0, 200)}, args ${Object.keys(doc?.args ?? {})}`);
    // its --replay without --patch: refused before the server starts, never run on the stock blocks
    const sj = path.join(pl.out, 'session.json');
    const rp = node([path.join(EMU, 'bin/play.mjs'), '--no-browser', '--out', path.join(tmp, 'replayed'), '--replay', sj], { timeout: 60000 });
    ok(rp.status === 1 && rp.stderr.startsWith(`play.mjs: --replay ${sj}: the session ran on patched firmware (2 patches (16 bytes changed) from ${file}; main block sha256 ${wantSha.slice(0, 16)}`) &&
      !/play: http/.test(rp.stdout) && !fs.existsSync(path.join(tmp, 'replayed')), `play.mjs --replay of the patched session without --patch: rc ${rp.status} ${rp.stderr.slice(0, 300)} ${rp.stdout.slice(0, 200)}`);

    // bin/nav.mjs: the line first, session.json's patch
    const navOut = path.join(tmp, 'nav');
    const n = node([path.join(EMU, 'bin/nav.mjs'), '--png', 'none', '--out', navOut, '--patch', file, 'DOWN']);
    let nd = null;
    try { nd = JSON.parse(fs.readFileSync(path.join(navOut, 'session.json'), 'utf8')); } catch { /* reported below */ }
    ok(n.status === 0 && n.stdout.startsWith('patched: 2 patches (16 bytes changed)') && nd && summaryOk(nd.patch), `nav.mjs --patch: rc ${n.status} ${n.stdout.slice(0, 200)} ${n.stderr.slice(-300)}`);

    // refusals: old bytes that differ, an overlap (two files), before any lab
    const wrong = path.join(tmp, 'wrong.json'), twice = path.join(tmp, 'twice.json');
    fs.writeFileSync(wrong, JSON.stringify([{ block: 0, offset: TAIL, old: b64(NEW.subarray(0, 4)), new: b64(tail.subarray(0, 4)) }]));
    fs.writeFileSync(twice, JSON.stringify([{ block: 'main', offset: TAIL + 8, old: b64(tail.subarray(0, 8)), new: b64(tail.subarray(0, 8)) }]));
    const gone = path.join(tmp, 'gone.json');           // never written
    for (const [what, files, re] of [['old bytes', [wrong], /old bytes differ from the stock main block at 0x01ffff00/], ['an overlap', [file, twice], /overlap in the main block/],
      ['a file that cannot be read', [gone], /gone.json: cannot read it \(ENOENT\)/]]) {
      const fl = files.flatMap((f) => ['--patch', f]);
      const dfl = fl.map((x) => x === file ? mainOnly : x);     // debug.mjs refuses the file's resource patch first
      const runs = [['debug.mjs', ['--entry', '0x502d0336', ...dfl], /^debug.mjs: --patch refused: /],
        ['play.mjs', ['--no-browser', '--idle', 'off', '--out', path.join(tmp, 'refused'), ...fl], /^play.mjs: --patch refused: /],
        ['nav.mjs', ['--png', 'none', '--out', path.join(tmp, 'refused-nav'), ...fl, 'DOWN'], /^error: --patch refused: /]];
      for (const [tool, args, head] of runs) {
        const x = node([path.join(EMU, 'bin', tool), ...args], { timeout: 60000 });
        ok(x.status === 1 && head.test(x.stderr) && re.test(x.stderr) && !/play: http/.test(x.stdout), `${tool} refuses ${what}: rc ${x.status} ${x.stderr.slice(0, 300)} ${x.stdout.slice(0, 200)}`);
      }
    }
    const both = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--patch', file, '--image', ORIGINAL]);
    ok(both.status === 2 && /not with --image/.test(both.stderr), `debug.mjs --patch with --image: rc ${both.status} ${both.stderr.slice(0, 200)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = patchUnits();
  console.log(`patch overlay units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let fail = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await patchSession();
    console.log(`patch overlay on E143 (debug.mjs, play.mjs, nav.mjs): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
