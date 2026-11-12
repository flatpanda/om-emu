// The card in the first slot for a node-hosted lab (env.card, src/lab/storage.mjs): kept in one file between sessions
// (src/lab/sdcard.mjs cardImage: the sectors the firmware wrote), so a card the firmware formatted mounts at the next
// start without a format, and the pictures stay on it. Off unless the host passes a file (OM_EMU_CARD); without it
// every session starts with a blank card. Its capacity is the saved card's, or for a new card the host's size
// (OM_EMU_CARD_SIZE in GiB, src/lab/sdcard.mjs cardSectors: above 32 an SDXC card), else the default 8 GiB SDHC card.
// Node-only (host/).
import fs from 'node:fs';
import path from 'node:path';
import { SdCard, cardImage, cardFromImage, cardSectors, memoryCard } from '../src/lab/sdcard.mjs';

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

// The second slot's card for a node-hosted lab (env.card2, src/lab/storage.mjs S-SDCARD): {card2} from a file (kept
// between sessions as the first slot's is) and / or a new card's size in GiB, or {} for an empty second slot. The
// file is never the first slot's (first): each slot takes a card of its own
export function secondCard(file, size, first) {
  if (!file && !size) return {};
  const sectors = size ? { sectors: cardSectors(size) } : {};
  if (!file) return { card2: memoryCard(sectors) };
  if (first && path.resolve(file) === path.resolve(first)) throw new Error(`secondCard: ${file} is the first slot's card file (OM_EMU_CARD): the second slot takes a card of its own`);
  return { card2: fileCard(file, sectors) };
}
