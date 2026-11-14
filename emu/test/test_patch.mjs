// Patch overlays (src/fw/patch.mjs, src/lab/patchaudit.mjs, --patch FILE and --main FILE on bin/play.mjs, bin/nav.mjs
// and bin/debug.mjs, bin/modelcheck.mjs):
//   patchUnits    (firmware-free) both file shapes read (om-c's {block, offset, old, new} in base64, the ND128
//                 manifest's {decoded_body_offset, before, after} in hex, artifacts/nd128/manifest.json itself), every
//                 malformed patch refused, the block references (indices, names), and on synthetic blocks: old bytes
//                 that differ refused, overlaps refused (in one file and across two, adjacent patches taken), a range
//                 outside the loaded part refused, and the applied overlay: the bytes, the stock blocks untouched, the
//                 counts and both digests; a --replay of a session.json that records a patch refused without an
//                 overlay (src/lab/player.mjs replayPatchRefusal), taken with one, and a session.jsonl not checked;
//                 digest-anchored runs (made-up om3-patch-1 / om3-patch-2 documents): taken, the changed ranges,
//                 frames and card_files reported as not applied, a wrong before or after digest, another main_base,
//                 a run out of range, overlapping runs, another file's main-block patch, an unknown format or field
//                 (a format that names an Object.prototype member or is no string too) and every malformed run
//                 refused; mainPatches' runs, a block of another length or the stock block itself refused; the lab's
//                 patch rules on a made-up image (an instruction on patched bytes, the hook rule and its neighbour, a
//                 pass-through observer let be and left out of the audit, the audit's hooks, ports, facts and line, a
//                 word fact checked over its 4 bytes, the changed bytes in the gaps the boot does not load and none
//                 beside them); H-PATCHTASK in the kernel's task
//                 guard (src/lab/kernel.mjs) on a made-up kernel, with its negative controls; the patched build's
//                 default S-NVRAM file (host/nvram.mjs)
//   patchSession  (E143's blocks) a patch file the test writes: 16 bytes of the main block's 0xFF tail padding
//                 (0x1ffff00, never run: the code ends at 0x1a70c3b) changed and 8 bytes of the resource block's index
//                 written as they are; bin/debug.mjs, which loads no resource block, refuses that file and reads the
//                 new bytes of the main block's patch alone at their flash address and, the tail lying past section
//                 10's loaded end, S-STALERAM's 0xA5 at their run-time address (--loaded off: the new bytes);
//                 bin/play.mjs prints the patched line, its status and GET /api/session carry the summary (the main
//                 block's sha256 the test computes, the resource block's the stock prefix's) and S-STALERAM, the live
//                 debug route reads 0xA5 and the new bytes at the flash view after the bring-up, the start line and the
//                 audit report the tail as where the boot does not load, the session runs, a model switch is refused, and session.json has
//                 the summary but no patch among its args; bin/nav.mjs prints the line and its session.json the summary;
//                 a file whose old bytes differ, an overlap and a file that cannot be read are refused by all three
//                 tools (exit 1) before any lab; play.mjs --replay of the patched session.json without --patch is
//                 refused before the server starts; the patched block as --main through debug.mjs (the loaded-ranges
//                 mode on as with --patch: 0xA5 at the run-time address and the start line; --loaded off: the new
//                 bytes, not checked) and nav.mjs (the audit's line, no port table on E143, the tail unloaded), --main
//                 with --patch and a block of another length refused by all three; the hook rule: a byte of malloc's
//                 hooked first instruction changed stops nav.mjs, the byte after it does not (and is loaded); a
//                 pass-through observer (obs-setting-value at a settings read's return) on patched bytes does not
//                 stop it: the instruction there moved to the tail behind a jmp, nav.mjs runs the stock run's steps
//                 (the controls: the jmp alone stops at the tail, a byte of SETTINGS_READ's hooked entry stops it)
//   patchModelSession  (another body, OM_EMU_MODEL; bin/test.mjs runs E147) see its head below
//   node emu/test/test_patch.mjs [--session] [--session-model]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PatchRefused, readPatchText, applyPatches, patchLayout, resolveBlock, patchLine, mainPatches } from '../src/fw/patch.mjs';
import { createHash } from '../src/util/sha256.mjs';
import { replayPatchRefusal } from '../src/lab/player.mjs';
import { PatchRanges, PatchHooked, auditTables, auditLine, unloadedRuns, unloadedLine, factLeaves } from '../src/lab/patchaudit.mjs';
import { LabTask } from '../src/lab/kernel.mjs';
import { IMAGE_BASE } from '../src/fw/model.mjs';
import { nvramChoice } from '../host/nvram.mjs';

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
  ok(replayPatchRefusal('session.json', JSON.stringify({ inputs: [], patch: {} }), null) === '--replay session.json: the session ran on patched firmware (a patch overlay): refused without --patch (give the same --patch FILE, or --main FILE, again)',
    'a patch field patchLine cannot read is still refused');
  ok(replayPatchRefusal('session.jsonl', logged, null) === null && replayPatchRefusal('session.json', '{', null) === null,
    'a session.jsonl and a malformed file are not this check\'s');

  // digest-anchored runs (caduceus-om3's om3-patch-1 / om3-patch-2 shape), made up here on the synthetic block: base
  // 0x1000, runs at run-time addresses
  const BASE = 0x1000, al = patchLayout({ ...info, image_base: BASE });
  const hx = (b) => Buffer.from(b).toString('hex');
  const patched = (runs) => { const b = main.slice(); for (const [at, bytes] of runs) b.set(bytes, at - BASE); return b; };
  const om3 = (runs, extra = {}) => ({ format: 'om3-patch-2', name: 'made up', version: 'v0', main_base: '0x1000', main_sha256_before: sha(main),
    main_sha256_after: sha(patched(runs)), changed_bytes: 0, runs: runs.map(([at, bytes]) => ['0x' + at.toString(16), hx(bytes)]),
    frames: { component: 2, base: '0x458c0000', layers: [] }, card_files: ['A.BIN', 'B.BIN'], ...extra });
  const runs = [[BASE + 0x20, [0x20, 0x99, 0x22]], [BASE + 0x40, [0xa0, 0xa1]]];       // 0x20 and 0x22 written as they are
  const anchored = (doc, src = 'r.json') => readPatchText(JSON.stringify(doc), src);
  const ar = applyPatches(blocks, anchored(om3(runs)), { layout: al, createHash });
  const want3 = patched(runs), as = ar.summary;
  ok(ar.blocks.main !== main && ar.blocks.main.every((x, i) => x === want3[i]) && main[0x21] === 0x21, 'om3-patch-2: the runs applied to a copy');
  ok(as.applied === 2 && as.bytes === 3 && as.blocks.length === 1 && as.blocks[0].sha256 === sha(want3) && as.blocks[0].stock_sha256 === sha(main),
    `om3-patch-2: the summary's counts and digests: ${JSON.stringify(as)}`);
  ok(JSON.stringify(ar.changed) === '[[33,1],[64,2]]', `the changed ranges: only the bytes that differ: ${JSON.stringify(ar.changed)}`);
  ok(as.not_applied?.length === 2 && as.not_applied[0].field === 'frames' && /component 2, a block the lab does not load/.test(as.not_applied[0].why) &&
    as.not_applied[1].field === 'card_files' && /^A.BIN, B.BIN: files for the card/.test(as.not_applied[1].why) && as.not_applied.every((x) => x.file === 'r.json'),
    `frames and card_files reported as not applied: ${JSON.stringify(as.not_applied)}`);
  ok(/; not applied: frames \(white Frame Art layers in container component 2, .*\), card_files \(A.BIN, B.BIN: /.test(patchLine(as)), `patchLine says what is not applied: ${patchLine(as)}`);
  const p1 = om3(runs, { format: 'om3-patch-1' });
  delete p1.frames; delete p1.card_files;
  const r1 = applyPatches(blocks, anchored(p1), { layout: al, createHash });
  ok(r1.summary.bytes === 3 && !('not_applied' in r1.summary) && !/not applied/.test(patchLine(r1.summary)), 'om3-patch-1 (no frames, no card_files): taken, nothing left out');
  ok(!('not_applied' in applyPatches(blocks, anchored(om3(runs, { frames: undefined, card_files: [] })), { layout: al, createHash }).summary), 'an empty card_files is nothing left out');
  const withRes = applyPatches(blocks, [...anchored(om3(runs)), ...readPatchText(text([p('resource', 0, [255], [7])]), 'res.json')], { layout: al, createHash });
  ok(withRes.summary.blocks.length === 2 && withRes.blocks.resource[0] === 7, 'another file\'s patch to the resource block taken with it');
  const a3 = (doc, re, what) => refuses(() => applyPatches(blocks, anchored(doc), { layout: al, createHash }), re, what);
  a3(om3(runs, { main_sha256_before: sha(want3) }), /r.json: main_sha256_before [0-9a-f]{16}\.\.\. is not the stock main block's .*: its runs carry no old bytes/, 'a before digest that is not the stock block\'s');
  a3(om3(runs, { main_sha256_after: sha(main) }), /r.json: the patched main block's sha256 [0-9a-f]{16}\.\.\. is not its main_sha256_after/, 'an after digest the runs do not give');
  a3(om3(runs, { main_base: '0x2000', runs: [['0x2020', '00']] }), /r.json: main_base 0x00002000 is not this model's image base 0x00001000/, 'another main_base');
  a3(om3([[BASE + 0xff, [0xff]]], { runs: [['0x10ff', 'ffee']] }), /r.json patch 0 \(run 0x000010ff\): 0x000000ff\+2 lies outside the main code block \(256 bytes\)/, 'a run past the block\'s end');
  a3(om3(runs, { runs: [['0x1020', '0000'], ['0x1021', '00']] }), /r.json patch 0 \(run 0x00001020\) .* and r.json patch 1 \(run 0x00001021\) .* overlap in the main block/, 'overlapping runs');
  refuses(() => applyPatches(blocks, [...anchored(om3(runs)), ...readPatchText(text([p(0, 0x80, [0x80], [0])]), 'o.json')], { layout: al, createHash }),
    /r.json: its runs are the whole change to the main block \(main_sha256_after\), and o.json patch 0 patches it too/, 'another file\'s patch to the main block');
  refuses(() => applyPatches({ resource }, anchored(om3(runs)), { layout: al, createHash }), /r.json: the main block is not loaded here/, 'no main block');
  const rd = (doc, re, what) => refuses(() => anchored(doc), re, what);
  rd(om3(runs, { format: 'om3-patch-3' }), /format "om3-patch-3": not one this reader knows \(om3-patch-1, om3-patch-2\)/, 'an unknown format');
  // a format that names an Object.prototype member, or is no string (a list's text would be 'om3-patch-2'): refused
  // as unknown, not a TypeError
  for (const f of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 2, ['om3-patch-2']]) {
    let m;
    try { m = refusal(() => anchored(om3(runs, { format: f }))); } catch (e) { m = `not a refusal: ${e.name}: ${e.message}`; }
    ok(m !== null && m.startsWith(`r.json: format ${JSON.stringify(f)}: not one this reader knows`), `the format ${JSON.stringify(f)}: ${m ?? 'taken'}`);
  }
  rd({ ...om3(runs), format: 'om3-patch-1' }, /om3-patch-1 field "frames": not one this reader knows, refused rather than left out/, 'frames in om3-patch-1');
  rd(om3(runs, { extra: 1 }), /field "extra": not one this reader knows/, 'an unknown field');
  rd(om3(runs, { frames: { component: 1 } }), /frames: not \{component: 2 or later/, 'frames in a block the lab loads');
  rd(om3(runs, { card_files: 'A.BIN' }), /card_files: not a list/, 'card_files not a list');
  const noRuns = om3(runs); delete noRuns.runs;
  rd(noRuns, /r.json: no runs/, 'no runs');
  rd(om3(runs, { runs: [] }), /runs is not a list of runs/, 'empty runs');
  rd(om3(runs, { main_sha256_before: 'abc' }), /main_sha256_before is not a sha256/, 'a malformed digest');
  rd(om3(runs, { runs: [['0x1020']] }), /r.json run 0: not \[address, hex\]/, 'a run without its bytes');
  rd(om3(runs, { runs: [['0x1020', 'abc']] }), /r.json run 0: its bytes is not hex/, 'odd hex in a run');
  rd(om3(runs, { runs: [['0x1020', '']] }), /r.json run 0: no bytes/, 'a run of no bytes');
  rd(om3(runs, { runs: [['0xfff', '00']] }), /address 0x00000fff lies below main_base 0x00001000/, 'a run below main_base');
  ok(readPatchText(JSON.stringify({ format: 'x', patches: [p(0, 1, [1], [2])] }), 'w.json').length === 1, 'an object with a patches list and a format field is the list shape');

  // --main: a whole patched block as runs of changed bytes against the stock block
  const whole = main.slice(); whole.set([0, 0], 5); whole[9] = 0xee; whole[255] = 0;
  const mp = mainPatches(main, whole, 'main.bin');
  ok(mp.length === 3 && mp[0].offset === 5 && mp[0].new.length === 2 && mp[1].offset === 9 && mp[2].offset === 255 && mp.every((x) => x.block === 'main' && x.source === 'main.bin'),
    `mainPatches: one patch per run: ${JSON.stringify(mp.map((x) => [x.offset, x.new.length]))}`);
  const mr = applyPatches(blocks, mp, { layout: al, createHash });
  ok(mr.summary.applied === 3 && mr.summary.bytes === 4 && mr.summary.blocks[0].sha256 === sha(whole) && JSON.stringify(mr.changed) === '[[5,2],[9,1],[255,1]]',
    `--main's overlay gives the block: ${JSON.stringify(mr.summary)} ${JSON.stringify(mr.changed)}`);
  refuses(() => mainPatches(main, whole.subarray(1), 'short.bin'), /short.bin: 255 bytes, the stock main code block 256/, 'a block of another length');
  refuses(() => mainPatches(main, main.slice(), 'same.bin'), /same.bin: the stock main code block itself/, 'the stock block itself');

  // the lab's patch rules (src/lab/patchaudit.mjs) on a made-up image at 0x60000000: 0xdd at 0x10 is a 7-byte call,
  // 0xcb at 0x30 a 1-byte return
  const image = new Uint8Array(0x100).fill(0xcb); image[0x10] = 0xdd;
  const pr = new PatchRanges([[0x14, 2], [0x40, 4]], image, 0x60000000);
  ok(pr.hit(0x13, 1) === null && pr.hit(0x14, 1)?.[0] === 0x14 && pr.hit(0x15, 1)?.[0] === 0x14 && pr.hit(0x16, 1) === null && pr.hit(0x3f, 2)?.[0] === 0x40 && pr.hit(0x44, 9) === null,
    'PatchRanges.hit: the ranges\' ends');
  ok(pr.code(0x60000010)?.[0] === 0x14 && pr.code(0x60000013) === null && pr.code(0x60000030) === null && pr.code(0x60000042)?.[0] === 0x40 && pr.code(0x5fffffff) === null && pr.code(0x60000100) === null,
    'an instruction on patched bytes: the 7-byte call whose operand changed, not the 1-byte return beside it; outside the image none');
  refuses(() => {
    try { pr.refuseHook(0x60000010, 'stub'); } catch (e) { if (e instanceof PatchHooked) throw new PatchRefused(e.message); throw e; }
  }, /lab hook stub reached at 0x60000010 \(disasm 0x50000010\), on bytes the patch overlay changed \(body 0x00000014\+2\): the lab's stand-in would run in place/, 'the hook rule: a hook reached on patched bytes stops the run');
  let quiet = true;
  try { pr.refuseHook(0x60000030, 'ret'); pr.refuseHook(0x60000017, 'next'); } catch { quiet = false; }
  ok(quiet, 'the hook rule: a hook beside the patched bytes runs');
  // a pass-through observer (src/lab/hle.mjs hook's pass) on the same patched instruction is let be: the patched bytes
  // run under it; the same pc without the flag still stops (the control)
  let passQuiet = true;
  try { pr.refuseHook(0x60000010, 'obs', true); } catch { passQuiet = false; }
  ok(passQuiet && refusal(() => { try { pr.refuseHook(0x60000010, 'obs', false); } catch (e) { if (e instanceof PatchHooked) throw new PatchRefused(e.message); throw e; } }) !== null,
    'the hook rule: a pass-through observer on patched bytes runs, the same hook without the flag stops');
  const au = auditTables(pr, { hooks: [[0x60000010, 'h1'], [0x60000030, 'h2'], [0xa0000000, 'ram']], len: 0x100,
    ports: { 0x50000010: [0x50001000], 0x50000042: [0x50002000, 0x50002002], 0x50000030: [0x50003000], 0x60000044: [0x60004000], 0x60000041: [0x60005000] },
    facts: [['t.a', 0x60000015], ['t.b', 0x60000016], ['n', 7], ['c', 0x50000040]] });
  ok(JSON.stringify(au.hooks) === '[{"at":"0x50000010","name":"h1"}]', `audit: the hooks on patched bytes: ${JSON.stringify(au.hooks)}`);
  ok(JSON.stringify(au.ported) === JSON.stringify([{ at: '0x50000042', e143: ['0x50002000', '0x50002002'] }, { at: '0x60000041', e143: ['0x60005000'] }, { at: '0x60000015', fact: 't.a' }, { at: '0x50000040', fact: 'c' }]),
    `audit: the ported addresses and facts on patched bytes (a hooked one is the hook's; data by its byte): ${JSON.stringify(au.ported)}`);
  ok(auditTables(pr, { hooks: [], ports: null, facts: null, len: 0x100 }).ported === null, 'audit: no tables (E143), ported null');
  // a pass-through observer is no hook that stops the session: left out, and a port at its pc is reported as ported
  const aup = auditTables(pr, { hooks: [[0x60000010, 'obs', true]], ports: { 0x50000010: [0x50001000] }, facts: [], len: 0x100 });
  ok(JSON.stringify(aup.hooks) === '[]' && JSON.stringify(aup.ported) === '[{"at":"0x50000010","e143":["0x50001000"]}]', `audit: a pass-through observer left out: ${JSON.stringify(aup)}`);
  // a fact naming a 32-bit word: checked over its 4 bytes (a patch to its byte +2 alone is reported), at its first byte
  // with width 1 (the control: not reported); factLeaves gives the section loader's end words width 4
  const pw = new PatchRanges([[0x42, 1]], image, 0x60000000);
  const fw4 = auditTables(pw, { hooks: [], ports: {}, facts: [['w', 0x60000040, 4]], len: 0x100 }), fw1 = auditTables(pw, { hooks: [], ports: {}, facts: [['w', 0x60000040, 1]], len: 0x100 });
  ok(JSON.stringify(fw4.ported) === '[{"at":"0x60000040","fact":"w"}]' && JSON.stringify(fw1.ported) === '[]', `audit: a word fact's byte +2 patched: width 4 ${JSON.stringify(fw4.ported)}, width 1 ${JSON.stringify(fw1.ported)}`);
  ok(JSON.stringify(factLeaves({ sections: { ends: [0x60000040, 0x60000044], table: 0x60000080 }, n: 7 })) === JSON.stringify([['sections.ends[0]', 0x60000040, 4], ['sections.ends[1]', 0x60000044, 4], ['sections.table', 0x60000080, 1], ['n', 7, 1]]),
    'factLeaves: the end words 4 bytes wide, any other fact 1');
  ok(auditLine(au, ['0x50000020']) === '1 lab hook(s) on patched bytes, each stopping the session when reached: h1 0x50000010' +
    '; 4 ported address(es) or fact(s) on patched bytes, which the lab calls or reads as patched: 0x50000042 (E143 0x50002000, 0x50002002), 0x60000041 (E143 0x60005000), 0x60000015 (fact t.a), 0x50000040 (fact c); H-PATCHTASK: 0x50000020',
    `auditLine: ${auditLine(au, ['0x50000020'])}`);
  // the changed bytes where the boot does not load (S-STALERAM's gaps): the pieces inside a gap, none outside, nothing
  // checked with the mode off
  const loads = { gaps: [{ lo: 0x60000040, hi: 0x60000042, n: 3, end: 0x60000040, word: 0x60000400 }, { lo: 0x60000080, hi: 0x60000100, n: 4, end: 0x60000080, word: 0x60000404 }] };
  const ur = unloadedRuns([[0x14, 2], [0x3e, 6], [0x7f, 0x81]], loads, 0x60000000);
  ok(JSON.stringify(ur) === JSON.stringify([{ at: '0x60000040', len: 2, n: 3, end: '0x60000040', word: '0x60000400' }, { at: '0x60000080', len: 0x80, n: 4, end: '0x60000080', word: '0x60000404' }]),
    `unloadedRuns: the pieces in the gaps: ${JSON.stringify(ur)}`);
  ok(JSON.stringify(unloadedRuns([[0x14, 2], [0x42, 0x3e]], loads, 0x60000000)) === '[]' && unloadedRuns([[0x40, 1]], null, 0x60000000) === null,
    'unloadedRuns: changed bytes beside the gaps give none; the mode off, null');
  ok(unloadedLine(ur).startsWith('2 patched range(s) where the boot does not load, stale RAM on the camera') && unloadedLine(ur).endsWith("0x60000080+128 (past section 4's loaded end 0x60000080, its end word at 0x60000404)") &&
    unloadedLine([]) === 'no patched byte where the boot does not load or is not shown to load' && /not checked/.test(unloadedLine(null)) &&
    auditLine({ ...au, unloaded: ur }).includes('; 2 patched range(s) where the boot does not load'), `unloadedLine: ${unloadedLine(ur)}`);
  // the ranges not shown to be loaded (bootLoads' unshown): their own class, after the gaps' pieces, and a line that
  // never calls them clean (alone: not 'no patched byte where the boot does not load')
  const withU = { ...loads, unshown: [{ lo: 0x60000020, hi: 0x60000030, kind: 'head', copy: { at: 0x50000144 } }, { lo: 0x60000060, hi: 0x60000070, kind: 'stored', copy: null }] };
  const uu = unloadedRuns([[0x1e, 4], [0x3e, 6], [0x6f, 1]], withU, 0x60000000);
  ok(JSON.stringify(uu) === JSON.stringify([{ at: '0x60000040', len: 2, n: 3, end: '0x60000040', word: '0x60000400' },
    { at: '0x60000020', len: 2, unshown: 'head', lo: '0x60000020', hi: '0x60000030', copy: '0x50000144' }, { at: '0x6000006f', len: 1, unshown: 'stored', lo: '0x60000060', hi: '0x60000070', copy: null }]),
  `unloadedRuns: the pieces not shown loaded: ${JSON.stringify(uu)}`);
  const alone = unloadedLine(uu.slice(1)), mixed = unloadedLine(uu);
  ok(alone.startsWith('2 patched range(s) where the boot is not shown to load (?)') && !alone.includes('no patched byte') && !alone.includes('where the boot does not load') &&
    alone.includes("0x60000020+2 (in 0x60000020..0x60000030, past the reset head's copies, below section 1, after the head copy at 0x50000144)") && alone.endsWith('0x6000006f+1 (in 0x60000060..0x60000070, up to an end the reset head stores and never loads)') &&
    mixed.startsWith('1 patched range(s) where the boot does not load') && mixed.includes('; 2 patched range(s) where the boot is not shown to load (?)'), `unloadedLine with unshown: ${alone} / ${mixed}`);

  // H-PATCHTASK: the kernel's task guard (src/lab/kernel.mjs LabTask._task_start) on a made-up kernel: an entry on
  // patched bytes starts and is listed, once; any other entry the lab does not model is refused, with or without an
  // overlay
  const timage = new Uint8Array(0x400).fill(0xcb), steps = [];
  const fake = (patch) => ({ hle: { sim: { read: () => new Uint8Array([0xcb, 0xcb, 0xcb]), packet: (x) => steps.push(x) }, patch } });
  const lt = new LabTask(fake(new PatchRanges([[0x100, 8]], timage, IMAGE_BASE)));
  lt._task_start(null, { a2: IMAGE_BASE + 0x104, d2: 0 });
  lt._task_start(null, { a2: IMAGE_BASE + 0x104, d2: 0 });
  ok(JSON.stringify(lt.patch_tasks) === JSON.stringify([0x50000104]) && steps.length === 2, `H-PATCHTASK: the patch's task starts, listed once: ${JSON.stringify(lt.patch_tasks)}`);
  const guard = (task, entry) => { try { task._task_start(null, { a2: entry, d2: 5 }); return null; } catch (e) { return e.message; } };
  const m1 = guard(lt, IMAGE_BASE + 0x200), m2 = guard(new LabTask(fake(null)), IMAGE_BASE + 0x104);
  ok(/kernel would start firmware task entry 0x50000200 \(exinf 0x5\): not modelled/.test(m1 ?? '') && /0x50000104 .*not modelled/.test(m2 ?? '') && lt.patch_tasks.length === 1,
    `the guard refuses an entry beside the patched bytes (${m1}) and any entry without an overlay (${m2})`);

  // the default S-NVRAM file of patched firmware: the build's own (host/nvram.mjs)
  const nb = nvramChoice({ arg: null, env: null, model: 'E147', build: 'ab'.repeat(32) }), ns = nvramChoice({ arg: null, env: null, model: 'E147' });
  ok(/\/\.om-emu\/nvram-E147-abababab\.json$/.test(nb.file) && /\/\.om-emu\/nvram-E147\.json$/.test(ns.file) && /S-NVRAM, the patched build's own file \(its main code block's sha256 abababab\.\.\.\)/.test(nb.line) && !/patched/.test(ns.line),
    `the default file keyed by the build: ${nb.file} | ${nb.line}`);
  const ne = nvramChoice({ arg: '/tmp/x.json', env: null, model: 'E147', build: 'ab'.repeat(32) });
  ok(ne.file === '/tmp/x.json' && !/patched/.test(ne.line), 'an explicit --nvram FILE is used as given');
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
    // (the tail lies past section 10's loaded end: with --patch the loaded-ranges mode is on by default, S-STALERAM,
    // and its DRAM holds the fill, 0xA5, while the flash view holds the patch; --loaded off maps the whole block)
    const stale = 'a5'.repeat(16);
    const d = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--stop', '0x502d0336', '--patch', mainOnly, '--read', `${run}:16`, '--read', `${flash}:16`]);
    let dj = null;
    try { dj = JSON.parse(d.stdout); } catch { /* reported below */ }
    const hx = (a) => '0x' + a.toString(16).padStart(8, '0');
    const ds = dj?.patch;
    ok(d.status === 0 && dj && dj.memory[hx(run)] === stale && dj.memory[hx(flash)] === hexNew && /debug.mjs: patched: 1 patch \(16 bytes changed\)/.test(d.stderr) &&
      ds && ds.applied === 1 && ds.bytes === 16 && ds.blocks.length === 1 && ds.blocks[0].block === 'main' && ds.blocks[0].sha256 === wantSha,
      `debug.mjs --patch: rc ${d.status} ${JSON.stringify(dj?.memory)} ${JSON.stringify(ds)} ${d.stderr.slice(0, 300)}`);
    const dOff = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--stop', '0x502d0336', '--patch', mainOnly, '--loaded', 'off', '--read', `${run}:16`]);
    let dOffJ = null;
    try { dOffJ = JSON.parse(dOff.stdout); } catch { /* reported below */ }
    ok(dOff.status === 0 && dOffJ?.memory[hx(run)] === hexNew, `debug.mjs --patch --loaded off: rc ${dOff.status} ${JSON.stringify(dOffJ?.memory)} ${dOff.stderr.slice(0, 300)}`);

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
      const rf = await pl.json('POST', '/api/debug', { id: 2, op: 'read', addr: hx(flash), size: 16 });
      ok(rd.ok && rd.hex === stale && rf.ok && rf.hex === hexNew && st.stand_ins?.includes('S-STALERAM'),
        `the live route after the bring-up: the patched tail's DRAM ${rd.hex} (S-STALERAM), its flash view ${rf.hex}, the stand-ins ${st.stand_ins?.filter((x) => /STALE/.test(x))}`);
      const un = st.patch_audit?.unloaded ?? [];
      ok(JSON.stringify(st.patch_audit?.hooks) === '[]' && st.patch_audit.ported === null && JSON.stringify(st.patch_audit.tasks) === '[]' &&
        un.length === 1 && un[0].at === hx(run) && un[0].len === 16 && un[0].n === 10 && !st.stand_ins.includes('H-PATCHTASK'),
        `the status's patch audit on E143: no hook on the patched bytes, no port table, the tail past section 10's end: ${JSON.stringify(st.patch_audit)}`);
      ok(pl.lines.some((l) => l.startsWith(`play: patch audit: 1 patched range(s) where the boot does not load`) && l.includes(`${hx(run)}+16 (past section 10's loaded end`)),
        `play's start line on the tail the boot does not load: ${pl.lines.join(' | ')}`);
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
        ['play.mjs', ['--no-browser', '--nvram', 'off', '--idle', 'off', '--out', path.join(tmp, 'refused'), ...fl], /^play.mjs: --patch refused: /],
        ['nav.mjs', ['--png', 'none', '--out', path.join(tmp, 'refused-nav'), ...fl, 'DOWN'], /^error: --patch refused: /]];
      for (const [tool, args, head] of runs) {
        const x = node([path.join(EMU, 'bin', tool), ...args], { timeout: 60000 });
        ok(x.status === 1 && head.test(x.stderr) && re.test(x.stderr) && !/play: http/.test(x.stdout), `${tool} refuses ${what}: rc ${x.status} ${x.stderr.slice(0, 300)} ${x.stdout.slice(0, 200)}`);
      }
    }
    // --main: the patched block itself (want, written here) as the same overlay: debug.mjs reads the bytes, nav.mjs runs
    // it with the audit's line; --main with --patch, a block of another length, refused
    const mainBin = path.join(tmp, 'main.bin');
    fs.writeFileSync(mainBin, want);
    // (--main is an overlay as --patch is: the loaded-ranges mode on by default, the tail's DRAM the fill, reported at the
    // start; --loaded off maps it)
    const dm = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--stop', '0x502d0336', '--main', mainBin, '--read', `${run}:16`, '--read', `${flash}:16`]);
    let dmj = null;
    try { dmj = JSON.parse(dm.stdout); } catch { /* reported below */ }
    ok(dm.status === 0 && dmj?.memory?.[hx(run)] === stale && dmj.memory[hx(flash)] === hexNew && /debug.mjs: patch audit: 1 patched range\(s\) where the boot does not load/.test(dm.stderr) && dmj.patch?.applied === 1 && dmj.patch.bytes === 16 && dmj.patch.blocks[0].sha256 === wantSha &&
      dmj.patch.files[0] === mainBin && /debug.mjs: patched: 1 patch \(16 bytes changed\) from .*main.bin; main block sha256 /.test(dm.stderr),
      `debug.mjs --main: rc ${dm.status} ${JSON.stringify(dmj?.memory)} ${JSON.stringify(dmj?.patch)} ${dm.stderr.slice(0, 400)}`);
    const dmOff = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--stop', '0x502d0336', '--main', mainBin, '--loaded', 'off', '--read', `${run}:16`]);
    let dmOffJ = null;
    try { dmOffJ = JSON.parse(dmOff.stdout); } catch { /* reported below */ }
    ok(dmOff.status === 0 && dmOffJ?.memory?.[hx(run)] === hexNew && /debug.mjs: patch audit: the loaded ranges not checked/.test(dmOff.stderr),
      `debug.mjs --main --loaded off: rc ${dmOff.status} ${JSON.stringify(dmOffJ?.memory)} ${dmOff.stderr.slice(0, 300)}`);
    const navMain = path.join(tmp, 'nav-main');
    const nm = node([path.join(EMU, 'bin/nav.mjs'), '--png', 'none', '--out', navMain, '--main', mainBin, 'DOWN']);
    let nmj = null;
    try { nmj = JSON.parse(fs.readFileSync(path.join(navMain, 'session.json'), 'utf8')); } catch { /* reported below */ }
    ok(nm.status === 0 && nm.stdout.startsWith(`patched: 1 patch (16 bytes changed) from ${mainBin}; main block sha256 ${wantSha.slice(0, 16)}`) &&
      nm.stdout.includes('patch audit: no lab hook on patched bytes; ports and facts not audited (E143: the lab\'s own build)') &&
      /\npatch audit: 1 patched range\(s\) where the boot does not load/.test(nm.stdout) &&
      nmj?.patch?.blocks?.[0]?.sha256 === wantSha && JSON.stringify({ ...nmj.patch_audit, unloaded: nmj.patch_audit?.unloaded?.length }) === '{"hooks":[],"ported":null,"unloaded":1,"tasks":[]}',
      `nav.mjs --main: rc ${nm.status} ${nm.stdout.slice(0, 400)} ${JSON.stringify(nmj?.patch_audit)} ${nm.stderr.slice(-300)}`);
    for (const [tool, args] of [['debug.mjs', ['--entry', '0x502d0336']], ['play.mjs', ['--no-browser', '--nvram', 'off']], ['nav.mjs', ['--png', 'none', 'DOWN']]]) {
      const x = node([path.join(EMU, 'bin', tool), ...args, '--main', mainBin, '--patch', file], { timeout: 60000 });
      ok(x.status === 2 && /--main and --patch exclude each other/.test(x.stderr), `${tool} --main with --patch: rc ${x.status} ${x.stderr.slice(0, 200)}`);
      const shortBin = path.join(tmp, 'short.bin');
      fs.writeFileSync(shortBin, want.subarray(0, 1000));
      const y = node([path.join(EMU, 'bin', tool), ...args.filter((v) => v !== 'DOWN'), ...(tool === 'play.mjs' ? ['--out', path.join(tmp, 'refused-main')] : []), '--main', shortBin, ...(tool === 'nav.mjs' ? ['DOWN'] : [])], { timeout: 60000 });
      ok(y.status === 1 && /--main refused: .*short.bin: 1000 bytes, the stock main code block 33554368/.test(y.stderr) && !/play: http/.test(y.stdout),
        `${tool} --main of another length: rc ${y.status} ${y.stderr.slice(0, 300)}`);
    }

    // the hook rule (src/lab/patchaudit.mjs): a byte of the first instruction at malloc (0x50002fdc, hooked by the
    // lab's S-HEAP) changed stops the session when the hook is reached; the byte after that instruction changed does
    // not (malloc's own code never runs under the stand-in)
    const MALLOC = 0x2fdc;
    const len4 = main[MALLOC] === 0xfa;                     // fa: a 4-byte instruction (src/core/cpu.mjs insnLength)
    ok(len4, `malloc's first instruction is 4 bytes long: ${Buffer.from(main.subarray(MALLOC, MALLOC + 4)).toString('hex')}`);
    for (const [at, stops] of [[MALLOC + 1, true], [MALLOC + 4, false]]) {
      const hf = path.join(tmp, `hook-${at}.json`), hout = path.join(tmp, `nav-hook-${at}`);
      fs.writeFileSync(hf, JSON.stringify([{ block: 0, offset: at, old: b64(main.subarray(at, at + 1)), new: b64([main[at] ^ 0xff]) }]));
      const h = node([path.join(EMU, 'bin/nav.mjs'), '--png', 'none', '--out', hout, '--patch', hf, 'DOWN']);
      ok(stops ? h.status === 1 && /^error: lab hook malloc reached at 0x[0-9a-f]{8} \(disasm 0x50002fdc\), on bytes the patch overlay changed \(body 0x00002fdd\+1\): the lab's stand-in would run in place of the patched code/.test(h.stderr)
        : h.status === 0 && h.stdout.includes('patch audit: no lab hook on patched bytes') && h.stdout.includes('patch audit: no patched byte where the boot does not load'),
      `the hook rule, a byte ${at - MALLOC} past malloc's entry: rc ${h.status} ${h.stderr.slice(0, 300)} ${h.stdout.slice(0, 200)}`);
    }
    // the hook rule spares a pass-through observer (src/lab/hle.mjs hook's pass): obs-setting-value, at the return of
    // SETTINGS_READ's call in the menu's reader (0x50b4e88a), records the read's value and single-steps the instruction
    // there. That instruction and the 4 bytes after it (5 bytes, up to the reader's ret) replaced by a jmp to a copy of
    // them in the code's 0xFF tail (0x1a70c40, which the boot loads): nav.mjs runs, and its steps are the stock run's,
    // DOWN's settings reads (all returning there) with their values. Controls: the jmp without the copy stops at the
    // tail, so the patched bytes ran under the observer; a byte of SETTINGS_READ's own hooked entry (obs-setting, which
    // can finish the read in the lab's place) changed still stops the session
    const RA = 0xb4e88a, CAVE = 0x1a70c40, SETTINGS_READ = 0xb7b618;
    ok(main[RA] === 0x62 && main[RA + 2] === 0xdf && main.subarray(CAVE, CAVE + 5).every((x) => x === 0xff),
      `the reader's return: ${Buffer.from(main.subarray(RA, RA + 5)).toString('hex')} (mov d0,(a2); clr d0; ret), the tail ${Buffer.from(main.subarray(CAVE, CAVE + 5)).toString('hex')}`);
    const jmp = Buffer.alloc(5); jmp[0] = 0xdc; jmp.writeInt32LE(CAVE - RA, 1);      // jmp (d32,pc), 5 bytes (src/core/cpu.mjs)
    const navRun = (name, list) => {
      const pf = path.join(tmp, `${name}.json`), out = path.join(tmp, `nav-${name}`);
      if (list) fs.writeFileSync(pf, JSON.stringify(list));
      const r = node([path.join(EMU, 'bin/nav.mjs'), '--png', 'none', '--out', out, ...(list ? ['--patch', pf] : []), 'DOWN']);
      let doc = null;
      try { doc = JSON.parse(fs.readFileSync(path.join(out, 'session.json'), 'utf8')); } catch { /* reported below */ }
      return { r, steps: doc?.steps ? JSON.stringify(doc.steps.map(({ seconds, ...s }) => s)) : null, down: doc?.steps?.[1]?.settings ?? null };
    };
    const stockNav = navRun('stock', null);
    const viaCave = navRun('cave', [{ block: 0, offset: RA, old: b64(main.subarray(RA, RA + 5)), new: b64(jmp) }, { block: 0, offset: CAVE, old: b64(main.subarray(CAVE, CAVE + 5)), new: b64(main.subarray(RA, RA + 5)) }]);
    ok(stockNav.r.status === 0 && viaCave.r.status === 0 && !/lab hook/.test(viaCave.r.stderr) && viaCave.r.stdout.includes('patch audit: no lab hook on patched bytes') &&
      viaCave.r.stdout.includes('patch audit: no patched byte where the boot does not load') && viaCave.steps === stockNav.steps && viaCave.down?.length > 0 && viaCave.down.every(([, v]) => v !== null),
      `the hook rule spares obs-setting-value on patched bytes: rc ${viaCave.r.status} ${viaCave.r.stderr.slice(0, 300)}; DOWN's settings ${JSON.stringify(viaCave.down)} against the stock run's ${JSON.stringify(stockNav.down)}; steps equal ${viaCave.steps === stockNav.steps}`);
    const jmpOnly = navRun('jmp', [{ block: 0, offset: RA, old: b64(main.subarray(RA, RA + 5)), new: b64(jmp) }]);
    ok(jmpOnly.r.status === 1 && /^error: stopped at 0x[0-9a-f]{8} \(disasm 0x51a70c40\)/.test(jmpOnly.r.stderr),
      `control: the jmp without its copy stops at the tail: rc ${jmpOnly.r.status} ${jmpOnly.r.stderr.slice(0, 300)}`);
    const entry = navRun('entry', [{ block: 0, offset: SETTINGS_READ, old: b64(main.subarray(SETTINGS_READ, SETTINGS_READ + 1)), new: b64([main[SETTINGS_READ] ^ 1]) }]);
    ok(entry.r.status === 1 && /^error: lab hook obs-setting reached at 0x[0-9a-f]{8} \(disasm 0x50b7b618\), on bytes the patch overlay changed/.test(entry.r.stderr),
      `control: a byte of SETTINGS_READ's hooked entry stops the session: rc ${entry.r.status} ${entry.r.stderr.slice(0, 300)}`);
    const both = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x502d0336', '--patch', file, '--image', ORIGINAL]);
    ok(both.status === 2 && /not with --image/.test(both.stderr), `debug.mjs --patch with --image: rc ${both.status} ${both.stderr.slice(0, 200)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { checks, bad };
}

// ---- another body's blocks (OM_EMU_MODEL, a process of its own: bin/test.mjs runs it on E147) ----------------------
// A digest-anchored file the test writes (om3-patch-2, caduceus-om3's release shape, made up: one run of 16 bytes in
// the main block's 0xFF tail padding at 0x1ffff00, past section 10's loaded end, frames and card_files) and the block
// it gives as --main: debug.mjs reads the run's bytes at the flash view and 0xA5 at run time through both, with the start
// line naming the unloaded run; play.mjs prints the patched line with what is not applied, keeps the camera's
// state in the build's own default file (under a HOME of the test's), its status carries the summary and the audit
// (no hook, no ported address on the tail, the tail unloaded), the live route reads 0xA5 and the flash view's bytes,
// S-STALERAM and S-SECLOADED listed, session.json has both; play.mjs --main prints the same summary and runs in the
// loaded-ranges mode too; a file whose before digest is not the stock block's is refused by play.mjs and by
// modelcheck (one model), and modelcheck refuses an overlay with two models
export async function patchModelSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { ORIGINAL, readBytes } = await import('../checks/lib/env.mjs');
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { startPlay } = await import('./test_host.mjs');
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-patch-model-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  const hx = (a) => '0x' + (a >>> 0).toString(16).padStart(8, '0');
  try {
    const main = readBytes(ORIGINAL);
    const TAIL = 0x1ffff00, run = MODEL_INFO.image_base + TAIL, flash = 0x50000000 + TAIL, stale = 'a5'.repeat(16);
    ok(main.subarray(TAIL, TAIL + 16).every((x) => x === 0xff), `${MODEL}: 0xFF padding at ${hx(TAIL)}`);
    const NEW = Buffer.from('om-emu om3 test.'), want = main.slice();
    want.set(NEW, TAIL);
    const wantSha = sha(want), stockSha = MODEL_INFO.rom_sha256;
    const doc = { format: 'om3-patch-2', name: 'om-emu test', version: 'v0', main_base: hx(MODEL_INFO.image_base), main_sha256_before: stockSha,
      main_sha256_after: wantSha, changed_bytes: 16, runs: [[hx(run), NEW.toString('hex')]], frames: { component: 2, base: '0x0', layers: [] }, card_files: ['T.BIN'] };
    const file = path.join(tmp, 'patch.json'), mainBin = path.join(tmp, 'main.bin'), wrong = path.join(tmp, 'wrong.json');
    fs.writeFileSync(file, JSON.stringify(doc));
    fs.writeFileSync(mainBin, want);
    fs.writeFileSync(wrong, JSON.stringify({ ...doc, main_sha256_before: wantSha }));
    const summaryOk = (s, f, n) => s && s.applied === n && s.bytes === 16 && s.files[0] === f && s.blocks.length === 1 && s.blocks[0].sha256 === wantSha && s.blocks[0].stock_sha256 === stockSha;
    const notApplied = 'not applied: frames (white Frame Art layers in container component 2, a block the lab does not load), card_files (T.BIN: files for the card, not in this file)';

    // debug.mjs: the bytes through the file and through the block, both in the loaded-ranges mode (on by default with
    // either overlay: the tail lies past section 10's loaded end, so its DRAM holds the fill, reported at the start, and
    // the flash view the run's bytes)
    for (const [opt, f] of [['--patch', file], ['--main', mainBin]]) {
      const d = node([path.join(EMU, 'bin/debug.mjs'), '--entry', '0x50000000', '--stop', '0x50000000', opt, f, '--read', `${run}:16`, '--read', `${flash}:16`], { env: { ...process.env, OM_EMU_MODEL: MODEL } });
      let dj = null;
      try { dj = JSON.parse(d.stdout); } catch { /* reported below */ }
      ok(d.status === 0 && dj?.memory?.[hx(run)] === stale && dj.memory[hx(flash)] === NEW.toString('hex') && summaryOk(dj.patch, f, 1) &&
        d.stderr.includes(`debug.mjs: patch audit: 1 patched range(s) where the boot does not load`) && d.stderr.includes(`${hx(run)}+16 (past section 10's loaded end`),
      `${MODEL} debug.mjs ${opt}: rc ${d.status} ${JSON.stringify(dj?.memory)} ${JSON.stringify(dj?.patch)} ${d.stderr.slice(0, 400)}`);
    }

    // play.mjs --patch, its default state file the build's own under the test's HOME
    const home = path.join(tmp, 'home');
    const pl = await startPlay('patch-model', ['--model', MODEL, '--idle', 'off', '--nvram', 'on', '--patch', file], { env: { ...process.env, HOME: home } });
    const nvFile = path.join(home, '.om-emu', `nvram-${MODEL}-${wantSha.slice(0, 8)}.json`);
    try {
      ok(pl.lines.some((l) => l === `play: patched firmware: 1 patch (16 bytes changed) from ${file}; main block sha256 ${wantSha.slice(0, 16)} (stock ${stockSha.slice(0, 16)}); ${notApplied}`),
        `${MODEL} play's patched line: ${pl.lines.join(' | ')}`);
      ok(pl.lines.some((l) => l === `play: settings and clock kept in ${nvFile} (S-NVRAM, the patched build's own file (its main code block's sha256 ${wantSha.slice(0, 8)}...); --nvram off for a blank camera)`),
        `${MODEL} play's state file: ${pl.lines.join(' | ')}`);
      const st = await pl.waitPhase((x) => x.phase === 'running' && x.gui_name, 180);
      ok(summaryOk(st.patch, file, 1) && st.patch.not_applied?.map((x) => x.field).join() === 'frames,card_files', `${MODEL} the status's patch: ${JSON.stringify(st.patch)}`);
      const un = st.patch_audit?.unloaded ?? [];
      ok(JSON.stringify(st.patch_audit?.hooks) === '[]' && JSON.stringify(st.patch_audit.ported) === '[]' && JSON.stringify(st.patch_audit.tasks) === '[]' &&
        un.length === 1 && un[0].at === hx(run) && un[0].len === 16 && un[0].n === 10 && st.error === null, `${MODEL} the status's audit: ${JSON.stringify(st.patch_audit)} ${JSON.stringify(st.error)}`);
      ok(pl.lines.some((l) => l.startsWith('play: patch audit: 1 patched range(s) where the boot does not load')), `${MODEL} play's start line on the unloaded tail: ${pl.lines.join(' | ')}`);
      const rd = await pl.json('POST', '/api/debug', { id: 1, op: 'read', addr: hx(run), size: 16 });
      const rf = await pl.json('POST', '/api/debug', { id: 2, op: 'read', addr: hx(flash), size: 16 });
      ok(rd.ok && rd.hex === stale && rf.ok && rf.hex === NEW.toString('hex') && st.stand_ins?.includes('S-STALERAM') && st.stand_ins.includes('S-SECLOADED'),
        `${MODEL} the live route: the run's DRAM ${rd.hex} (S-STALERAM), its flash view ${rf.hex}; stand-ins ${st.stand_ins}`);
    } finally {
      const rc = await pl.close();
      ok(rc === 0, `${MODEL} play exit ${rc}: ${pl.errs.join('').slice(-400)}`);
    }
    let sj = null;
    try { sj = JSON.parse(fs.readFileSync(path.join(pl.out, 'session.json'), 'utf8')); } catch { /* reported below */ }
    ok(summaryOk(sj?.patch, file, 1) && JSON.stringify({ ...sj.patch_audit, unloaded: sj.patch_audit?.unloaded?.length }) === '{"hooks":[],"ported":[],"unloaded":1,"tasks":[]}', `${MODEL} session.json: ${JSON.stringify(sj?.patch)?.slice(0, 300)} ${JSON.stringify(sj?.patch_audit)}`);
    ok(!fs.existsSync(path.join(home, '.om-emu', `nvram-${MODEL}.json`)), `${MODEL}: the stock default state file untouched`);

    // play.mjs --main: the same block, the same summary but its file; then the refusals
    const pm = await startPlay('patch-model-main', ['--model', MODEL, '--idle', 'off', '--main', mainBin]);
    try {
      ok(pm.lines.some((l) => l === `play: patched firmware: 1 patch (16 bytes changed) from ${mainBin}; main block sha256 ${wantSha.slice(0, 16)} (stock ${stockSha.slice(0, 16)})`),
        `${MODEL} play --main's line: ${pm.lines.join(' | ')}`);
      const sess = await pm.json('GET', '/api/session');
      ok(summaryOk(sess.patch, mainBin, 1), `${MODEL} play --main's session: ${JSON.stringify(sess.patch)}`);
      // --main keys the loaded-ranges mode as --patch does
      const ms = await pm.waitPhase((x) => x.phase === 'running' && x.gui_name, 180);
      ok(ms.stand_ins?.includes('S-STALERAM') && ms.patch_audit?.unloaded?.length === 1 && pm.lines.some((l) => l.startsWith('play: patch audit: 1 patched range(s)')),
        `${MODEL} play --main in the loaded-ranges mode: ${JSON.stringify(ms.stand_ins)} ${JSON.stringify(ms.patch_audit)}`);
    } finally {
      const rc = await pm.close();
      ok(rc === 0, `${MODEL} play --main exit ${rc}: ${pm.errs.join('').slice(-400)}`);
    }
    const pw = node([path.join(EMU, 'bin/play.mjs'), '--model', MODEL, '--no-browser', '--nvram', 'off', '--out', path.join(tmp, 'refused'), '--patch', wrong], { timeout: 60000 });
    ok(pw.status === 1 && /^play.mjs: --patch refused: .*wrong.json: main_sha256_before [0-9a-f]{16}\.\.\. is not the stock main block's/.test(pw.stderr) && !/play: http/.test(pw.stdout),
      `${MODEL} play.mjs refuses a before digest that is not the stock block's: rc ${pw.status} ${pw.stderr.slice(0, 300)}`);
    const mw = node([path.join(EMU, 'bin/modelcheck.mjs'), '--patch', wrong, MODEL], { timeout: 120000 });
    ok(mw.status === 1 && mw.stdout.includes(`: FAILED --patch refused: ${wrong}: main_sha256_before`), `${MODEL} modelcheck --patch refused: rc ${mw.status} ${mw.stdout.slice(0, 300)} ${mw.stderr.slice(-300)}`);
    const m2 = node([path.join(EMU, 'bin/modelcheck.mjs'), '--patch', file, MODEL, 'E143'], { timeout: 60000 });
    ok(m2.status === 2 && /--patch runs on one model, named .*: 2 given/.test(m2.stderr), `${MODEL} modelcheck --patch with two models: rc ${m2.status} ${m2.stderr.slice(0, 200)}`);
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
  if (process.argv.includes('--session-model')) {
    const s = await patchModelSession();
    console.log(`patch overlay on ${process.env.OM_EMU_MODEL ?? 'E143'} (an om3-patch-2 file and --main; debug.mjs, play.mjs, modelcheck): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
