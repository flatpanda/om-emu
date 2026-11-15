// What a firmware file is (src/fw/identify.mjs) and the gates that say it:
//   identifyUnits    (firmware-free) made-up bodies and containers the test builds: a release's container and its
//                    bare block ('stock'), a head with another version field ('other-version'), a changed main block
//                    with the checksum recomputed and not ('modified', checksum_ok), and what is 'unknown': a head
//                    naming a body MODELS does not hold, a head around another body's stock block, a release's head
//                    with the blocks elsewhere, no main block, two, a cut one, bytes of no known length, a reader that
//                    throws (answered, never thrown). The control the rule exists for: two bodies with main blocks of
//                    one length are told apart by the head's model field and the digest (a length-only gate takes
//                    either for a modified copy of the other); a bare block of that length with an unknown digest names
//                    both as candidates. The reader's answer is the whole file's, walkBytes is walk. The lab's gate
//                    (labFirmware, the run's model): a container of nobody's, bytes of no container and a container
//                    with the model's own head around another main block are refused as before, each now naming what
//                    the file is
//   identifyFiles    (the .BINs and unpacked blocks at hand; a body without either is a counted skip) each MODELS
//                    body's .BIN is its 'stock' container with the checksum 0 and its unpacked block its 'stock' block:
//                    the head rule (model field: the body's digits and 0; version field: the .BIN name's digits)
//   node emu/test/test_identify.mjs [--units] [--files]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as F from '../src/fw/olyfw.mjs';
import { identifyBytes, identifyFirmware, releaseHead, bodyOfHead, bodyOfDigest } from '../src/fw/identify.mjs';
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

  // the lab's gate on files of the run's model: refused as before, each now naming what the file is
  const { labFirmware, WrongFirmware } = await import('../src/fw/labfw.mjs');
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const gate = async (u8) => { try { await labFirmware(asyncReader(u8), u8.length, createHash); return null; } catch (e) { return e; } };
  const g1 = await gate(container(Amod, { model: '1234' }));
  ok(g1 instanceof WrongFirmware && g1.message.includes(`the main code block is not ${MODEL}'s`) && g1.message.includes(': this file is a container of a body MODELS does not hold (model field 1234, version field 0x1200); the lab runs') &&
    g1.message.endsWith(`${MODEL_INFO.bin}: choose that .BIN`) && g1.id.status === 'unknown', `the gate on a container of nobody's: ${g1?.message}`);
  const g2 = await gate(random(1000, 6));
  ok(g2 instanceof Error && !(g2 instanceof WrongFirmware) && /^no OE block with flags 0x0100 in the \.BIN \(0 blocks\); this file is 1000 bytes that start with no container head/.test(g2.message), `the gate on bytes of no container: ${g2?.message}`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !['--units', '--files'].some((x) => process.argv.includes(x));
  let fail = 0;
  const say = (name, r) => {
    console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}${r.skipped?.length ? `, ${r.skipped.length} SKIPPED` : ''}`);
    [...r.bad, ...(r.skipped ?? []).map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
    fail += r.bad.length;
  };
  if (all || process.argv.includes('--units')) say('firmware identity units', await identifyUnits());
  if (process.argv.includes('--files')) say('firmware identity of the files at hand', await identifyFiles());
  process.exit(fail ? 1 : 0);
}
