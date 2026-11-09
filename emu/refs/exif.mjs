// An independent reader of a JPEG file's segments and its Exif APP1 (JEITA CP-3451 / TIFF 6.0), written from the
// specifications, not from the firmware, to check the files the lab's card holds (test/test_storage.mjs).
//   jpegSegments(bytes) -> [{marker, at, length}] up to SOS (length: the segment's own length field, 0 for SOI)
//   readExif(bytes) -> {order, ifd0, exif, ifd1, makernote} or null without an Exif APP1; each IFD a Map tag -> value
//                      (ASCII as a string without its NUL, SHORT / LONG as a number or an array, RATIONAL as [num, den]
//                      or an array of them, UNDEFINED as its bytes)

const SOI = 0xD8, SOS = 0xDA, APP1 = 0xE1;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
const EXIF_IFD = 0x8769, MAKER_NOTE = 0x927C;

export function jpegSegments(b) {
  if (b[0] !== 0xFF || b[1] !== SOI) throw new Error('jpegSegments: no SOI');
  const out = [{ marker: SOI, at: 0, length: 0 }];
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xFF) throw new Error(`jpegSegments: no marker at ${i}`);
    const marker = b[i + 1], length = b[i + 2] << 8 | b[i + 3];
    out.push({ marker, at: i, length });
    if (marker === SOS) return out;
    i += 2 + length;
  }
  throw new Error('jpegSegments: no SOS');
}

export function readExif(b) {
  const app1 = jpegSegments(b).find((s) => s.marker === APP1 && String.fromCharCode(...b.subarray(s.at + 4, s.at + 8)) === 'Exif' && b[s.at + 8] === 0);
  if (!app1) return null;
  const base = app1.at + 10, end = app1.at + 2 + app1.length;
  const order = String.fromCharCode(b[base], b[base + 1]);
  if (order !== 'II' && order !== 'MM') throw new Error(`readExif: byte order ${order}`);
  const le = order === 'II';
  const u16 = (o) => { if (base + o + 2 > end) throw new Error(`readExif: offset ${o} out of the segment`); return le ? b[base + o] | b[base + o + 1] << 8 : b[base + o] << 8 | b[base + o + 1]; };
  const u32 = (o) => (le ? (u16(o) | u16(o + 2) << 16) : (u16(o) << 16 | u16(o + 2))) >>> 0;
  if (u16(2) !== 42) throw new Error('readExif: no TIFF magic 42');
  const ifd = (o) => {
    const n = u16(o), tags = new Map();
    for (let k = 0; k < n; k++) {
      const e = o + 2 + 12 * k, tag = u16(e), type = u16(e + 2), count = u32(e + 4), size = (TYPE_SIZE[type] ?? 0) * count;
      if (!TYPE_SIZE[type]) throw new Error(`readExif: tag 0x${tag.toString(16)} of type ${type}`);
      const at = size <= 4 ? e + 8 : u32(e + 8);
      if (base + at + size > end) throw new Error(`readExif: tag 0x${tag.toString(16)}'s ${size} bytes at ${at} out of the segment`);
      let v;
      if (type === 2) v = String.fromCharCode(...b.subarray(base + at, base + at + count)).replace(/\0[\s\S]*$/, '');
      else if (type === 1 || type === 7) v = b.slice(base + at, base + at + count);
      else {
        const one = (i) => type === 3 ? u16(at + 2 * i) : type === 4 || type === 9 ? u32(at + 4 * i) : [u32(at + 8 * i), u32(at + 8 * i + 4)];
        v = count === 1 ? one(0) : Array.from({ length: count }, (_, i) => one(i));
      }
      tags.set(tag, type === 7 || type === 1 ? v : v);
      if (tag === MAKER_NOTE) tags.set('makernote_at', at);
    }
    return { tags, next: u32(o + 2 + 12 * n) };
  };
  const i0 = ifd(u32(4)), ifd1 = i0.next ? ifd(i0.next).tags : null;
  const exif = i0.tags.has(EXIF_IFD) ? ifd(i0.tags.get(EXIF_IFD)).tags : null;
  const mnAt = exif?.get('makernote_at'), mn = exif?.get(MAKER_NOTE);
  const makernote = mn ? { at: mnAt, header: String.fromCharCode(...mn.subarray(0, 12)).replace(/\0[\s\S]*$/, ''), length: mn.length } : null;
  return { order, ifd0: i0.tags, exif, ifd1, makernote };
}
