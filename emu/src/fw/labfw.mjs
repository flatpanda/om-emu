// The firmware the lab runs, from a .BIN: the two blocks (src/fw/olyfw.mjs labBlocks), the resource block cut to its
// prefix (src/fw/resprefix.mjs), and both checked against the digests MODELS gives the run's model (src/fw/model.mjs
// MODEL_INFO: rom_sha256, BLOBS.sha256's digest of the main code block, and res_sha256, the resource prefix's). The
// lab runs one model's release (its addresses are translated for that build), so any other .BIN that unpacks cleanly (a
// newer release, or another body's) is refused here, before anything is cached, with a message that names the .BIN the
// model needs and, when the main code block is another body's of MODELS, that body; any other refused file is named
// by what src/fw/identify.mjs finds it to be (another release, a modified container, a bare block, no container).
// Worker-safe: the reader and the hash come in as arguments.
import { labBlocks } from './olyfw.mjs';
import { bodyOfDigest, identifyFirmware } from './identify.mjs';
import { nandSourceAsync, nandExtract, encodeExtract } from './nand.mjs';
import { resPrefix } from './resprefix.mjs';
import { MODEL, MODEL_INFO } from './model.mjs';
import { MODELS } from './models.mjs';

// what a refusal of modified firmware adds: how the lab does run it
const overlayHint = (id) => (id?.status === 'modified' ? ' (modified firmware runs as a patch overlay on the stock .BIN: the Patch option, node\'s --patch or --main)' : '');
// id: what the file is (src/fw/identify.mjs), for a main code block that is no MODELS body's stock one
export class WrongFirmware extends Error {
  constructor(what, got, id = null) {
    const want = what === 'the main code block' ? MODEL_INFO.rom_sha256 : MODEL_INFO.res_sha256;
    const other = what === 'the main code block' ? bodyOfDigest(got) : null;
    super(`${what} is not ${MODEL}'s (sha256 ${String(got).slice(0, 16)}..., ${MODEL} ${want.slice(0, 16)}...)` +
      (other ? `: this .BIN is ${other}'s (${MODELS[other].name}) firmware` : id ? `: this file is ${id.reason}` : '') +
      `; the lab runs ${MODEL} (${MODEL_INFO.name}) on the firmware ${MODEL_INFO.bin}: choose that .BIN${overlayHint(id)}`);
    this.name = 'WrongFirmware';
    this.id = id;
  }
}

// Throws WrongFirmware unless the two digests are the model's (the OPFS cache's manifest, the blocks just unpacked).
export function checkFirmware(rom_sha256, res_sha256) {
  if (rom_sha256 !== MODEL_INFO.rom_sha256) throw new WrongFirmware('the main code block', rom_sha256);
  if (res_sha256 !== MODEL_INFO.res_sha256) throw new WrongFirmware('the resource prefix', res_sha256);
}

// {rom, res (the prefix), rom_sha256, res_sha256, res_full (the whole resource block's length)}, or throws (a damaged
// container, a block missing, a checksum, a cut, WrongFirmware). The main code block is checked before the prefix is cut.
// A file refused before its digest is known (no container, a block missing, a checksum) is refused with the same
// error, its message followed by what the file is (identifyFirmware; e.id); what is accepted does not change, and a
// reader's own failure passes unchanged.
export async function labFirmware(read, size, createHash, { onBlock = null } = {}) {
  const hex = (b) => createHash('sha256').update(b).digest('hex');
  let unpacked;
  try { unpacked = await labBlocks(read, size, { onBlock }); } catch (e) {
    // labBlocks' refusals are Errors with a message of their own. A reader's failure whose message cannot be written
    // (the browser's NotReadableError: a DOMException's message is its prototype's getter) is thrown as it came
    if (!(e instanceof Error) || !Object.getOwnPropertyDescriptor(e, 'message')?.writable) throw e;
    const id = await identifyFirmware(read, size, createHash);
    e.message += `; this file is ${id.reason}${overlayHint(id)}`;
    e.id = id;
    throw e;
  }
  const { rom, res, blocks } = unpacked;
  const rom_sha256 = hex(rom.data);
  if (rom_sha256 !== MODEL_INFO.rom_sha256) throw new WrongFirmware('the main code block', rom_sha256, bodyOfDigest(rom_sha256) ? null : await identifyFirmware(read, size, createHash));
  const prefix = resPrefix(res.data, { load: res.block.load });
  const res_sha256 = hex(prefix);
  checkFirmware(rom_sha256, res_sha256);
  return { rom: rom.data, res: prefix, rom_sha256, res_sha256, res_full: res.data.length, blocks, res_load: res.block.load };
}

// The NAND the hosts keep for the play bring-up's resource tables (src/lab/resnand.mjs) in the .BIN's place (the
// browser player's OPFS cache; node's unpacked/<code>, host/firmware.mjs): the extract of the container's NAND blocks
// (src/fw/nand.mjs nandExtract; the resource block's head and tail only, the lab holding its body), as bytes, checked
// against the digest MODELS gives (res_nand.extract_sha256); null on a body without res_nand. read: the container's
// reader (it may answer a Promise); blocks and res_load: labFirmware's.
export async function labNand(read, blocks, createHash, res_load) {
  if (!MODEL_INFO.res_nand) return null;
  const src = nandSourceAsync(read, blocks);
  const bytes = encodeExtract(await nandExtract(src.areas, src.read, { skip: [res_load] }));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  checkNand(sha256);
  return { bytes, sha256 };
}
// Throws unless sha256 is the model's NAND extract digest (MODELS res_nand.extract_sha256), or null on a body without
// res_nand.
export function checkNand(sha256) {
  const want = MODEL_INFO.res_nand?.extract_sha256 ?? null;
  if (sha256 !== want) throw new Error(`the NAND extract is not ${MODEL}'s (sha256 ${String(sha256).slice(0, 16)}..., ${MODEL} ${String(want).slice(0, 16)}...): choose ${MODEL_INFO.bin}`);
}
