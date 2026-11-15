// What a firmware file is (src/fw/identify.mjs), the gates that say it, and --main FILE on a .BIN container
// (src/fw/patch.mjs mainFilePatches, checks/lib/env.mjs readMainFile):
//   identifyUnits    (firmware-free) made-up bodies and containers the test builds: a release's container and its
//                    bare block ('stock'), a head with another version field ('other-version'), a changed main block
//                    with the checksum recomputed and not ('modified', checksum_ok), and what is 'unknown': a head
//                    naming a body MODELS does not hold, a head around another body's stock block, a release's head
//                    with the blocks elsewhere, no main block, two, a cut one, bytes of no known length, a reader that
//                    throws (answered, never thrown). The control the rule exists for: two bodies with main blocks of
//                    one length are told apart by the head's model field and the digest (a length-only gate takes
//                    either for a modified copy of the other); a bare block of that length with an unknown digest names
//                    both as candidates. The reader's answer is the whole file's, walkBytes is walk. --main's core on
//                    the same files: a modified container's patches are the bare block's with not_applied saying the
//                    other blocks are not read (and the checksum, when not recomputed), in the overlay's summary and
//                    line; the stock container refused as the stock block is; another body's container or stock block,
//                    another version's container refused by name. The lab's gate (labFirmware, the run's model): a
//                    container of nobody's, bytes of no container and a container with the model's own head around
//                    another main block are refused as before, each now naming what the file is; a reader's own
//                    failure (the browser's NotReadableError, a plain Error, a TypeError) passes through as it came
//   identifyFiles    (the .BINs and unpacked blocks at hand; a body without either is a counted skip) each MODELS
//                    body's .BIN is its 'stock' container with the checksum 0 and its unpacked block its 'stock' block:
//                    the head rule (model field: the body's digits and 0; version field: the .BIN name's digits)
//   identifySession  (the process's model through bin/session.mjs; E147 in bin/test.mjs's child) --main with the
//                    stock .BIN refused as the stock block; a .BIN the test makes from it (16 bytes of the main block's
//                    0xFF tail padding changed, the checksum not recomputed, written outside the tree and removed)
//                    runs: its steps' lab times and frames are those of --main with the bare block and the frames
//                    those of the stock session, the summary's patch and audit the bare block's but for the file and
//                    what is not applied; the same .BIN with the checksum recomputed has no checksum note; the lab's
//                    gate refuses both naming them modified, and another body's .BIN is refused by --main by name
//   node emu/test/test_identify.mjs [--units] [--files] [--session]      (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as F from '../src/fw/olyfw.mjs';
import { identifyBytes, identifyFirmware, releaseHead, bodyOfHead, bodyOfDigest } from '../src/fw/identify.mjs';
import { PatchRefused, mainPatches, mainFilePatches, applyPatches, patchLayout, patchLine } from '../src/fw/patch.mjs';
import { MODELS, romPath } from '../src/fw/models.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname), REPO = path.resolve(EMU, '..');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const same = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));

// One block of a container: head, the body (scrambled when flags != 0), tail. model: the head's four model digits;
// cks: false leaves the tail's checksum field 0 (a total that is not 0). body: a multiple of 16 bytes.
function block(flags, body, { model = '9010', ver = 0x1200, load = 0x1000, cks = true, typ = 'OE' } = {}) {
  const head = (c) => {
    const h = new Uint8Array(32), dv = new DataView(h.buffer);
    h[0] = typ.charCodeAt(0); h[1] = typ.charCodeAt(1); h[2] = parseInt(model.slice(0, 2), 16); h[3] = parseInt(model.slice(2), 16);
    dv.setUint32(8, load, true); dv.setUint32(12, body.length, true); dv.setUint16(16, ver, true); dv.setUint16(20, flags, true); dv.setUint32(28, c, true);
    return h;
  };
  const total = (F.sum32(head(0)) + F.sum32(body) + F.sum32(head(0))) >>> 0;
  const stored = new Uint8Array(body.length);
  if (flags !== 0) { for (let g = 0; g < body.length; g += 16) for (let k = 0; k < 16; k++) stored[g + F.PERM[k]] = body[g + k] ^ 0xff; } else stored.set(body);
  const out = new Uint8Array(64 + body.length);
  out.set(head(0), 0); out.set(stored, 32); out.set(head(cks ? (-total) >>> 0 : 0), 32 + body.length);
  return out;
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const random = (n, seed) => Uint8Array.from({ length: n }, () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; });
const asyncReader = (u8) => async (off, len) => u8.subarray(off, off + len);

// ---- firmware-free ---------------------------------------------------------------------------------------------
export async function identifyUnits() {
  const t = tester(), { ok } = t;
  // three made-up bodies: A and B with main blocks of one length (as E118, E120 and E122 have), C with another
  const N = 4096, A = random(N, 1), B = random(N, 2), C = random(2 * N, 3), RES = random(256, 4);
  const entry = (name, bin, version, rom) => ({ name, bin, version, rom_len: rom.length, rom_sha256: sha(rom), res_block: `blk${(rom.length + 64).toString(16).padStart(8, '0')}.OE.0101.bin`, res_len: 256, image_base: 0x60021020 });
  const M = { E901: entry('Made-up A', 'OLY_E_901_1200_0000_0000.BIN', '1.2', A), E902: entry('Made-up B', 'OLY_E_902_1101_0000_0000.BIN', '1.1', B), E903: entry('Made-up C', 'OLY_E_903_2000_0000_0000.BIN', '2.0', C) };
  ok(JSON.stringify([releaseHead('E901', M), releaseHead('E902', M), bodyOfHead('9020', M), bodyOfHead('9021', M), bodyOfDigest(sha(B), M), bodyOfDigest(sha(RES), M)]) ===
    '[{"model":"9010","ver":4608},{"model":"9020","ver":4353},"E902",null,"E902",null]', 'a release\'s head from its .BIN name, a body by its head and by its digest');
  ok(thrown(() => releaseHead('X', { X: { bin: 'firmware.bin' } }))?.message.includes('does not name the body'), 'a .BIN name without the body and version is no release head');
  const res = (o = {}) => block(0x0101, RES, { load: 0x2000, ver: 0x0100, ...o });
  const container = (main, o = {}) => cat(block(0x0100, main, o), res({ model: o.model ?? '9010' }));
  const Amod = A.slice(); Amod.set([1, 2, 3, 4], 100); Amod[4000] ^= 0x80;
  const id = (u8) => identifyBytes(u8, createHash, M);
  const is = (r, status, kind, model, re) => r.status === status && r.kind === kind && r.model === model && re.test(r.reason);
  const show = (r) => JSON.stringify({ ...r, main: r.main ? r.main.length : null });
  const cases = [
    ['a release\'s container', container(A), (r) => is(r, 'stock', 'container', 'E901', /^E901 \(Made-up A\)'s v1\.2 release container \(OLY_E_901_1200_0000_0000\.BIN\)$/) && r.checksum_ok === true && r.version === '1.2' && r.blocks === 2 && same(r.main, A) && r.rom_sha256 === M.E901.rom_sha256],
    ['its bare block', A, (r) => is(r, 'stock', 'block', 'E901', /^E901 \(Made-up A\)'s v1\.2 main code block as unpacked$/) && r.checksum_ok === null && r.head === null && r.main === null && r.blocks === 0],
    ['a head with another version field', container(Amod, { ver: 0x1300 }), (r) => is(r, 'other-version', 'container', 'E901', /^a container of E901 \(Made-up A\) at version field 0x1300, not the 0x1200 of the v1\.2 release MODELS holds$/) && r.head.ver === 0x1300],
    ['a changed main block, the checksum recomputed', container(Amod), (r) => is(r, 'modified', 'container', 'E901', /^a container of E901 \(Made-up A\) v1\.2 with another main code block \(the release's place and length, sha256 [0-9a-f]{16}\.\.\., the release's [0-9a-f]{16}\.\.\.\): modified firmware$/) && r.checksum_ok === true && same(r.main, Amod)],
    ['a changed main block, the checksum not recomputed', container(Amod, { cks: false }), (r) => is(r, 'modified', 'container', 'E901', /modified firmware; its main block's checksum total is 0x[0-9a-f]{8}, not 0$/) && r.checksum_ok === false && same(r.main, Amod)],
    ['the stock block under a head whose checksum field is wrong', container(A, { cks: false }), (r) => is(r, 'stock', 'container', 'E901', /release container .*; its main block's checksum total is 0x[0-9a-f]{8}, not 0$/) && r.checksum_ok === false],
    // the rule's reason: B's files are B's, never a modified A, though the main blocks have one length
    ['the other body of that length, its container', container(B, { model: '9020', ver: 0x1101 }), (r) => is(r, 'stock', 'container', 'E902', /^E902 \(Made-up B\)'s v1\.1 release container/)],
    ['the other body of that length, its bare block', B, (r) => is(r, 'stock', 'block', 'E902', /^E902 \(Made-up B\)'s v1\.1 main code block as unpacked$/)],
    ['the other body\'s changed container', container(Amod, { model: '9020', ver: 0x1101 }), (r) => is(r, 'modified', 'container', 'E902', /^a container of E902 \(Made-up B\) v1\.1 with another main code block/)],
    ['a bare changed block of the shared length', Amod, (r) => is(r, 'modified', 'block', null, /^a block of the length of E901's and E902's main code block \(4096 bytes\) whose sha256 \([0-9a-f]{16}\.\.\.\) is none of theirs: a modified main code block of one of them, as far as a bare block shows \(it names no body\)$/) && r.candidates.join() === 'E901,E902'],
    ['a bare changed block of one body\'s length', random(2 * N, 9), (r) => is(r, 'modified', 'block', 'E903', /^a block of the length of E903's main code block \(8192 bytes\) whose sha256 \([0-9a-f]{16}\.\.\.\) is not its: a modified main code block, as far as/) && r.candidates.join() === 'E903'],
    ['a head naming A around B\'s stock block', container(B), (r) => is(r, 'unknown', 'container', 'E901', /^a container whose head \(model field 9010, version field 0x1200\) is not the release's around E902 \(Made-up B\)'s v1\.1 stock main code block$/)],
    ['A\'s stock block under another version field', container(A, { ver: 0x1300 }), (r) => is(r, 'unknown', 'container', 'E901', /is not the release's around E901 \(Made-up A\)'s v1\.2 stock main code block$/)],
    ['a head naming no body', container(Amod, { model: '1234' }), (r) => is(r, 'unknown', 'container', null, /^a container of a body MODELS does not hold \(model field 1234, version field 0x1200\)$/)],
    ['a release\'s head, a main block of another length', container(random(N / 2, 5)), (r) => is(r, 'unknown', 'container', 'E901', /^a container whose head names E901 \(Made-up A\) v1\.2 but whose blocks are not the release's \(the main code block at 0x00000000, 2048 bytes; the release's at 0, 4096 bytes, the resource block at 0x00001040\)$/)],
    ['a release\'s head, no resource block where the release has it', block(0x0100, Amod), (r) => is(r, 'unknown', 'container', 'E901', /but whose blocks are not the release's/)],
    ['a release\'s head, the main block second', cat(res(), block(0x0100, Amod)), (r) => is(r, 'unknown', 'container', 'E901', /but whose blocks are not the release's \(the main code block at 0x00000140/)],
    ['a container without a main block', cat(res(), res()), (r) => is(r, 'unknown', 'container', null, /^a container of 2 block\(s\) with 0 main code blocks \(OE, flags 0x0100\), not one$/) && r.blocks === 2],
    ['a container with two main blocks', cat(block(0x0100, A), block(0x0100, A)), (r) => is(r, 'unknown', 'container', null, /with 2 main code blocks/)],
    ['a container cut inside its main block', container(A).subarray(0, 2000), (r) => is(r, 'unknown', 'container', 'E901', /^a container cut inside its main code block \(body overruns file: the head gives 4096 bytes\)$/) && r.head.len === 4096],
    ['bytes of no known length', random(1000, 6), (r) => is(r, 'unknown', null, null, /^1000 bytes that start with no container head \(OE, OM, OA, OL\) and are not the length of a main code block MODELS holds$/)],
    ['an empty file', new Uint8Array(0), (r) => is(r, 'unknown', null, null, /^0 bytes that start with no container head/)],
  ];
  for (const [what, u8, want] of cases) {
    const r = id(u8), ra = await identifyFirmware(asyncReader(u8), u8.length, createHash, M);
    ok(want(r), `${what}: ${show(r)}`);
    ok(show(ra) === show(r) && (r.main === null) === (ra.main === null) && (r.main === null || same(r.main, ra.main)), `${what}: the reader's answer is the whole file's: ${show(ra)}`);
    const w = await F.walk(asyncReader(u8), u8.length);
    ok(JSON.stringify(F.walkBytes(u8)) === JSON.stringify(w), `${what}: walkBytes is walk`);
  }
  // what a length-only gate answers: both bodies' files pass as a modified copy of A (the control the rule is for)
  const byLength = (u8) => { const b = F.walkBytes(u8).blocks.find((x) => x.flags === 0x0100); return (b ? b.len : u8.length) === M.E901.rom_len; };
  ok(byLength(container(B, { model: '9020', ver: 0x1101 })) && byLength(B) && id(container(B, { model: '9020', ver: 0x1101 })).model === 'E902' && id(B).model === 'E902',
    'control: a gate that compares the length alone takes B\'s container and block for A\'s; the head and the digest name B');
  // never thrown: a reader that fails, a createHash that fails
  const r1 = await identifyFirmware(async () => { throw new Error('NotReadableError'); }, 5000, createHash, M);
  const r2 = identifyBytes(A, () => { throw new Error('no hash'); }, M);
  ok(is(r1, 'unknown', null, null, /^a file that could not be read \(NotReadableError\)$/) && is(r2, 'unknown', null, null, /could not be read \(no hash\)/), `a failing reader and a failing hash are answered: ${show(r1)} ${show(r2)}`);

  // --main FILE's core on these files, the run's model A
  const main = (u8) => mainFilePatches(A, u8, 'f.BIN', id(u8), 'E901');
  const refused = (u8, re, what) => { const e = thrown(() => main(u8)); ok(e instanceof PatchRefused && re.test(e.message), `--main ${what}: ${e ? e.message : 'accepted'}`); };
  const bare = mainPatches(A, Amod, 'f.BIN'), strip = (ps) => JSON.stringify(ps.map(({ not_applied, ...p }) => ({ ...p, old: [...p.old], new: [...p.new] })));
  for (const [cks, fields] of [[true, 'container'], [false, 'container,checksum']]) {
    const ps = main(container(Amod, { cks }));
    ok(bare.length === 2 && strip(ps) === strip(bare) && ps.every((p) => p.not_applied === ps[0].not_applied) && ps[0].not_applied.map((x) => x.field).join() === fields,
      `--main a modified container (checksum ${cks ? 'recomputed' : 'not recomputed'}): the bare block's patches, not_applied ${JSON.stringify(ps[0]?.not_applied)}`);
    const r = applyPatches({ main: A, resource: RES }, ps, { layout: patchLayout(M.E901), createHash });
    ok(same(r.blocks.main, Amod) && r.summary.not_applied?.map((x) => x.field).join() === fields && r.summary.not_applied.every((x) => x.file === 'f.BIN') &&
      patchLine(r.summary).includes('; not applied: container (only its main code block is taken: its 1 other block(s) are not read, the lab loads the stock resource block)') &&
      patchLine(r.summary).includes('checksum (the main code block\'s checksum total is not 0') === !cks,
    `the overlay of a modified container: the block, the summary's not_applied, the line: ${patchLine(r.summary)}`);
  }
  ok(strip(main(Amod)) === strip(bare) && main(Amod).every((p) => !('not_applied' in p)) && !('not_applied' in applyPatches({ main: A }, main(Amod), { layout: patchLayout(M.E901), createHash }).summary),
    'control: --main a bare modified block: mainPatches\' patches, nothing listed as not applied');
  refused(container(A), /^f\.BIN: the stock main code block itself \(nothing to patch\)$/, 'the stock container (as the stock block)');
  refused(A, /^f\.BIN: the stock main code block itself \(nothing to patch\)$/, 'the stock block');
  refused(container(B, { model: '9020', ver: 0x1101 }), /^f\.BIN: E902 \(Made-up B\)'s v1\.1 release container \(OLY_E_902_1101_0000_0000\.BIN\): not a \.BIN of E901's firmware as the lab runs it, stock or modified$/, 'another body\'s container');
  refused(container(Amod, { model: '9020', ver: 0x1101 }), /^f\.BIN: a container of E902 \(Made-up B\) v1\.1 with another main code block .*: not a \.BIN of E901's firmware/, 'another body\'s modified container');
  refused(container(Amod, { ver: 0x1300 }), /^f\.BIN: a container of E901 \(Made-up A\) at version field 0x1300, .*: not a \.BIN of E901's firmware as the lab runs it/, 'another version\'s container');
  refused(container(Amod, { model: '1234' }), /a body MODELS does not hold .*: not a \.BIN of E901's firmware/, 'a container of no body');
  refused(B, /^f\.BIN: E902 \(Made-up B\)'s v1\.1 main code block as unpacked, not a patched main code block of E901$/, 'another body\'s stock block of the same length');
  refused(random(1000, 6), /^f\.BIN: 1000 bytes, the stock main code block 4096: not a patched main code block of this model$/, 'a file of another length (mainPatches\' refusal)');
  ok(mainPatches(A, B, 'f.BIN').reduce((n, p) => n + p.new.length, 0) > 4000, 'control: mainPatches alone takes another body\'s stock block of the same length as a patched block (nearly every byte a patch)');

  // the lab's gate on files of the run's model: refused as before, each now naming what the file is
  const { labFirmware, WrongFirmware } = await import('../src/fw/labfw.mjs');
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const gate = async (u8) => { try { await labFirmware(asyncReader(u8), u8.length, createHash); return null; } catch (e) { return e; } };
  const g1 = await gate(container(Amod, { model: '1234' }));
  ok(g1 instanceof WrongFirmware && g1.message.includes(`the main code block is not ${MODEL}'s`) && g1.message.includes(': this file is a container of a body MODELS does not hold (model field 1234, version field 0x1200); the lab runs') &&
    g1.message.endsWith(`${MODEL_INFO.bin}: choose that .BIN`) && g1.id.status === 'unknown', `the gate on a container of nobody's: ${g1?.message}`);
  const g2 = await gate(random(1000, 6));
  ok(g2 instanceof Error && !(g2 instanceof WrongFirmware) && /^no OE block with flags 0x0100 in the \.BIN \(0 blocks\); this file is 1000 bytes that start with no container head/.test(g2.message), `the gate on bytes of no container: ${g2?.message}`);
  // a reader's own failure is thrown as it came: the browser's NotReadableError, whose message no one can write (the
  // gate must not turn it into a TypeError by adding to it)
  const dom = new DOMException('The requested file could not be read', 'NotReadableError');
  let g3 = null;
  try { await labFirmware(async () => { throw dom; }, 5000, createHash); } catch (e) { g3 = e; }
  ok(g3 === dom && g3.message === 'The requested file could not be read', `the gate on a reader that fails with a DOMException: ${g3?.name}: ${g3?.message}`);
  // and so is one whose message could be written (node's fs errors are plain Errors), and a TypeError: only the
  // container's refusals (ContainerRefused) are told what the file is
  for (const err of [new Error('x'), new TypeError('x')]) {
    let g = null;
    try { await labFirmware(async () => { throw err; }, 5000, createHash); } catch (e) { g = e; }
    ok(g === err && g.message === 'x' && !('id' in g), `the gate on a reader that fails with a ${err.name}: ${g?.name}: ${g?.message}`);
  }
  // a container with the run's model's own head, the release's layout and a main block of zeros (no firmware byte)
  const rel = releaseHead(MODEL), zeros = new Uint8Array(MODEL_INFO.rom_len), own = { model: rel.model, ver: rel.ver };
  for (const cks of [true, false]) {
    const u8 = cat(block(0x0100, zeros, { ...own, cks }), block(0x0101, RES, { model: rel.model, ver: 0x0100 }));
    const r = identifyBytes(u8, createHash), g = await gate(u8);
    const hint = '(modified firmware runs as a patch overlay on the stock .BIN: the Patch option, node\'s --patch or --main)';
    ok(is(r, 'modified', 'container', MODEL, /with another main code block/) && r.checksum_ok === cks && r.version === MODEL_INFO.version, `a container with ${MODEL}'s head around other bytes: ${show(r)}`);
    ok(cks ? g instanceof WrongFirmware && g.message.includes(`: this file is a container of ${MODEL} (${MODEL_INFO.name}) v${MODEL_INFO.version} with another main code block`) && g.message.endsWith(`choose that .BIN ${hint}`)
      : g instanceof Error && /^OE block 0x0100 at 0x00000000: checksum total 0x[0-9a-f]{8}, not 0 \(a damaged or altered \.BIN\); this file is a container of /.test(g.message) && g.message.endsWith(`not 0 ${hint}`),
    `the gate on it (checksum ${cks ? 'recomputed' : 'not recomputed'}): ${g?.name}: ${g?.message}`);
  }
  return t;
}

// ---- the files at hand ---------------------------------------------------------------------------------------------
const binOf = (m) => [process.env.OM_FW_DIR && path.join(process.env.OM_FW_DIR, m.bin), path.join(REPO, 'fw', m.bin), path.join(REPO, 'fw/old', m.bin)].find((f) => f && fs.existsSync(f)) ?? null;
const fileReader = (file) => {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  return { size, close: () => fs.closeSync(fd), read: (off, len) => { const b = new Uint8Array(len); const n = fs.readSync(fd, b, 0, len, off); return n === len ? b : b.subarray(0, n); } };
};
export async function identifyFiles() {
  const t = tester(), { ok } = t, skipped = [];
  for (const [code, m] of Object.entries(MODELS)) {
    const bin = binOf(m), blk = path.join(REPO, romPath(m));
    if (bin) {
      const f = fileReader(bin);
      try {
        const r = await identifyFirmware(f.read, f.size, createHash), rel = releaseHead(code);
        ok(r.status === 'stock' && r.kind === 'container' && r.model === code && r.checksum_ok === true && r.head.model === rel.model && r.head.ver === rel.ver && r.head.off === 0 && r.head.len === m.rom_len && r.rom_sha256 === m.rom_sha256,
          `${m.bin}: ${JSON.stringify({ ...r, main: null })}`);
      } finally { f.close(); }
    } else skipped.push(`${code}: no ${m.bin}`);
    if (fs.existsSync(blk)) {
      const r = identifyBytes(new Uint8Array(fs.readFileSync(blk)), createHash);
      ok(r.status === 'stock' && r.kind === 'block' && r.model === code, `${code}'s unpacked main code block: ${JSON.stringify(r)}`);
    } else skipped.push(`${code}: no unpacked main code block`);
  }
  return { checks: t.checks, bad: t.bad, skipped };
}

// ---- the process's model through bin/session.mjs --------------------------------------------------------------------
const BIN = path.join(EMU, 'bin/session.mjs');
const cli = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: opts.timeout ?? 300000, maxBuffer: 1 << 28, env: { ...process.env, ...(opts.env ?? {}) } });
  const lines = [];
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { lines.push({ unparsed: l }); } }
  return { rc: r.status, steps: lines.filter((x) => !x.summary), sum: lines.find((x) => x.summary) ?? null, err: r.stderr ?? '', last: (r.stderr ?? '').trim().split('\n').at(-1) ?? '' };
};
export async function identifySession() {
  const t = tester(), { ok } = t, skipped = [];
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { labFirmware } = await import('../src/fw/labfw.mjs');
  const stockBin = binOf(MODEL_INFO), stockBlk = path.join(REPO, romPath(MODEL_INFO));
  if (!stockBin) { skipped.push(`${MODEL}: no ${MODEL_INFO.bin} (fw/, fw/old/ or $OM_FW_DIR)`); return { checks: t.checks, bad: t.bad, skipped }; }
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-identify-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // --main with the stock .BIN: the stock block itself, as --main with the unpacked block
    const s0 = cli(['--main', stockBin, 'wait:100']), s1 = cli(['--main', stockBlk, 'wait:100']);
    ok(s0.rc === 1 && s0.last === `session.mjs: --main refused: ${stockBin}: the stock main code block itself (nothing to patch)` && s1.rc === 1 && s1.last === `session.mjs: --main refused: ${stockBlk}: the stock main code block itself (nothing to patch)`,
      `--main with the stock .BIN and with the stock block: rc ${s0.rc} ${s0.last} | rc ${s1.rc} ${s1.last}`);
    // a .BIN with 16 bytes of the main block's 0xFF tail padding changed: the file as it is, and its checksum recomputed
    const TAIL = MODEL_INFO.rom_len - 0x100, NEW = Buffer.from('om-emu container');
    const whole = new Uint8Array(fs.readFileSync(stockBin)), b0 = F.walkBytes(whole).blocks[0], stock = F.decodeBlock(whole.subarray(0, 64 + b0.len), b0).data;
    ok(b0.flags === 0x0100 && stock.subarray(TAIL, TAIL + 16).every((x) => x === 0xff) && sha(stock) === MODEL_INFO.rom_sha256, `${MODEL}: the .BIN's first block is the stock main block, 0xFF padding at 0x${TAIL.toString(16)}`);
    const want = stock.slice(); want.set(NEW, TAIL);
    for (let k = 0; k < 16; k++) whole[32 + TAIL + F.PERM[k]] = want[TAIL + k] ^ 0xff;        // the group scrambled back (TAIL is 16-aligned)
    const modBin = path.join(tmp, MODEL_INFO.bin), fixBin = path.join(tmp, 'fixed.BIN'), bareBlk = path.join(tmp, 'main.bin');
    fs.writeFileSync(modBin, whole);
    fs.writeFileSync(bareBlk, want);
    const flow = ['wait:1500', 's1', 's2', 'wait:1500', 'play', 'info', 'play', 'menu', 'down', 'menu'];
    const plain = cli(flow), bare = cli(['--main', bareBlk, ...flow]), cont = cli(['--main', modBin, ...flow]);
    const shape = (r, lab = true) => JSON.stringify(r.steps.map((x) => [x.token, x.ok, lab ? x.lab_ns : 0, x.gui, x.frame]));
    ok(plain.rc === 0 && bare.rc === 0 && cont.rc === 0 && plain.steps.length === flow.length + 1 && new Set(plain.steps.map((x) => x.frame)).size >= 3 && plain.steps.slice(1).every((x) => x.frame),
      `the three runs pass and the flow's frames change: rc ${plain.rc} ${bare.rc} ${cont.rc}; ${plain.steps.map((x) => x.frame)} | ${cont.last}`);
    ok(shape(cont) === shape(bare), `--main with the .BIN: every step's lab time, GUI and frame are the bare block's:\n${shape(cont)}\n${shape(bare)}`);
    ok(shape(cont, false) === shape(plain, false), `--main with the .BIN: every step's GUI and frame are the stock session's:\n${shape(cont, false)}\n${shape(plain, false)}`);
    const tailNote = '; not applied: container (only its main code block is taken: its ';
    const head = `1 patch (16 bytes changed) from ${modBin}; main block sha256 ${sha(want).slice(0, 16)} (stock ${MODEL_INFO.rom_sha256.slice(0, 16)})`;
    ok(cont.sum?.patch?.startsWith(head + tailNote) && /other block\(s\) are not read, the lab loads the stock resource block\), checksum \(the main code block's checksum total is not 0 \(not recomputed after the change\); the lab does not check it\)$/.test(cont.sum.patch) &&
      bare.sum?.patch === head.replace(modBin, bareBlk) && cont.err.includes(`session.mjs: patched firmware: ${cont.sum.patch}`),
    `the summary's patch: the bare block's but for the file and what is not applied: ${cont.sum?.patch} | ${bare.sum?.patch}`);
    ok(cont.sum?.patch_audit && JSON.stringify(cont.sum.patch_audit) === JSON.stringify(bare.sum?.patch_audit) && JSON.stringify(cont.sum.stand_ins) === JSON.stringify(bare.sum.stand_ins) && plain.sum.patch === null,
      `the summary's patch audit and stand-ins are the bare block's: ${JSON.stringify(cont.sum?.patch_audit)} | ${JSON.stringify(bare.sum?.patch_audit)}`);
    // control: the comparison tells a run with another flow apart
    const other = cli(['--main', modBin, ...flow.filter((x) => x !== 's2')]), drop = (r) => JSON.stringify(r.steps.filter((x) => x.token !== 's2').map((x) => [x.token, x.gui, x.frame]));
    ok(other.rc === 0 && drop(other) !== drop(plain), `control: the same comparison tells a flow without S2 apart (its playback has no picture): rc ${other.rc} ${other.last}`);

    // the checksum recomputed: the tail's checksum field moved by the sum's change; no checksum note
    const fixed = whole.slice(), dv = new DataView(fixed.buffer), at = 32 + b0.len + 28;
    dv.setUint32(at, (dv.getUint32(at, true) - (F.sum32(want) - F.sum32(stock))) >>> 0, true);
    fs.writeFileSync(fixBin, fixed);
    const idMod = identifyBytes(whole, createHash), idFix = identifyBytes(fixed, createHash);
    ok(idMod.status === 'modified' && idMod.model === MODEL && idMod.checksum_ok === false && idFix.status === 'modified' && idFix.checksum_ok === true && idFix.rom_sha256 === sha(want),
      `the two .BINs: ${JSON.stringify({ ...idMod, main: null })} ${JSON.stringify({ ...idFix, main: null })}`);
    const fx = cli(['--main', fixBin, 'wait:100']);
    ok(fx.rc === 0 && fx.sum?.patch?.startsWith(head.replace(modBin, fixBin) + tailNote) && /stock resource block\)$/.test(fx.sum.patch), `--main with the checksum recomputed: no checksum note: rc ${fx.rc} ${fx.sum?.patch} | ${fx.last}`);
    // the lab's gate (the browser player's and fetch-fw's) still refuses both, naming them
    for (const [file, re] of [[modBin, /^OE block 0x0100 at 0x00000000: checksum total 0x[0-9a-f]{8}, not 0 \(a damaged or altered \.BIN\); this file is a container of /], [fixBin, /^the main code block is not .*: this file is a container of /]]) {
      const f = fileReader(file);
      let e = null;
      try { await labFirmware(f.read, f.size, createHash); } catch (x) { e = x; } finally { f.close(); }
      ok(e && re.test(e.message) && e.message.includes(`${MODEL} (${MODEL_INFO.name}) v${MODEL_INFO.version} with another main code block`) && e.message.endsWith('node\'s --patch or --main)') && e.id?.status === 'modified',
        `the gate on ${path.basename(file)}: ${e ? e.message : 'accepted'}`);
    }
    // another body's .BIN (one of the same main block length where there is one at hand)
    const otherCode = Object.keys(MODELS).find((c) => c !== MODEL && MODELS[c].rom_len === MODEL_INFO.rom_len && binOf(MODELS[c])) ?? Object.keys(MODELS).find((c) => c !== MODEL && binOf(MODELS[c]));
    if (!otherCode) skipped.push('no other body\'s .BIN at hand');
    else {
      const o = cli(['--main', binOf(MODELS[otherCode]), 'wait:100']);
      ok(o.rc === 1 && o.last === `session.mjs: --main refused: ${binOf(MODELS[otherCode])}: ${otherCode} (${MODELS[otherCode].name})'s v${MODELS[otherCode].version} release container (${MODELS[otherCode].bin}): not a .BIN of ${MODEL}'s firmware as the lab runs it, stock or modified`,
        `--main with ${otherCode}'s .BIN: rc ${o.rc} ${o.last}`);
    }
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
  if (all || process.argv.includes('--units')) say('firmware identity units', await identifyUnits());
  if (process.argv.includes('--files')) say('firmware identity of the files at hand', await identifyFiles());
  if (process.argv.includes('--session')) { const r = await identifySession(); say(`--main with a .BIN (${process.env.OM_EMU_MODEL ?? 'E143'}, bin/session.mjs)`, r); fail += r.skipped.length; }
  process.exit(fail ? 1 : 0);
}
