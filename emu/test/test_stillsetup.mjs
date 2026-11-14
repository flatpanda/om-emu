// E147's still set-up (docs/hle-gaps.md 4.3.12): the image library's create takes the constructor the shot record's
// picture mode selects, which the creative dial sets, as on the camera, and at COLOR, MONO and ART runs the create's
// second-step stub that Caduceus for OM-3 hooks (.hook_su), past rec_ImgPro_CreateParam's extension, whose two
// buffers MM allocates natively once S-RECREQ gives the still's Command 16.
//   stillSetupSession   (E147) one session, a shot at each creative-dial position (STILL_PATH.E147.dial,
//                       test/test_storage.mjs): the request's format word and flags at the stage-table fill, the
//                       constructor taken (once) and the other not, the second step's stub and the extension's apply
//                       once where the constructor for bit 19 or byte +8 1 is taken and never elsewhere, MM's retry
//                       sleep never, and each shot's file written; control: the per-shot EXIF fill once per shot
//   caduceusSetupSession (E147; needs OM_CADUCEUS, a caduceus-om3 checkout, else not run and not counted) the release
//                       releases/$OM_CADUCEUS_RELEASE (v0.29 by default) as --patch with its LOOKS.BIN on a card the
//                       firmware formatted, FILM 3 selected as test/test_looks.mjs selects it, S2 at the creative
//                       dial's start (COLOR) through the supported scripting API (host/session.mjs): a logging trace
//                       over the S2 press counts the .hook_su site (the stub, whose instruction the release replaced:
//                       it differs from the stock image's) once and the stock set-up it calls once; the picture is a
//                       JPEG refs/jpeg.mjs decodes, with 'FILM 3 <its name>' in its ImageDescription; no poke and no
//                       harness input. No Caduceus byte is in this file
//   node emu/test/test_stillsetup.mjs [--session] [--caduceus]     (OM_EMU_MODEL=E147)
//
// E147 facts used (D, the stock block; run-time = notation + 0x10021020): the second step's stub 0x50496710 (`call
// 0x504987bb`, the still set-up), the extension's apply 0x50530805, MM's retry sleep in its allocation 0x50521e52
// (`call 0x5002c6e5` after a bank found no block), the per-shot EXIF fill 0x50436558
import fs from 'node:fs';
import path from 'node:path';
import { STILL_PATH } from './test_storage.mjs';
import { readLooks } from './test_looks.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const SU = 0x50496710, SETUP = 0x504987BB, APPLY = 0x50530805, MM_SLEEP = 0x50521E52, EXIF_FILL = 0x50436558, RT = 0x10021020;
const BIT19 = 'the constructor for byte +8 1 or bit 19', STILL = 'the still constructor';
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

export async function stillSetupSession() {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E147') { ok(false, `test_stillsetup: the session needs OM_EMU_MODEL=E147, not ${MODEL}`); return t; }
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { SdCard } = await import('../src/lab/sdcard.mjs');
  const P = STILL_PATH.E147, at = new Map(P.at.map(([what, a]) => [what, a]));
  const card = new SdCard();
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
  try {
    pl.open_session();
    const lab = pl.session.lab, runs = new Map(), requests = [];
    const watch = { [BIT19]: at.get(BIT19), [STILL]: at.get(STILL), su: SU, apply: APPLY, sleep: MM_SLEEP, fill: EXIF_FILL };
    for (const [k, a] of Object.entries(watch)) { runs.set(k, 0); lab.observe(a, () => runs.set(k, runs.get(k) + 1), 'obs-stillsetup'); }
    lab.observe(P.select, (l, r) => requests.push(l.sim.read((r.a0 >>> 0) + 4, P.size)), 'obs-stillsetup-select');
    const run = (inp) => { pl.run_input(inp); if (pl.error) throw pl.error; };
    run({ type: 'scene', change: { liveview: true } });
    for (const [pos, label, format, flags, ctor] of P.dial) {
      for (const k of runs.keys()) runs.set(k, 0);
      requests.length = 0;
      const images = pl.session.camapp.images.length;
      run({ type: 'switch', id: 'creative_dial', value: pos });
      for (const inp of [{ type: 'token', token: 'WAIT:800' }, { type: 'key', id: 's1', action: 'down' }, { type: 'token', token: 'WAIT:300' }, { type: 'key', id: 's2', action: 'down' },
        { type: 'token', token: 'WAIT:700' }, { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }, { type: 'token', token: 'WAIT:1500' }]) run(inp);
      const b = requests[0] ?? new Uint8Array(0), word = (o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
      const other = ctor === BIT19 ? STILL : BIT19, set = ctor === BIT19 ? 1 : 0, c = Object.fromEntries(runs);
      ok(requests.length === 1 && word(8) === format && word(12) === flags,
        `${label} (position ${pos}): the stage-table fill once (${requests.length}), the request's format word ${h8(word(8))} and flags ${h8(word(12))}, want ${h8(format)} and ${h8(flags)}`);
      ok(c[ctor] === 1 && c[other] === 0 && c.su === set && c.apply === set && c.sleep === 0 && c.fill === 1,
        `${label} (position ${pos}): ${ctor} once, ${other} never, the second step's stub and the extension's apply ${set ? 'once' : 'never'}, MM's retry never, the per-shot EXIF fill (control) once: ${JSON.stringify(c)}`);
      const img = pl.session.camapp.images[images];
      ok(pl.session.camapp.images.length === images + 1 && img?.file?.size > 0, `${label} (position ${pos}): S2 wrote its picture's file: ${JSON.stringify(img?.file)}`);
    }
  } catch (e) {
    ok(false, `the session stopped: ${String(e?.message ?? e).slice(0, 600)}`);
  } finally {
    try { pl.close_session(); } catch { /* closed */ }
  }
  return t;
}

export async function caduceusSetupSession() {
  const t = tester(), { ok } = t;
  const root = process.env.OM_CADUCEUS;
  if (!root) return Object.assign(t, { notRun: 'OM_CADUCEUS is not set (a caduceus-om3 checkout)' });
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E147') { ok(false, `test_stillsetup: the session needs OM_EMU_MODEL=E147, not ${MODEL}`); return t; }
  const rel = process.env.OM_CADUCEUS_RELEASE || 'v0.29';
  t.release = rel;
  const R = path.join(root, 'releases', rel), patchFile = path.join(R, 'patch.json'), looksFile = path.join(R, 'LOOKS.BIN');
  if (!fs.existsSync(patchFile) || !fs.existsSync(looksFile)) { ok(false, `test_stillsetup: ${R} has no patch.json and LOOKS.BIN`); return t; }
  const looks = readLooks(fs.readFileSync(looksFile));
  const { loadImage } = await import('../checks/lib/env.mjs');
  const stock = loadImage().subarray(SU - 0x50000000, SU - 0x50000000 + 5);
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-stillsetup-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const T = (...p) => path.join(tmp, ...p);
  const { spawnSync } = await import('node:child_process');
  const nc = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', T('card.omsd'), '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
  ok(nc.status === 0, `card.mjs new: rc ${nc.status} ${nc.stderr.slice(0, 300)}`);
  const { openSession } = await import('../host/session.mjs');
  const said = [];
  const s = await openSession({ model: 'E147', patch: [patchFile], card: T('card.omsd'), cardPut: [`OM3MOD/LOOKS.BIN=${looksFile}`], nvram: T('nv.json'), out: T('out'), say: (l) => said.push(l) });
  try {
    let failed = null;
    const st = (tok) => { if (failed) return {}; const r = s.step(tok); if (!r.ok) { failed = `${tok}: ${r.error}`; ok(false, `step ${r.step} ${failed}`); } return r; };
    const run = (text) => text.split(' ').forEach(st);
    run('wait:1500');
    const site = st(`read:${h8(SU + RT)}:5`).hex ?? '', was = [...stock].map((x) => x.toString(16).padStart(2, '0')).join('');
    ok(site.length === 10 && site !== was, `the .hook_su site ${h8(SU)} holds the release's instruction, not the stock image's: ${site} (stock ${was})`);
    run('s1 wait:1200');
    for (const keys of ['ok ok right right right right', 'ok', 'ok ok right', 'ok', 'ok ok right', 'ok']) run(keys);
    st(`trace:${h8(SU)},${h8(SETUP)}`);
    const counts = {};
    for (const tok of 's1:down s2:down wait:300 s2:up s1:up wait:5000'.split(' ')) for (const [pc, n] of Object.entries(st(tok).hit_counts ?? {})) counts[pc] = (counts[pc] ?? 0) + n;
    st('trace:off');
    ok(counts[h8(SU)] === 1 && counts[h8(SETUP)] === 1, `S2 at COLOR runs the .hook_su site ${h8(SU)} once and the stock set-up ${h8(SETUP)} once: ${JSON.stringify(counts)}`);
    const want3 = `FILM 3 ${looks.films[2].name}`;
    const ex = st('exif:DCIM/100OMSYS/*.JPG').exif?.ImageDescription ?? '';
    ok(ex.includes(want3), `S2 on FILM 3: ImageDescription ${JSON.stringify(ex)}, want ${JSON.stringify(want3)}`);
    st(`card-get:DCIM/100OMSYS/*.JPG=${T('shot.jpg')}`);
    const { decodeJpeg } = await import('../refs/jpeg.mjs');
    let dec = null;
    try { const j = fs.readFileSync(T('shot.jpg')); dec = decodeJpeg(j); dec = { width: dec.width, height: dec.height, eoi: j[j.length - 2] === 0xff && j[j.length - 1] === 0xd9 }; } catch (e) { dec = { error: e.message }; }
    ok(dec?.width > 0 && dec.height > 0 && dec.eoi, `the picture is a JPEG refs/jpeg.mjs decodes, ending with EOI: ${JSON.stringify(dec)}`);
  } finally {
    const sum = s.close();
    ok(sum.pokes.length === 0 && sum.harness_inputs.length === 0 && (sum.patch_audit?.hooks ?? []).length === 0,
      `no poke, no harness input, no lab hook on patched bytes: ${JSON.stringify({ pokes: sum.pokes, harness: sum.harness_inputs, audit: sum.patch_audit })}`);
    ok(said.some((l) => /patched firmware: \d+ patches/.test(l)), `the release taken as --patch: ${said[0]}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--session') && !process.argv.includes('--caduceus');
  let fail = 0;
  if (all || process.argv.includes('--session')) {
    const s = await stillSetupSession();
    console.log(`E147's still set-up at each creative-dial position: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  if (all || process.argv.includes('--caduceus')) {
    const s = await caduceusSetupSession();
    if (s.notRun) console.log(`E147's still set-up under Caduceus: not run (${s.notRun})`);
    else console.log(`E147's still set-up under Caduceus (${s.release}): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
