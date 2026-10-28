// The card in the first slot for a node-hosted lab (env.card, src/lab/storage.mjs): kept in one file between sessions
// (src/lab/sdcard.mjs cardImage: the sectors the firmware wrote), so a card the firmware formatted mounts at the next
// start without a format, and the pictures stay on it. Off unless the host passes a file (OM_EMU_CARD); without it
// every session starts with a blank card. Its capacity is the saved card's, or for a new card the host's size
// (OM_EMU_CARD_SIZE in GiB, src/lab/sdcard.mjs cardSectors: above 32 an SDXC card), else the default 8 GiB SDHC card.
// Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import { SdCard, cardImage, cardFromImage } from '../src/lab/sdcard.mjs';

// sectors: the capacity a new card gets (null: the default card's); a saved card of another capacity is refused, so
// a size option never silently stands for a different card
export function fileCard(file, { sectors = null } = {}) {
  return {
    file,
    open() {
      let bytes = null;
      try { bytes = new Uint8Array(fs.readFileSync(file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!bytes) return new SdCard(sectors === null ? {} : { sectors });
      const card = cardFromImage(bytes);
      if (sectors !== null && card.sectors !== sectors) {
        throw new Error(`fileCard: ${file} holds a card of ${card.sectors} sectors, the size asked for is ${sectors} (another file, or no size, for that card)`);
      }
      return card;
    },
    save(card) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, cardImage(card));
      fs.renameSync(tmp, file);
    },
  };
}
