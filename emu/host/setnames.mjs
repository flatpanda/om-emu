// A body's setting names (src/fw/setnames.mjs) from the user's own firmware, read when first asked for and kept for
// the process, per body. The block 2 body (flags 0x0106) is taken from unpacked/<code>/ when it is there and
// BLOBS.sha256 pins its digest (E143's and E146's are unpacked; checked against the pin), else from the body's .BIN (its
// path in BLOBS.sha256, fw/ or fw/old/, or $OM_FW_DIR/<its name>) through the container reader (src/fw/olyfw.mjs), its
// checksum verified and the same .BIN's main code block checked against the body's MODELS digest (rom_sha256), so the
// names are the release the lab runs. Nothing is written: the names are firmware bytes and stay in memory. Throws
// SettingNameError where the firmware is not there or holds no table (src/fw/setnames.mjs nameTable). Node only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MODELS, codeOf } from '../src/fw/models.mjs';
import { parseHead, decodeBlock, TYPES } from '../src/fw/olyfw.mjs';
import { nameTable, readNames, SettingNames, SettingNameError, NAMES_BLOCK_FLAGS } from '../src/fw/setnames.mjs';
import { REPO, binPin } from './blobs.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const hex = (v, n) => v.toString(16).padStart(n, '0');
const cache = new Map();

// The pinned digest of an unpacked file (its path relative to the repository), or null
function pinOf(rel) {
  for (const line of fs.readFileSync(path.join(REPO, 'BLOBS.sha256'), 'utf8').split('\n')) {
    const [h, r] = line.trim().split(/\s+/);
    if (r === rel) return h;
  }
  return null;
}
// The body's .BIN on disk, or null
function binFile(m) {
  const pin = binPin(m), dir = process.env.OM_FW_DIR;
  return [pin && path.join(REPO, pin.rel), dir && path.join(dir, m.bin)].find((f) => f && fs.existsSync(f)) ?? null;
}
// The OE blocks' heads of a .BIN, read from its file (olyfw.mjs walk, synchronously)
function heads(fd, size) {
  const blocks = [], h = new Uint8Array(32);
  for (let off = 0; off + 32 <= size;) {
    fs.readSync(fd, h, 0, 32, off);
    if (!TYPES.includes(String.fromCharCode(h[0], h[1]))) break;
    const b = { off, ...parseHead(h, 0) };
    if (off + 64 + b.len > size) break;
    blocks.push(b);
    off += 64 + b.len;
  }
  return blocks;
}
const readAt = (fd, b) => { const all = new Uint8Array(64 + b.len); fs.readSync(fd, all, 0, all.length, b.off); return all; };

// {body, source}: the block 2 body of MODELS[code], or SettingNameError
export function block2(code) {
  const m = MODELS[code];
  if (!m) throw new SettingNameError(`${code}: not a MODELS body`);
  const dir = path.join(REPO, 'unpacked', codeOf(m));
  const unpacked = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${m.bin}.blk`) && f.endsWith(`.OE.${hex(NAMES_BLOCK_FLAGS, 4)}.bin`)) : undefined;
  if (unpacked) {
    const rel = `unpacked/${codeOf(m)}/${unpacked}`, want = pinOf(rel);
    if (want) {
      const body = new Uint8Array(fs.readFileSync(path.join(REPO, rel)));
      if (sha(body) !== want) throw new SettingNameError(`${rel}: sha256 ${sha(body).slice(0, 16)}..., BLOBS.sha256 pins ${want.slice(0, 16)}...`);
      return { body, source: rel };
    }
  }
  const file = binFile(m);
  if (!file) throw new SettingNameError(`${code}: neither ${m.bin}'s block 2 (flags 0x${hex(NAMES_BLOCK_FLAGS, 4)}) in unpacked/${codeOf(m)}/ nor the .BIN itself (fw/, fw/old/ or $OM_FW_DIR) is here: the setting names are read from the user's own firmware`);
  const fd = fs.openSync(file, 'r');
  try {
    const blocks = heads(fd, fs.fstatSync(fd).size), b2 = blocks.find((b) => b.typ === 'OE' && b.flags === NAMES_BLOCK_FLAGS), main = blocks.find((b) => b.typ === 'OE' && b.flags === 0x0100);
    if (!b2 || !main) throw new SettingNameError(`${file}: no OE block with flags 0x${hex(b2 ? 0x0100 : NAMES_BLOCK_FLAGS, 4)}`);
    const rom = decodeBlock(readAt(fd, main), main);
    if (sha(rom.data) !== m.rom_sha256) throw new SettingNameError(`${file}: its main code block is not ${code}'s v${m.version} (sha256 ${sha(rom.data).slice(0, 16)}...)`);
    const r = decodeBlock(readAt(fd, b2), b2);
    if (!r.cksum_ok) throw new SettingNameError(`${file}: block 2 at 0x${hex(b2.off, 8)}: checksum total 0x${hex(r.cksum_tot, 8)}, not 0`);
    return { body: r.data, source: path.relative(REPO, file).startsWith('..') ? file : path.relative(REPO, file) };
  } finally { fs.closeSync(fd); }
}

// MODELS[code]'s names (SettingNames), kept per body for the process; SettingNameError as block2 and nameTable throw
export function settingNames(code) {
  if (cache.has(code)) return cache.get(code);
  const { body, source } = block2(code);
  let t;
  try { t = nameTable(body); } catch (e) {
    if (e instanceof SettingNameError) e.message = `${code} (${source}): ${e.message}`;
    throw e;
  }
  const names = new SettingNames(readNames(body, t), { model: code, offset: t.offset, source });
  cache.set(code, names);
  return names;
}
