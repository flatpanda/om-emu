// The machine's second core (src/core/cores.mjs; docs/hle-gaps.md 4.6.1):
//   coresUnits   (no firmware) the machine's second core on a blank image: each core reads its own core number at
//                0x8050, core 2 stores into its local RAM at 0x50000000 while core 0's flash view refuses a store, the
//                interleave gives core 2 a turn of the quantum per quantum of core 0, a doorbell on bank 2 raises core
//                2's request and not core 0's, and the machine refuses a snapshot
//   node emu/test/test_cpu2.mjs
import { fileURLToPath } from 'node:url';

// MN10300 code: mov (0x8050),d0; mov d0,(abs32); mov imm32,d0; inc d1 / d2; bra to the inc
const MOV_ID = [0x30, 0x50, 0x80], ST = (a) => [0xFC, 0x81, a & 0xff, (a >>> 8) & 0xff, (a >>> 16) & 0xff, a >>> 24];
const IMM = (v) => [0xFC, 0xCC, v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
export function coresUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  return import('../src/machine.mjs').then(({ createMachine }) => {
    const m = createMachine({ rom: new Uint8Array(0x1000), insnLimit: 0, cores: { second: 2, quantum: 1000 } });
    const P0 = 0xA3000000, P2 = 0xA3000100, OUT = 0xA3000800;
    // core 0: its core number to OUT, IRQ 324's level 2 into bank 2 (+0x510) and bank 2's pending bit 8, then a loop
    const p0 = [...MOV_ID, ...ST(OUT), ...IMM(4), ...ST(0x99B00510), ...IMM(8), ...ST(0x99B00808), 0x44, 0xCA, 0xFF];
    // core 2: its core number to OUT + 4 and into its local RAM 0x50002000, then a loop
    const p2 = [...MOV_ID, ...ST(OUT + 4), ...ST(0x50002000), 0x48, 0xCA, 0xFF];
    m.dbgWrite(P0, Uint8Array.from(p0)); m.dbgWrite(P2, Uint8Array.from(p2)); m.dbgWrite(OUT, new Uint8Array(8).fill(0xEE));
    const regs = m.getRegs(); regs[9] = P0; regs[10] = 0; regs[15] = 0; m.setRegs(regs);
    m.cores.start(P2, 0);
    m.cores.interleave = true;
    ok(m.cont({ budget: 10000 }) === 'paused', 'core 0 pauses at its budget');
    m.halt();
    const out = m.dbgRead(OUT, 8), u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
    const st = m.cores.state();
    ok(u32(out, 0) === 0 && u32(out, 4) === 2, `the core numbers: core 0 wrote ${u32(out, 0)}, core 2 ${u32(out, 4)}`);
    ok(!st.parked && st.turns >= 9 && st.insns >= 9000 && st.insns <= 11000, `core 2's turns ${st.turns}, instructions ${st.insns}, parked ${st.parked}`);
    ok(st.irqReq === true && m.devices.intc.presentedMask === 0, `bank 2's doorbell: core 2's request ${st.irqReq}, bank 0's mask ${m.devices.intc.presentedMask}`);
    ok(m.dbgRead(0x50002000, 4).every((b) => b === 0), 'core 0 sees its flash view at 0x50002000 (the blank image), not core 2\'s RAM');
    // core 0 stores into its flash view: a fault 2
    const st0 = [...ST(0x50002000)], at = 0xA3000200;
    m.dbgWrite(at, Uint8Array.from(st0));
    const r2 = m.getRegs(); r2[9] = at; m.setRegs(r2);
    m.step();
    ok(m.lastStop().kind === 'fault' && m.lastStop().code === 2, `core 0's store into the flash view: ${JSON.stringify(m.lastStop())}`);
    let refused = null;
    try { m.snapshot(); } catch (e) { refused = e.message; }
    ok(refused !== null && /second core/.test(refused), `snapshot refused: ${refused}`);
    return { checks, bad };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const u = await coresUnits();
  console.log(`the machine's second core: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length ? 1 : 0);
}
