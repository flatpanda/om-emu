// The Cortex-M4 core (src/core/m4/, docs/om1-scpu-spec.md section 8 steps 3-4) on both its execution tiers (cpu.mjs:
// the reference, which decodes every instruction each time, and the decode cache, dcache.mjs):
// - m4Units: hand-written vectors on each tier: the decoder on encodings from the ARMv7-M ARM, the executor on short
//   programs (flags, shifts, IT blocks, PUSH / POP, TBB, divide, LDREX / STREX), and the exception model (SVC entry
//   and return on MSP and PSP, PendSV, SysTick, PRIMASK and BASEPRI, fault escalation and the enabled UsageFault,
//   lockup, WFI, BKPT, the lazy FP context); then the two tiers in lockstep, compared after every instruction
//   (registers, flags, the special and system registers, SysTick, the cycle count, the bus writes) on those programs
//   and on the cache's hazards: code in SRAM that stores over itself (an instruction already run, a 32-bit
//   instruction's second halfword, an instruction across a page boundary), code run at the flash alias and written at
//   0x08000000, a write behind the bus reported with bus.written, and one 16-bit ADDS run inside and outside an IT
//   block. Mutants 1 (a hit that ignores the page's version) and 2 (the IT state baked into a kept record) must make
//   the lockstep fail: its own sensitivity check;
// - m4Vectors: the QEMU-recorded differential vectors (test/fixtures/m4_vectors.json, tools/m4-oracle/oracle.mjs) on
//   each tier, and in lockstep twice over, the second pass of each case from the cache alone;
// - m4Firmware: the SCPU image from its reset vector until its first unmodelled access on each tier and in lockstep,
//   and on the STM32L4 machine to its console prompt at the same cycle on both tiers (needs the unpacked E143 SCPU
//   block; skipped without it).
//   node emu/test/test_m4.mjs
import fs from 'node:fs';
import path from 'node:path';
import { decode } from '../src/core/m4/decode.mjs';
import { CortexM4, STEP_OK, STEP_SLEEP, STEP_BKPT, STEP_LOCKUP } from '../src/core/m4/cpu.mjs';
import { MemoryBus } from '../src/core/m4/bus.mjs';
import { smoke, scpuMachine, SRAM } from '../src/core/m4/boot.mjs';
import { Stm32l4 } from '../src/core/m4/periph/stm32l4.mjs';
import { runJs, differ, initialState, setupJs, stepCase, caseOver, MAX_STEPS } from './m4cases.mjs';
import { BOOT } from './test_stm32l4.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const hex = (v) => '0x' + (v >>> 0).toString(16);

// encoding -> the decoder's encoding name and some fields
const DECODE = [
  [[0x4408], 'ADD (register) T2', { rd: 0, rm: 1 }],
  [[0x1842], 'ADD (register) T1', { rd: 2, rn: 0, rm: 1 }],
  [[0xf04f, 0x0001], 'MOV (immediate) T2', { rd: 0, imm: 1 }],
  [[0xf44f, 0x7080], 'MOV (immediate) T2', { rd: 0, imm: 0x100 }],
  [[0xf240, 0x1234], 'MOV (immediate) T3', { rd: 2, imm: 0x0134 }],
  [[0xb530], 'PUSH T1', { list: 0x4030 }],
  [[0xbd30], 'POP T1', { list: 0x8030 }],
  [[0xe92d, 0x4ff0], 'PUSH T2', { list: 0x4ff0 }],
  [[0xe8bd, 0x8010], 'POP T2', { list: 0x8010 }],
  [[0xf8d0, 0x1004], 'LDR (immediate) T3', { rd: 1, rn: 0, imm: 4 }],
  [[0xf850, 0x1b04], 'LDR (immediate) T4', { rd: 1, rn: 0, imm: 4, idx: 0, add: 1, wb: 1 }],
  [[0x4a01], 'LDR (literal) T1', { rd: 2, imm: 4 }],
  [[0xe8df, 0xf000], 'TBB T1', { rn: 15, rm: 0 }],
  [[0xe8df, 0xf011], 'TBH T1', { rn: 15, rm: 1 }],
  [[0xfbb0, 0xf2f1], 'UDIV T1', { rd: 2, rn: 0, rm: 1 }],
  [[0xfb90, 0xf2f1], 'SDIV T1', { rd: 2, rn: 0, rm: 1 }],
  [[0xfb10, 0xf001], 'SMULBB T1', { rd: 0, rn: 0, rm: 1 }],
  [[0xf3ef, 0x8009], 'MRS T1', { rd: 0, imm: 9 }],
  [[0xf380, 0x8814], 'MSR T1', { rn: 0, imm: 20 }],
  [[0xeef1, 0x0a10], 'VMRS T1', { rd: 0 }],
  [[0xeee1, 0x0a10], 'VMSR T1', { rd: 0 }],
  [[0xecbd, 0x8a10], 'VPOP T2', { rd: 16, list: 16 }],
  [[0xed2d, 0x8a10], 'VPUSH T2', { rd: 16, list: 16 }],
  [[0xbf0c], 'IT T1', { cond: 0, list: 0xc }],
  [[0x2800], 'CMP (immediate) T1', { rn: 0, imm: 0 }],
  [[0xd0fe], 'B T1', { cond: 0, imm: -4 }],
  [[0xf000, 0xf800], 'BL T1', { imm: 0 }],
  [[0xf7ff, 0xfffe], 'BL T1', { imm: -4 }],
  [[0x4770], 'BX T1', { rm: 14 }],
  [[0xb108], 'CBZ T1', { rn: 0, imm: 2 }],
  [[0xb662], 'CPS T1', { imm: 2, add: 0 }],
  [[0xb672], 'CPS T1', { imm: 2, add: 1 }],
  [[0xdf05], 'SVC T1', { imm: 5 }],
  [[0xbf30], 'WFI T1', {}],
  [[0xf3bf, 0x8f4f], 'DSB T1', {}],
  [[0xe850, 0x1f00], 'LDREX T1', { rd: 1, rn: 0 }],
  [[0xe840, 0x3200], 'STREX T1', { rd: 2, rm: 3, rn: 0 }],
  [[0xf3c0, 0x0207], 'UBFX T1', { rd: 2, rn: 0, sa: 0, imm: 8 }],
  [[0xfab0, 0xf080], 'CLZ T1', { rd: 0, rm: 0 }],
  [[0xde00], 'UDF T1', {}],
  [[0xee00, 0x1a10], 'VMOV (between ARM core register and single-precision register) T1', { rd: 1, rm: 0, add: 0 }],
];

function assemble(low, at, code) { code.forEach((h, i) => { low[at + 2 * i] = h & 0xff; low[at + 2 * i + 1] = h >>> 8; }); }
const w32 = (b, o, v) => { b[o] = v; b[o + 1] = v >>> 8; b[o + 2] = v >>> 16; b[o + 3] = v >>> 24; };
// a bus that logs its writes (the lockstep compares each step's)
class LogBus extends MemoryBus {
  constructor(opts) { super(opts); this.log = []; }
  wr(a, size, v) { this.log.push(`${hex(a)}/${size}=${hex(v)}`); super.wr(a, size, v); }
}
// a machine: 16 KiB of RAM at 0 (vectors, the program at `at`, handlers), 16 KiB at 0x20000000 (the program when `at`
// is there), SP at its top; every system exception's vector is `b .` at 0x80 unless handlers names its code. alias:
// the low 16 KiB at 0x08000000 and seen at 0 too (the STM32's boot alias of flash, here writable)
function build(code, { at = 0x100, handlers = {}, opts = {}, alias = false } = {}) {
  const bus = new LogBus();
  const low = alias ? bus.ram(0x08000000, 0x4000) : bus.ram(0, 0x4000);
  if (alias) bus.alias(0, 0x08000000, 0x4000);
  const ram = bus.ram(0x20000000, 0x4000);
  w32(low, 0, 0x20004000); w32(low, 4, at | 1);
  assemble(low, 0x80, [0xe7fe]);
  for (let n = 2; n < 16; n++) w32(low, 4 * n, 0x81);
  let h = 0x400;
  for (const [n, c] of Object.entries(handlers)) { w32(low, 4 * Number(n), h | 1); assemble(low, h, c); h += 0x100; }
  if (at >= 0x20000000) assemble(ram, at - 0x20000000, code); else assemble(low, at, code);
  return { cpu: new CortexM4({ bus, ...opts }), bus, low, ram, handlerAt: (n) => 0x400 + 0x100 * Object.keys(handlers).indexOf(String(n)) };
}
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// the hand-written vectors on one tier
function unitChecks(tier) {
  const machine = (code, o = {}) => build(code, { ...o, opts: { tier, ...(o.opts || {}) } });
  const bad = [];
  let checks = 0;
  const eq = (what, got, want) => { checks++; if (got !== want) bad.push(`${what}: ${typeof got === 'number' ? hex(got) : got} != ${typeof want === 'number' ? hex(want) : want}`); };
  const steps = (cpu, n) => { for (let i = 0; i < n; i++) cpu.step(); };

  for (const [w, enc, fields] of DECODE) {
    const d = decode(w[0], w[1] ?? 0);
    eq(`decode ${w.map((x) => x.toString(16)).join(' ')}`, d.enc, enc);
    eq(`decode ${w.map((x) => x.toString(16)).join(' ')} unpredictable`, d.unp, false);
    for (const [k, v] of Object.entries(fields)) eq(`decode ${w.map((x) => x.toString(16)).join(' ')} ${k}`, d[k], v);
  }

  { // flags: ADDS overflow, SUBS to zero
    const { cpu } = machine([0x1842, 0x1a4b, 0xe7fe]);
    cpu.r[0] = 0x7fffffff; cpu.r[1] = 1;
    steps(cpu, 1);
    eq('adds r2', cpu.r[2], 0x80000000 | 0); eq('adds NZCV', (cpu.n << 3) | (cpu.z << 2) | (cpu.c << 1) | cpu.v, 0b1001);
    steps(cpu, 1);
    eq('subs r3', cpu.r[3], 0); eq('subs NZCV', (cpu.n << 3) | (cpu.z << 2) | (cpu.c << 1) | cpu.v, 0b0110);
  }
  { // shifts: LSLS #1 carries out bit 31, ASRS #32
    const { cpu } = machine([0x0048, 0x1008, 0xe7fe]);
    cpu.r[1] = 0x80000001 | 0;
    steps(cpu, 1); eq('lsls r0, r1, #1', cpu.r[0], 2); eq('lsls carry', cpu.c, 1);
    steps(cpu, 1); eq('asrs r0, r1, #32', cpu.r[0], -1); eq('asrs carry', cpu.c, 1);
  }
  for (const [r0, want] of [[0, 1], [5, 2]]) { // ITE EQ: the IT block's moves set no flags
    const { cpu } = machine([0x2800, 0xbf0c, 0x2101, 0x2102, 0xe7fe]);
    cpu.r[0] = r0;
    steps(cpu, 4);
    eq(`ite eq with r0 = ${r0}`, cpu.r[1], want); eq(`ite eq: Z kept (r0 = ${r0})`, cpu.z, r0 === 0 ? 1 : 0); eq('it state after the block', cpu.it, 0);
    eq('pc after the block', cpu.pc, 0x108);
  }
  { // PUSH {r4, r5, lr}; POP {r4, r5, pc}
    const { cpu, ram } = machine([0xb530, 0x2400, 0xbd30], { at: 0x100 });
    cpu.r[4] = 0x11; cpu.r[5] = 0x22; cpu.r[14] = 0x201;
    steps(cpu, 1);
    eq('push: sp', cpu.r[13], 0x20003ff4); eq('push: r4 lowest', rd32(ram, 0x3ff4), 0x11); eq('push: lr highest', rd32(ram, 0x3ffc), 0x201);
    steps(cpu, 2);
    eq('pop: r4', cpu.r[4], 0x11); eq('pop: pc', cpu.pc, 0x200); eq('pop: sp', cpu.r[13], 0x20004000);
  }
  for (const [r0, want] of [[0, 10], [1, 11]]) { // TBB [pc, r0]
    const { cpu } = machine([0xe8df, 0xf000, 0x0302, 0xbf00, 0x210a, 0x210b, 0xe7fe]);
    cpu.r[0] = r0;
    steps(cpu, 2);
    eq(`tbb case ${r0}`, cpu.r[1], want);
  }
  { // UDIV, SDIV, divide by zero (0, then UsageFault DIVBYZERO escalated with CCR.DIV_0_TRP)
    const { cpu } = machine([0xfbb0, 0xf2f1, 0xfb90, 0xf2f1, 0xfbb0, 0xf2f3, 0xfbb0, 0xf2f3, 0xe7fe]);
    cpu.r[0] = 100; cpu.r[1] = 7; cpu.r[3] = 0;
    steps(cpu, 1); eq('udiv', cpu.r[2], 14);
    cpu.r[0] = -100; steps(cpu, 1); eq('sdiv', cpu.r[2], -14);
    steps(cpu, 1); eq('udiv by zero', cpu.r[2], 0);
    cpu.sys.ccr |= 0x10; steps(cpu, 1);
    eq('div by zero trap: HardFault', cpu.ipsr, 3); eq('CFSR.DIVBYZERO', cpu.sys.cfsr, 1 << 25); eq('HFSR.FORCED', cpu.sys.hfsr, 1 << 30);
  }
  { // LDREX / STREX: pass, then fail with the monitor clear
    const { cpu, ram } = machine([0xe850, 0x1f00, 0xe840, 0x3200, 0xe840, 0x3200, 0xe7fe]);
    cpu.r[0] = 0x20000100; cpu.r[3] = 0x55;
    steps(cpu, 2); eq('strex after ldrex: status', cpu.r[2], 0); eq('strex stored', rd32(ram, 0x100), 0x55);
    cpu.r[3] = 0x66; steps(cpu, 1); eq('strex without the monitor: status', cpu.r[2], 1); eq('strex without the monitor: memory', rd32(ram, 0x100), 0x55);
  }
  { // SVC on MSP: the frame, EXC_RETURN, the return
    const { cpu, ram } = machine([0xdf05, 0x2001, 0xe7fe], { handlers: { 11: [0x4770] } });
    cpu.r[0] = 0x1234; cpu.r[12] = 0xc; cpu.r[14] = 0x77;
    steps(cpu, 1);
    eq('svc: handler', cpu.pc, 0x400); eq('svc: ipsr', cpu.ipsr, 11); eq('svc: lr', cpu.r[14], 0xfffffff9 | 0);
    eq('svc: sp', cpu.r[13], 0x20003fe0); eq('svc: stacked r0', rd32(ram, 0x3fe0), 0x1234); eq('svc: stacked r12', rd32(ram, 0x3ff0), 0xc);
    eq('svc: stacked lr', rd32(ram, 0x3ff4), 0x77); eq('svc: stacked pc', rd32(ram, 0x3ff8), 0x102); eq('svc: stacked xpsr T', rd32(ram, 0x3ffc) >>> 24, 1);
    steps(cpu, 1);
    eq('svc return: pc', cpu.pc, 0x102); eq('svc return: ipsr', cpu.ipsr, 0); eq('svc return: sp', cpu.r[13], 0x20004000); eq('svc return: lr', cpu.r[14], 0x77);
  }
  { // SVC from a thread on PSP: the frame on PSP, EXC_RETURN 0xfffffffd, back on PSP
    const { cpu, ram } = machine([0xf380, 0x8809, 0x2102, 0xf381, 0x8814, 0xdf00, 0xe7fe], { handlers: { 11: [0x4770] } });
    cpu.r[0] = 0x20002000;
    steps(cpu, 3);
    eq('msr control: SPSEL', cpu.control, 2); eq('sp is PSP', cpu.r[13], 0x20002000); eq('msp kept', cpu.getMsp(), 0x20004000);
    steps(cpu, 1);
    eq('svc on psp: lr', cpu.r[14], 0xfffffffd | 0); eq('svc on psp: psp', cpu.getPsp(), 0x20001fe0); eq('svc on psp: sp is msp', cpu.r[13], 0x20004000);
    eq('svc on psp: stacked pc', rd32(ram, 0x1ff8), 0x10c);
    steps(cpu, 1);
    eq('return to psp: sp', cpu.r[13], 0x20002000); eq('return to psp: control', cpu.control, 2);
  }
  { // PendSV through ICSR, held off by PRIMASK, taken after CPSIE I
    const { cpu } = machine([0xb672, 0x6001, 0xbf00, 0xb662, 0xe7fe], { handlers: { 14: [0xe7fe] } });
    cpu.r[0] = 0xe000ed04 | 0; cpu.r[1] = 1 << 28;
    steps(cpu, 3);
    eq('PendSV pending under PRIMASK', cpu.sys.pending[14], 1); eq('not taken under PRIMASK', cpu.ipsr, 0);
    steps(cpu, 2);
    eq('taken after cpsie i', cpu.ipsr, 14);
  }
  { // BASEPRI masks a priority-0x40 PendSV, not a 0x20 one
    const { cpu } = machine([0xe7fe], { handlers: { 14: [0xe7fe] }, opts: { prioBits: 4 } });
    cpu.basepri = 0x40; cpu.sys.prio[14] = 0x40; cpu.sys.setPending(14);
    steps(cpu, 2); eq('BASEPRI 0x40 masks priority 0x40', cpu.ipsr, 0);
    cpu.sys.prio[14] = 0x20; cpu.irqDirty = true;
    steps(cpu, 1); eq('BASEPRI 0x40 lets 0x20 in', cpu.ipsr, 14);
  }
  { // SysTick: reload 3 on the processor clock, the exception after the count reaches 0; COUNTFLAG clears on read
    const { cpu } = machine([0xe7fe], { handlers: { 15: [0xe7fe] } });
    cpu.sys.write(0xe000e014, 4, 3); cpu.sys.write(0xe000e010, 4, 7);
    let k = 0;
    while (cpu.ipsr !== 15 && k < 20) { cpu.step(); k++; }
    eq('SysTick taken', cpu.ipsr, 15); eq('SysTick after steps', k, 5);
    eq('COUNTFLAG', (cpu.sys.read(0xe000e010, 4) >>> 16) & 1, 1); eq('COUNTFLAG cleared by the read', (cpu.sys.read(0xe000e010, 4) >>> 16) & 1, 0);
  }
  { // WFI sleeps until SysTick
    const { cpu } = machine([0xbf30, 0xe7fe], { handlers: { 15: [0xe7fe] } });
    cpu.sys.write(0xe000e014, 4, 10); cpu.sys.write(0xe000e010, 4, 7);
    steps(cpu, 1);
    eq('wfi sleeps', cpu.sleeping, true); eq('a sleeping step', cpu.step(), STEP_SLEEP);
    let k = 0;
    while (cpu.ipsr !== 15 && k < 40) { cpu.step(); k++; }
    eq('woken into SysTick', cpu.ipsr, 15); eq('wfi: the frame returns after it', rd32(cpu.bus.find(0x20000000).bytes, 0x3ff8), 0x102);
  }
  { // UDF: HardFault (UsageFault disabled), then UsageFault when enabled; a fault in HardFault locks up
    const { cpu, ram } = machine([0xde00, 0xe7fe], { handlers: { 3: [0xde01] } });
    steps(cpu, 1);
    eq('udf: HardFault', cpu.ipsr, 3); eq('udf: CFSR.UNDEFINSTR', cpu.sys.cfsr, 1 << 16); eq('udf: HFSR.FORCED', cpu.sys.hfsr, 1 << 30);
    eq('udf: stacked pc is the udf', rd32(ram, 0x3ff8), 0x100);
    eq('udf in HardFault: lockup', cpu.step(), STEP_LOCKUP);
    const m = machine([0xde00, 0xe7fe]);
    m.cpu.sys.shcsrEna = 4;
    steps(m.cpu, 1);
    eq('udf with USGFAULTENA: UsageFault', m.cpu.ipsr, 6); eq('udf with USGFAULTENA: HFSR', m.cpu.sys.hfsr, 0);
  }
  { // an unaligned LDM: UsageFault UNALIGNED, escalated
    const { cpu } = machine([0xc802, 0xe7fe]);
    cpu.r[0] = 0x20000101;
    steps(cpu, 1);
    eq('unaligned ldm: HardFault', cpu.ipsr, 3); eq('unaligned ldm: CFSR.UNALIGNED', cpu.sys.cfsr, 1 << 24);
  }
  { // BKPT stops the run with pc at the instruction
    const { cpu } = machine([0xbe00, 0xe7fe]);
    eq('bkpt', cpu.step(), STEP_BKPT); eq('bkpt: pc', cpu.pc, 0x100);
  }
  { // MSR / MRS PSP, BASEPRI_MAX
    const { cpu } = machine([0xf380, 0x8809, 0xf3ef, 0x8109, 0xf382, 0x8812, 0xf383, 0x8812, 0xe7fe]);
    cpu.r[0] = 0x20001000; cpu.r[2] = 0x80; cpu.r[3] = 0xc0;
    steps(cpu, 2); eq('mrs psp', cpu.r[1], 0x20001000);
    steps(cpu, 1); eq('basepri_max from 0', cpu.basepri, 0x80);
    steps(cpu, 1); eq('basepri_max does not raise it', cpu.basepri, 0x80);
  }
  { // the lazy FP context: VMSR sets FPCA; SVC reserves the 26-word frame; VPUSH in the handler saves S0..S15 there;
    // the return restores them
    const handler = [0xee00, 0x1a10, 0xed2d, 0x0a01, 0xecbd, 0x0a01, 0x4770];
    const { cpu, ram } = machine([0xeee1, 0x0a10, 0xdf00, 0xe7fe], { handlers: { 11: handler } });
    cpu.sys.cpacr = 0x00f00000;
    cpu.r[0] = 0x03c00000; cpu.s[0] = 0x11111111; cpu.s[15] = 0x15151515; cpu.r[1] = 0x99;
    steps(cpu, 1);
    eq('vmsr: FPCA', cpu.control & 4, 4); eq('vmsr: FPSCR', cpu.fpscr, 0x03c00000);
    steps(cpu, 1);
    eq('fp frame: sp', cpu.r[13], 0x20004000 - 0x68); eq('fp frame: lr', cpu.r[14], 0xffffffe9 | 0);
    eq('fp frame: LSPACT', cpu.sys.fpccr & 1, 1); eq('fp frame: FPCAR', cpu.sys.fpcar, 0x20004000 - 0x68 + 0x20); eq('fp frame: FPCA cleared', cpu.control & 4, 0);
    steps(cpu, 1);   // vmov s0, r1: the lazy save first
    eq('lazy save: s0 in the frame', rd32(ram, 0x4000 - 0x68 + 0x20), 0x11111111); eq('lazy save: s15', rd32(ram, 0x4000 - 0x68 + 0x20 + 60), 0x15151515);
    eq('lazy save: FPSCR', rd32(ram, 0x4000 - 0x68 + 0x60), 0x03c00000); eq('lazy save: LSPACT cleared', cpu.sys.fpccr & 1, 0);
    eq('vmov s0, r1', cpu.s[0], 0x99);
    steps(cpu, 3);
    eq('fp return: pc', cpu.pc, 0x106); eq('fp return: s0 restored', cpu.s[0], 0x11111111); eq('fp return: FPCA', cpu.control & 4, 4);
    eq('fp return: sp', cpu.r[13], 0x20004000);
  }
  { // NOCP: an FP instruction with CPACR clear
    const { cpu } = machine([0xeef1, 0x0a10, 0xe7fe]);
    steps(cpu, 1);
    eq('vmrs with CPACR clear: CFSR.NOCP', cpu.sys.cfsr, 1 << 19);
  }
  return { checks, bad };
}

export function m4Units() {
  const out = { checks: 0, bad: [] };
  for (const tier of ['reference', 'cached']) {
    const u = unitChecks(tier);
    out.checks += u.checks; out.bad.push(...u.bad.map((x) => `${tier} tier: ${x}`));
  }
  const l = programLockstep();
  out.checks += l.checks; out.bad.push(...l.bad);
  return out;
}

// ---- the two tiers in lockstep
// the core's state after a step, by name: what the lockstep compares
const STATE = {
  r: (c) => Array.from(c.r, hex).join(' '), pc: (c) => hex(c.pc), xpsr: (c) => hex(c.xpsr()), msp: (c) => hex(c.getMsp()),
  psp: (c) => hex(c.getPsp()), primask: (c) => c.primask, basepri: (c) => c.basepri, faultmask: (c) => c.faultmask,
  control: (c) => c.control, s: (c) => Array.from(c.s, hex).join(' '), fpscr: (c) => hex(c.fpscr), event: (c) => c.event,
  sleeping: (c) => c.sleeping, halted: (c) => c.halted, excl: (c) => c.excl, insns: (c) => c.insns, cycles: (c) => c.cycles,
  cfsr: (c) => hex(c.sys.cfsr), hfsr: (c) => hex(c.sys.hfsr), bfar: (c) => hex(c.sys.bfar), mmfar: (c) => hex(c.sys.mmfar),
  fpccr: (c) => hex(c.sys.fpccr), fpcar: (c) => hex(c.sys.fpcar), systick: (c) => `${c.sys.stCsr} ${c.sys.stCvr} ${c.sys.stFrac}`,
  cyccnt: (c) => c.sys.cyccnt, pending: (c) => c.sys.pending.join(''), active: (c) => c.sys.active.join(''),
};
function stateDiff(a, b) {
  const out = [];
  for (const [k, f] of Object.entries(STATE)) { const x = f(a), y = f(b); if (x !== y) out.push(`${k} ${x} != ${y}`); }
  return out;
}
// one step: its result, or the error it threw
function tryStep(cpu) { try { return String(cpu.step()); } catch (e) { return `${e.name}: ${e.message}`; } }
// step a reference machine a and a cached machine b together n times (pokes: step number -> f(machine), done to both
// before that step): the first difference after a step (the state, the step's bus writes, its result), or null
function lockstep(a, b, n, pokes = {}) {
  for (let k = 0; k < n; k++) {
    if (pokes[k]) { pokes[k](a); pokes[k](b); }
    a.bus.log.length = 0; b.bus.log.length = 0;
    const ra = tryStep(a.cpu), rb = tryStep(b.cpu);
    const d = stateDiff(a.cpu, b.cpu);
    if (ra !== rb) d.push(`step result ${ra} != ${rb}`);
    const wa = a.bus.log.join(' '), wb = b.bus.log.join(' ');
    if (wa !== wb) d.push(`writes ${wa || 'none'} != ${wb || 'none'}`);
    if (d.length) return `step ${k}: ${d.slice(0, 3).join('; ')}`;
  }
  return null;
}

// the programs the tiers run in lockstep: the units' and the cache's hazards. setup(m) gives both machines the same
// state; pokes act on both between steps; want: the reference's registers (and pc) at the end
const SRAM_CODE = 0x20000100;
const set = (regs) => ({ cpu }) => { for (const [k, v] of Object.entries(regs)) cpu.r[Number(k)] = v | 0; };
const sysWrites = (writes) => ({ cpu }) => { for (const [a, v] of writes) cpu.sys.write(a, 4, v); };
const PROGRAMS = [
  { name: 'ADDS overflow, SUBS to zero', code: [0x1842, 0x1a4b, 0xe7fe], steps: 4, setup: set({ 0: 0x7fffffff, 1: 1 }) },
  { name: 'LSLS #1, ASRS #32', code: [0x0048, 0x1008, 0xe7fe], steps: 4, setup: set({ 1: 0x80000001 }) },
  { name: 'ITE EQ, then', code: [0x2800, 0xbf0c, 0x2101, 0x2102, 0xe7fe], steps: 6, setup: set({ 0: 0 }) },
  { name: 'ITE EQ, else', code: [0x2800, 0xbf0c, 0x2101, 0x2102, 0xe7fe], steps: 6, setup: set({ 0: 5 }) },
  { name: 'PUSH / POP to pc', code: [0xb530, 0x2400, 0xbd30], steps: 6, setup: set({ 4: 0x11, 5: 0x22, 14: 0x201 }) },
  { name: 'TBB', code: [0xe8df, 0xf000, 0x0302, 0xbf00, 0x210a, 0x210b, 0xe7fe], steps: 4, setup: set({ 0: 1 }) },
  { name: 'UDIV, SDIV, divide by zero and its trap', code: [0xfbb0, 0xf2f1, 0xfb90, 0xf2f1, 0xfbb0, 0xf2f3, 0xfbb0, 0xf2f3, 0xe7fe],
    steps: 6, setup: set({ 0: 100, 1: 7, 3: 0 }), pokes: { 1: set({ 0: -100 }), 3: ({ cpu }) => { cpu.sys.ccr |= 0x10; } } },
  { name: 'LDREX / STREX', code: [0xe850, 0x1f00, 0xe840, 0x3200, 0xe840, 0x3200, 0xe7fe], steps: 4,
    setup: set({ 0: 0x20000100, 3: 0x55 }), pokes: { 2: set({ 3: 0x66 }) } },
  { name: 'SVC on MSP and its return', code: [0xdf05, 0x2001, 0xe7fe], handlers: { 11: [0x4770] }, steps: 5,
    setup: set({ 0: 0x1234, 12: 0xc, 14: 0x77 }) },
  { name: 'SVC on PSP and its return', code: [0xf380, 0x8809, 0x2102, 0xf381, 0x8814, 0xdf00, 0xe7fe], handlers: { 11: [0x4770] },
    steps: 7, setup: set({ 0: 0x20002000 }) },
  { name: 'PendSV under PRIMASK', code: [0xb672, 0x6001, 0xbf00, 0xb662, 0xe7fe], handlers: { 14: [0xe7fe] }, steps: 7,
    setup: set({ 0: 0xe000ed04, 1: 1 << 28 }) },
  { name: 'SysTick on b .', code: [0xe7fe], handlers: { 15: [0xe7fe] }, steps: 12, setup: sysWrites([[0xe000e014, 3], [0xe000e010, 7]]) },
  { name: 'WFI until SysTick', code: [0xbf30, 0xe7fe], handlers: { 15: [0xe7fe] }, steps: 20, setup: sysWrites([[0xe000e014, 10], [0xe000e010, 7]]) },
  { name: 'UDF to HardFault, UDF in HardFault to lockup', code: [0xde00, 0xe7fe], handlers: { 3: [0xde01] }, steps: 4 },
  { name: 'UDF to the enabled UsageFault', code: [0xde00, 0xe7fe], steps: 3, setup: ({ cpu }) => { cpu.sys.shcsrEna = 4; } },
  { name: 'an unaligned LDM', code: [0xc802, 0xe7fe], steps: 3, setup: set({ 0: 0x20000101 }) },
  { name: 'BKPT', code: [0xbe00, 0xe7fe], steps: 2 },
  { name: 'MSR / MRS PSP, BASEPRI_MAX', code: [0xf380, 0x8809, 0xf3ef, 0x8109, 0xf382, 0x8812, 0xf383, 0x8812, 0xe7fe], steps: 5,
    setup: set({ 0: 0x20001000, 2: 0x80, 3: 0xc0 }) },
  { name: 'the lazy FP context', code: [0xeee1, 0x0a10, 0xdf00, 0xe7fe], handlers: { 11: [0xee00, 0x1a10, 0xed2d, 0x0a01, 0xecbd, 0x0a01, 0x4770] },
    steps: 8, setup: ({ cpu }) => { cpu.sys.cpacr = 0x00f00000; set({ 0: 0x03c00000, 1: 0x99 })({ cpu }); cpu.s[0] = 0x11111111; cpu.s[15] = 0x15151515; } },
  { name: 'NOCP', code: [0xeef1, 0x0a10, 0xe7fe], steps: 3 },
  // movs r1, #0xff; cmp r0, r0; it eq; adds r1, #1; bne 1f; b <the adds>; 1: b .  (the ADDS inside the block, then outside)
  { id: 'it', name: 'one 16-bit ADDS inside and outside an IT block', code: [0x21ff, 0x4280, 0xbf08, 0x3101, 0xd100, 0xe7fc, 0xe7fe],
    steps: 12, want: { 1: 0x101, pc: 0x10c } },
  // 1: movs r0, #1; adds r1, r1, r0; strh r2, [r3]; subs r4, #1; bne 1b; b .  (r2 = movs r0, #5 over the first)
  { id: 'smc', name: 'SRAM: a store over an instruction already run', at: SRAM_CODE, code: [0x2001, 0x1809, 0x801a, 0x3c01, 0xd1fa, 0xe7fe],
    steps: 14, setup: set({ 1: 0, 2: 0x2005, 3: SRAM_CODE, 4: 2 }), want: { 0: 5, 1: 6 } },
  // 1: movw r0, #1; adds r1, r1, r0; strh r2, [r3, #2]; subs r4, #1; bne 1b; b .  (r2 = the halfword of movw r0, #5)
  { name: 'SRAM: a store over a 32-bit instruction\'s second halfword', at: SRAM_CODE, code: [0xf240, 0x0001, 0x1809, 0x805a, 0x3c01, 0xd1f9, 0xe7fe],
    steps: 14, setup: set({ 1: 0, 2: 5, 3: SRAM_CODE, 4: 2 }), want: { 0: 5, 1: 6 } },
  // 1: nop; movw r0, #1 (its halfwords on either side of the page boundary 0x20000200); adds; strh r2, [r3]; subs; bne 1b
  { name: 'SRAM: a store over a 32-bit instruction across a page boundary', at: 0x200001fc,
    code: [0xbf00, 0xf240, 0x0001, 0x1809, 0x801a, 0x3c01, 0xd1f8, 0xe7fe], steps: 16, setup: set({ 1: 0, 2: 5, 3: 0x20000200, 4: 2 }),
    want: { 0: 5, 1: 6 } },
  // the SRAM program run at the flash alias (0x100), its store through 0x08000100
  { name: 'code run at the alias, written at 0x08000000', alias: true, code: [0x2001, 0x1809, 0x801a, 0x3c01, 0xd1fa, 0xe7fe],
    steps: 14, setup: set({ 1: 0, 2: 0x2005, 3: 0x08000100, 4: 2 }), want: { 0: 5, 1: 6 } },
  // 1: movs r0, #1; adds r1, r1, r0; subs r4, #1; bne 1b; b .  (after one pass the movs becomes movs r0, #5 behind the bus)
  { name: 'a write behind the bus, reported with bus.written', at: SRAM_CODE, code: [0x2001, 0x1809, 0x3c01, 0xd1fb, 0xe7fe],
    steps: 11, setup: set({ 1: 0, 4: 2 }), pokes: { 4: ({ ram, bus }) => { ram[0x100] = 0x05; ram[0x101] = 0x20; bus.written(SRAM_CODE, 2); } },
    want: { 0: 5, 1: 6 } },
];
// the mutants and the program each must fail on
const MUTANTS = [[1, 'smc', 'a hit that ignores its page\'s version'], [2, 'it', 'the IT state baked into a kept record']];

function programLockstep() {
  const bad = [];
  let checks = 0, fills = 0, insns = 0;
  const pair = (p, mutant = 0) => {
    const o = { at: p.at, handlers: p.handlers, alias: p.alias };
    const a = build(p.code, { ...o, opts: { tier: 'reference' } }), b = build(p.code, { ...o, opts: { tier: 'cached', mutant } });
    if (p.setup) { p.setup(a); p.setup(b); }
    return [a, b];
  };
  for (const p of PROGRAMS) {
    const [a, b] = pair(p);
    checks++;
    const d = lockstep(a, b, p.steps, p.pokes);
    if (d) bad.push(`lockstep, ${p.name}: ${d}`);
    for (const [k, v] of Object.entries(p.want || {})) {
      checks++;
      const got = k === 'pc' ? a.cpu.pc : a.cpu.r[Number(k)];
      if ((got | 0) !== (v | 0)) bad.push(`${p.name}: the reference's ${k === 'pc' ? 'pc' : `r${k}`} ${hex(got)} != ${hex(v)}`);
    }
    fills += b.cpu.dc.fills; insns += b.cpu.insns;
  }
  checks++;
  if (fills >= insns) bad.push(`the cached tier decoded ${fills} times for ${insns} instructions: the cache was not used`);
  for (const [mutant, id, what] of MUTANTS) {
    const p = PROGRAMS.find((x) => x.id === id), [a, b] = pair(p, mutant);
    checks++;
    if (!lockstep(a, b, p.steps, p.pokes)) bad.push(`mutant ${mutant} (${what}): the lockstep found no difference on "${p.name}"`);
  }
  return { checks, bad };
}

// the QEMU-recorded vectors, on each tier and in lockstep
export function m4Vectors(file = path.join(ROOT, 'emu/test/fixtures/m4_vectors.json')) {
  const bad = [];
  if (!fs.existsSync(file)) return { checks: 1, bad: [`no ${path.relative(ROOT, file)}`], cases: 0 };
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  let checks = 0;
  for (const tier of ['reference', 'cached']) {
    for (const c of fx.cases) {
      checks++;
      const js = runJs(c, { prioBits: fx.prioBits, tier });
      if (js.drop) { bad.push(`${tier} tier, seed ${c.seed}: the JS core drops it (${js.drop})`); continue; }
      const st = initialState(c.seed), o = c.out;
      for (const [k, v] of Object.entries(c.set || {})) st.r[Number(k)] = v | 0;
      const r = Array.from(st.r); for (const [k, v] of o.r) r[k] = v; r[15] = o.pc;
      const s = Array.from(st.s); for (const [k, v] of o.s) s[k] = v;
      const mem = []; for (const [off, ...bytes] of o.mem) bytes.forEach((b, i) => mem.push([off + i, b]));
      const d = differ({ ...o, r, s, mem }, js);
      if (d.length) bad.push(`${tier} tier, seed ${c.seed} (code ${c.code.map((h) => h.toString(16).padStart(4, '0')).join(' ')}): ${d.slice(0, 3).join('; ')}`);
    }
  }
  const l = vectorLockstep(fx);
  return { checks: checks + l.checks, bad: [...bad, ...l.bad], cases: fx.cases.length, qemu: fx.qemu };
}
// each case on both tiers step by step, twice: the second pass (restart: the same machines, the decoded instructions
// kept) must run from the cache alone
function vectorLockstep(fx) {
  const bad = [];
  let refills = 0;
  for (const c of fx.cases) {
    const opts = { prioBits: fx.prioBits, Bus: LogBus };
    const a = setupJs(c, { ...opts, tier: 'reference' }), b = setupJs(c, { ...opts, tier: 'cached' });
    let d = null, dropped = false;
    for (let pass = 0; pass < 2 && !d && !dropped; pass++) {
      if (pass) { a.restart(); b.restart(); }
      const before = b.cpu.dc.fills;
      for (let k = 0; k < MAX_STEPS && !caseOver(a); k++) {
        a.bus.log.length = 0; b.bus.log.length = 0;
        const da = stepCase(a), db = stepCase(b);
        const diff = stateDiff(a.cpu, b.cpu);
        if (da !== db) diff.push(`drop ${da} != ${db}`);
        const wa = a.bus.log.join(' '), wb = b.bus.log.join(' ');
        if (wa !== wb) diff.push(`writes ${wa || 'none'} != ${wb || 'none'}`);
        if (diff.length) { d = `pass ${pass + 1}, step ${k}: ${diff.slice(0, 3).join('; ')}`; break; }
        if (da) { dropped = true; break; }
      }
      if (pass && !d) refills += b.cpu.dc.fills - before;
    }
    if (d) bad.push(`lockstep, seed ${c.seed} (code ${c.code.map((h) => h.toString(16).padStart(4, '0')).join(' ')}): ${d}`);
  }
  if (refills) bad.push(`the second passes decoded ${refills} instructions again (want none: all from the cache)`);
  return { checks: fx.cases.length + 1, bad };
}

// the SCPU image from reset: the pinned stop (the first unmodelled access) and the count before it
export const SMOKE = { insns: 58852, addr: 0x40022000, pc: 0x800a534, exceptions: { 11: 1 } };
export function m4Firmware(file = path.join(ROOT, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk0e560000.OE.0107.bin')) {
  if (!fs.existsSync(file)) return { checks: 0, bad: [], skipped: [`no ${path.relative(ROOT, file)}`] };
  const image = new Uint8Array(fs.readFileSync(file));
  const bad = [];
  let checks = 0, first = null;
  const eq = (what, got, want) => { checks++; if (got !== want) bad.push(`${what}: ${got} != ${want}`); };
  // each tier from reset to the stop
  for (const tier of ['reference', 'cached']) {
    const r = smoke(image, 5e6, { tier });
    first ??= r;
    eq(`${tier} tier: instructions before the first unmodelled access`, r.insns, SMOKE.insns);
    eq(`${tier} tier: the stopping address`, r.stop ? hex(r.stop.addr) : 'none', hex(SMOKE.addr));
    eq(`${tier} tier: the stopping pc`, hex(r.pc), hex(SMOKE.pc));
    eq(`${tier} tier: exceptions taken`, JSON.stringify(r.exceptions), JSON.stringify(SMOKE.exceptions));
  }
  // the two tiers in lockstep to the stop: the state after every step, SRAM at the end
  {
    const a = scpuMachine(image, { tier: 'reference' }), b = scpuMachine(image, { tier: 'cached' });
    let d = null;
    for (let k = 0; k < SMOKE.insns + 1000; k++) {
      const ra = tryStep(a.cpu), rb = tryStep(b.cpu);
      const diff = stateDiff(a.cpu, b.cpu);
      if (ra !== rb) diff.push(`step result ${ra} != ${rb}`);
      if (diff.length) { d = `step ${k}: ${diff.slice(0, 3).join('; ')}`; break; }
      if (ra !== String(STEP_OK) && ra !== String(STEP_SLEEP)) break;
    }
    eq('the image\'s start in lockstep', d, null);
    eq('the lockstep reached the stop', a.cpu.insns, SMOKE.insns);
    const sa = a.bus.find(SRAM).bytes, sb = b.bus.find(SRAM).bytes;
    eq('SRAM the same on both tiers at the stop (the first differing byte)', sa.findIndex((v, i) => v !== sb[i]), -1);
    checks++;
    if (b.cpu.dc.fills >= b.cpu.insns) bad.push(`the cached tier decoded ${b.cpu.dc.fills} times for ${b.cpu.insns} instructions`);
  }
  // the STM32L4 machine: the prompt at the same cycle on both tiers, then help
  const runs = {};
  for (const tier of ['reference', 'cached']) {
    const m = new Stm32l4(image);
    m.cpu.setTier(tier);
    const r = m.boot();
    eq(`${tier} tier: boot to the prompt`, r.reason, 'until');
    eq(`${tier} tier: the cycle of the first prompt`, m.cpu.cycles, BOOT.promptCycles);
    m.run({ seconds: 0.5 });
    const h = m.command('help');
    eq(`${tier} tier: help answered`, h.reason, 'until');
    runs[tier] = { cycles: m.cpu.cycles, insns: m.cpu.insns, text: m.consoleText() };
  }
  eq('the cycle after help on both tiers', runs.cached.cycles, runs.reference.cycles);
  eq('the instructions after help on both tiers', runs.cached.insns, runs.reference.insns);
  eq('the console\'s text the same on both tiers', runs.cached.text === runs.reference.text, true);
  return { checks, bad, skipped: [], r: first };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = m4Units(), v = m4Vectors(), f = m4Firmware();
  console.log(`Cortex-M4 units ${u.checks - u.bad.length}/${u.checks}; QEMU vectors ${v.checks - v.bad.length}/${v.checks}; firmware ${f.skipped.length ? 'SKIPPED' : `${f.checks - f.bad.length}/${f.checks}`}`);
  [...u.bad, ...v.bad.slice(0, 20), ...f.bad, ...f.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  process.exit(u.bad.length + v.bad.length + f.bad.length ? 1 : 0);
}
