// Regression test for fixed CPU core bugs: the decode cache's per-chunk slot lists stay bounded under direct-mapped
// conflicts, and code writes still reach re-tagged slots and instructions that span two chunks (self-contained).
//   node emu/test/test_regress.mjs
import { createMachine } from '../src/machine.mjs';
import { R, PC, D0 } from '../src/core/cpu.mjs';
import { run, cacheStats } from '../src/core/interp.mjs';

const le = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
export function cache() {
  const bad = [];
  // Two loop bodies whose slots collide pairwise (i = (pc ^ pc >>> 13) & 0xffff): every iteration re-tags 4 slots.
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const A = 0x1000, B = 0x11008;
  m.dbgWrite(A, new Uint8Array([0x80, 0x05, 0x85, 0x05, 0xdc, ...le(B - (A + 4))]));            // mov 5,d0; mov 5,d1; jmp B
  m.dbgWrite(B, new Uint8Array([0x80, 0x07, 0x85, 0x07, 0xdc, ...le((A - (B + 4)) >>> 0)]));     // mov 7,d0; mov 7,d1; jmp A
  R[PC] = A;
  run(300000);
  const st = cacheStats();
  if (st.refs > 2 * st.live || st.maxList > 8) bad.push(`colliding loop: ${JSON.stringify(st)} (lists must stay bounded by the live slots)`);
  // A code write still reaches the re-tagged slots: mov 5,d0 at A becomes mov 9,d0.
  m.dbgWrite(A + 1, new Uint8Array([0x09]));
  m.setBreakpoints([A + 2]);
  R[PC] = A; m.cont();
  if (R[D0] !== 9) bad.push(`write after re-tags: d0 ${R[D0]}, want 9`);
  // An instruction spanning two chunks (0x20fe..0x2102: mov imm32,d0) is dropped by a write to either chunk.
  m.setBreakpoints([0x2104]);
  m.dbgWrite(0x20fe, new Uint8Array([0xfc, 0xcc, ...le(0x11111111)]));
  // Second chunk: an immediate byte; first chunk: the register field (mov imm32,d0 -> mov imm32,d1).
  for (const [at, byte, reg, want] of [[0x2102, 0x22, 0, 0x11221111], [0x20ff, 0xcd, 1, 0x11221111]]) {
    R[PC] = 0x20fe; R[D0] = 0; R[D0 + 1] = 0; m.cont();
    m.dbgWrite(at, new Uint8Array([byte]));
    R[PC] = 0x20fe; R[D0] = 0; R[D0 + 1] = 0; m.cont();
    if ((R[D0 + reg] >>> 0) !== want) bad.push(`spanning insn, write at 0x${at.toString(16)}: d${reg} 0x${(R[D0 + reg] >>> 0).toString(16)}, want 0x${want.toString(16)}`);
  }
  const end = cacheStats();
  if (end.refs > 2 * end.live) bad.push(`after writes: ${JSON.stringify(end)}`);
  return { checks: 5, bad };   // bounded lists, write after re-tags, two spanning writes, bounded after writes
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = cache();
  console.log(`decode-cache checks ${c.checks - c.bad.length}/${c.checks}`);
  c.bad.forEach((x) => console.log('  ', x));
  process.exit(c.bad.length ? 1 : 0);
}
