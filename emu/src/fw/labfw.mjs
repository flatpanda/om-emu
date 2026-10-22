// The firmware the lab runs, from a .BIN: the two blocks (src/fw/olyfw.mjs labBlocks), the resource block cut to its
// prefix (src/fw/resprefix.mjs), and both checked against the digests MODELS gives the run's model (src/fw/model.mjs
// MODEL_INFO: rom_sha256, BLOBS.sha256's digest of the main code block, and res_sha256, the resource prefix's). The
// lab runs one model's release (its addresses are translated for that build), so any other .BIN that unpacks cleanly (a
// newer release, or another body's) is refused here, before anything is cached, with a message that names the .BIN the
// model needs and, when the main code block is another body's of MODELS, that body.
// Worker-safe: the reader and the hash come in as arguments.
import { labBlocks } from './olyfw.mjs';
import { resPrefix } from './resprefix.mjs';
import { MODEL, MODEL_INFO } from './model.mjs';
import { MODELS } from './models.mjs';

export class WrongFirmware extends Error {
  constructor(what, got) {
    const want = what === 'the main code block' ? MODEL_INFO.rom_sha256 : MODEL_INFO.res_sha256;
    const other = what === 'the main code block' ? Object.keys(MODELS).find((k) => MODELS[k].rom_sha256 === got) : undefined;
    super(`${what} is not ${MODEL}'s (sha256 ${String(got).slice(0, 16)}..., ${MODEL} ${want.slice(0, 16)}...)` +
      (other ? `: this .BIN is ${other}'s (${MODELS[other].name}) firmware` : '') +
      `; the lab runs ${MODEL} (${MODEL_INFO.name}) on the firmware ${MODEL_INFO.bin}: choose that .BIN`);
    this.name = 'WrongFirmware';
  }
}

// Throws WrongFirmware unless the two digests are the model's (the OPFS cache's manifest, the blocks just unpacked).
export function checkFirmware(rom_sha256, res_sha256) {
  if (rom_sha256 !== MODEL_INFO.rom_sha256) throw new WrongFirmware('the main code block', rom_sha256);
  if (res_sha256 !== MODEL_INFO.res_sha256) throw new WrongFirmware('the resource prefix', res_sha256);
}

// {rom, res (the prefix), rom_sha256, res_sha256, res_full (the whole resource block's length)}, or throws (a damaged
// container, a block missing, a checksum, a cut, WrongFirmware). The main code block is checked before the prefix is cut.
export async function labFirmware(read, size, createHash, { onBlock = null } = {}) {
  const hex = (b) => createHash('sha256').update(b).digest('hex');
  const { rom, res } = await labBlocks(read, size, { onBlock });
  const rom_sha256 = hex(rom.data);
  if (rom_sha256 !== MODEL_INFO.rom_sha256) throw new WrongFirmware('the main code block', rom_sha256);
  const prefix = resPrefix(res.data, { load: res.block.load });
  const res_sha256 = hex(prefix);
  checkFirmware(rom_sha256, res_sha256);
  return { rom: rom.data, res: prefix, rom_sha256, res_sha256, res_full: res.data.length };
}
