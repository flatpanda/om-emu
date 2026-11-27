// Memory snapshot/restore units (src/core/mem.mjs, F25), firmware-free:
//   memSnapshotUnits   read-only K_ROM pages are excluded from memSnapshotBytes; dirty RAM pages are captured and
//                      restored across multiple detours; mutating a K_ROM page via dbgWrite after a snapshot still
//                      restores its original ROM bytes cleanly; mutating a K_ROM page via dbgWrite before a snapshot
//                      captures the modified page while still excluding unmutated ROM pages; initMemory resets all
//                      ROM/dirty tracking cleanly.
//   node emu/test/test_mem_snapshot.mjs
import * as mem from '../src/core/mem.mjs';

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

export function memSnapshotUnits() {
  const t = tester(), { ok } = t;
  const { initMemory, addRegion, markDirty, ld8, ld32, st32, dbgRead, dbgWrite,
    memSnapshot, memRestore, memSnapshotBytes, K_RAM, K_ROM, ROM_OFF, ROM_SIZE, DRAM_OFF } = mem;

  const PAGE = 0x10000;
  const ROM_BASE = 0x50000000;
  const RAM_BASE = 0x60000000;
  const ROM_PAGES = 16; // 1 MiB of loaded ROM

  initMemory(16 << 20);
  addRegion({ base: ROM_BASE, size: ROM_SIZE, kind: K_ROM, off: ROM_OFF, name: 'test.rom' });
  addRegion({ base: RAM_BASE, size: 16 << 20, kind: K_RAM, off: DRAM_OFF, name: 'test.ram' });

  // Populate 16 pages of K_ROM directly (matching machine.mjs initial ROM load)
  const romBytes = new Uint8Array(ROM_PAGES * PAGE);
  for (let p = 0; p < ROM_PAGES; p++) {
    romBytes[p * PAGE] = 0xA0 + p;
    romBytes[p * PAGE + 0x100] = 0x11 + p;
    romBytes[p * PAGE + 0xfffc] = 0xC0 + p;
  }
  mem.U8.set(romBytes, ROM_OFF);
  markDirty(ROM_OFF, romBytes.length);

  // 1. Unmutated ROM pages are excluded from memSnapshotBytes
  const sRomOnly = memSnapshot();
  ok(memSnapshotBytes(sRomOnly) === 0, `ROM-only snapshot copies 0 bytes (got ${memSnapshotBytes(sRomOnly)})`);

  // 2. Dirty RAM pages are included and restored across multiple detours
  st32(RAM_BASE + 0x10, 0x12345678);
  st32(RAM_BASE + PAGE + 0x20, 0x9abcdef0);
  const s0 = memSnapshot();
  ok(memSnapshotBytes(s0) === 2 * PAGE, `snapshot with 2 dirty RAM pages + ${ROM_PAGES} clean ROM pages copies 2 pages (got ${memSnapshotBytes(s0)})`);

  // Detour 1: overwrite existing RAM and dirty a brand-new RAM page
  st32(RAM_BASE + 0x10, 0xdeadbeef);
  st32(RAM_BASE + 3 * PAGE + 0x40, 0xfeedface);
  memRestore(s0);
  ok((ld32(RAM_BASE + 0x10) >>> 0) === 0x12345678 && (ld32(RAM_BASE + PAGE + 0x20) >>> 0) === 0x9abcdef0,
    'detour 1 restore brings back original RAM words');
  ok((ld32(RAM_BASE + 3 * PAGE + 0x40) >>> 0) === 0,
    'detour 1 restore zeroes RAM page dirtied after snapshot');

  // Detour 2: mutate different RAM pages and restore again
  st32(RAM_BASE + PAGE + 0x20, 0x55555555);
  st32(RAM_BASE + 5 * PAGE + 0x80, 0xcafebabe);
  memRestore(s0);
  ok((ld32(RAM_BASE + PAGE + 0x20) >>> 0) === 0x9abcdef0 && (ld32(RAM_BASE + 5 * PAGE + 0x80) >>> 0) === 0,
    'detour 2 restore brings back original RAM and zeroes newly dirtied page');

  // 3. Mutating a ROM page via dbgWrite AFTER snapshot restores original ROM bytes cleanly
  const romAddr2 = ROM_BASE + 2 * PAGE + 0x100;
  ok(ld8(romAddr2) === 0x13, `original ROM byte at page 2 is 0x13 (got ${ld8(romAddr2)})`);
  dbgWrite(romAddr2, Uint8Array.from([0xee, 0xdd, 0xcc, 0xbb]));
  ok(ld8(romAddr2) === 0xee && ld8(romAddr2 + 3) === 0xbb, 'dbgWrite mutated ROM page 2 after snapshot');
  // Also mutate an unloaded (zero) tail ROM page via dbgWrite after snapshot
  const romTailAddr = ROM_BASE + (ROM_PAGES + 2) * PAGE + 0x40;
  dbgWrite(romTailAddr, Uint8Array.from([0x77, 0x88]));
  ok(ld8(romTailAddr) === 0x77, 'dbgWrite mutated unloaded tail ROM page after snapshot');

  memRestore(s0);
  ok(ld8(romAddr2) === 0x13 && ld8(romAddr2 + 1) === 0 && ld8(romAddr2 + 3) === 0,
    `restore after post-snapshot ROM dbgWrite restores original ROM bytes (got ${Array.from(dbgRead(romAddr2, 4))})`);
  ok(ld8(ROM_BASE + 2 * PAGE) === 0xA2 && ld8(ROM_BASE + 2 * PAGE + 0xfffc) === 0xC2,
    'restored ROM page 2 keeps all its original bytes across the 64 KiB page');
  ok(ld8(romTailAddr) === 0 && ld8(romTailAddr + 1) === 0,
    'restore zeroes unloaded tail ROM page dirtied after snapshot');

  // Taking a new snapshot after restoring clean ROM excludes page 2 again
  const sAfterRestore = memSnapshot();
  ok(memSnapshotBytes(sAfterRestore) === 2 * PAGE,
    `snapshot after restoring clean ROM excludes ROM page again (got ${memSnapshotBytes(sAfterRestore)})`);

  // Second ROM detour on the same page still restores original bytes cleanly
  dbgWrite(romAddr2, Uint8Array.from([0x99]));
  ok(ld8(romAddr2) === 0x99, 'second dbgWrite detour on ROM page 2');
  memRestore(s0);
  ok(ld8(romAddr2) === 0x13, 'second restore on ROM page 2 brings back original byte');

  // 4. Mutating a ROM page BEFORE snapshot captures the modified page (and excludes unmutated ROM pages)
  const romAddr5 = ROM_BASE + 5 * PAGE + 0x100;
  ok(ld8(romAddr5) === 0x16, `original ROM byte at page 5 is 0x16 (got ${ld8(romAddr5)})`);
  dbgWrite(romAddr5, Uint8Array.from([0x42, 0x43]));
  const sPatched = memSnapshot();
  ok(memSnapshotBytes(sPatched) === 3 * PAGE,
    `snapshot with 2 RAM pages + 1 pre-mutated ROM page copies 3 pages, not ${2 + ROM_PAGES} (got ${memSnapshotBytes(sPatched)})`);

  // Mutate page 5 again after sPatched, then restore sPatched -> gets 0x42, 0x43
  dbgWrite(romAddr5, Uint8Array.from([0xaa, 0xbb]));
  ok(ld8(romAddr5) === 0xaa, 'post-sPatched dbgWrite overwrote ROM page 5');
  memRestore(sPatched);
  ok(ld8(romAddr5) === 0x42 && ld8(romAddr5 + 1) === 0x43,
    `restore sPatched brings back pre-snapshot modified ROM bytes (got ${Array.from(dbgRead(romAddr5, 2))})`);

  // Restoring earlier s0 (taken before page 5 was mutated) brings back original 0x16, 0x00
  memRestore(s0);
  ok(ld8(romAddr5) === 0x16 && ld8(romAddr5 + 1) === 0,
    `restore earlier s0 brings back original unpatched ROM bytes (got ${Array.from(dbgRead(romAddr5, 2))})`);

  // And restoring sPatched again after s0 brings back 0x42, 0x43!
  memRestore(sPatched);
  ok(ld8(romAddr5) === 0x42 && ld8(romAddr5 + 1) === 0x43,
    'restore sPatched again after s0 brings back modified ROM bytes');

  // 5. initMemory resets ROM pages and tracking cleanly for a new machine
  initMemory(16 << 20);
  addRegion({ base: ROM_BASE, size: ROM_SIZE, kind: K_ROM, off: ROM_OFF, name: 'test.rom2' });
  ok(ld8(romAddr2) === 0 && ld8(romAddr5) === 0 && ld8(ROM_BASE) === 0,
    'initMemory zeroes previously loaded/mutated ROM pages');
  const sFresh = memSnapshot();
  ok(memSnapshotBytes(sFresh) === 0, `fresh machine snapshot copies 0 bytes (got ${memSnapshotBytes(sFresh)})`);

  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = memSnapshotUnits();
  console.log(`memory snapshot units: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
