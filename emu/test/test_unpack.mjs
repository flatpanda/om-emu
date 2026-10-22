// Gate B1: the .BIN unpacker (src/fw/olyfw.mjs) and the resource prefix (src/fw/resprefix.mjs).
// - the real E143 .BIN ($OM_BIN, else $OM_FW_DIR/OLY_E_143_1900_0000_0000.BIN): every checksum is 0, the two lab
//   blocks (main code and resources, the files bin/fetch-fw.mjs writes) are in unpacked/E143, and every walked block
//   with a file there is byte-identical to it (no file there is left unwalked);
// - every .BIN under $OM_FW_DIR against its line in BLOBS.sha256 (fw/<path>);
// - the resource prefix: the extent from the block's index, refusals of a cut that ends inside an entry;
// - the firmware identity (src/fw/labfw.mjs): the run's model's .BIN accepted with its MODELS digests, every other
//   .BIN under $OM_FW_DIR refused (one of another MODELS body named as that body's), a synthetic container that
//   unpacks cleanly refused as not the model's (no firmware needed), and checkFirmware on the OPFS manifest's digests.
// A missing .BIN or firmware directory is a skip that the summary counts and reports, never a pass.
//   node emu/test/test_unpack.mjs [--all]   (--all: also walk and verify every block of every .BIN in $OM_FW_DIR)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as F from '../src/fw/olyfw.mjs';
import { resExtent, resPrefix } from '../src/fw/resprefix.mjs';
import { labFirmware, checkFirmware, WrongFirmware } from '../src/fw/labfw.mjs';
import { MODEL_INFO as FW } from '../src/fw/model.mjs';
import { MODELS } from '../src/fw/models.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const E143 = path.join(REPO, 'unpacked/E143');
const BIN_NAME = 'OLY_E_143_1900_0000_0000.BIN';
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function fwPaths(env = process.env) {
  const dir = env.OM_FW_DIR || null;
  const bin = env.OM_BIN || (dir ? path.join(dir, BIN_NAME) : null);
  return { dir, bin };
}
// A reader over a file descriptor (what File.slice is in the Worker).
export function fileReader(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  const read = (off, len) => { const b = new Uint8Array(len); const n = fs.readSync(fd, b, 0, len, off); return n === len ? b : b.subarray(0, n); };
  return { read, size, close: () => fs.closeSync(fd) };
}
const memReader = (u8) => ({ read: (off, len) => u8.subarray(off, off + len), size: u8.length });

const nodeHash = (alg) => createHash(alg);

// A synthetic block: head, the body (scrambled when flags != 0) and a tail whose checksum makes the u32 sum 0. body: a
// multiple of 16 bytes.
export function synthBlock(typ, flags, body, load = 0x1000, ver = 0x0143) {
  const head = (cks) => {
    const h = new Uint8Array(32), dv = new DataView(h.buffer);
    h[0] = typ.charCodeAt(0); h[1] = typ.charCodeAt(1); h[2] = 0x12; h[3] = 0x34;
    dv.setUint32(8, load, true); dv.setUint32(12, body.length, true); dv.setUint16(16, ver, true); dv.setUint16(20, flags, true); dv.setUint32(28, cks, true);
    return h;
  };
  const total = (F.sum32(head(0)) + F.sum32(body) + F.sum32(head(0))) >>> 0;
  const stored = new Uint8Array(body.length);
  if (flags !== 0) { for (let g = 0; g < body.length; g += 16) for (let k = 0; k < 16; k++) stored[g + F.PERM[k]] = body[g + k] ^ 0xff; } else stored.set(body);
  const out = new Uint8Array(64 + body.length);
  out.set(head(0), 0); out.set(stored, 32); out.set(head((-total) >>> 0), 32 + body.length);
  return out;
}

// labFirmware / checkFirmware: {checks, bad, skipped}
export async function identityTests(dir) {
  const bad = [], skipped = [];
  let checks = 0;
  const refuses = async (what, read, size, want) => {
    checks++;
    try { await labFirmware(read, size, nodeHash); bad.push(`${what}: accepted`); } catch (e) {
      if (!(e instanceof WrongFirmware) || !e.message.includes(FW.bin) || !e.message.includes(want)) bad.push(`${what}: refused with ${e.name}: ${e.message}`);
      return e.message;
    }
    return null;
  };
  // a container with both lab blocks, every checksum 0, no model's
  let seed = 3;
  const body = (n) => Uint8Array.from({ length: n }, () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; });
  const a = synthBlock('OE', 0x0100, body(4096)), b = synthBlock('OE', 0x0101, body(2048));
  const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length);
  { const m = memReader(c); const w = await F.walk(m.read, m.size); checks++; if (w.blocks.length !== 2 || w.blocks.some((x) => x.error)) bad.push(`synthetic container: walk ${JSON.stringify(w.blocks)}`); }
  { const m = memReader(c); await refuses('synthetic container', m.read, m.size, 'the main code block'); }
  // the manifest check
  const thr = (f) => { try { f(); return null; } catch (e) { return e; } };
  checks += 3;
  if (thr(() => checkFirmware(FW.rom_sha256, FW.res_sha256))) bad.push('checkFirmware: the model\'s digests refused');
  if (!(thr(() => checkFirmware('0'.repeat(64), FW.res_sha256)) instanceof WrongFirmware)) bad.push('checkFirmware: another main code block accepted');
  if (!(thr(() => checkFirmware(FW.rom_sha256, undefined)) instanceof WrongFirmware)) bad.push('checkFirmware: a manifest without the prefix digest accepted');
  // the real .BINs
  if (!dir || !fs.existsSync(dir)) { skipped.push(`firmware identity: firmware directory ${dir ?? '(OM_FW_DIR unset)'} not found`); return { checks, bad, skipped }; }
  const bins = fs.readdirSync(dir).filter((n) => /^OLY_E_\d+_\d+_0000_0000\.BIN$/.test(n)).sort();
  for (const n of bins) {
    const r = fileReader(path.join(dir, n));
    try {
      if (n === FW.bin) {
        checks++;
        const fw = await labFirmware(r.read, r.size, nodeHash);
        if (fw.rom_sha256 !== FW.rom_sha256 || fw.res_sha256 !== FW.res_sha256 || fw.rom.length !== FW.rom_len || fw.res.length !== FW.res_len) bad.push(`${n}: ${JSON.stringify({ rom: fw.rom_sha256, res: fw.res_sha256, lens: [fw.rom.length, fw.res.length] })}`);
      } else {
        const msg = await refuses(n, r.read, r.size, 'the main code block');
        const body = Object.keys(MODELS).find((k) => MODELS[k].bin === n);
        if (body && msg !== null) { checks++; if (!msg.includes(`this .BIN is ${body}'s`)) bad.push(`${n}: refused without naming ${body}: ${msg}`); }
        if (msg !== null) console.log(`   ${n}: refused: ${msg.slice(0, 160)}`);
      }
    } finally { r.close(); }
  }
  if (!bins.includes(FW.bin)) bad.push(`${dir}: no ${FW.bin}`);
  return { checks, bad, skipped };
}

export async function unpackTests({ all = false } = {}) {
  const bad = [], skipped = [];
  let checks = 0;
  // the real .BIN against unpacked/E143
  const { dir, bin } = fwPaths();
  let resBody = null;
  if (!bin || !fs.existsSync(bin)) skipped.push(`E143 .BIN: ${bin ?? 'set OM_BIN or OM_FW_DIR'} not found`);
  else {
    const r = fileReader(bin);
    try {
      const { blocks, end } = await F.walk(r.read, r.size);
      const names = new Set(fs.readdirSync(E143).filter((n) => n.startsWith(BIN_NAME + '.blk')));
      for (const b of blocks) {
        checks++;
        const name = F.blockName(BIN_NAME, b);
        const got = await F.readBlock(r.read, b);
        if (!got.cksum_ok) bad.push(`${name}: checksum total 0x${got.cksum_tot.toString(16)}`);
        if (!names.delete(name)) { if (b.flags === 0x0100 || b.flags === 0x0101) bad.push(`${name}: no such file in unpacked/E143 (bin/fetch-fw.mjs writes it)`); continue; }
        const want = fs.readFileSync(path.join(E143, name));
        if (want.length !== got.data.length || sha(want) !== sha(got.data)) bad.push(`${name}: ${got.data.length} bytes, sha ${sha(got.data).slice(0, 12)} != unpacked ${want.length} bytes ${sha(want).slice(0, 12)}`);
        if (b.flags === 0x0101) resBody = got.data;
      }
      for (const n of names) bad.push(`${n}: in unpacked/E143 but not walked from ${bin}`);
    } finally { r.close(); }
  }
  // BLOBS.sha256
  if (!dir || !fs.existsSync(dir)) skipped.push(`BLOBS.sha256 check: firmware directory ${dir ?? '(OM_FW_DIR unset)'} not found`);
  else {
    const blobs = new Map(fs.readFileSync(path.join(REPO, 'BLOBS.sha256'), 'utf8').split('\n').filter(Boolean).map((l) => { const [h, p] = l.split(/\s+/); return [p, h]; }));
    const walkDir = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(d, e.name)) : e.name.endsWith('.BIN') ? [path.join(d, e.name)] : []));
    const bins = walkDir(dir);
    if (!bins.length) bad.push(`${dir}: no .BIN file`);
    for (const f of bins) {
      checks++;
      const key = 'fw/' + path.relative(dir, f);
      const want = blobs.get(key);
      const got = createHash('sha256').update(fs.readFileSync(f)).digest('hex');
      if (!want) bad.push(`${key}: not listed in BLOBS.sha256`);
      else if (got !== want) bad.push(`${key}: sha256 ${got.slice(0, 16)} != BLOBS.sha256 ${want.slice(0, 16)}`);
      if (all) {
        const r = fileReader(f);
        try {
          const { blocks } = await F.walk(r.read, r.size);
          for (const b of blocks) { if (b.error) { bad.push(`${key} @0x${b.off.toString(16)}: ${b.error}`); continue; } const x = await F.readBlock(r.read, b); if (!x.cksum_ok) bad.push(`${key} @0x${b.off.toString(16)}: checksum`); }
        } finally { r.close(); }
      }
    }
  }
  // the resource prefix
  const block = resBody ?? (fs.existsSync(path.join(E143, `${BIN_NAME}.blk02000000.OE.0101.bin`)) ? new Uint8Array(fs.readFileSync(path.join(E143, `${BIN_NAME}.blk02000000.OE.0101.bin`))) : null);
  if (!block) skipped.push('resource prefix: no resource block');
  else {
    checks++;
    const { end, entries } = resExtent(block);
    const p = resPrefix(block);
    if (p.length !== end || end > block.length || entries.length === 0) bad.push(`resource prefix: ${p.length} bytes, extent ${end}, ${entries.length} entries`);
    try { resPrefix(block, { cut: end - 1 }); bad.push('resource prefix: a cut inside the last entry was not refused'); } catch { /* refused */ }
    let last = 0;
    for (const [a, s] of entries) last = Math.max(last, a + s);
    if (!entries.some(([a, s]) => a + s === last)) bad.push('resource prefix: no entry ends at the extent');
  }
  const id = await identityTests(dir);
  checks += id.checks; bad.push(...id.bad); skipped.push(...id.skipped);
  return { checks, bad, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await unpackTests({ all: process.argv.includes('--all') });
  console.log(`unpacker (B1): ${r.checks - r.bad.length}/${r.checks}; ${r.skipped.length} skipped`);
  r.bad.forEach((x) => console.log('  ', x));
  r.skipped.forEach((x) => console.log('   SKIPPED', x));
  process.exit(r.bad.length ? 1 : r.skipped.length ? 3 : 0);
}
