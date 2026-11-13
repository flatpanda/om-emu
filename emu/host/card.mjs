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

// A blank card formatted by the firmware (bin/card.mjs new): a headless play session of the lab's model starts with
// the card in the slot, as bin/play.mjs's does (src/lab/player.mjs; a blank camera, no NVRAM), and the insertion
// formats the blank card and mounts it by the firmware's own path (H-FILEINIT, S-SDCARD: the layout is the firmware's,
// nothing here makes a file system); then the session closes. sectors: the capacity (null: the default 8 GiB SDHC
// card). {card, storage: the insertion's summary (mounted, formatted, its log)}; a card the session did not leave
// formatted and mounted is refused. The lab is imported here, after the caller fixed the model (host/modelarg.mjs)
export async function formatCard({ sectors = null } = {}) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  if (!STORAGE) throw new Error(`${MODEL}: the lab does not run this body's card file system natively (src/fw/models.mjs card_fs), so its firmware cannot format a card here`);
  const card = new SdCard(sectors === null ? {} : { sectors });
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
  let storage;
  try {
    pl.open_session();
    storage = pl.session.steps.find((x) => x.storage)?.storage ?? null;
  } finally {
    try { pl.close_session(); } catch { /* closed */ }
  }
  if (!storage?.mounted || !storage.formatted) throw new Error(`${MODEL}: the session did not format and mount the blank card: ${JSON.stringify(storage && { mounted: storage.mounted, formatted: storage.formatted, log: storage.log })}`);
  return { card, storage };
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
