// The run-time image of a main code block. Some builds store sections of it compressed: E144 (OM-5) keeps two
// `olycompress` containers (a 16-byte magic, u32 packed size, u32 raw size, 8 zero bytes, an LZ4 block), each at the
// start of the span it expands to, the rest of the span 0xFF; the boot section table after "BCS\0" lists those spans
// with flag 1, and the bootloader expands them before the code runs. Decoding each container in place gives the image
// the code sees, with every offset unchanged (file offset + the image base = run-time address). E143 and E147 have
// no container in their main block, so their image is returned unchanged (the same array).
import { lz4Block } from '../lab/resources.mjs';
import { BOARD } from './board.mjs';
import { IMAGE_BASE } from './model.mjs';

const MAGIC = new TextEncoder().encode('olycompress');

function find(b, from) {
  outer: for (let p = b.indexOf(MAGIC[0], from); p >= 0 && p + MAGIC.length <= b.length; p = b.indexOf(MAGIC[0], p + 1)) {
    for (let k = 1; k < MAGIC.length; k++) if (b[p + k] !== MAGIC[k]) continue outer;
    return p;
  }
  return -1;
}
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// The run-time image: the expanded block, or rom itself when it holds no container and the board copies no data out
// of it. base and preload default to the model this process runs (src/fw/model.mjs, src/fw/board.mjs); given, they
// make the result a function of its inputs alone (bin/port.mjs expands another build than the lab's). Throws when a
// container does not decode to its raw size or would overrun the block.
export function expandImage(rom, { base = IMAGE_BASE, preload = BOARD.preload } = {}) {
  return relocate(expand(rom), base, preload);
}
// The reset head's copies of image data to RAM past the image (src/fw/board.mjs preload; E144: the boot data and the
// chunks linked at 0x61e3xxxx), rows [file offset, length, run-time address]: the image grows to cover them, each at
// its run-time offset (address - base), so every reader of the image by run-time address sees what the code sees,
// and the machine loads them with the image.
function relocate(img, base, rows) {
  if (!rows.length) return img;
  const end = Math.max(img.length, ...rows.map(([, len, to]) => to - base + len));
  const out = new Uint8Array(end);
  out.set(img);
  for (const [from, len, to] of rows) out.set(img.subarray(from, from + len), to - base);
  return out;
}
function expand(rom) {
  let p = find(rom, 0);
  if (p < 0) return rom;
  const out = new Uint8Array(rom);
  for (; p >= 0; p = find(rom, p + 1)) {
    const packed = u32(rom, p + 16), raw = u32(rom, p + 20);
    if (p + 32 + packed > rom.length || p + raw > rom.length) throw new Error(`expandImage: container at 0x${p.toString(16)} overruns the block`);
    const data = lz4Block(rom.subarray(p + 32, p + 32 + packed), raw);
    if (data.length !== raw) throw new Error(`expandImage: container at 0x${p.toString(16)} decodes to ${data.length} bytes, header says ${raw}`);
    out.set(data, p);
  }
  return out;
}
