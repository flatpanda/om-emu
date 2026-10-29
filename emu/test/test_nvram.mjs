// S-NVRAM, the camera's non-volatile state kept between sessions (src/lab/menu.mjs, host/nvram.mjs):
//   nvramSessions  on a fresh file the first session starts on the shooting screen where a session without it shows
//                  the date prompt (at the start's frame); the blank store's saves of E and M reach the file; a setting changed in the session
//                  and saved as the menu closes (the native menu-close save, posted to the flash task) is back in the
//                  next session, whose registry bootstrap restores M and E; bin/play.mjs with OM_EMU_NVRAM lists
//                  S-NVRAM and not S-SETSAVE
//   node emu/test/test_nvram.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const J = path.resolve(new URL('..', import.meta.url).pathname);
const SID = 571, VALUE = 3200;                  // the front upper button's function (default 84) -> off

export async function nvramSessions() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-nvram');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'nvram.json');
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { fileNvram } = await import('../host/nvram.mjs');
  const base = { rom: loadImage(), resBlock: loadBlock(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), wallClock: () => performance.now() / 1000 };
  // the session idles idle_ms after its start (the comparison with a session without S-NVRAM takes the start's frame:
  // with the native lens, E143's default, the application leaves the date prompt for the shooting screen when the lens
  // module's state event comes, about 120 ms later, docs/hle-gaps.md 4.4.2)
  const open = (nvram, idle_ms = 1500) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, { ...base, ...(nvram ? { nvram } : {}) });
    pl.open_session();
    const s = pl.session;
    s.idle_slice(s.lab.lab_time() + idle_ms * 1e6);
    return s;
  };
  const frame = (s) => Buffer.from(s.frame('boundary', true)[2]).toString('base64');
  const press = (s, k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 1200e6); };
  const plain = frame(open(null, 0));
  const nvram = fileNvram(file);
  let s = open(nvram, 0);
  ok(frame(s) !== plain, 'S-NVRAM: the first session starts without the date prompt a session without it shows');
  s.idle_slice(s.lab.lab_time() + 1500e6);
  ok(JSON.stringify(s.lab.store_log.nvram.loaded) === '[]', `a fresh file restores nothing: ${JSON.stringify(s.lab.store_log.nvram.loaded)}`);
  const saved = nvram.load();
  ok(saved?.M?.length === 0x40000 && saved?.E?.length === 0x30000 && saved?.scpu?.[0] === 0xa8,
    `the blank store's saves reach the file (M ${saved?.M?.length}, E ${saved?.E?.length}, SCPU word 0 ${saved?.scpu?.[0]})`);
  s.set(SID, VALUE);
  press(s, 'menu'); press(s, 'menu');
  const saves = s.lab.store_log.nvram.saves;
  ok(saves.some((x) => x.store === 'M' && x.posted), `the menu close saves M through the flash task: ${JSON.stringify(saves)}`);
  s = open(nvram);
  ok(JSON.stringify(s.lab.store_log.nvram.loaded) === '["M","E"]', `the next session restores M and E: ${JSON.stringify(s.lab.store_log.nvram.loaded)}`);
  ok(s.get(SID) === VALUE, `setting ${SID} kept: ${s.get(SID)}, want ${VALUE}`);
  ok(s.lab.state() === 0x108, `the restored camera reaches its screen: GUI 0x${s.lab.state().toString(16)}`);
  // the node host: OM_EMU_NVRAM gives its lab the file
  process.env.OM_CHECK_OUT = out;
  const { withPlay } = await import('../checks/lib/playhttp.mjs');
  const was = process.env.OM_EMU_NVRAM;
  process.env.OM_EMU_NVRAM = path.join(out, 'host.json');
  try {
    await withPlay('nvram', ['--idle', 'off', '--a15', 'on'], async (pl) => {
      const st = await pl.status();
      ok(st.stand_ins.includes('S-NVRAM') && !st.stand_ins.includes('S-SETSAVE'), `play with OM_EMU_NVRAM: ${st.stand_ins}`);
    });
  } finally {
    if (was === undefined) delete process.env.OM_EMU_NVRAM; else process.env.OM_EMU_NVRAM = was;
  }
  ok(fs.existsSync(path.join(out, 'host.json')), 'the host wrote its file');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await nvramSessions();
  console.log(`S-NVRAM: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
