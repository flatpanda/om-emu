// check_irq's independent references: values read from the firmware image's static data and the
// arithmetic the check derives from the ISA manual and the lab assumptions, never from the harness's model code.
// Pure (refs/ imports only refs/); the image is the caller's Uint8Array.
export const RT_BASE = 0x60021020;                 // the run-time copy of E143's main code (rt_data; refs/ are E143's)
const SIZES = { I: 4, H: 2, B: 1 };
// struct.unpack_from with a little-endian format of I, H and B, counts allowed ('<5I')
export function unpackFrom(fmt, b, offset) {
  if (!/^<(\d*[IHB])+$/.test(fmt)) throw new Error(`refs/irq unpackFrom: ${fmt}: little-endian I, H, B only`);
  const out = [];
  let o = offset;
  for (const m of fmt.slice(1).matchAll(/(\d*)([IHB])/g)) {
    for (let n = m[1] ? Number(m[1]) : 1; n > 0; n--) {
      const c = m[2], w = SIZES[c];
      if (o + w > b.length || o < 0) throw new Error(`refs/irq unpackFrom: ${fmt} at ${offset} outside the buffer`);
      let v = 0;
      for (let k = w - 1; k >= 0; k--) v = v * 256 + b[o + k];
      out.push(v);
      o += w;
    }
  }
  return out;
}
// check_irq.image_ivars: the IVAR values 0x5000f068 stores (`mov imm32,d0` fc cc, then `movhu d0,(0x80xx)` 03 lo hi),
// read from the image bytes up to its `ret` (df 00): level -> value, levels below 7, in first-store order.
export function imageIvars(img) {
  const out = new Map();
  let at = 0xF068;
  while (!(img[at] === 0xdf && img[at + 1] === 0x00)) {
    if (img[at] === 0xfc && img[at + 1] === 0xcc && img[at + 6] === 0x03 && img[at + 8] === 0x80) {
      out.set(Math.floor(img[at + 7] / 4), (img[at + 2] | img[at + 3] << 8));
      at += 9;
    } else at += 1;
  }
  return new Map([...out].filter(([level]) => level < 7));
}
// check_irq.rt_data: struct.unpack_from(fmt, img, address - 0x60021020)
export const rtData = (img, address, fmt) => unpackFrom(fmt, img, address - RT_BASE);
// I3: the kernel's registration table at 0x5001bdd0, 12-byte {level, 0, handler (run-time)} entries, level 6 down to 0
// then a zero entry: level -> handler for the first seven
export function registration(img) {
  const want = new Map();
  for (let k = 0; k < 7; k++) { const [level, , handler] = unpackFrom('<III', img, 0x1BDD0 + 12 * k); want.set(level, handler); }
  return want;
}
// I6: the attach routine's clamp, `mov imm8,d0` (80 06) at 0x5002e947: [opcode, constant]
export const attachClamp = (img) => [img[0x2E947], img[0x2E948]];
// I10: the A-IPI descriptor [target][core] = {write index *, read index *, ring, bit} at 0x60092cd4 + 64 t + 16 c, and
// the doorbell registers 0x60092dd4[target]
export const IPI_DESC = 0x60092CD4, IPI_REGS = 0x60092DD4;
export function ipiDescriptors(img) {
  const desc = new Map();
  for (let t = 0; t < 4; t++) for (let c = 0; c < 4; c++) desc.set(`${t},${c}`, rtData(img, IPI_DESC + 64 * t + 16 * c, '<IIIB'));
  return desc;
}
export const ipiRegisters = (img) => rtData(img, IPI_REGS, '<4I');
// I7 (A-TMR-1/2): every expiry t0 + k (R + 1) 1000 ns up to the horizon, with the channels expiring there: [[t, [ch...]]]
// sorted by t, channels ascending
export function timerSchedule(t0, channels, horizon) {
  const want = new Map();
  for (const [ch, reload] of channels) {
    for (let k = 1; t0 + k * (reload + 1) * 1000 <= horizon; k++) {
      const t = t0 + k * (reload + 1) * 1000;
      if (!want.has(t)) want.set(t, []);
      want.get(t).push(ch);
    }
  }
  return [...want].sort((a, b) => a[0] - b[0]).map(([t, chs]) => [t, chs.sort((a, b) => a - b)]);
}
// I9 (A-USLAB): channel 33 reads reload - ((lab us + CPU reads) mod (reload + 1))
export function uslab(reload, t, reads) {
  const R = BigInt(reload), us = BigInt(Math.floor(t / 1000));
  return Number(R - ((us + BigInt(reads)) % (R + 1n)));
}
// I5 T2: the signed 64-bit product of two u32 read as signed: [low word, high word]
export function product64(a, b) {
  const sa = BigInt(a | 0), sb = BigInt(b | 0), p = sa * sb;
  return [Number(BigInt.asUintN(32, p)), Number(BigInt.asUintN(32, p >> 32n))];
}
