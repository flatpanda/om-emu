// The display composite as the page's pixels: src/lab/display.mjs ycc_to_rgb (A9: inverse full-range BT.601, JFIF
// integer form) on every little-endian word of the composite's raw bytes, written as RGBA with
// alpha 255. The node server's PNG is the same RGB (host/server.mjs png_raw: ycc_rows_to_rgb). test/test_web.mjs pins
// the digest of its output over all 2^24 words. Worker-safe.
import { ycc_to_rgb } from '../src/lab/display.mjs';

export const yccToRgb = ycc_to_rgb;

// RGBA (w * h * 4 bytes) of the composite's raw bytes (w * h little-endian u32 words).
export function rgbaOf(w, h, raw, out = new Uint8Array(4 * w * h)) {
  const n = w * h;
  if (raw.length !== 4 * n) throw new Error(`frame: ${raw.length} bytes for ${w}x${h}`);
  const words = (raw.byteOffset & 3) === 0 ? new Uint32Array(raw.buffer, raw.byteOffset, n) : new Uint32Array(raw.slice().buffer);
  let last = -1, r = 0, g = 0, b = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const wd = words[i] & 0xffffff;
    if (wd !== last) { last = wd; [r, g, b] = ycc_to_rgb(wd); }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return out;
}
