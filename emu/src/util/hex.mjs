// Hex text of integers: hex(v) '0x1f' / '-0x1f', hexDigits(v, width) the digits alone zero-padded to width (v >= 0),
// hex8(v) a u32 as '0x' and 8 digits; s32(v) a u32 as a signed 32-bit int.
export function hex(v) { return v < 0 ? '-0x' + (-v).toString(16) : '0x' + v.toString(16); }
export function hexDigits(v, width = 0) { return v.toString(16).padStart(width, '0'); }
export const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const s32 = (v) => v | 0;
