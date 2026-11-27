// The idle key image on every body (src/lab/play.mjs idle_images, TYPE2_KEYS): no type-2 entry of the body's UI_IN
// tables idles at its pressed level (bit = polarity), named by a control row or not (FIDELITY-NOTES 7.7; until
// 2026-11-22 an unnamed one kept bit 0, pressed at polarity 0: E122's 0x122b / 0x122c, E147's 0x120b); on E143 the
// static TYPE2_KEYS (CONTROLS and CODE0_KEYS) is its tables' set; the picture-function rows (picfn_left, picfn_right)
// and the Shortcut row (shortcut, 0x1224) are wired exactly on the bodies whose tables hold their codes as keys. No session runs: each body's main block, its
// tables read by uiin_layout, in a child process of its own (the model is fixed when the lab is imported).
//   keyIdleTests  every body of src/fw/ports.mjs PORTS and E143; a body whose unpacked block is missing is a failure
//   node emu/test/test_keyidle.mjs            (all bodies)
//   node emu/test/test_keyidle.mjs --body     (the body of OM_EMU_MODEL only; prints its failures, exit 1 on any)
import { spawnSync } from 'node:child_process';

const SELF = new URL(import.meta.url).pathname;

// one body, in this process: {checks, bad}
export async function bodyTests() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage } = await import('../checks/lib/env.mjs');
  const P = await import('../src/lab/play.mjs');
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  const key = (e) => e.join(',');
  const static0 = new Set(P.TYPE2_KEYS.map(key));
  const image = loadImage();
  const { groups } = P.uiin_layout(image);
  P.apply_uiin_layout(image);
  const imgs = P.idle_images();
  const type2 = groups.flatMap(({ entries }, g) => entries.filter((e) => e[3] === 2).map(([b, bit, code, , pol]) => ({ g, b, bit, code, pol })));
  for (const { g, b, bit, code, pol } of type2) {
    ok(((imgs[g][b] >> bit) & 1) !== pol, `0x${code.toString(16)} (group ${g} byte ${b} bit ${bit}, polarity ${pol}) idles pressed`);
  }
  ok(type2.length === P.TYPE2_KEYS.length, `TYPE2_KEYS holds ${P.TYPE2_KEYS.length} entries, the tables ${type2.length}`);
  if (ON_LAB_MODEL) {
    const tab = new Set(type2.map(({ g, b, bit, pol }) => key([g, b, bit, pol])));
    ok(tab.size === static0.size && [...tab].every((k) => static0.has(k)), `E143: the static TYPE2_KEYS (${[...static0].join(' ')}) is not its tables' (${[...tab].join(' ')})`);
  }
  for (const id of ['picfn_left', 'picfn_right', 'shortcut']) {
    const c = P.BY_ID.get(id), held = type2.find((e) => e.code === c.bodykey);
    ok(held ? c.status === 'wired' && c.uiin?.[3] === c.bodykey && c.uiin?.[4] === 2 : c.status === 'not-wired' && c.uiin === null,
      `${id}: status ${c.status}, uiin ${JSON.stringify(c.uiin)}; the tables ${held ? 'hold' : 'lack'} 0x${c.bodykey.toString(16)}`);
  }
  return { checks, bad };
}

// every body, each in a child: {checks, bad, bodies}
export async function keyIdleTests() {
  const { PORTS } = await import('../src/fw/ports.mjs');
  const bodies = ['E143', ...Object.keys(PORTS)];
  const bad = [];
  for (const m of bodies) {
    const r = spawnSync(process.execPath, [SELF, '--body'], { env: { ...process.env, OM_EMU_MODEL: m }, encoding: 'utf8' });
    if (r.status !== 0) bad.push(...(r.stdout + r.stderr).trim().split('\n').filter(Boolean).map((l) => `${m}: ${l.trim()}`));
  }
  return { checks: bodies.length, bad, bodies };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--body')) {
    const r = await bodyTests();
    r.bad.forEach((x) => console.log(x));
    process.exitCode = r.bad.length ? 1 : 0;
  } else {
    const r = await keyIdleTests();
    console.log(`idle key image: ${r.checks - new Set(r.bad.map((x) => x.split(':')[0])).size}/${r.checks} bodies`);
    r.bad.forEach((x) => console.log('  ', x));
    process.exitCode = r.bad.length ? 1 : 0;
  }
}
