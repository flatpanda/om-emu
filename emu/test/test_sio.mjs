// PER_SIO's served IIC transfers (src/lab/sio.mjs) and the TG-5's internal charger (src/lab/charger.mjs), without
// firmware:
//   sioUnits  iicSegments on the charger request's two transfers (the write [0x36, register, value]; the write-read
//             [0x36, register, 0x37] with a restart before byte 2 and a receive) and its refusals (a restart outside
//             the transfer or out of order, a read segment that is not last or carries data, a read without a kept
//             receive, a receive without a read segment); S-CHARGER's write and read-back, and its refusals (another
//             address or register, a read of a register not written, a read of two bytes, a read with no register
//             named)
//   node emu/test/test_sio.mjs
import { iicSegments, SioError } from '../src/lab/sio.mjs';
import { IntCharger, ChargerError, CHARGER_ADDRESS } from '../src/lab/charger.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e instanceof cls) return true; throw e; } };
const shape = (segs) => JSON.stringify(segs.map((s) => [s.addr, s.read, [...s.data]]));

export function sioUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const write = Uint8Array.of(0x36, 1, 0xa2), readBack = Uint8Array.of(0x36, 1, 0x37);
  ok(shape(iicSegments(write, [], false)) === JSON.stringify([[0x1b, false, [1, 0xa2]]]), 'the request\'s write is one write segment to 0x1b: register 1, value 0xa2');
  ok(shape(iicSegments(readBack, [2], true)) === JSON.stringify([[0x1b, false, [1]], [0x1b, true, []]]), 'the read-back: a write naming register 1, a restart, a read from 0x1b');
  ok(throwsAs(() => iicSegments(readBack, [3], true), SioError) && throwsAs(() => iicSegments(readBack, [0], true), SioError), 'a restart at the transfer\'s end or start is refused');
  ok(throwsAs(() => iicSegments(Uint8Array.of(0x36, 1, 0x36, 2, 0x37), [4, 2], true), SioError), 'restarts out of order are refused');
  ok(throwsAs(() => iicSegments(Uint8Array.of(0x37, 0x36, 1), [1], true), SioError), 'a read segment before the last is refused');
  ok(throwsAs(() => iicSegments(Uint8Array.of(0x36, 1, 0x37, 5), [2], true), SioError), 'a read segment carrying data is refused');
  ok(throwsAs(() => iicSegments(readBack, [2], false), SioError), 'a read segment without a kept receive is refused');
  ok(throwsAs(() => iicSegments(write, [], true), SioError), 'a kept receive and no read segment is refused');
  const c = new IntCharger();
  c.write(CHARGER_ADDRESS, Uint8Array.of(1, 0xa2));
  c.write(CHARGER_ADDRESS, Uint8Array.of(1));
  ok(JSON.stringify(c.read(CHARGER_ADDRESS, 1)) === '[162]', 'register 1 reads back the 0xa2 written');
  c.write(CHARGER_ADDRESS, Uint8Array.of(0, 8));
  c.write(CHARGER_ADDRESS, Uint8Array.of(0));
  ok(JSON.stringify(c.read(CHARGER_ADDRESS, 1)) === '[8]', 'register 0 reads back the 8 written');
  ok(throwsAs(() => c.read(CHARGER_ADDRESS, 1), ChargerError), 'a read with no register named is refused');
  c.write(CHARGER_ADDRESS, Uint8Array.of(2));
  ok(throwsAs(() => c.read(CHARGER_ADDRESS, 1), ChargerError), 'a read of register 2, never written, is refused (its value is ?)');
  ok(throwsAs(() => c.write(0x1c, Uint8Array.of(1, 2)), ChargerError) && throwsAs(() => c.read(0x1c, 1), ChargerError), 'another address is refused');
  ok(throwsAs(() => c.write(CHARGER_ADDRESS, Uint8Array.of(3, 1)), ChargerError) && throwsAs(() => c.write(CHARGER_ADDRESS, Uint8Array.of(1, 2, 3)), ChargerError), 'register 3 and a write of two values are refused');
  c.write(CHARGER_ADDRESS, Uint8Array.of(1));
  ok(throwsAs(() => c.read(CHARGER_ADDRESS, 2), ChargerError), 'a read of two bytes is refused');
  ok(JSON.stringify(c.status().regs) === JSON.stringify({ 0: 8, 1: 0xa2 }), 'the status keeps the registers written');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = sioUnits();
  console.log(`PER_SIO IIC and charger units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length ? 1 : 0);
}
