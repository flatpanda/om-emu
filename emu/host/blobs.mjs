// A MODELS body's firmware files on disk: its .BIN's pin in BLOBS.sha256 and whether its unpacked files are there (the
// two blocks, src/fw/models.mjs romPath, resPath, and on a body that gives res_nand its NAND extract, nandPath). It
// reads src/fw/models.mjs only, never src/fw/model.mjs, so it answers for any model, not only the run's: --model list
// (host/modelarg.mjs), the play server's switch (host/playcli.mjs) and the run's own provisioning (host/firmware.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { romPath, resPath, nandPath } from '../src/fw/models.mjs';

export const REPO = path.resolve(new URL('../../', import.meta.url).pathname);

// A MODELS entry's .BIN as BLOBS.sha256 pins it: {rel (fw/... or fw/old/...), sha256}, or null
export function binPin(m) {
  for (const line of fs.readFileSync(path.join(REPO, 'BLOBS.sha256'), 'utf8').split('\n')) {
    const [h, rel] = line.trim().split(/\s+/);
    if (rel?.startsWith('fw/') && rel.endsWith(`/${m.bin}`)) return { rel, sha256: h };
  }
  return null;
}

// The unpacked files of a MODELS entry are on disk: both blocks and the NAND extract where it has one (their digests
// are not read here)
export const blocksPresent = (m) => [romPath, resPath, nandPath].every((p) => p(m) === null || fs.existsSync(path.join(REPO, p(m))));
