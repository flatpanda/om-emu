// The accelerometer stand-in's sample (src/lab/acc.mjs), without firmware:
//   accUnits  the body's reading of a tilt (level: 1 g up; roll and pitch: the x and z components the gauge's getter
//             reads back as -asin), the axis table's inverse (E143's {1, -2, 3}: sensor y = -body y) round-tripped
//             through the firmware's remap, a non-permutation and a sample past 16 bits refused, and A-ACC-2's range
//             (45 degrees either way, the body's y axis dominant) with its reasons
//   node emu/test/test_acc.mjs
import { bodyReading, sensorOf, bodyOf, tiltRefusal, AccError, TILT_MAX_DEG } from '../src/lab/acc.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e instanceof cls) return true; throw e; } };
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps);

export function accUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const AXES = [1, -2, 3], G = 16384;
  ok(near(bodyReading(0, 0, G), [-0, G, -0]), 'level: 1 g along the body\'s y axis');
  ok(JSON.stringify(sensorOf(bodyReading(0, 0, G), AXES)) === JSON.stringify([0, -G, 0]), 'level in the sensor\'s axes is the pose-0 reference (0, -16384, 0)');
  const r = bodyReading(10, 0, 1), p = bodyReading(0, 10, 1);
  ok(Math.abs(-Math.asin(r[0]) * 180 / Math.PI - 10) < 1e-9 && Math.abs(r[2]) < 1e-12, 'roll 10: -asin(x) is 10 degrees, z is 0');
  ok(Math.abs(-Math.asin(p[2]) * 180 / Math.PI - 10) < 1e-9 && Math.abs(p[0]) < 1e-12, 'pitch 10: -asin(z) is 10 degrees, x is 0');
  ok(Math.abs(Math.hypot(...bodyReading(-4.5, 7.5, 1)) - 1) < 1e-12, 'a tilt keeps the reading 1 g long');
  for (const [roll, pitch] of [[5, 0], [-3, 6], [2, -9]]) {
    const body = bodyReading(roll, pitch, G), s = sensorOf(body, AXES);
    ok(near(bodyOf(s, AXES), body, 0.5), `roll ${roll} pitch ${pitch}: the remap of the sample gives the body's reading back (within rounding)`);
  }
  ok(JSON.stringify(sensorOf([1, 2, 3], [3, -1, 2])) === JSON.stringify([-2, 3, 1]), 'another permutation with signs inverts');
  ok(throwsAs(() => sensorOf([0, G, 0], [1, 1, 3]), AccError), 'an axis table that is not a permutation is refused');
  ok(throwsAs(() => sensorOf([0, 40000, 0], AXES), AccError), 'a sample past 16 bits is refused');
  ok(tiltRefusal(0, 0) === null && tiltRefusal(TILT_MAX_DEG, 0) === null && tiltRefusal(-30, 30) === null, 'level, 45 degrees of roll and (-30, 30) are taken');
  ok(/A-ACC-2/.test(tiltRefusal(46, 0) ?? '') && /A-ACC-2/.test(tiltRefusal(0, -50) ?? ''), 'beyond 45 degrees is refused under A-ACC-2');
  ok(/dominant/.test(tiltRefusal(45, 45) ?? ''), '(45, 45): the body\'s y axis is not dominant, refused');
  ok(/numbers/.test(tiltRefusal(Number.NaN, 0) ?? ''), 'NaN is refused');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = accUnits();
  console.log(`accelerometer sample units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exitCode = u.bad.length ? 1 : 0;
}
