// The card in the first slot for a node-hosted lab (env.card, src/lab/storage.mjs): kept in one file between sessions
// (src/lab/sdcard.mjs cardImage: the sectors the firmware wrote), so a card the firmware formatted mounts at the next
// start without a format, and the pictures stay on it. Off unless the host passes a file (OM_EMU_CARD); without it
// every session starts with a blank card. Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import { SdCard, cardImage, cardFromImage } from '../src/lab/sdcard.mjs';

export function fileCard(file) {
  return {
    file,
    open() {
      let bytes = null;
      try { bytes = new Uint8Array(fs.readFileSync(file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return bytes ? cardFromImage(bytes) : new SdCard();
    },
    save(card) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, cardImage(card));
      fs.renameSync(tmp, file);
    },
  };
}
