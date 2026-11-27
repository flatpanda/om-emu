// E-M1 III Mod Builder packs (dfeldt91-blip/E-M1-Miii builder/mods.json, src/fw/patch.mjs readMods), --main's resource
// block, and a container whose only change is its main block's version field (src/fw/identify.mjs, src/fw/patch.mjs
// mainFilePatches):
//   modsUnits    (firmware-free) a made-up pack on made-up blocks, with an expand that turns one span of the block
//                into other bytes (as an olycompress container decodes): a mod's block 0 edits applied to that image
//                and its block 1 edits to the resource block, its stock_sha256 read over the image (control: the
//                same mod with the digest taken over the block as stored is refused), the image patched and the
//                stored block left stock, the summary's image block and mods, the changed ranges; refused: a digest one
//                digit off, a mod not named or named twice, a requires not named, a generated mod, an unknown field,
//                two mods on one byte, a pack for another .BIN, an address below the image base or past its end, no
//                expand, a mods.json edit with a main block patch, mods named on a file that is no pack. --main on
//                made-up containers: a changed resource block prefix gives resource patches beside the main block's
//                (control: without the stock resource block, as bin/debug.mjs, the same file is refused, nothing to
//                patch in the main block), a change past the prefix is counted as not applied, a container with the
//                release's blocks refused. The version field: the release's stock main block under another version
//                field is 'modified' and --main takes its resource change (alone: refused, nothing to patch); the
//                control, another main block under another version field, stays 'other-version' and is refused
//   modsFiles    (E139's unpacked main and resource blocks, and the pack at ~/.om-emu/thirdparty/E-M1-Miii/<tag>/
//                mods.json pinned by sha256; a missing one is a counted skip) every mod with edits but no generator
//                against E139 1.6 as the lab runs it: each one alone (its stock_sha256 over src/fw/expand.mjs
//                expandBlobs' image) and all of them at once but the one that requires a generated mod (refused);
//                control: a mod with edits inside a container (scp_menu) has another digest over the block as stored
//   modsSession  (OM_EMU_MODEL=E139 through bin/session.mjs) the pack's stack_any_lens and scp_menu: the shooting
//                screen with live view (ID_ST_CA_REQ_DISP) and the new bytes at their run-time addresses, scp_menu's
//                inside the second container (control: the stock run reads the stock bytes there); a .BIN the test
//                makes from the E139 .BIN with the main block's version field rewritten to 0x1745 (head and tail,
//                checksum recomputed): alone refused with nothing to patch (not as another version), with mono_slots'
//                resource block edits put into its resource block run to live view with the resource block patched;
//                control: the same .BIN with 16 bytes of the main block's padding changed too is refused as another
//                version. Files written under ~/.cache/om-emu-tmp and removed
//   node emu/test/test_mods.mjs [--units] [--files] [--session]      (OM_EMU_MODEL=E139 for --session)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as F from '../src/fw/olyfw.mjs';
import { identifyBytes } from '../src/fw/identify.mjs';
import { PatchRefused, readPatchText, applyPatches, patchLayout, patchLine, mainFilePatches } from '../src/fw/patch.mjs';
import { MODELS, romPath, resPath } from '../src/fw/models.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname), REPO = path.resolve(EMU, '..');
// the pack this test pins (no byte of it is in the repository: the repository has no LICENSE)
export const PACK = {
  tag: 'mod-builder-1.19', sha256: '51c0ce2dfd0d7326099ab237bd1dfea4ce95638c99b9071ad36c5490ab7036b8',
  url: 'https://raw.githubusercontent.com/dfeldt91-blip/E-M1-Miii/mod-builder-1.19/builder/mods.json',
};
export const packPath = () => path.join(process.env.OM_THIRDPARTY ?? path.join(os.homedir(), '.om-emu/thirdparty'), 'E-M1-Miii', PACK.tag, 'mods.json');
const fetchHint = () => `curl -sSfL --create-dirs -o ${packPath()} ${PACK.url}`;

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hex = (b) => Buffer.from(b).toString('hex');
const refusal = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof PatchRefused) return e.message; throw e; } };
const same = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));
const random = (n, seed) => Uint8Array.from({ length: n }, () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; });
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// One block of a container (as test_identify.mjs builds them): head, the body scrambled (flags != 0), tail, the
// checksum total 0
function block(flags, body, { model = '9010', ver = 0x1200, load = 0x1000 } = {}) {
  const head = (c) => {
    const h = new Uint8Array(32), dv = new DataView(h.buffer);
    h[0] = 0x4f; h[1] = 0x45; h[2] = parseInt(model.slice(0, 2), 16); h[3] = parseInt(model.slice(2), 16);
    dv.setUint32(8, load, true); dv.setUint32(12, body.length, true); dv.setUint16(16, ver, true); dv.setUint16(20, flags, true); dv.setUint32(28, c, true);
    return h;
  };
  const total = (F.sum32(head(0)) + F.sum32(body) + F.sum32(head(0))) >>> 0;
  const stored = new Uint8Array(body.length);
  for (let g = 0; g < body.length; g += 16) for (let k = 0; k < 16; k++) stored[g + F.PERM[k]] = body[g + k] ^ 0xff;
  return cat(head(0), stored, head((-total) >>> 0));
}

// ---- firmware-free ---------------------------------------------------------------------------------------------
export function modsUnits() {
  const t = tester(), { ok } = t;
  const N = 4096, BASE = 0x60021020, A = random(N, 1), RES = random(512, 4), SPAN = [0x400, 0x800];
  // the made-up body: its resource block follows the main block, the lab reads its first 256 bytes
  const M = { E901: { name: 'Made-up A', bin: 'OLY_E_901_1200_0000_0000.BIN', version: '1.2', rom_len: N, rom_sha256: sha(A), res_block: `blk${(N + 64).toString(16).padStart(8, '0')}.OE.0101.bin`, res_len: 256, image_base: BASE } };
  const layout = patchLayout(M.E901);
  // an expand that decodes the span to other bytes, as an olycompress container does (a function of the block alone)
  const expand = (rom) => { const out = rom.slice(); for (let i = SPAN[0]; i < SPAN[1]; i++) out[i] = rom[i] ^ 0x5a; return out; };
  const IMG = expand(A);
  // a pack: a mod with an edit inside the span, one outside it and one in block 1; its stock_sha256 over the image
  // (block 0) and the resource block (block 1), in the edits' order
  const digest = (img, edits) => sha(cat(...edits.map(([b, a, h]) => (b === 0 ? img : RES).subarray(b === 0 ? a - BASE : a, (b === 0 ? a - BASE : a) + h.length / 2))));
  const E1 = [[0, BASE + 0x500, 'cbcb'], [0, BASE + 0x100, 'deadbeef'], [1, 0x20, '4100']];
  const mod = (id, edits, more = {}) => ({ id, title: id, description: '', camera: '', requires: [], stock_sha256: digest(IMG, edits), edits: edits.map(([b, a, h]) => [b, '0x' + a.toString(16), h]), ...more });
  const pack = (mods, fw = M.E901.bin) => JSON.stringify({ format: 1, firmware: { name: fw, sha256: '0'.repeat(64), size: 1 }, mods });
  const P = pack([mod('one', E1), mod('two', [[0, BASE + 0x700, '00']]), mod('needs', [[0, BASE + 0x10, 'ff']], { requires: ['two'] }),
    { id: 'gen', title: 'gen', description: '', camera: '', requires: [], generator: 'white_frame', options: {} }, mod('clash', [[0, BASE + 0x501, '11']])]);
  const apply = (text, mods, o = {}) => applyPatches({ main: A, resource: RES }, readPatchText(text, 'mods.json', { mods }), { layout, createHash, expand, ...o });

  const r = apply(P, ['one']);
  const img = r.blocks.image;
  ok(img && same(r.blocks.main, A) && hex(img.subarray(0x500, 0x502)) === 'cbcb' && hex(img.subarray(0x100, 0x104)) === 'deadbeef' && hex(r.blocks.resource.subarray(0x20, 0x22)) === '4100' &&
    same(img.subarray(0x600, 0x800), IMG.subarray(0x600, 0x800)) && same(A, M.E901 && A) && hex(IMG.subarray(0x500, 0x502)) !== 'cbcb',
  'a mod: its block 0 edits on the image (inside and outside the decoded span), its block 1 edit on the resource block, the stored block stock');
  ok(JSON.stringify(r.summary.blocks.map((b) => [b.block, b.name, b.patches, b.sha256 === sha(img), b.stock_sha256 === sha(IMG)])) === JSON.stringify([['resource', layout.resource.name, 1, false, false], ['image', 'blk00000000.OE.0100.bin run-time image', 2, true, true]]) &&
    JSON.stringify(r.summary.mods) === '[{"file":"mods.json","id":"one","edits":3}]' && JSON.stringify(r.changed) === JSON.stringify([[0x100, 4], [0x500, 2]]) &&
    /, image block sha256 [0-9a-f]{16} \(stock [0-9a-f]{16}\); mods: one \(3 edits\)$/.test(patchLine(r.summary)),
  `the summary: the image and resource blocks, the mods, the changed ranges, the line: ${patchLine(r.summary)} ${JSON.stringify(r.changed)}`);
  const r2 = apply(P, ['two', 'needs']);
  ok(r2.blocks.image[0x700] === 0 && r2.blocks.image[0x10] === 0xff && r2.summary.mods.length === 2, 'a mod with its requires named');
  // control: the digest taken over the block as stored (not the image) is refused, though the edits are the same
  const stored = pack([{ ...mod('one', E1), stock_sha256: digest(A, E1) }]);
  ok(digest(A, E1) !== digest(IMG, E1), 'control: the stored block and the image differ under the edits');
  const refusedAs = (fn, re, what) => { const m = refusal(fn); ok(m !== null && re.test(m), `${what}: ${m ?? 'accepted'}`); };
  refusedAs(() => apply(stored, ['one']), /^mods\.json mod one: the stock bytes under its 3 edit\(s\) have sha256 [0-9a-f]{16}\.\.\., not its stock_sha256 [0-9a-f]{16}\.\.\.: not a mod for this model's stock firmware$/, 'control: a stock_sha256 over the block as stored');
  const off = mod('one', E1); off.stock_sha256 = (off.stock_sha256[0] === '0' ? '1' : '0') + off.stock_sha256.slice(1);
  refusedAs(() => apply(pack([off]), ['one']), /not its stock_sha256/, 'a stock_sha256 one digit off');
  refusedAs(() => apply(P, null), /^mods\.json: a mods\.json pack: name the mods to apply \(FILE#id,id\.\.\.; its mods: one, two, needs, gen, clash\)$/, 'no mods named');
  refusedAs(() => apply(P, ['nope']), /^mods\.json: no mod "nope"/, 'a mod the pack does not hold');
  refusedAs(() => apply(P, ['one', 'one']), /a mod named twice/, 'a mod named twice');
  refusedAs(() => apply(P, ['needs']), /^mods\.json mod needs: it requires two, not named$/, 'a requires not named');
  refusedAs(() => apply(P, ['gen']), /^mods\.json mod gen: a generated mod \(generator "white_frame"\): its bytes are made by the builder at build time and are not in the file$/, 'a generated mod');
  refusedAs(() => apply(P, ['one', 'clash']), /overlap in the image block$/, 'two mods on one byte');
  refusedAs(() => apply(pack([mod('one', E1)], 'OLY_E_901_1100_0000_0000.BIN'), ['one']), /^mods\.json mod one: made for OLY_E_901_1100_0000_0000\.BIN, the lab runs OLY_E_901_1200_0000_0000\.BIN$/, 'a pack for another .BIN');
  refusedAs(() => apply(pack([mod('low', [[0, BASE + 0x10, 'ff']])]).replace(`"0x${(BASE + 0x10).toString(16)}"`, '"0x60000000"'), ['low']), /address 0x60000000 lies below the image base 0x60021020/, 'an address below the image base');
  refusedAs(() => apply(pack([{ ...mod('far', [[0, BASE + 0x10, 'ff']]), edits: [[0, '0x' + (BASE + N - 1).toString(16), 'ffff']] }]), ['far']), /lies outside the main code block's run-time image \(4096 bytes\)$/, 'an edit past the image\'s end');
  refusedAs(() => apply(pack([mod('b2', [[0, BASE + 0x10, 'ff']])]).replace('[0,', '[2,'), ['b2']), /block 2: the lab loads only the main code block/, 'a block the lab does not load');
  refusedAs(() => apply(P, ['one'], { expand: null }), /needs the main block's run-time image, not made here$/, 'no expand');
  refusedAs(() => applyPatches({ main: A, resource: RES }, [...readPatchText(P, 'mods.json', { mods: ['two'] }), ...readPatchText(JSON.stringify([{ block: 0, offset: 0x10, old: Buffer.from([A[0x10]]).toString('base64'), new: 'AA==' }]), 'p.json')], { layout, createHash, expand }),
    /patches the main block's run-time image and p\.json patch 0 the block as stored: the two do not mix$/, 'a mods.json edit with a main block patch');
  refusedAs(() => readPatchText(P.replace('"mods":', '"extra":1,"mods":'), 'mods.json', { mods: ['one'] }), /mods\.json field "extra": not one this reader knows/, 'an unknown field');
  refusedAs(() => readPatchText(JSON.stringify([{ block: 0, offset: 1, old: 'AQ==', new: 'Ag==' }]), 'p.json', { mods: ['one'] }), /^p\.json: mods named \(one\), but not a mods\.json pack$/, 'mods named on a file that is no pack');

  // --main: the resource block too
  const Amod = A.slice(); Amod.set([1, 2, 3], 100);
  const resIn = RES.slice(); resIn.set([9, 9], 0x40);                    // inside the 256 bytes the lab reads
  const resPast = resIn.slice(); resPast[0x180] ^= 1; resPast[0x181] ^= 1;  // and two bytes past them
  const container = (main, res, o = {}) => cat(block(0x0100, main, o), block(0x0101, res, { load: 0x2000, ver: 0x0100 }));
  const id = (u8) => identifyBytes(u8, createHash, M);
  const main = (u8, withRes = true) => mainFilePatches(A, u8, 'f.BIN', id(u8), 'E901', withRes ? { res: RES, layout } : {});
  const fields = (ps) => ps[0].not_applied.map((x) => x.field).join();
  const ps = main(container(Amod, resIn));
  const ra = applyPatches({ main: A, resource: RES }, ps, { layout, createHash });
  ok(ps.length === 2 && JSON.stringify(ps.map((p) => [p.block, p.offset, p.n])) === '[["main",100,0],["resource",64,1]]' && same(ra.blocks.main, Amod) && same(ra.blocks.resource, resIn) && fields(ps) === 'container' &&
    patchLine(ra.summary).endsWith('; not applied: container (only its main code block and its resource block\'s part the lab reads are taken: its 0 other block(s) are not read)'),
  `--main a container with a changed main block and resource block prefix: both blocks' patches: ${patchLine(ra.summary)}`);
  const pp = main(container(Amod, resPast));
  ok(pp.length === 2 && fields(pp) === 'container,resource' && pp[0].not_applied[1].why === '2 bytes of its resource block past the 256 the lab reads differ from the stock block\'s: not applied', `--main a change past the prefix: counted, not applied: ${JSON.stringify(pp[0].not_applied)}`);
  const po = main(container(A, resIn));
  ok(po.length === 1 && po[0].block === 'resource' && id(container(A, resIn)).status === 'stock', '--main the release\'s main block with a changed resource block prefix: the resource patch alone');
  refusedAs(() => main(container(A, resIn), false), /: nothing to patch in the main code block; a change in another block is not seen here \(give it as --patch on that block\)$/, 'control: the same file without the stock resource block (bin/debug.mjs)');
  refusedAs(() => main(container(A, RES)), /: nothing to patch in the main code block or the resource block's part the lab reads; a change in another block is not seen here$/, '--main the release\'s blocks');
  refusedAs(() => main(container(A, resPast.map((x, i) => (i < 256 ? RES[i] : x)))), /nothing to patch in the main code block or the resource block's part the lab reads \(2 bytes of its resource block past the 256 the lab reads differ from the stock block's\)/, '--main a change past the prefix alone');

  // the version field: the release's stock main block under another one is 'modified'; another main block under
  // another one stays 'other-version' (the control: a real content difference)
  const v = id(container(A, resIn, { ver: 0x1745 })), vo = id(container(Amod, resIn, { ver: 0x1745 }));
  ok(v.status === 'modified' && v.model === 'E901' && /whose only change to the main code block is its version field 0x1745 \(the release's 0x1200/.test(v.reason) && vo.status === 'other-version',
    `the version field alone: modified; with another main block: other-version: ${v.status} ${v.reason} | ${vo.status} ${vo.reason}`);
  const pv = main(container(A, resIn, { ver: 0x1745 }));
  ok(pv.length === 1 && pv[0].block === 'resource' && same(applyPatches({ main: A, resource: RES }, pv, { layout, createHash }).blocks.resource, resIn), '--main the version field rewritten and a resource change: the resource patch');
  refusedAs(() => main(container(A, RES, { ver: 0x1745 })), /^f\.BIN: a container of E901 \(Made-up A\) v1\.2 whose only change to the main code block is its version field 0x1745 .*: nothing to patch in the main code block or the resource block's part the lab reads/, '--main the version field alone');
  refusedAs(() => main(container(Amod, resIn, { ver: 0x1745 })), /^f\.BIN: a container of E901 \(Made-up A\) at version field 0x1745, not the 0x1200 .*: not a \.BIN of E901's firmware as the lab runs it, stock or modified$/, 'control: another main block under the rewritten version field');
  return t;
}

// ---- E139's blocks and the pinned pack -------------------------------------------------------------------------
function readPack(skipped) {
  const f = packPath();
  if (!fs.existsSync(f)) { skipped.push(`no ${f} (${fetchHint()})`); return null; }
  const text = fs.readFileSync(f, 'utf8');
  return { text, sha256: sha(Buffer.from(text, 'utf8')), file: f };
}
export async function modsFiles() {
  const t = tester(), { ok } = t, skipped = [];
  const m = MODELS.E139, blk = path.join(REPO, romPath(m)), resf = path.join(REPO, resPath(m));
  const pk = readPack(skipped);
  if (!pk) return { checks: t.checks, bad: t.bad, skipped };
  ok(pk.sha256 === PACK.sha256, `${pk.file}: sha256 ${pk.sha256.slice(0, 16)}..., pinned ${PACK.sha256.slice(0, 16)}... (${PACK.tag})`);
  if (!fs.existsSync(blk) || !fs.existsSync(resf)) { skipped.push(`E139: no unpacked blocks (node emu/bin/fetch-fw.mjs --model E139)`); return { checks: t.checks, bad: t.bad, skipped }; }
  const { expandBlobs } = await import('../src/fw/expand.mjs');
  const rom = new Uint8Array(fs.readFileSync(blk)), res = new Uint8Array(fs.readFileSync(resf));
  ok(sha(rom) === m.rom_sha256, 'E139: the unpacked main block is the release\'s');
  const doc = JSON.parse(pk.text), layout = patchLayout(m);
  const apply = (mods) => applyPatches({ main: rom, resource: res }, readPatchText(pk.text, 'mods.json', { mods }), { layout, createHash, expand: expandBlobs });
  const statics = doc.mods.filter((x) => x.edits?.length && !x.generator).map((x) => x.id);
  const takes = statics.filter((x) => doc.mods.find((y) => y.id === x).requires.every((r) => statics.includes(r)));
  const each = statics.map((x) => [x, refusal(() => apply([x]))]);
  const fails = each.filter(([x, e]) => e !== null && takes.includes(x));
  ok(statics.length === 15 && fails.length === 0, `each mod with edits alone (${statics.length}): ${fails.map(([x, e]) => `${x}: ${e}`).join('; ') || 'all taken'}`);
  const needy = statics.filter((x) => !takes.includes(x));
  ok(needy.length >= 1 && each.filter(([x]) => needy.includes(x)).every(([, e]) => /it requires .*, not named$/.test(e ?? '')), `a mod that requires a generated mod refused: ${needy.join(', ')}`);
  const all = apply(takes);
  const img = all.blocks.image, edits = doc.mods.filter((x) => takes.includes(x.id)).flatMap((x) => x.edits);
  ok(img && same(all.blocks.main, rom) && edits.every(([b, a, h]) => b !== 0 || hex(img.subarray(parseInt(a, 16) - m.image_base, parseInt(a, 16) - m.image_base + h.length / 2)) === h.toLowerCase()) &&
    all.summary.mods.length === takes.length && all.summary.blocks.some((b) => b.block === 'resource'),
  `all ${takes.length} at once: every block 0 edit's bytes at its address in the image, the stored block stock; ${patchLine(all.summary).slice(0, 160)}`);
  // control: a mod inside the second container has another digest over the block as stored
  const scp = doc.mods.find((x) => x.id === 'scp_menu');
  const storedDigest = sha(cat(...scp.edits.map(([, a, h]) => rom.subarray(parseInt(a, 16) - m.image_base, parseInt(a, 16) - m.image_base + h.length / 2))));
  ok(scp && storedDigest !== scp.stock_sha256 && refusal(() => apply(['scp_menu'])) === null, 'control: scp_menu\'s stock_sha256 is its bytes in the image, not in the block as stored');
  return { checks: t.checks, bad: t.bad, skipped };
}

// ---- E139 through bin/session.mjs -----------------------------------------------------------------------------
const BIN = path.join(EMU, 'bin/session.mjs');
const cli = (args) => {
  const r = spawnSync(process.execPath, [BIN, '--nvram', 'off', ...args], { encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 28 });
  const lines = [];
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { lines.push({ unparsed: l }); } }
  return { rc: r.status, steps: lines.filter((x) => !x.summary), sum: lines.find((x) => x.summary) ?? null, last: (r.stderr ?? '').trim().split('\n').at(-1) ?? '' };
};
const binOf = (m) => [process.env.OM_FW_DIR && path.join(process.env.OM_FW_DIR, m.bin), path.join(REPO, 'fw', m.bin), path.join(REPO, 'fw/old', m.bin)].find((f) => f && fs.existsSync(f)) ?? null;
export async function modsSession() {
  const t = tester(), { ok } = t, skipped = [];
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E139') { skipped.push(`the session is E139's (OM_EMU_MODEL=E139), not ${MODEL}'s`); return { checks: t.checks, bad: t.bad, skipped }; }
  const pk = readPack(skipped);
  if (!pk) return { checks: t.checks, bad: t.bad, skipped };
  const doc = JSON.parse(pk.text), edit = (id, n) => doc.mods.find((x) => x.id === id).edits[n];
  const LIVE = 'expect:gui=SS_COMMON/ID_ST_CA_REQ_DISP';
  const [, aStack, hStack] = edit('stack_any_lens', 0), scpIn = doc.mods.find((x) => x.id === 'scp_menu').edits.find(([b, a]) => b === 0 && parseInt(a, 16) >= 0x60c6c000);
  const mem = (a, h) => `expect:mem:${a}=${h}`, nmem = (a, h) => `expect:mem:${a}!=${h}`;
  const s = cli(['--patch', `${pk.file}#stack_any_lens,scp_menu`, 'wait:1500', LIVE, mem(aStack, hStack), mem(scpIn[1], scpIn[2])]);
  ok(s.rc === 0 && s.sum?.ok && /; image block sha256 [0-9a-f]{16} \(stock [0-9a-f]{16}\); mods: stack_any_lens \(1 edit\), scp_menu \(2 edits\)$/.test(s.sum.patch ?? ''),
    `E139 with stack_any_lens and scp_menu: live view, the new bytes at ${aStack} and at ${scpIn[1]} (inside the second container): rc ${s.rc} ${s.sum?.patch} | ${s.last}`);
  const c = cli(['wait:1500', LIVE, nmem(aStack, hStack), nmem(scpIn[1], scpIn[2])]);
  ok(c.rc === 0 && c.sum?.patch === null, `control: the stock run reads the stock bytes there: rc ${c.rc} ${c.last}`);

  // a .BIN with the main block's version field rewritten, as the builder writes its test builds
  const stockBin = binOf(MODEL_INFO);
  if (!stockBin) { skipped.push(`no ${MODEL_INFO.bin} (fw/, fw/old/ or $OM_FW_DIR)`); return { checks: t.checks, bad: t.bad, skipped }; }
  const tmp = path.join(os.homedir(), '.cache/om-emu-tmp/test-mods-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const whole = new Uint8Array(fs.readFileSync(stockBin)), blocks = F.walkBytes(whole).blocks, b0 = blocks[0], b1 = blocks.find((x) => x.flags === 0x0101);
    const rewrite = (u8, b, at, bytes) => {   // body bytes at a 16-aligned group set, scrambled back, the checksum kept 0
      const body = F.decodeBlock(u8.subarray(b.off, b.off + 64 + b.len), b).data, before = F.sum32(body.subarray(at & ~15, (at & ~15) + 32));
      body.set(bytes, at);
      for (let g = at & ~15; g < at + bytes.length; g += 16) for (let k = 0; k < 16; k++) u8[b.off + 32 + g + F.PERM[k]] = body[g + k] ^ 0xff;
      const dv = new DataView(u8.buffer, u8.byteOffset), ck = b.off + 32 + b.len + 28;
      dv.setUint32(ck, (dv.getUint32(ck, true) - (F.sum32(body.subarray(at & ~15, (at & ~15) + 32)) - before)) >>> 0, true);
    };
    const version = (u8) => {                 // the version field in head and tail, the checksum kept 0
      const dv = new DataView(u8.buffer, u8.byteOffset), d = 0x1745 - dv.getUint16(16, true);
      dv.setUint16(16, 0x1745, true); dv.setUint16(32 + b0.len + 16, 0x1745, true);
      dv.setUint32(32 + b0.len + 28, (dv.getUint32(32 + b0.len + 28, true) - 2 * d) >>> 0, true);
      return u8;
    };
    const vOnly = version(whole.slice()), vRes = vOnly.slice(), vMain = vRes.slice();
    for (const [b, a, h] of doc.mods.find((x) => x.id === 'mono_slots').edits) if (b === 1) rewrite(vRes, b1, parseInt(a, 16), Buffer.from(h, 'hex'));
    rewrite(vMain, b0, MODEL_INFO.rom_len - 0x100, Buffer.from('om-emu container'));
    const files = { vOnly, vRes, vMain };
    for (const [k, u8] of Object.entries(files)) fs.writeFileSync(path.join(tmp, `${k}.BIN`), u8);
    const ids = Object.fromEntries(Object.entries(files).map(([k, u8]) => [k, identifyBytes(u8, createHash)]));
    ok(ids.vOnly.status === 'modified' && ids.vOnly.checksum_ok && ids.vRes.status === 'modified' && ids.vMain.status === 'other-version' && ids.vMain.checksum_ok,
      `the three .BINs: ${Object.entries(ids).map(([k, x]) => `${k} ${x.status} ${x.checksum_ok}`).join(', ')}`);
    const o = cli(['--main', path.join(tmp, 'vOnly.BIN'), 'wait:100']);
    ok(o.rc === 1 && o.last.includes('whose only change to the main code block is its version field 0x1745') && o.last.endsWith('nothing to patch in the main code block or the resource block\'s part the lab reads; a change in another block is not seen here'),
      `--main the version field alone: refused, nothing to patch: rc ${o.rc} ${o.last}`);
    const r = cli(['--main', path.join(tmp, 'vRes.BIN'), 'wait:1500', LIVE]);
    ok(r.rc === 0 && / patches? \(\d+ bytes changed\) from .*vRes\.BIN; resource block sha256 [0-9a-f]{16} \(stock [0-9a-f]{16}\); not applied: container/.test(r.sum?.patch ?? ''),
      `--main the version field and mono_slots' resource edits: live view, the resource block patched: rc ${r.rc} ${r.sum?.patch} | ${r.last}`);
    const x = cli(['--main', path.join(tmp, 'vMain.BIN'), 'wait:100']);
    ok(x.rc === 1 && /at version field 0x1745, not the 0x1600 .*: not a \.BIN of E139's firmware as the lab runs it, stock or modified$/.test(x.last), `control: the version field and a main block change: refused as another version: rc ${x.rc} ${x.last}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { checks: t.checks, bad: t.bad, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !['--units', '--files', '--session'].some((x) => process.argv.includes(x));
  let fail = 0;
  const say = (name, r) => {
    console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}${r.skipped?.length ? `, ${r.skipped.length} SKIPPED` : ''}`);
    [...r.bad, ...(r.skipped ?? []).map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
    fail += r.bad.length;
  };
  if (all || process.argv.includes('--units')) say('mods.json and version-only containers, units', modsUnits());
  if (all || process.argv.includes('--files')) say('mods.json on E139\'s blocks', await modsFiles());
  if (process.argv.includes('--session')) say(`mods.json and --main on E139 (bin/session.mjs)`, await modsSession());
  process.exit(fail ? 1 : 0);
}
