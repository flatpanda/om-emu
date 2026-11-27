// Unit tests for non-mutating breakpoint and watchpoint inspection in Debugger and Protocol.
// Firmware-free standalone test:
//   node emu/test/test_debug_inspect.mjs
import { createHash } from 'node:crypto';
import { Debugger } from '../src/debug/debugger.mjs';
import { Protocol } from '../src/debug/protocol.mjs';

const BLANK = new Uint8Array(0x1000);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function debugInspectUnits() {
  const bad = [];
  let checks = 0;
  const ok = (what, cond, detail = '') => { checks++; if (!cond) bad.push(`${what}${detail ? ` (${detail})` : ''}`); };

  // ---- 1. Direct Debugger inspection
  const d = Debugger.create({ rom: BLANK, createHash });
  try {
    // Initial empty state
    ok('Debugger initial getBreakpoints() is []', same(d.getBreakpoints(), []), JSON.stringify(d.getBreakpoints()));
    ok('Debugger initial getWatchpoints() is []', same(d.getWatchpoints(), []), JSON.stringify(d.getWatchpoints()));

    // Breakpoints: sorted numeric order, deduplication, non-mutation
    d.breakpoints([0xa3000010, 0x50000004, 0x00008000, 0xa3000010]);
    const bps1 = d.getBreakpoints();
    ok('Debugger getBreakpoints() returns sorted unique u32 PCs', same(bps1, [0x00008000, 0x50000004, 0xa3000010]), JSON.stringify(bps1));

    // Mutating returned array does not mutate Debugger state
    bps1.push(0x12345678);
    bps1[0] = 0xdeadbeef;
    ok('Debugger getBreakpoints() returns a defensive copy', same(d.getBreakpoints(), [0x00008000, 0x50000004, 0xa3000010]), JSON.stringify(d.getBreakpoints()));

    // Verify armed breakpoint still triggers after inspection
    // nop; nop; nop at 0xa3000000
    d.write(0xa3000000, Uint8Array.from([0xcb, 0xcb, 0xcb]));
    d.reset({ pc: 0xa3000000 });
    d.breakpoints([0xa3000002]);
    ok('Debugger getBreakpoints() reflects updated breakpoint', same(d.getBreakpoints(), [0xa3000002]));
    const stopBp = d.cont({ budget: 10 });
    ok('Debugger breakpoint still stops after getBreakpoints()', stopBp.stop === 'break' && stopBp.regs.pc === 0xa3000002, JSON.stringify(stopBp));

    // Updating via cont({ stops }) updates getBreakpoints()
    d.reset({ pc: 0xa3000000 });
    d.cont({ stops: [0xa3000001], budget: 10 });
    ok('Debugger getBreakpoints() reflects cont({ stops })', same(d.getBreakpoints(), [0xa3000001]), JSON.stringify(d.getBreakpoints()));

    // Clearing breakpoints
    d.breakpoints([]);
    ok('Debugger getBreakpoints() is [] after clear', same(d.getBreakpoints(), []));

    // Watchpoints: setting, inspecting, non-mutation, round-trip, updating, clearing
    d.watch([
      { id: 'w0', lo: 0xa2100000, len: 4, kind: 'w', action: 'stop' },
      { lo: 0xa2100010, hi: 0xa2100018, kind: 'r', action: 'log' },
      { id: 'acc', lo: 0xa2100020, len: 2, kind: 'a' },
    ]);
    const wantWs = [
      { id: 'w0', lo: 0xa2100000, hi: 0xa2100004, len: 4, kind: 'w', action: 'stop' },
      { id: 1, lo: 0xa2100010, hi: 0xa2100018, len: 8, kind: 'r', action: 'log' },
      { id: 'acc', lo: 0xa2100020, hi: 0xa2100022, len: 2, kind: 'rw', action: 'stop' },
    ];
    const ws1 = d.getWatchpoints();
    ok('Debugger getWatchpoints() returns armed watchpoint descriptors', same(ws1, wantWs), JSON.stringify(ws1));

    // Mutating returned array and descriptor does not mutate Debugger state
    ws1[0].lo = 0;
    ws1[0].kind = 'r';
    ws1.push({ id: 'bogus', lo: 0, hi: 1, len: 1, kind: 'w', action: 'log' });
    ok('Debugger getWatchpoints() returns defensive copies', same(d.getWatchpoints(), wantWs), JSON.stringify(d.getWatchpoints()));

    // Round-trip into watch()
    d.watch(d.getWatchpoints());
    ok('Debugger getWatchpoints() round-trips cleanly through watch()', same(d.getWatchpoints(), wantWs), JSON.stringify(d.getWatchpoints()));

    // Verify armed watchpoint still triggers after inspection
    // mov d0,(a0); nop at 0xa3000000
    d.write(0xa3000000, Uint8Array.from([0x60, 0xcb]));
    d.reset({ pc: 0xa3000000, d0: 0x42, a0: 0xa2100000 });
    const stopWp = d.cont({ budget: 10 });
    ok('Debugger watchpoint still stops after getWatchpoints()', stopWp.stop === 'watch' && stopWp.watch?.id === 'w0', JSON.stringify(stopWp));

    // Updating and clearing watchpoints
    d.watch([{ id: 'only', lo: 0xa2100040, len: 1 }]);
    ok('Debugger getWatchpoints() reflects update', same(d.getWatchpoints(), [{ id: 'only', lo: 0xa2100040, hi: 0xa2100041, len: 1, kind: 'w', action: 'stop' }]));
    d.watch([]);
    ok('Debugger getWatchpoints() is [] after clear', same(d.getWatchpoints(), []));
  } finally {
    d.close();
  }

  // ---- 2. Protocol inspection ops
  const P = new Protocol({ env: { createHash }, defaultImage: 'blank', loadImage: () => BLANK, disasm: null });
  const ask = (q) => P.handle(q);

  // Refused before load
  const preBp = ask({ id: 1, op: 'breakpoints' });
  ok('Protocol breakpoints before load fails with BadRequest', !preBp.ok && preBp.id === 1 && preBp.error?.type === 'BadRequest', JSON.stringify(preBp));
  const preWp = ask({ id: 2, op: 'watchpoints' });
  ok('Protocol watchpoints before load fails with BadRequest', !preWp.ok && preWp.id === 2 && preWp.error?.type === 'BadRequest', JSON.stringify(preWp));

  // Load machine
  const loaded = ask({ id: 3, op: 'load' });
  ok('Protocol load succeeds', loaded.ok, JSON.stringify(loaded));

  // Empty after load
  const emptyBp = ask({ id: 4, op: 'breakpoints' });
  ok('Protocol breakpoints after load is []', emptyBp.ok && same(emptyBp.pcs, []), JSON.stringify(emptyBp));
  const emptyWp = ask({ id: 5, op: 'watchpoints' });
  ok('Protocol watchpoints after load is []', emptyWp.ok && same(emptyWp.list, []), JSON.stringify(emptyWp));

  // Set, inspect, verify non-mutation, update, clear breakpoints
  ask({ op: 'break', pcs: ['0xa3000020', '0x50000004', '0xa3000010', '0x50000004'] });
  const protoBp1 = ask({ op: 'breakpoints' });
  const protoBp2 = ask({ op: 'breakpoints' });
  ok('Protocol breakpoints returns sorted hex8 PCs', protoBp1.ok && same(protoBp1.pcs, ['0x50000004', '0xa3000010', '0xa3000020']), JSON.stringify(protoBp1));
  ok('Protocol breakpoints is non-mutating across calls', protoBp2.ok && same(protoBp2.pcs, protoBp1.pcs), JSON.stringify(protoBp2));

  // Update via break, then clear
  ask({ op: 'break', pcs: ['0xa3000002'] });
  ok('Protocol breakpoints reflects update', same(ask({ op: 'breakpoints' }).pcs, ['0xa3000002']));
  ask({ op: 'break', pcs: [] });
  ok('Protocol breakpoints is [] after clear', same(ask({ op: 'breakpoints' }).pcs, []));

  // Set, inspect, round-trip, update, clear watchpoints
  const setW = ask({
    op: 'watch',
    list: [
      { id: 'r1', addr: '0xa2100000', len: 4, kind: 'r', action: 'log' },
      { lo: '0xa2100010', hi: '0xa2100018', kind: 'rw', action: 'stop' },
    ],
  });
  ok('Protocol watch succeeds', setW.ok && setW.count === 2, JSON.stringify(setW));
  const wantProtoWs = [
    { id: 'r1', addr: '0xa2100000', len: 4, kind: 'r', action: 'log' },
    { id: 1, addr: '0xa2100010', len: 8, kind: 'rw', action: 'stop' },
  ];
  const protoWp1 = ask({ op: 'watchpoints' });
  const protoWp2 = ask({ op: 'watchpoints' });
  ok('Protocol watchpoints returns formatted list matching watch schema', protoWp1.ok && same(protoWp1.list, wantProtoWs), JSON.stringify(protoWp1));
  ok('Protocol watchpoints is non-mutating across calls', protoWp2.ok && same(protoWp2.list, wantProtoWs), JSON.stringify(protoWp2));

  // Round-trip Protocol watchpoints output back into watch
  const rtW = ask({ op: 'watch', list: protoWp1.list });
  ok('Protocol watchpoints output round-trips into watch', rtW.ok && same(ask({ op: 'watchpoints' }).list, wantProtoWs), JSON.stringify(rtW));

  // Allowed while paused (read-only)
  ask({ op: 'write', addr: '0xa3000000', hex: 'cbcbcb' });
  ask({ op: 'reset', regs: { pc: '0xa3000000' } });
  ask({ op: 'break', pcs: ['0xa3000010'] });
  const paused = ask({ op: 'cont', budget: 1 });
  ok('Protocol cont pauses on budget', paused.ok && paused.stop === 'paused', JSON.stringify(paused));
  ok('Protocol breakpoints allowed while paused', same(ask({ op: 'breakpoints' }).pcs, ['0xa3000010']));
  ok('Protocol watchpoints allowed while paused', same(ask({ op: 'watchpoints' }).list, wantProtoWs));
  ask({ op: 'halt' });

  // Clear watchpoints
  ask({ op: 'watch', list: [] });
  ok('Protocol watchpoints is [] after clear', same(ask({ op: 'watchpoints' }).list, []));

  // Refused after quit
  ask({ op: 'quit' });
  const postBp = ask({ op: 'breakpoints' });
  const postWp = ask({ op: 'watchpoints' });
  ok('Protocol breakpoints after quit fails with BadRequest', !postBp.ok && postBp.error?.type === 'BadRequest', JSON.stringify(postBp));
  ok('Protocol watchpoints after quit fails with BadRequest', !postWp.ok && postWp.error?.type === 'BadRequest', JSON.stringify(postWp));

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad } = debugInspectUnits();
  if (bad.length) {
    console.error(`test_debug_inspect: FAIL (${bad.length}/${checks}):\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`test_debug_inspect: PASS (${checks} checks)`);
}
