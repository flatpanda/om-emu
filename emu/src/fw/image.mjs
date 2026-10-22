// Reads of a run-time image by run-time address (an image as src/fw/expand.mjs returns it, its byte 0 at its model's
// image base: the lab passes src/fw/model.mjs IMAGE_BASE and MODEL). A read outside the image throws ImageRangeError
// naming the image's label and its base instead of reading undefined: an address past the image's end is RAM the code
// sees but the image does not hold, which on a body whose reset head copies data there means a copy missing from its
// board's preload (src/fw/board.mjs).
import { ValueError } from '../lab/errors.mjs';

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// a ValueError, as the lab's table readers raised for an address outside the image before this module
export class ImageRangeError extends ValueError {}

// {base, end, has(a), off(a, n), u8, u16, u32, cstr} over image at base (end: base + image.length), label naming it in
// errors (its model's code). off(a, n) is the offset of the n bytes at a, cstr the latin-1 text up to its NUL.
export function imageView(image, base, label) {
  const end = base + image.length;
  const has = (a) => a >= base && a < end;
  const off = (a, n = 1) => {
    if (a >= base && a + n <= end) return a - base;
    const past = a >= end ? ' (past the image: a reset-head copy missing from preload?)' : '';
    throw new ImageRangeError(`${label}: ${h8(a)}+${n} outside the run-time image ${h8(base)}..${h8(end)}${past}`);
  };
  const u8 = (a) => image[off(a)];
  const u16 = (a) => { const o = off(a, 2); return image[o] | image[o + 1] << 8; };
  const u32 = (a) => { const o = off(a, 4); return (image[o] | image[o + 1] << 8 | image[o + 2] << 16 | image[o + 3] << 24) >>> 0; };
  const cstr = (a) => {
    const o = off(a), z = image.indexOf(0, o);
    if (z < 0) throw new ImageRangeError(`${label}: the string at ${h8(a)} has no NUL before the image's end ${h8(end)}`);
    let s = '';
    for (let i = o; i < z; i++) s += String.fromCharCode(image[i]);
    return s;
  };
  return { base, end, has, off, u8, u16, u32, cstr };
}
