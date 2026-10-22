// The kick model's TB-layout refusals (gate modes 1 and 2, src/core/interp.mjs refusals a..e), unsliced and in
// continue slices of 1 and 3, and their permanent control NC-REF-e (refusal e removed in a copy of src/).
//   node emu/test/test_irq.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const IMAGE = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');

// The five TB-layout refusals of the kick model (interp.mjs, refusal e): JS-only expectations of the Unported text, unsliced and
// in slices of 1 and 3.
export async function kickRefusals(src = path.join(REPO, 'emu/src')) {
  const S = await import(path.join(src, 'lab/sim.mjs')), I = await import(path.join(src, 'lab/irq.mjs'));
  const rom = new Uint8Array(fs.readFileSync(IMAGE)), bad = [];
  const le = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const level = 0x99200000 + 4 * 210, store = [0xfc, 0xdc, ...le(level), 0xfc, 0xce, ...le(1 << 5), 0x68];
  const remap = [0xfc, 0xdc, ...le(0x98100058), 0xfc, 0xce, ...le(0x14161514), 0x68];   // the window to segment 0x14
  const run = ({ gate, gatePc = 0, pre = false, code, at = 0x1000, insns = 0, stops = [], builtins = [] }, slice) => {
    const sim = new S.Simulator({ rom, createHash, ...(slice ? { slice } : {}) }, 200);
    sim.write(0x8000 + 4 * 5, new Uint8Array([0xf0, 0xf0]));
    const intc = new I.IntcDebug(sim);
    intc.set_gate(gate, gatePc);
    intc.set_test(new Map([[210, 1]]));
    if (pre) I.cpu_store(sim, level, 1 << 5);
    sim.write(at, new Uint8Array(code));
    sim.reset({ pc: at, sp: 0x20100, psw: 0x0F00, insns });
    try { const r = sim.run(stops, false, null, builtins); return `stop pc 0x${r.pc.toString(16)} fault ${r.fault}`; } catch (e) {
      // a refusal is thrown at an instruction boundary: the machine stays runnable (machine.mjs TbUndecidable)
      if (/\(refusal [a-e]\)/.test(e.message)) {
        const m = sim.m, stop = m.lastStop();
        let stepped = '';
        try { m.step(); } catch (e2) { stepped = `, step threw ${e2.name}`; }
        if (m.failed() !== null || stop?.kind !== 'undecidable' || stepped) bad.push(`refusal ${e.message.match(/\(refusal ([a-e])\)/)[1]}${slice ? ` (slices of ${slice})` : ''}: the machine after it: failed ${m.failed()?.name ?? null}, lastStop ${stop?.kind}${stepped}`);
      }
      return `${e.name}: ${e.message}`;
    }
  };
  const cases = [
    // (a) insns 150 of 200 (the near-limit zone): the store raises the request, a breakpoint follows
    ['a', { gate: 2, code: [0x40, ...store, 0x40, 0xff], insns: 150, stops: [0x1000 + 1 + 13] }, /refusal a\)/],
    // (b) gate mode 1, the request pending, the near-limit zone's visit after the first inc is at the gate pc
    ['b', { gate: 1, gatePc: 0x1001, pre: true, code: [0x40, 0x40, 0xff], insns: 150 }, /refusal b\)/],
    // (c) gate mode 1, the request pending, a bra lands on the gate pc (not a breakpoint)
    ['c', { gate: 1, gatePc: 0x1006, pre: true, code: [0x40, 0xca, 0x05, 0xcb, 0xcb, 0xcb, 0x40, 0xff] }, /refusal c\)/],
    // (c) on a page start reached sequentially
    ['c-page', { gate: 1, gatePc: 0x2000, pre: true, at: 0x1ffe, code: [0x40, 0x40, 0x40, 0xff] }, /refusal c\)/],
    // (c) not refused: a sequential arrival mid-page (the TB runs through, no look point)
    ['c-seq', { gate: 1, gatePc: 0x1002, pre: true, code: [0x40, 0x40, 0x40, 0xff] }, /^stop pc 0x1003 fault 5$/],
    // the same after a prefix form (mov imm32,d0: the predecessor's length from its two opcode bytes)
    ['c-seq-prefix', { gate: 1, gatePc: 0x1006, pre: true, code: [0xfc, 0xcc, 1, 2, 3, 4, 0x40, 0xff] }, /^stop pc 0x1007 fault 5$/],
    // a bra onto the gate pc with no request pending: nothing to refuse
    ['c-quiet', { gate: 1, gatePc: 0x1006, code: [0x40, 0xca, 0x05, 0xcb, 0xcb, 0xcb, 0x40, 0xff] }, /^stop pc 0x1007 fault 5$/],
    // (d) the store raises the request right before a PERF2 builtin pc (a breakpoint on JS)
    ['d', { gate: 2, code: [0x40, ...store, 0x40, 0xff], stops: [0x1000 + 1 + 13], builtins: [0x1000 + 1 + 13] }, /refusal d\)/],
    // the same breakpoint, not a builtin pc: a plain stop without a look (bp-next)
    ['d-plain', { gate: 2, code: [0x40, ...store, 0x40, 0xff], stops: [0x1000 + 1 + 13] }, /^stop pc 0x100e fault 0$/],
    // (e) gate mode 1, the request pending: a bus window remap right before a breakpoint at the gate pc
    ['e', { gate: 1, gatePc: 0x100e, pre: true, code: [0x40, ...remap, 0x40, 0xff], stops: [0x100e] }, /refusal e\)/],
  ];
  let n = 0;
  for (const [id, c, want] of cases) {
    for (const slice of [null, 1, 3]) {
      n++;
      const got = run(c, slice);
      if (!want.test(got)) bad.push(`refusal ${id}${slice ? ` (slices of ${slice})` : ''}: ${got}, want ${want}`);
    }
  }
  return { cases: n, bad };
}

// NC-REF-e: refusal e removed, in a copy of src/ (out/test-irq/nc-ref-e), must fail its expectation
export async function refusalControl() {
  const root = path.join(REPO, 'emu/out/test-irq'), bad = [];
  fs.rmSync(root, { recursive: true, force: true });
  const d = path.join(root, 'nc-ref-e', 'src');
  fs.cpSync(path.join(REPO, 'emu/src'), d, { recursive: true });
  const f = path.join(d, 'core/interp.mjs'), t = fs.readFileSync(f, 'utf8');
  const from = '    if (isBP(pc) && S.irqReq && S.intc.admitted(pc, false)) refuse(';
  if (t.split(from).length !== 2) throw new Error('control nc-ref-e: core/interp.mjs does not hold the text once');
  fs.writeFileSync(f, t.replace(from, '    if (false) refuse('));
  try {
    const re = await kickRefusals(d);
    if (!re.bad.some((x) => x.startsWith('refusal e'))) bad.push('NC-REF-e (refusal e removed) not caught');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  return { checks: 1, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await kickRefusals(), c = await refusalControl();
  console.log(`TB-layout refusals ${f.cases - f.bad.length}/${f.cases}; NC-REF-e ${c.checks - c.bad.length}/${c.checks}`);
  [...f.bad, ...c.bad].forEach((x) => console.log('  ', x));
  process.exit(f.bad.length || c.bad.length ? 1 : 0);
}
