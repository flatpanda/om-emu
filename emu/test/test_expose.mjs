// S-LENS and S-EXPOSE (src/lab/camapp.mjs): the 12-40 on the mount and the camera's own exposure plan
//   exposeSessions  one session: the lens driver's derived focal lengths (35 mm equivalents) are the 12-40's; the plan
//                   the application gets at its start keeps Tv + Av - Sv = BV for the default scene (EV 12); a brighter
//                   S-SCENE scene gives a shorter shutter time or a smaller aperture, a darker one a longer time or a
//                   higher ISO; the live view's exposure in auto is the plan's; the aperture never opens past F2.8
//   node emu/test/test_expose.mjs
import path from 'node:path';
import zlib from 'node:zlib';

const FOCAL = { wide: 0xA32D4BB0, tele: 0xA32D4BB4, now: 0xA32D4BB8 };

export async function exposeSessions() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const SC = await import('../src/lab/scene.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })),
    wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  s.idle_slice(lab.lab_time() + 1500e6);
  const fl = Object.fromEntries(Object.entries(FOCAL).map(([k, a]) => [k, lab.sim.u32(a)]));
  ok(fl.wide === 24 && fl.tele === 80 && fl.now === 50, `S-LENS: 35 mm focal lengths ${JSON.stringify(fl)}, want wide 24, tele 80, now 50 (25 mm)`);
  const p0 = s.camapp.plan;
  ok(p0 !== undefined && p0 !== null, 'S-EXPOSE: the application has a plan once it has started');
  const bal = (p) => p.tv + p.av - p.sv - p.bv;
  ok(p0 && p0.bv === 1792 && Math.abs(bal(p0)) <= 8 , `the default scene's plan keeps Tv + Av - Sv = BV: ${JSON.stringify(p0)}`);
  const plans = {};
  for (const ev of [16, 12, 6]) {
    pl.apply({ type: 'scene', change: { ev, liveview: true }, t_wall: pl.wall(), seq: ev });
    plans[ev] = { ...s.camapp.plan };
  }
  ok(plans[16].bv === 2816 && plans[6].bv === 256, `BV follows the scene's EV: ${plans[16].bv}, ${plans[6].bv}`);
  ok(plans[16].tv + plans[16].av > plans[12].tv + plans[12].av, `brighter: a shorter time or a smaller aperture: ${JSON.stringify([plans[16], plans[12]])}`);
  ok(plans[6].tv < plans[12].tv || plans[6].sv > plans[12].sv, `darker: a longer time or a higher ISO: ${JSON.stringify([plans[6], plans[12]])}`);
  ok(Object.values(plans).every((p) => p.av >= 761), `the aperture never opens past the lens's F2.8: ${Object.values(plans).map((p) => p.av)}`);
  const e = SC.exposureOf(s.scene), p = s.camapp.plan;
  ok(Math.abs(e.shutter_s - p.shutter_s) < 1e-9 && Math.abs(e.aperture - p.aperture) < 1e-9 && Math.abs(e.iso - p.iso) < 1e-9,
    `S-SCENE's auto exposure is the camera's plan: ${JSON.stringify(e)} vs ${JSON.stringify(p)}`);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await exposeSessions();
  console.log(`S-LENS and S-EXPOSE: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
