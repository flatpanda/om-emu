// PER_SIO's channel map at the play bring-up (src/lab/play.mjs sio_map_bring_up, H-SIOMAP; docs/hle-gaps.md
// 2026-11-22):
//   sioMapSession  (firmware) a play session on the body of OM_EMU_MODEL (E143 by default): on a body whose PER_SIO
//                  driver has the map (src/fw/facts.mjs sioDriver, fact 'sio'), the map word is set by the firmware's
//                  setter (E143 0x5005f0b2) when the session is open, the panel's channel 2 has a controller index
//                  from the map (a byte of the board's table, not of low memory), and the player reports H-SIOMAP;
//                  on a body without the map (the E118 family) nothing is set or reported
//   node emu/test/test_siomap.mjs   (with OM_EMU_MODEL=E144 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

const PANEL_CHANNEL = 2;   // the panel's PER_SIO channel byte (E143 configuration 0xa32c6efc: channel byte 2, D)

export async function sioMapSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' }, env);
  pl.open_session();
  const s = pl.session, sim = s.lab.sim;
  const m = s.sio_map ?? null, used = pl.stand_ins_in_use();
  if (MODEL_INFO.sio_devices) {
    ok(s.sio && used.includes('H-SIOMAP'), `${MODEL}: the map set by S-SIOIIC's bring-up and H-SIOMAP reported`);
  } else if (m) {
    ok(sim.u32(m.word) >>> 0 === m.map && m.map !== 0, `${MODEL}: the map word ${m.word.toString(16)} holds the setter's map`);
    const index = sim.read(m.map + 2 * PANEL_CHANNEL, 1)[0];
    ok(m.map >= 0x60000000, `${MODEL}: the map ${m.map.toString(16)} is in the image's tables, not low memory`);
    console.log(`${MODEL}: channel map ${m.map.toString(16)}, panel channel ${PANEL_CHANNEL} -> controller index ${index}`);
    ok(used.includes('H-SIOMAP'), `${MODEL}: H-SIOMAP reported`);
  } else {
    ok(!used.includes('H-SIOMAP'), `${MODEL}: no map, no H-SIOMAP`);
    console.log(`${MODEL}: PER_SIO's driver has no channel map`);
  }
  pl.close?.();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad } = await sioMapSession();
  for (const b of bad) console.log(`FAIL ${b}`);
  console.log(`${checks - bad.length}/${checks} checks`);
  process.exit(bad.length ? 1 : 0);
}
