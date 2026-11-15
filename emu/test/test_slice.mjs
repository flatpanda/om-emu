// The lab's call (src/lab/hle.mjs HLE.call, which the debug API's call op and the checks' session-less calls use) on a
// synthetic block, without firmware: hand-written MN103 functions at known offsets of a zeroed image.
//   sliceUnits   the frame derived from a function's call sites (one site; two sites that agree; two that differ and
//                none refused, 'pass frame='); arguments in registers and a word written through a pointer; a word
//                read back in d0; a function that calls another that calls a third, back at the harness's return
//                address with sp at its top; the saved-register check (a callee that clears d2: 'bad return state';
//                the same callee with d2 given as it leaves it returns); the typed faults (a store into the flash
//                view: fault 2 with the pc and the address; a loop: fault 7 at the instruction limit); the machine
//                still callable after each. Controls: with a frame given smaller than the callee's own the call
//                ends in a fault, so the derived frame is what makes the nested call return; the output differs with
//                the argument. And the limit this is not: the lab's map is the board's, so a store through a null pointer
//                lands in the lab's low RAM and the call returns; a strict slice, in which every access outside a
//                declared job faults, needs a memory map of its own (it is not this call)
//   node emu/test/test_slice.mjs
import { createHash } from 'node:crypto';

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export async function sliceUnits() {
  const t = tester(), { ok } = t;
  const { HLE, BASE, SP, CALLER, SAVED, FirmwareError, runtime } = await import('../src/lab/hle.mjs');
  const { findRegion } = await import('../src/core/mem.mjs');
  // the block: each function at its offset. Encodings (the CPU core's, checked by the recorded ISA vectors): mov d0,(a0)
  // 60; mov (a0),d0 70; clr d2 08; bra . ca 00; call d32,[regs],size dd <rel32> regs size; ret [regs],size df regs size
  const rom = new Uint8Array(0x1000);
  const rel = (from, to) => { const v = (to - from) | 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; };
  const put = (o, ...b) => { rom.set(b, o); return BASE + o; };
  const STORE = put(0x100, 0x60, 0xdf, 0x00, 0x00);                                    // mov d0,(a0); ret [],0
  const MID = put(0x200, 0xdd, ...rel(0x200, 0x100), 0x00, 0x00, 0xdf, 0x00, 0x04);    // call STORE,[],0; ret [],4
  const LOOP = put(0x300, 0xca, 0x00);                                                 // bra .
  const CLOBBER = put(0x400, 0x08, 0xdf, 0x00, 0x00);                                  // clr d2; ret [],0
  const LOAD = put(0x500, 0x70, 0xdf, 0x00, 0x00);                                     // mov (a0),d0; ret [],0
  const TOP = put(0x600, 0xdd, ...rel(0x600, 0x200), 0x00, 0x04, 0xdf, 0x00, 0x04);    // call MID,[],4; ret [],4
  put(0x700, 0xdd, ...rel(0x700, 0x500), 0x00, 0x00);                                  // a second call site of LOAD, the same frame
  put(0x780, 0xdd, ...rel(0x780, 0x400), 0x00, 0x00);                                  // CLOBBER's two call sites
  put(0x790, 0xdd, ...rel(0x790, 0x400), 0x00, 0x08);                                  // disagree on the frame
  put(0x7a0, 0xdd, ...rel(0x7a0, 0x500), 0x00, 0x00);
  const hle = new HLE({ rom, createHash });
  const OUT = SP + 0x1000;                              // a word of the lab's DRAM above the harness stack's top
  const word = (a) => { const b = hle.sim.read(a, 4); return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; };
  const clear = (a) => hle.sim.write(a, new Uint8Array(4));
  const call = (...a) => { try { return hle.call(...a); } catch (e) { if (!(e instanceof FirmwareError)) throw e; return e; } };
  const back = (r) => !(r instanceof Error) && r.pc === CALLER + 7 && r.sp === SP && Object.entries(SAVED).every(([k, v]) => r[k] === v >>> 0);
  try {
    // the frames, derived from the call sites
    const frame = (fn) => { try { return JSON.stringify(hle.frame(fn)); } catch (e) { return e.message; } };
    ok(frame(STORE) === '[0,0]' && frame(MID) === '[0,4]' && frame(LOAD) === '[0,0]', `the frames of functions whose call sites agree: ${frame(STORE)} ${frame(MID)} ${frame(LOAD)}`);
    ok(frame(CLOBBER) === `${h8(CLOBBER)}: call-site frames [[0, 0], [0, 8]]; pass frame=` && frame(TOP) === `${h8(TOP)}: call-site frames []; pass frame=`, `call sites that differ, and none: ${frame(CLOBBER)} | ${frame(TOP)}`);
    // arguments, an output word, a value back
    clear(OUT);
    const r1 = call(STORE, { d0: 0x12345678, a0: OUT });
    ok(back(r1) && word(OUT) === 0x12345678 && r1.d0 === 0x12345678 && r1.a0 === OUT, `a store through a0: ${back(r1)} ${h8(word(OUT))} ${r1.message ?? ''}`);
    const r1b = call(STORE, { d0: 0x0badcafe, a0: OUT + 4 });
    ok(back(r1b) && word(OUT + 4) === 0x0badcafe && word(OUT) === 0x12345678, 'control: another argument and pointer, another word written');
    const r2 = call(LOAD, { a0: OUT });
    ok(back(r2) && r2.d0 === 0x12345678, `a load into d0: ${h8(r2.d0 ?? 0)} ${r2.message ?? ''}`);
    // a function that calls another that calls a third
    clear(OUT);
    const r3 = call(TOP, { d0: 0xbeef, a0: OUT }, null, [0, 4]);
    ok(back(r3) && word(OUT) === 0xbeef, `three levels deep, back at the harness: ${back(r3)} ${h8(word(OUT))} ${r3.message ?? ''}`);
    clear(OUT);
    const r3b = call(MID, { d0: 0xcafe, a0: OUT });
    ok(back(r3b) && word(OUT) === 0xcafe, `two levels, the frame derived: ${back(r3b)} ${h8(word(OUT))}`);
    // control: with a frame smaller than the callee's own, the callee's inner call overwrites the harness's return
    // address and its ret takes the word above it: the call ends in a fault, never at the harness's return address
    const r3c = call(MID, { d0: 1, a0: OUT }, null, [0, 0]);
    ok(r3c instanceof FirmwareError && /^stopped at .* fault=\d/.test(r3c.message), `control: MID with the frame [0, 0] does not return to the harness: ${String(r3c.message ?? 'returned').split('\n')[0]}`);
    // the saved registers
    const r4 = call(CLOBBER, {}, null, [0, 0]);
    ok(r4 instanceof FirmwareError && r4.message.startsWith('bad return state: ') && /"d2": 0,/.test(r4.message), `a callee that clears d2: ${String(r4.message ?? 'returned').slice(0, 80)}`);
    const r4b = call(CLOBBER, { d2: 0 }, null, [0, 0]);
    ok(!(r4b instanceof Error) && r4b.pc === CALLER + 7 && r4b.d2 === 0, 'control: with d2 given as the callee leaves it, the call returns');
    // the typed faults; the machine callable after each
    const r5 = call(STORE, { d0: 1, a0: BASE + 0x800 });
    ok(r5 instanceof FirmwareError && r5.message.startsWith(`stopped at ${h8(runtime(STORE))} (disasm ${h8(STORE)}) fault=2:`) && r5.message.includes(`address=${h8(BASE + 0x800)}`) && rom[0x800] === 0,
      `a store into the flash view: ${String(r5.message ?? 'returned').split('\n')[0]}`);
    const r6 = call(LOOP, {}, null, [0, 0]);
    ok(r6 instanceof FirmwareError && /fault=7/.test(r6.message) && r6.message.includes(`(disasm ${h8(LOOP)})`), `a loop ends at the instruction limit: ${String(r6.message ?? 'returned').split('\n')[0]}`);
    clear(OUT);
    const r7 = call(STORE, { d0: 7, a0: OUT });
    ok(back(r7) && word(OUT) === 7, 'after the faults the same machine still calls');
    // what this is not: the map is the board's, so a null pointer is the lab's low RAM
    const low = findRegion(0);
    const r8 = call(STORE, { d0: 0x600df00d, a0: 0 });
    ok(low?.name === 'om1.lab-low-ram' && back(r8) && word(0) === 0x600df00d, `the limit: a store through a null pointer returns and lands in ${low?.name} (${h8(word(0))}): this call is no strict slice`);
  } finally { hle.close(); }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await sliceUnits();
  console.log(`the lab's call on a synthetic block: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
