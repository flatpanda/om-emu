// The firmware cache of the browser player in the Origin Private File System: the two descrambled blocks the lab
// reads (the main code block and the prefix of the resource block, src/fw/resprefix.mjs) and a manifest with their
// lengths and sha256, so a later visit boots without the .BIN. OPFS is the user's own browser storage for this origin:
// nothing is uploaded, and clear() removes it. Writes use a sync access handle (dedicated Workers only); a cached block
// whose sha256 differs from the manifest's is refused (and the cache cleared), so a damaged cache never boots a lab, and
// so is a manifest whose digests are not the model's (src/fw/labfw.mjs: a cache written before that check existed).
// One directory per model (src/fw/model.mjs MODEL), so each body's firmware stays cached beside the others.
import { checkFirmware } from '../src/fw/labfw.mjs';
import { MODEL } from '../src/fw/model.mjs';

export const DIR = `firmware-${MODEL}`;
export const FILES = { rom: 'rom.bin', res: 'res.bin', manifest: 'manifest.json' };
export const VERSION = 1;
// The directories of the cache before it was named by model alone (E143's was om1-firmware, another model's
// om1-firmware-<code>): one whose manifest has this model's digests is moved to DIR the first time DIR is missing, so
// the rename neither asks for the .BIN again nor strands its blocks in OPFS; one with another body's is left to it.
const LEGACY = [`om1-firmware-${MODEL}`, 'om1-firmware'];

async function dir(create) {
  const root = await navigator.storage.getDirectory();
  try { return await root.getDirectoryHandle(DIR); } catch (e) { if (e?.name !== 'NotFoundError') throw e; }
  for (const name of LEGACY) {
    let old;
    try {
      old = await root.getDirectoryHandle(name);
      const m = JSON.parse(new TextDecoder().decode(await get(old, FILES.manifest)));
      checkFirmware(m.rom?.sha256, m.res?.sha256);
    } catch { continue; }                            // none there, or not this model's
    const d = await root.getDirectoryHandle(DIR, { create: true });
    for (const f of [FILES.rom, FILES.res, FILES.manifest]) await put(d, f, await get(old, f));       // the manifest last
    await root.removeEntry(name, { recursive: true });
    return d;
  }
  return root.getDirectoryHandle(DIR, { create });
}
async function put(d, name, bytes) {
  const fh = await d.getFileHandle(name, { create: true });
  const h = await fh.createSyncAccessHandle();
  try {
    h.truncate(0);
    const n = h.write(bytes, { at: 0 });
    h.flush();
    if (n !== bytes.length) throw new Error(`OPFS ${name}: wrote ${n} of ${bytes.length} bytes`);
  } finally { h.close(); }
}
async function get(d, name) {
  const fh = await d.getFileHandle(name);
  return new Uint8Array(await (await fh.getFile()).arrayBuffer());
}
const hex = (createHash, b) => createHash('sha256').update(b).digest('hex');

// Store the blocks: meta = {bin: {name, size, lastModified}, res_full: the resource block's full length}; sha: the
// blocks' sha256 when the caller has them ({rom, res}), else computed here.
export async function store(rom, res, meta, createHash, sha = {}) {
  const d = await dir(true);
  const manifest = { version: VERSION, ...meta, rom: { len: rom.length, sha256: sha.rom ?? hex(createHash, rom) }, res: { len: res.length, sha256: sha.res ?? hex(createHash, res) } };
  await put(d, FILES.rom, rom);
  await put(d, FILES.res, res);
  await put(d, FILES.manifest, new TextEncoder().encode(JSON.stringify(manifest)));
  return manifest;
}
// The manifest, or null when nothing is cached.
export async function info() {
  try {
    const d = await dir(false);
    const m = JSON.parse(new TextDecoder().decode(await get(d, FILES.manifest)));
    return m.version === VERSION ? m : null;
  } catch { return null; }
}
// {rom, res, manifest} from the cache, verified, or null when nothing (or an old version) is cached.
export async function load(createHash) {
  const m = await info();
  if (!m) return null;
  try { checkFirmware(m.rom?.sha256, m.res?.sha256); } catch (e) { await clear(); throw new Error(`OPFS cache: ${e.message} (cleared)`); }
  const d = await dir(false);
  const rom = await get(d, FILES.rom), res = await get(d, FILES.res);
  for (const [k, b] of [['rom', rom], ['res', res]]) {
    if (b.length !== m[k].len || hex(createHash, b) !== m[k].sha256) {
      await clear();
      throw new Error(`OPFS cache: ${k} block does not match its manifest (cleared; load the .BIN again)`);
    }
  }
  return { rom, res, manifest: m };
}
export async function clear() {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(DIR, { recursive: true }); } catch { /* nothing cached */ }
}
