// caduceus-ep7's release edits.json as a patch file (src/fw/patch.mjs readEdits; cakelesscoder/caduceus-ep7,
// Apache-2.0, film-look patches for the PEN E-P7, E142 1.1: its stock is the .BIN om-emu pins). Nothing of theirs is
// in the repo: the release's files are read from $OM_THIRDPARTY/caduceus-ep7/<tag>/ (default ~/.om-emu/thirdparty),
// fetched by hand from the tag's tree (they publish no release asset), and pinned here by sha256.
//   ep7Units    (firmware-free) a made-up edits document on synthetic blocks: a run-time address and "off:" edits on the
//               main block, an "off:" edit on the resource block (component 0x101), the bytes, the stock blocks
//               untouched, both blocks' changed ranges; refused: an expect byte that differs (the control: the
//               message names the address), a kind not among components, a run-time address on 0x101, an address
//               below the image base, a component the lab does not load, an overlap, expect and new of two lengths,
//               bad hex, an unknown edit field, a malformed components list; the other top-level fields not read
//   ep7Release  (E142: run in a child with OM_EMU_MODEL=E142) per pinned release present: its files against the pins,
//               build.json's stock sha256 the E142 .BIN's (BLOBS.sha256) and its edit count and changed bytes the
//               reader's, the patched blocks' sha256 against the pins; controls: one main edit's and one OSD edit's
//               expect byte flipped each refused with the edit's address; then bin/session.mjs --patch: the start's
//               live-view screen, MENU opens the menu, and the flipped file refused (exit 1) before any lab.
//               A release whose folder is absent prints SKIPPED and passes
//   node emu/test/test_ep7edits.mjs [--release]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PatchRefused, readPatchText, applyPatches, patchLayout } from '../src/fw/patch.mjs';
import { createHash } from '../src/util/sha256.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.dirname(EMU);
const SELF = new URL(import.meta.url).pathname;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (c, what) => { checks++; if (!c) bad.push(what); }, get checks() { return checks; } };
};
const refusal = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof PatchRefused) return e.message; throw e; } };
const hex = (a) => Buffer.from(a).toString('hex');

// The pinned releases: the files' sha256 (as their SHA256SUMS gives edits.json and build.json) and what the reader
// gives on E142's stock blocks (X, 2026-11-22: changed bytes = build.json's changed_payload_bytes)
export const RELEASES = {
  'v0.34a': {
    files: {
      'edits.json': '21dba5b81102387813db91985e562f9d04ba78be9f9e683cb78d1305727703a9',
      'build.json': '26edee854ba011e7ef9d31a3822cd08084f6eefd4c4a39a7e4ab67eddf42c37d',
    },
    main: { patches: 498, sha256: 'f8ca450eda1a7838b42d4dadc211656c888bb5d56681d1a7b0fd2a3685703e81' },
    resource: { patches: 33, sha256: '00fa0d451d11115eccfa39451290fcd2af816354d2b0a8a7ac93c59a823f7b0a' },
  },
};
export const thirdparty = () => process.env.OM_THIRDPARTY ?? path.join(os.homedir(), '.om-emu', 'thirdparty');

// ---- firmware-free -------------------------------------------------------------------------------------------------
export function ep7Units() {
  const t = tester(), { ok } = t;
  const BASE = 0x60020020;
  const info = { rom_len: 256, image_base: BASE, res_block: 'blk00000140.OE.0101.bin', res_len: 128 };
  const layout = patchLayout(info);
  const main = new Uint8Array(256).map((_, i) => i), resource = new Uint8Array(200).map((_, i) => 255 - (i & 0xff));
  const doc = (edits, extra = {}) => JSON.stringify({ components: ['0x100', '0x101'], edits, labels: { x: '0x1' }, meta: {}, ...extra });
  const E = (kind, addr, expect, nw, more = {}) => ({ kind, addr, expect: hex(expect), new: hex(nw), why: 'w', ...more });
  const apply = (text) => applyPatches({ main, resource }, readPatchText(text, 'edits.json'), { layout, createHash });
  const refuses = (fn, re, what) => { const m = refusal(fn); ok(m !== null && re.test(m), `${what}: ${m ?? 'taken'}`); };

  const good = doc([
    E('0x100', '0x60020030', [16, 17], [0xaa, 17], { source: 'patches/x' }),   // offset 16, one byte changed
    E('0x100', 'off:0x20', [32, 33, 34], [1, 2, 3]),
    E('0x101', 'off:0x10', [resource[16], resource[17]], [9, 9]),
  ]);
  const ps = readPatchText(good, 'edits.json');
  ok(ps.length === 3 && ps[0].offset === null && ps[0].addr === 0x60020030 && ps[0].block === 'component 0x0100' && ps[1].offset === 0x20 && ps[2].block === 'component 0x0101',
    `read: a run-time address keeps its addr (offset taken at apply), off: edits their offsets: ${JSON.stringify(ps.map((p) => [p.block, p.offset, p.addr]))}`);
  const r = apply(good);
  ok(r.blocks.main[16] === 0xaa && r.blocks.main[17] === 17 && hex(r.blocks.main.subarray(32, 35)) === '010203' && r.blocks.resource[16] === 9 && r.blocks.resource[17] === 9,
    'the patched blocks: the run-time address at addr - image base, the off: edits at their offsets, the 0x101 edit in the resource block');
  ok(main[16] === 16 && resource[16] === 255 - 16, 'the stock blocks untouched');
  ok(r.summary.applied === 3 && r.summary.bytes === 6 && JSON.stringify(r.changed) === '[[16,1],[32,3]]' && JSON.stringify(r.ranges.resource) === '[[16,2]]'
    && r.summary.blocks.map((b) => `${b.block}:${b.patches}:${b.ranges}`).join() === 'main:2:2,resource:1:1',
  `the counts and both blocks' changed ranges: ${JSON.stringify(r.summary)} ${JSON.stringify(r.ranges)}`);

  // the control: one expect byte that is not the stock block's
  refuses(() => apply(doc([E('0x100', '0x60020030', [16, 0x55], [0xaa, 0x55])])), /edits\.json edit 0 \(0x60020030\): old bytes differ from the stock main block at 0x00000011 \(0x11, the patch expects 0x55\)/, 'a main expect byte that differs');
  refuses(() => apply(doc([E('0x101', 'off:0x10', [0], [9])])), /edit 0 \(component 0x0101 off:0x10\): old bytes differ from the stock resource block at 0x00000010/, 'an OSD expect byte that differs');
  refuses(() => apply(doc([E('0x106', 'off:0x0', [0], [1])], { components: ['0x100', '0x101', '0x106'] })), /component 0x0106: not a block the lab loads/, 'a component the lab does not load');
  refuses(() => readPatchText(doc([E('0x106', 'off:0x0', [0], [1])]), 'f'), /kind 0x106 is not among the file's components/, 'a kind not among components');
  refuses(() => readPatchText(doc([E('0x101', '0x60020030', [0], [1])]), 'f'), /a run-time address on component 0x101/, 'a run-time address on 0x101');
  refuses(() => apply(doc([E('0x100', '0x60020000', [0], [1])])), /address 0x60020000 lies below this model's image base 0x60020020/, 'an address below the image base');
  refuses(() => apply(doc([E('0x100', '0x60020130', [0], [1])])), /outside the main code block \(256 bytes\)/, 'an address past the block');
  refuses(() => apply(doc([E('0x101', 'off:0x7f', [resource[127], resource[128]], [0, 0])])), /outside the resource block's part the lab reads \(128 bytes\)/, "past the resource block's prefix");
  refuses(() => apply(doc([E('0x100', 'off:0x10', [16, 17], [0, 0]), E('0x100', '0x60020031', [17], [1])])), /overlap in the main block/, 'an overlap of an off: and an address edit');
  refuses(() => readPatchText(doc([E('0x100', 'off:0x10', [16, 17], [0])]), 'f'), /expect has 2 bytes, new 1/, 'expect and new of two lengths');
  refuses(() => readPatchText(doc([{ kind: '0x100', addr: 'off:0x10', expect: '1', new: '2' }]), 'f'), /expect is not hex/, 'odd hex');
  refuses(() => readPatchText(doc([E('0x100', 'off:0x10', [16], [0], { mask: 'ff' })]), 'f'), /field "mask": not one this reader knows/, 'an unknown edit field');
  refuses(() => readPatchText(doc([E('0x100', 'off:-1', [16], [0])]), 'f'), /offset "-1"/, 'a negative off:');
  refuses(() => readPatchText(doc([E('0x100', 'off:0x10', [16], [0])], { components: '0x100' }), 'f'), /components is not a list/, 'components not a list');
  refuses(() => readPatchText(doc([E('0x100', 'off:0x10', [16], [0])], { components: ['0x100', '0x100'] }), 'f'), /names a type twice/, 'a component twice');
  refuses(() => readPatchText(doc([]), 'f'), /no edits/, 'no edits');
  refuses(() => readPatchText(doc([{ kind: '0x100', addr: 'off:0x10', expect: '10' }]), 'f'), /no new/, 'no new');
  return t;
}

// ---- E142 ------------------------------------------------------------------------------------------------------------
export async function ep7Release() {
  const t = tester(), { ok } = t, notes = [];
  const env = await import('../checks/lib/env.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E142') { ok(false, `the release check runs on E142 (OM_EMU_MODEL=E142), not ${MODEL}`); return { ...t, notes }; }
  const blobs = fs.readFileSync(path.join(REPO, 'BLOBS.sha256'), 'utf8');
  const binSha = /^([0-9a-f]{64})\s+fw\/OLY_E_142_1100_0000_0000\.BIN$/m.exec(blobs)?.[1];
  for (const [tag, pin] of Object.entries(RELEASES)) {
    const dir = path.join(thirdparty(), 'caduceus-ep7', tag);
    if (!fs.existsSync(path.join(dir, 'edits.json'))) { notes.push(`SKIPPED ${tag}: ${dir}/edits.json absent`); continue; }
    const files = {};
    for (const [f, want] of Object.entries(pin.files)) {
      let b = null;
      try { b = fs.readFileSync(path.join(dir, f)); } catch {}
      ok(b !== null && sha(b) === want, `${tag} ${f}: ${b === null ? 'missing' : `sha256 ${sha(b).slice(0, 16)}... is not its pin ${want.slice(0, 16)}...`}`);
      files[f] = b;
    }
    if (!files['edits.json'] || !files['build.json']) continue;
    const build = JSON.parse(files['build.json']), text = files['edits.json'].toString('utf8');
    ok(binSha && build.stock_sha256 === binSha, `${tag} build.json stock_sha256 ${build.stock_sha256?.slice(0, 16)}... is the E142 .BIN om-emu pins (${binSha?.slice(0, 16)}...)`);
    const ps = env.readPatchFiles([path.join(dir, 'edits.json')]);
    const r = env.patchedFirmware(ps), s = r.summary;
    const mb = s.blocks.find((b) => b.block === 'main'), rb = s.blocks.find((b) => b.block === 'resource');
    ok(s.applied === build.edits && s.bytes === build.changed_payload_bytes, `${tag}: ${s.applied} edits, ${s.bytes} bytes changed (build.json: ${build.edits}, ${build.changed_payload_bytes})`);
    ok(mb?.patches === pin.main.patches && mb.sha256 === pin.main.sha256 && rb?.patches === pin.resource.patches && rb.sha256 === pin.resource.sha256,
      `${tag}: the patched blocks: main ${mb?.patches} ${mb?.sha256.slice(0, 16)}, resource ${rb?.patches} ${rb?.sha256.slice(0, 16)}`);

    // the controls: one expect byte flipped, in a main edit and in an OSD edit
    const doc = JSON.parse(text);
    const flip = (i) => {
      const d = structuredClone(doc), e = d.edits[i];
      e.expect = ((parseInt(e.expect.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0')) + e.expect.slice(2);
      return { d, e };
    };
    const iMain = doc.edits.findIndex((e) => e.kind === '0x100' && !e.addr.startsWith('off:')), iOsd = doc.edits.findIndex((e) => e.kind === '0x101');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep7edits-'));
    try {
      let brokenFile = null;
      for (const i of [iMain, iOsd]) {
        const { d, e } = flip(i), f = path.join(tmp, `edits-${i}.json`);
        fs.writeFileSync(f, JSON.stringify(d));
        brokenFile ??= f;
        const m = refusal(() => env.patchedFirmware(env.readPatchFiles([f])));
        const at = e.addr.startsWith('off:') ? `component 0x0101 ${e.addr}` : e.addr;
        ok(m !== null && m.includes(`edit ${i} (${at}): old bytes differ`), `${tag} control: edit ${i}'s first expect byte flipped is refused naming ${at}: ${m ?? 'taken'}`);
      }
      // the session: --patch on bin/session.mjs, the start's live view and the menu
      const run = (patch) => spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), '--patch', patch, 'wait:3000', 'menu', 'wait:500'],
        { env: { ...process.env, OM_EMU_MODEL: 'E142' }, encoding: 'utf8', timeout: 300000 });
      const p = run(path.join(dir, 'edits.json'));
      const recs = p.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)), sum = recs.find((x) => x.summary);
      const gui = (tok) => recs.find((x) => x.token === tok)?.gui;
      ok(p.status === 0 && sum?.ok && /531 patches/.test(sum.patch ?? '') && gui('wait:3000') === 'SS_COMMON/ID_ST_CA_REQ_DISP' && gui('menu') === 'SS_MENU/ID_ST_MENU',
        `${tag} session: exit ${p.status}, ${sum?.patch?.slice(0, 40)}, after 3 s ${gui('wait:3000')}, MENU ${gui('menu')} (want the shooting screen, then the menu)${p.status ? `: ${p.stderr.trim().split('\n').pop()}` : ''}`);
      const q = run(brokenFile);
      ok(q.status === 1 && /--patch refused: .*old bytes differ/.test(q.stderr) && !q.stdout.includes('"step"'), `${tag} session control: the flipped file refused before any lab: exit ${q.status}, ${q.stderr.trim().split('\n').pop()}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  return { ...t, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let fail = 0;
  if (process.argv.includes('--release')) {
    const s = await ep7Release();
    s.notes.forEach((x) => console.log(x));
    console.log(`caduceus-ep7 edits.json on E142: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    process.exitCode = s.bad.length ? 1 : 0;
  } else {
    const u = ep7Units();
    console.log(`caduceus-ep7 edits.json units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
    const r = spawnSync(process.execPath, [SELF, '--release'], { env: { ...process.env, OM_EMU_MODEL: 'E142' }, encoding: 'utf8' });
    process.stdout.write(r.stdout + r.stderr);
    if (r.status !== 0) fail++;
    process.exitCode = fail ? 1 : 0;
  }
}
