// The HLS media side with an SDXC card (docs/hle-gaps/4.8.md 4.8.6, 4.8.7, 4.8.19) on the body of OM_EMU_MODEL: Card
// Formatting from the menu (E143's line) or Format from Card Setup (the E144 and E118 families' media control
// process), then the card out and in, each on a blank 64 GiB card the insertion formats (exFAT), with the checks
// test_storage.mjs's 8 GiB HLS run makes (the volume formatted again and consistent, the counts reset; the card out:
// unmounted, the camera's no-card state; back in: mounted without a format, the count back).
//   sdxcHls   (firmware) the above on OM_EMU_MODEL; refused where src/fw/models.mjs card_fs runs no HLS side
//   node emu/test/test_sdxchls.mjs [GiB]
import { SdCard, cardSectors } from '../src/lab/sdcard.mjs';
import { hlsFormat, hlsOutIn } from './test_storage.mjs';

export async function sdxcHls(gib = 64) {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  if (!STORAGE?.hls) return { checks: 1, bad: [`${MODEL}: src/fw/models.mjs card_fs runs no HLS media side`], notes };
  const tag = `${MODEL} ${gib} GiB`;
  await hlsFormat(new SdCard({ sectors: cardSectors(gib) }), tag, ok, bad, notes);
  await hlsOutIn(new SdCard({ sectors: cardSectors(gib) }), tag, ok, bad, notes);
  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gib = Number(process.argv[2] ?? 64);
  const x = await sdxcHls(gib);
  console.log(`the HLS media side with a ${gib} GiB SDXC card: ${x.checks - x.bad.length}/${x.checks}`);
  x.notes.forEach((t) => console.log('   note:', t));
  x.bad.forEach((t) => console.log('  ', t));
  process.exitCode = x.bad.length ? 1 : 0;
}
