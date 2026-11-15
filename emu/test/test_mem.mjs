// The memory map's rules at addRegion (src/core/mem.mjs), firmware-free:
//   memUnits   a RAM-like region whose physical offset is not its base's modulo 4, one outside the machine's physical
//              space and one that overlaps a mapped region are each a RangeError, and nothing of the refused region is
//              mapped; the regions the rules allow keep working (an offset that differs from the base modulo 64 KiB but
//              not modulo 4, with its bytes and words agreeing; two views of one physical range; a device region inside
//              a page next to another; a page remapPages cleared). Controls: the same three regions without the fault
//              are accepted, and the machine's own map (a blank image, with the hdmi, audio and cores options) builds.
//   node emu/test/test_mem.mjs
import * as mem from '../src/core/mem.mjs';

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

export async function memUnits() {
  const t = tester(), { ok } = t;
  const { initMemory, addRegion, remapPages, findRegion, K_RAM, K_ROMD, K_MMIO, DRAM_OFF, ld8, ld16, ld32, st8, st32 } = mem;
  const dev = { read: () => 0, write: () => {} };
  initMemory(64 << 20);
  const A = 0x10000000, B = 0x20000000, C = 0x30000000;
  const refused = (r, re, what) => {
    const e = thrown(() => addRegion(r));
    ok(e instanceof RangeError && re.test(e.message), `${what}: ${e ? `${e.name}: ${e.message}` : 'accepted'}`);
    ok(findRegion(r.base) === null && mem.RP[r.base >>> 16] === -1, `${what}: nothing of the refused region is mapped`);
  };

  // 1. the offset and the base modulo 4
  for (const d of [1, 2, 3]) refused({ base: A, size: 0x20000, kind: K_RAM, off: DRAM_OFF + d, name: 'lab-test-odd' }, /lab-test-odd at 0x10000000\+0x20000: the physical offset \d+ is not the base's modulo 4/, `offset base + ${d}`);
  refused({ base: A + 2, size: 0x100, kind: K_ROMD, off: DRAM_OFF, name: 'lab-test-odd-base', dev: { romdWrite() {} } }, /not the base's modulo 4/, 'a base 2 past its offset, a ROM device');
  refused({ base: A, size: 0x100, kind: K_RAM, name: 'lab-test-no-off' }, /the physical offset undefined is not/, 'a RAM region without an offset');
  // allowed: an offset that is not the base's modulo 64 KiB (a region inside a page), bytes and words agreeing
  addRegion({ base: A + 0x104, size: 0x1000, kind: K_RAM, off: DRAM_OFF + 0x30008, name: 'lab-test-inner' });
  st32(A + 0x108, 0x11223344); st8(A + 0x10c, 0x5a);
  ok((ld32(A + 0x108) >>> 0) === 0x11223344 && [0, 1, 2, 3].map((k) => ld8(A + 0x108 + k)).join() === '68,51,34,17' && ld16(A + 0x10a) === 0x1122 && ld8(A + 0x10c) === 0x5a && mem.U8[DRAM_OFF + 0x3000c] === 0x44,
    `an inner region 4-aligned to its offset: the word, its bytes and its halfword agree (${(ld32(A + 0x108) >>> 0).toString(16)}, ${[0, 1, 2, 3].map((k) => ld8(A + 0x108 + k))})`);

  // 2. the machine's physical space
  refused({ base: B, size: 0x20000, kind: K_RAM, off: mem.TOTAL - 0x10000, name: 'lab-test-past' }, /lab-test-past at 0x20000000\+0x20000: the physical range \d+\+131072 is outside the machine's \d+ bytes/, 'a region ending past TOTAL');
  refused({ base: B, size: 0x10000, kind: K_RAM, off: mem.BUF_SIZE, name: 'lab-test-beyond' }, /outside the machine's/, 'a region past the buffer');
  refused({ base: B, size: 0x10000, kind: K_RAM, off: -0x10000, name: 'lab-test-neg' }, /outside the machine's/, 'a negative offset');
  addRegion({ base: B, size: 0x10000, kind: K_RAM, off: mem.TOTAL - 0x10000, name: 'lab-test-last' });
  st32(B + 0xfffc, 0x0badcafe);
  ok((ld32(B + 0xfffc) >>> 0) === 0x0badcafe, 'control: the last 64 KiB of the physical space is a region and holds a word');

  // 3. overlaps
  addRegion({ base: C, size: 0x20000, kind: K_RAM, off: DRAM_OFF + 0x100000, name: 'lab-test-a' });
  for (const [base, size, what] of [[C + 0x10000, 0x20000, 'the tail of'], [C - 0x10000, 0x10004, 'four bytes into'], [C + 0x8000, 0x100, 'inside'], [C - 0x10000, 0x40000, 'around']]) {
    const e = thrown(() => addRegion({ base, size, kind: K_RAM, off: DRAM_OFF + 0x200000, name: 'lab-test-b' }));
    ok(e instanceof RangeError && /lab-test-b at 0x[0-9a-f]{8}\+0x[0-9a-f]+: overlaps lab-test-a at 0x30000000\+0x20000/.test(e.message), `a region ${what} another: ${e ? e.message : 'accepted'}`);
  }
  ok(findRegion(C - 0x10000) === null && findRegion(C + 0x20000) === null && findRegion(C + 0x10000).name === 'lab-test-a' && mem.RP[(C >>> 16) + 1] === DRAM_OFF + 0x110000, 'the refused overlaps mapped nothing: the pages around are free, the fast entry is the first region\'s');
  const e3 = thrown(() => addRegion({ base: C + 0x1fffc, size: 4, kind: K_MMIO, name: 'lab-test-dev', dev }));
  ok(e3 instanceof RangeError && /lab-test-dev .* overlaps lab-test-a/.test(e3.message), `a device register inside a RAM region: ${e3 ? e3.message : 'accepted'}`);
  // allowed: adjacent regions, two device regions in one page, a second view of the same physical range, a remapped page
  ok(thrown(() => {
    addRegion({ base: C + 0x20000, size: 0x10000, kind: K_RAM, off: DRAM_OFF + 0x200000, name: 'lab-test-next' });
    addRegion({ base: C + 0x40000, size: 0x100, kind: K_MMIO, name: 'lab-test-dev0', dev });
    addRegion({ base: C + 0x40100, size: 4, kind: K_MMIO, name: 'lab-test-dev1', dev });
    addRegion({ base: C + 0x100000, size: 0x20000, kind: K_RAM, off: DRAM_OFF + 0x100000, name: 'lab-test-a-view' });
  }) === null, 'control: an adjacent region, two device regions in one page and a second view of one physical range are accepted');
  st32(C + 0x100010, 0x600df00d);
  ok((ld32(C + 0x10) >>> 0) === 0x600df00d, 'the two views show one word');
  ok(thrown(() => remapPages(C, 0x20000, [{ base: C, size: 0x20000, kind: K_RAM, off: DRAM_OFF + 0x300000, name: 'lab-test-remap' }])) === null && findRegion(C).name === 'lab-test-remap', 'control: remapPages replaces the pages it clears');
  const e4 = thrown(() => remapPages(C, 0x20000, [{ base: C, size: 0x30000, kind: K_RAM, off: DRAM_OFF + 0x300000, name: 'lab-test-remap-long' }]));
  ok(e4 instanceof RangeError && /overlaps lab-test-next/.test(e4.message), `a remap region longer than the pages cleared: ${e4 ? e4.message : 'accepted'}`);

  // the machine's own map under the rules: a blank image, each option that adds regions
  const { createMachine } = await import('../src/machine.mjs');
  const { BOARD, boardKnows } = await import('../src/fw/board.mjs');
  for (const [what, opts] of [['default', {}], ['hdmi', { hdmi: true }], ['audio', { audio: true }], ['cores', { cores: { second: 2 } }]]) {
    if (what === 'audio' && !boardKnows('audio')) continue;
    const e = thrown(() => createMachine({ rom: new Uint8Array(0x1000), dramBytes: BOARD.dram_size, ...opts }));
    ok(e === null, `the machine's map with ${what}: ${e ? `${e.name}: ${e.message}` : ''}`);
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await memUnits();
  console.log(`memory map rules: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
