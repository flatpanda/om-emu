// The card's files for the players' Card panel: the card in the first slot read with the independent FAT reader
// (refs/fat.mjs), never through the firmware or the lab's own code, and a picture file decoded with the independent
// baseline JPEG decoder (refs/jpeg.mjs). The hosts hand CARD_VIEW to the Player as env.cardView (the browser player's
// Worker, web/worker.mjs; the node host's lab thread, host/labworker.mjs), which runs it between ticks on the card as
// it stands (src/lab/player.mjs card_files), and jpegRgba to the router as opts.cardImage (src/lab/playapi.mjs
// /api/card/image). Pure JS, Worker-safe; it imports refs/ for the readers, which src/ may not (test/test_pure.mjs).
// What the volume shows between ticks is what the card's sectors hold then: a file the firmware is writing, or a FAT
// it has not flushed, can read as it was before (the card out of the slot is the settled view).
import { FatVolume, mbrPartition } from '../refs/fat.mjs';
import { decodeJpeg } from '../refs/jpeg.mjs';
import { RefError, ValueError } from '../refs/errors.mjs';
import { ycc_to_rgb } from '../src/lab/display.mjs';
import { bytesBase64 } from '../src/util/bytes.mjs';

// the listing's bounds: directories below the root it walks into, entries it lists; the largest file read whole
export const LIST_DEPTH = 4, LIST_MAX = 2000, FILE_MAX = 16 << 20;
// FSInfo's free count when the volume does not know it (FAT specification section 5)
const FREE_UNKNOWN = -1 >>> 0;
// the largest side of a decoded picture (the viewer's; a thumbnail asks for less)
export const IMAGE_MAX = 4096;

// The volume of the card: the first partition of its MBR, else a volume from sector 0 (a card without an MBR)
function volumeOf(read) {
  const p = mbrPartition(read(0, 1));
  return new FatVolume(read, p ? p.start : 0);
}
// A directory entry's date and time (FAT's: the year from 1980, two-second units) as 'YYYY-MM-DD hh:mm:ss'; null for
// an entry with no date
function fatTime(date, time) {
  if (!date) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${1980 + (date >> 9)}-${p(date >> 5 & 15)}-${p(date & 31)} ${p(time >> 11)}:${p(time >> 5 & 63)}:${p(2 * (time & 31))}`;
}
// A reader's refusal ({error}), or the answer of fn; a JS error is a bug and propagates
function refused(fn) {
  try { return fn(); } catch (e) {
    if (e instanceof RefError) return { error: e.message };
    throw e;
  }
}

// The volume and its files: {volume: {type, label, start, clusters, cluster_bytes, free_bytes (FAT32's FSInfo count,
// null without one)}, files: [{path ('DCIM/100OMSYS/P1010001.JPG'), size (null for a directory), dir, mtime}],
// truncated}, the files in directory order, each directory followed by its entries; or {error} when the volume is not
// one refs/fat.mjs reads (a blank card, an exFAT volume, a broken chain).
// read(lba, count): the card's sectors (src/lab/sdcard.mjs SdCard.read, which counts no access).
export function cardList(read) {
  return refused(() => {
    const vol = volumeOf(read), files = [];
    let truncated = false;
    const walk = (cluster, dir, depth) => {
      for (const e of vol.list(cluster)) {
        if (e.short === '.' || e.short === '..') continue;
        if (files.length >= LIST_MAX) { truncated = true; return; }
        const path = dir ? `${dir}/${e.name}` : e.name;
        files.push({ path, size: e.dir ? null : e.size, dir: e.dir, mtime: fatTime(e.date, e.time) });
        if (e.dir && depth < LIST_DEPTH && e.cluster >= 2) walk(e.cluster, path, depth + 1);
      }
    };
    walk(vol.rootCluster, '', 0);
    const info = vol.fsInfo();
    return { volume: { type: vol.type, label: vol.label.trimEnd(), start: vol.start, clusters: vol.clusters, cluster_bytes: vol.spc * vol.bps,
      free_bytes: info && info.free !== FREE_UNKNOWN ? info.free * vol.spc * vol.bps : null }, files, truncated };
  });
}

// One file's bytes as base64 (the hosts' messages are JSON): {path, name, size, base64}, or {error} (no such file, a
// directory, a file past FILE_MAX, a volume refs/fat.mjs does not read).
export function cardFile(read, path) {
  return refused(() => {
    const vol = volumeOf(read), e = vol.find(path);
    if (e === null) throw new ValueError(`${path}: no such file on the card`);
    if (e.dir) throw new ValueError(`${path}: a directory`);
    if (e.size > FILE_MAX) throw new ValueError(`${path}: ${e.size} bytes, past the ${FILE_MAX} the Card panel reads`);
    return { path, name: e.name, size: e.size, base64: bytesBase64(vol.data(e)) };
  });
}

// env.cardView: what the Player's card_files calls
export const CARD_VIEW = { list: cardList, read: cardFile };

// A baseline JPEG's picture as RGBA, decoded by refs/jpeg.mjs: {w, h, rgba, width, height} (width x height the
// picture's, w x h what was drawn: scaled down so that its larger side is at most max, 0 for the picture's own size,
// never past IMAGE_MAX), or {error} for a file the decoder refuses. The chroma components are taken at their own
// sampling (nearest sample, no filter) and converted with the lab's YCbCr to RGB (src/lab/display.mjs ycc_to_rgb:
// full-range BT.601, which is JFIF's); one component is grey. The picture is sampled at each drawn pixel's centre.
export function jpegRgba(bytes, max = 0) {
  return refused(() => {
    const { width, height, components: cs } = decodeJpeg(bytes);
    if (cs.length !== 1 && cs.length !== 3) throw new ValueError(`a JPEG of ${cs.length} components (1 or 3 drawn)`);
    const side = Math.min(max > 0 ? max : IMAGE_MAX, IMAGE_MAX);
    const scale = Math.min(1, side / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const hmax = Math.max(...cs.map((c) => c.h)), vmax = Math.max(...cs.map((c) => c.v));
    const at = (c, x, y) => c.samples[Math.min(c.height - 1, Math.floor(y * c.v / vmax)) * c.width + Math.min(c.width - 1, Math.floor(x * c.h / hmax))];
    const rgba = new Uint8Array(4 * w * h);
    for (let oy = 0, o = 0; oy < h; oy++) {
      const y = Math.min(height - 1, Math.floor((oy + 0.5) * height / h));
      for (let ox = 0; ox < w; ox++, o += 4) {
        const x = Math.min(width - 1, Math.floor((ox + 0.5) * width / w));
        if (cs.length === 1) {
          rgba[o] = rgba[o + 1] = rgba[o + 2] = at(cs[0], x, y);
        } else {
          const [r, g, b] = ycc_to_rgb(at(cs[0], x, y) | at(cs[1], x, y) << 8 | at(cs[2], x, y) << 16);
          rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b;
        }
        rgba[o + 3] = 255;
      }
    }
    return { w, h, rgba, width, height };
  });
}
