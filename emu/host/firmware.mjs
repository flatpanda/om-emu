// The firmware of the run's model (src/fw/model.mjs MODEL) on disk: the main code block and the resource block the node
// tools read (src/fw/models.mjs romPath, resPath; checks/lib/env.mjs ORIGINAL, BLOCK, which check their digests when
// they load them). provision() makes them when they are missing (or, for fetch-fw, are not the model's): the .BIN is
// taken from --bin, else from its path in BLOBS.sha256 (fw/ or fw/old/), $OM_FW_DIR/<its name>, or $OM_BIN when that
// file has its name (the browser gates' variables), else downloaded from the vendor's updater API (src/fw/updater.mjs;
// it serves only each body's latest release, so one other than the release MODELS pins is refused), checked against
// its BLOBS.sha256 pin,
// unpacked with the JS unpacker (src/fw/olyfw.mjs labBlocks), and both blocks checked against MODELS (src/fw/labfw.mjs
// checkFirmware) before either is written. Node only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { romPath, resPath } from '../src/fw/models.mjs';
import { REPO, binPin, blocksPresent } from './blobs.mjs';
import { MODEL, MODEL_INFO } from '../src/fw/model.mjs';
import { labBlocks, blockName } from '../src/fw/olyfw.mjs';
import { resPrefix } from '../src/fw/resprefix.mjs';
import { checkFirmware } from '../src/fw/labfw.mjs';
import { ask, replyTag } from '../src/fw/updater.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function download(pin, say) {
  const reply = await ask(MODEL);
  if (!reply) throw new Error(`the updater API serves no firmware for ${MODEL}`);
  const name = replyTag(reply, 'file_name'), size = Number(replyTag(reply, 'file_size'));
  if (name !== MODEL_INFO.bin) throw new Error(`the updater API now serves ${name}; MODELS pins ${MODEL_INFO.bin} (v${MODEL_INFO.version}), which it no longer serves (see BLOBS.md for other sources)`);
  say(`downloading ${name} (${Math.round(size / 2 ** 20)} MiB) into ${path.dirname(pin.rel)}/`);
  const d = await fetch(replyTag(reply, 'url').replaceAll('&amp;', '&'));
  if (!d.ok) throw new Error(`download failed: HTTP ${d.status}`);
  const data = new Uint8Array(await d.arrayBuffer());
  if (data.length !== size) throw new Error(`the download has ${data.length} bytes, the reply says ${size}`);
  const file = path.join(REPO, pin.rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

// Makes the run's model's blocks if they are missing; prints nothing when they are there. 0, or 1 with the reason on
// stderr. verify: also check the digests of blocks that are there (and say so), and make them again when they are not
// the model's; make false: only report what is missing or wrong. bin: the .BIN to unpack instead of a local one.
export async function provision(prog, { make = true, verify = false, bin = null } = {}) {
  const say = (s) => process.stderr.write(`${prog}: ${s}\n`);
  const rom = path.join(REPO, romPath(MODEL_INFO)), res = path.join(REPO, resPath(MODEL_INFO)), dir = path.dirname(romPath(MODEL_INFO));
  const fetchFw = `node emu/bin/fetch-fw.mjs --model ${MODEL}`;
  try {
    if (blocksPresent(MODEL_INFO)) {
      if (!verify) return 0;
      let wrong = null;
      try { checkFirmware(sha(fs.readFileSync(rom)), sha(resPrefix(new Uint8Array(fs.readFileSync(res))))); } catch (e) { wrong = e.message; }
      if (!wrong) { say(`${dir} holds ${MODEL}'s (${MODEL_INFO.name} v${MODEL_INFO.version}) blocks with their MODELS digests`); return 0; }
      say(`${dir}: ${wrong}`);
      if (!make) { say(`run ${fetchFw} to make them again`); return 1; }
    } else if (!make) { say(`${dir} lacks ${MODEL}'s blocks: run ${fetchFw}`); return 1; }
    const pin = binPin(MODEL_INFO);
    if (!pin) throw new Error(`BLOBS.sha256 pins no ${MODEL_INFO.bin}`);
    const { OM_FW_DIR, OM_BIN } = process.env;
    const local = [path.join(REPO, pin.rel), OM_FW_DIR && path.join(OM_FW_DIR, MODEL_INFO.bin), OM_BIN && path.basename(OM_BIN) === MODEL_INFO.bin && OM_BIN];
    if (bin && !fs.existsSync(bin)) throw new Error(`no such file: ${bin}`);
    const file = bin ?? local.find((f) => f && fs.existsSync(f)) ?? await download(pin, say);
    const got = sha(fs.readFileSync(file));
    if (got !== pin.sha256) throw new Error(`${file}: sha256 ${got.slice(0, 16)}..., BLOBS.sha256 pins ${pin.sha256.slice(0, 16)}... for ${MODEL_INFO.bin} (not ${MODEL}'s v${MODEL_INFO.version} release)`);
    const rel = path.relative(REPO, file);
    say(`unpacking ${rel.startsWith('..') ? file : rel} into ${dir}/`);
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
    const read = (off, len) => { const b = new Uint8Array(len); const n = fs.readSync(fd, b, 0, len, off); return n === len ? b : b.subarray(0, n); };
    let blocks;
    try { blocks = await labBlocks(read, size); } finally { fs.closeSync(fd); }
    for (const [blk, f] of [[blocks.rom, rom], [blocks.res, res]]) {
      if (blockName(MODEL_INFO.bin, blk.block) !== path.basename(f)) throw new Error(`${MODEL_INFO.bin}: block ${blockName(MODEL_INFO.bin, blk.block)}, src/fw/models.mjs names ${path.basename(f)}`);
    }
    checkFirmware(sha(blocks.rom.data), sha(resPrefix(blocks.res.data, { load: blocks.res.block.load })));
    fs.mkdirSync(path.dirname(rom), { recursive: true });
    fs.writeFileSync(rom, blocks.rom.data);
    fs.writeFileSync(res, blocks.res.data);
    say(`${dir} ready`);
    return 0;
  } catch (e) {
    say(e.message);
    return 1;
  }
}
