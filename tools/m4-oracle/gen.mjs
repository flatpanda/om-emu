// The oracle's case generator: random Thumb / Thumb-2 sequences restricted to what the JS core implements and the
// architecture defines (no UNPREDICTABLE encoding, no UNPREDICTABLE placement in an IT block), with branch offsets
// fixed up to land inside the sequence. Every encoding gets a share: random words are first bucketed by the decoder's
// encoding name, and half of each case's instructions come from a uniformly chosen bucket (UNDEFINED ones, which end
// a case in a fault, are kept one time in five).
import { decode, thumbLength } from '../../emu/src/core/m4/decode.mjs';
import { EXECUTED_OPS } from '../../emu/src/core/m4/cpu.mjs';
import { rng, CODE } from '../../emu/test/m4cases.mjs';

const OPS = new Set(EXECUTED_OPS);
// left out: WFI / WFE (QEMU would wait), BKPT (a debug stop in QEMU's gdbstub), the FP data-processing space (not
// implemented), LDR into pc (UNPREDICTABLE when the address is not word-aligned, which the generator cannot see), and
// two places where QEMU 11.1 departs from the ARMv7-M ARM: a coprocessor other than cp10 / cp11 (QEMU: UsageFault
// UNDEFINSTR; the manual and the Cortex-M4 user guide: NOCP, which the core follows) and LDRH / LDRSH with Rt = pc
// (the manual's "unallocated memory hint, treat as NOP"; QEMU loads into pc); the UNDEFINED encodings of the
// coprocessor space (QEMU answers NOCP or UNDEFINSTR depending on the coprocessor number and CPACR); the exclusive
// space's op3 values ARMv7-M leaves UNDEFINED (QEMU runs them as the A profile's STREXD / LDREXD), likewise SETEND;
// BX pc from a halfword-aligned address (QEMU: UNALIGNED; the manual: T clear, then INVSTATE). And STREX gets an
// aligned address: with the monitor clear QEMU skips the alignment check of the manual's ExclusiveMonitorsPass
function usable(d) {
  if (d.unp || !OPS.has(d.op) || d.op === 'vfp' || d.op === 'bkpt' || d.op === 'nocp') return false;
  if (d.op === 'ldr' && d.rd === 15) return false;
  if (d.op === 'pld' && d.enc.startsWith('NOP (unallocated')) return false;
  if (d.op === 'udf' && /coprocessor|VFP|VLDM|VMOV|D16/.test(d.enc)) return false;   // QEMU: NOCP or UNDEFINSTR by coprocessor
  if (d.op === 'udf' && /0xe8cx|0xe8dx|SETEND/.test(d.enc)) return false;            // QEMU: the A profile's STREXD / LDREXD, SETEND
  if (d.op === 'bx' && d.rm === 15) return false;                                    // QEMU: UNALIGNED, not INVSTATE
  if (d.op === 'hint' && (d.imm === 2 || d.imm === 3)) return false;
  return true;
}
const writesPc = (d) => d.op === 'b' || d.op === 'bl' || d.op === 'bx' || d.op === 'blx' || d.op === 'cbz' || d.op === 'tb' ||
  (d.op === 'ldm' && (d.list >>> 15) & 1) || (d.op === 'ldr' && d.rd === 15) || (d.op === 'dp' && d.rd === 15);
// not allowed inside an IT block at all (A7.3: CBZ / CBNZ, IT, CPS, the conditional branches; MOV (register) T2 is
// UNPREDICTABLE there too), and the pc-writing forms other than as its last instruction
function itOk(d, last) {
  if (d.op === 'cbz' || d.op === 'it' || d.op === 'cps' || (d.op === 'b' && d.cond !== 14)) return false;
  if (d.enc === 'MOV (register) T2') return false;
  if (writesPc(d) && !last) return false;
  return true;
}

function randomWord(g) {
  if (g.below(100) < 45) { let h; do h = g.u32() & 0xffff; while ((h >>> 11) >= 0x1d); return [h]; }
  return [((0x1d + g.below(3)) << 11) | (g.u32() & 0x7ff), g.u32() & 0xffff];
}
const dec = (w) => decode(w[0], w[1] ?? 0);

// buckets: encoding name -> up to `per` words (each an array of halfwords)
export function buckets(seed = 7, samples = 3000000, per = 48) {
  const g = rng(seed), out = new Map();
  for (let i = 0; i < samples; i++) {
    const w = randomWord(g), d = dec(w);
    if (!usable(d)) continue;
    let b = out.get(d.enc);
    if (!b) out.set(d.enc, b = []);
    if (b.length < per) b.push(w);
  }
  return out;
}

// re-encode a branch's offset (bytes from pc + 4)
function setOffset(w, d, off) {
  const [h1, h2] = w;
  switch (d.enc) {
    case 'B T1': return [(h1 & 0xff00) | ((off >> 1) & 0xff)];
    case 'B T2': return [(h1 & 0xf800) | ((off >> 1) & 0x7ff)];
    case 'CBZ T1': case 'CBNZ T1': { const v = off >> 1; return [(h1 & 0xfd07) | (((v >> 5) & 1) << 9) | ((v & 31) << 3)]; }
    case 'B T3': {
      const s = (off >>> 20) & 1, j2 = (off >>> 19) & 1, j1 = (off >>> 18) & 1;
      return [(h1 & 0xfbc0) | (s << 10) | ((off >>> 12) & 0x3f), (h2 & 0xd000) | (j1 << 13) | (j2 << 11) | ((off >>> 1) & 0x7ff)];
    }
    default: {                                  // B T4, BL T1
      const s = (off >>> 24) & 1, i1 = (off >>> 23) & 1, i2 = (off >>> 22) & 1;
      const j1 = (~i1 & 1) ^ s, j2 = (~i2 & 1) ^ s;
      return [(h1 & 0xf800) | (s << 10) | ((off >>> 12) & 0x3ff), (h2 & 0xd000) | (j1 << 13) | (j2 << 11) | ((off >>> 1) & 0x7ff)];
    }
  }
}

// one case: { seed, code, set }
export function genCase(seed, bk) {
  const g = rng(seed ^ 0x5bd1e995);
  const names = [...bk.keys()];
  const n = 1 + g.below(5);
  const words = [], decs = [];
  let itLeft = 0;
  for (let k = 0; k < n; k++) {
    let w, d;
    for (let tries = 0; tries < 200; tries++) {
      w = g.below(2) ? (() => { const b = bk.get(names[g.below(names.length)]); return b[g.below(b.length)]; })() : randomWord(g);
      d = dec(w);
      if (!usable(d)) continue;
      if (d.op === 'udf' && g.below(5)) continue;     // an UNDEFINED encoding ends the case: one in five of those drawn
      if (itLeft > 0 && !itOk(d, itLeft === 1)) continue;
      if (d.op === 'it' && k === n - 1 && g.below(2)) continue;
      if (d.op === 'strex' && k > 0) continue;        // first, so that no earlier instruction moves its aligned base
      break;
    }
    if (!usable(d) || (itLeft > 0 && !itOk(d, itLeft === 1))) { w = [0xbf00]; d = dec(w); }   // NOP
    words.push(w); decs.push(d);
    if (itLeft > 0) itLeft--;
    if (d.op === 'it') { let m = d.list, len = 4; while (!(m & 1)) { m >>>= 1; len--; } itLeft = len; }
  }
  // addresses, then the branch fix-ups: a later instruction boundary or the end
  const addr = [];
  let a = CODE;
  for (const w of words) { addr.push(a); a += 2 * w.length; }
  const end = a, set = {};
  words.forEach((w, i) => {
    const d = decs[i];
    const later = [...addr.slice(i + 1), end];
    const target = later[g.below(later.length)];
    if (d.op === 'b' || d.op === 'bl' || d.op === 'cbz') {
      let off = target - (addr[i] + 4);
      if (d.op === 'cbz' && off < 0) off = end - (addr[i] + 4);
      if (d.op === 'cbz' && off > 126) return;
      words[i] = setOffset(w, d, off);
    }
    if ((d.op === 'bx' || d.op === 'blx') && d.rm < 13) set[d.rm] = target | 1;
    if (d.op === 'strex' && d.rn !== 13 && d.rn !== 15 && !(d.rn in set)) set[d.rn] = (0x20000800 + 4 * g.below(0x400)) | 0;
  });
  const code = [];
  for (const w of words) code.push(...w);
  return { seed, code, set };
}

export function encsOf(kase) {
  const out = [];
  for (let i = 0; i < kase.code.length;) { const h = kase.code[i], l = thumbLength(h) / 2; out.push(decode(h, kase.code[i + 1] ?? 0).enc); i += l; }
  return out;
}
