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
//                       harness input. What their set-up code does there (their firmware/src/xblock.s, D): the same
//                       trace counts their work-list hook's site once, their set-up entry (the code block's, read
//                       from their heap block at run time) once after the stock set-up, and the stock texture builder
//                       never: the shipped film has no Grain (LOOKS.BIN record +51, none of v0.29's or v0.29.1's has).
//                       Then a second session whose card holds the release's LOOKS.BIN with FILM 3's Grain set to Med
//                       by the test (test_lookcode.mjs looksWith), the same keys and S2 with a breakpoint at the
//                       texture builder: the press stops there, after the work-list site and before the set-up (their
//                       source asks for the texture when the work list is built), called from their code block with
//                       the still's resource manager (S+10280) and the key block the stock set-up makes for Grainy
//                       Film (the still parameters' +40 u16 and +44, the stock helper's answer for them, +55, 0), the
//                       job's key 11 and no texture at job+8324 yet. Let go, the builder does not come back: its
//                       build is a request to the pipeline unit, whose pages for it the lab has no model of, and the
//                       session stops at the unit's first write (the YC page 0x9c201000), pinned here as the lab's
//                       limit, so the store of the texture at job+8324 is not reached. No Caduceus byte is in this file
//   node emu/test/test_stillsetup.mjs [--session] [--caduceus]     (OM_EMU_MODEL=E147)
//
// E147 facts used (D, the stock block; run-time = notation + 0x10021020): the second step's stub 0x50496710 (`call
// 0x504987bb`, the still set-up), the extension's apply 0x50530805, MM's retry sleep in its allocation 0x50521e52
// (`call 0x5002c6e5` after a bank found no block), the per-shot EXIF fill 0x50436558; the work-list builder's read of
// the job's key 0x50497d71 (the 8 bytes their work-list hook replaces), the cached texture builder 0x504ac901 (a0 the
// resource manager, a1 a 6-byte key; the stock set-up calls it at 0x504989d5 for Grainy Film; a miss builds through
// 0x504ae099, whose request reaches the unit's YC page writer 0x50482e53) and the helper 0x504967db that gives the
// key's fourth byte
import fs from 'node:fs';
import path from 'node:path';
import { STILL_PATH } from './test_storage.mjs';
import { readLooks } from './test_looks.mjs';
import { looksWith, theirBlock, theirLayout } from './test_lookcode.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const SU = 0x50496710, SETUP = 0x504987BB, APPLY = 0x50530805, MM_SLEEP = 0x50521E52, EXIF_FILL = 0x50436558, RT = 0x10021020;
const WL = 0x50497D71, TXGET = 0x504AC901, TXPF = 0x504967DB;
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
  // their heap block's layout and their code block's entries, from their source at the release's tag (else the tree's)
  const their = (file) => { const g = spawnSync('git', ['-C', root, 'show', `${rel}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 }); return g.status === 0 ? g.stdout : fs.readFileSync(path.join(root, file), 'utf8'); };
  let Y, B;
  try { Y = theirLayout(their('firmware/src/editor.ld')); B = theirBlock(their('firmware/src/xblock.s')); } catch (e) { ok(false, e.message); return t; }
  const le = (hex, off, n) => parseInt((hex.slice(2 * off, 2 * off + 2 * n).match(/../g) ?? ['0']).reverse().join(''), 16) >>> 0;
  const KEYS = ['ok ok right right right right', 'ok', 'ok ok right', 'ok', 'ok ok right', 'ok'], SHOT = 's1:down s2:down wait:300 s2:up s1:up wait:5000'.split(' ');
  const s = await openSession({ model: 'E147', patch: [patchFile], card: T('card.omsd'), cardPut: [`OM3MOD/LOOKS.BIN=${looksFile}`], nvram: T('nv.json'), out: T('out'), say: (l) => said.push(l) });
  try {
    let failed = null;
    const st = (tok) => { if (failed) return {}; const r = s.step(tok); if (!r.ok) { failed = `${tok}: ${r.error}`; ok(false, `step ${r.step} ${failed}`); } return r; };
    const run = (text) => text.split(' ').forEach(st);
    run('wait:1500');
    const site = st(`read:${h8(SU + RT)}:5`).hex ?? '', was = [...stock].map((x) => x.toString(16).padStart(2, '0')).join('');
    ok(site.length === 10 && site !== was, `the .hook_su site ${h8(SU)} holds the release's instruction, not the stock image's: ${site} (stock ${was})`);
    run('s1 wait:1200');
    for (const keys of KEYS) run(keys);
    const heap = (Y.POOL + le(st(`read:${h8(Y.STATE)}:2`).hex ?? '', 0, 2) - 1) >>> 0, entry = (le(st(`read:${h8(heap + Y.XPTR)}:4`).hex ?? '', 0, 4) + B.entries.xb_su) >>> 0;
    st(`trace:${[SU, SETUP, WL, TXGET, entry].map(h8).join(',')}`);
    const counts = {};
    for (const tok of SHOT) for (const [pc, n] of Object.entries(st(tok).hit_counts ?? {})) counts[pc] = (counts[pc] ?? 0) + n;
    st('trace:off');
    ok(counts[h8(SU)] === 1 && counts[h8(SETUP)] === 1, `S2 at COLOR runs the .hook_su site ${h8(SU)} once and the stock set-up ${h8(SETUP)} once: ${JSON.stringify(counts)}`);
    ok(looks.films[2].record[51] === 0 && counts[h8(WL)] === 1 && counts[h8(entry)] === 1 && counts[h8(TXGET)] === undefined,
      `a film without Grain (FILM 3's record +51 is ${looks.films[2].record[51]}): their work-list site ${h8(WL)} once, their set-up entry ${h8(entry)} once, the stock texture builder ${h8(TXGET)} never: ${JSON.stringify(counts)}`);
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
  }
  // the same film with Grain: the release's LOOKS.BIN with FILM 3's record +51 set to 2 (Med) by the test
  try {
    fs.writeFileSync(T('LOOKS-grain.BIN'), looksWith(fs.readFileSync(looksFile), [[2, 51, 2]]));
    const nc2 = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', T('card2.omsd'), '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
    ok(nc2.status === 0, `card.mjs new: rc ${nc2.status} ${nc2.stderr.slice(0, 300)}`);
    const recs = [], at = {};
    // at the builder's stop: its key block, the still's parameters, the job, the helper's answer, then let it go
    const plan = [
      (r) => { Object.assign(at, Object.fromEntries(Object.entries(r.stopped.regs).map(([k, v]) => [k, Number(v) >>> 0])), { pc: r.stopped.pc }); return `read:${h8(at.a1)}:6`; },
      () => { at.block = recs.at(-1).hex; return `read:${h8(at.a3 + 40)}:16`; },                    // a3 = S + 4, the still's parameters (their xb_tex)
      () => { at.params = recs.at(-1).hex; return `read:${h8(at.a2 + 10276)}:8`; },                 // a2 = S
      () => { at.job = le(recs.at(-1).hex, 0, 4); at.res = le(recs.at(-1).hex, 4, 4); return `read:${h8(at.job + 5352)}:4`; },
      () => { at.key = le(recs.at(-1).hex, 0, 4); return `read:${h8(at.job + 8324)}:4`; },
      () => { at.texture = le(recs.at(-1).hex, 0, 4); return `call:${h8(TXPF)}:d0=${le(at.params, 0, 2)},d1=${le(at.params, 15, 1)}`; },
      () => { at.helper = Number(recs.at(-1).regs?.d0) & 0xff; return 'break:off'; },
      () => 'resume'];
    const g = await openSession({ model: 'E147', patch: [patchFile], card: T('card2.omsd'), cardPut: [`OM3MOD/LOOKS.BIN=${T('LOOKS-grain.BIN')}`], nvram: T('nv2.json'), out: T('out2'), say: () => {},
      onRecord: (r) => recs.push(r), atStop: () => (plan.length ? plan.shift()(recs.at(-1)) : null) });
    try {
      let failed = null;
      const st = (tok) => { if (failed) return {}; const r = g.step(tok); if (!r.ok) { failed = `${tok}: ${r.error}`; ok(false, `the film with Grain: step ${r.step} ${failed}`); } return r; };
      'wait:1500 s1 wait:1200'.split(' ').forEach(st);
      for (const keys of KEYS) keys.split(' ').forEach(st);
      const heap = (Y.POOL + le(st(`read:${h8(Y.STATE)}:2`).hex ?? '', 0, 2) - 1) >>> 0, code = le(st(`read:${h8(heap + Y.XPTR)}:4`).hex ?? '', 0, 4);
      ok(parseInt(st(`read:${h8(heap + 32 + 53)}:1`).hex ?? '0', 16) === 2, 'the film with Grain: COLOR 1\'s slot holds Grain 2 after FILM 3 is picked');
      st(`trace:${[SU, SETUP, WL].map(h8).join(',')}`);
      st(`break:${h8(TXGET)}`);
      // the shot: the press that reaches the builder ends in the resume's record, where the session stops
      let last = null;
      const n0 = recs.length;
      for (const tok of SHOT) { if (failed) break; last = g.step(tok); if (!last.ok || last.resumed) break; }
      const before = {};
      for (const r of recs.slice(n0)) { for (const [pc, n] of Object.entries(r.hit_counts ?? {})) before[pc] = (before[pc] ?? 0) + n; if (r.stopped) break; }
      ok(at.pc === h8(TXGET) && before[h8(WL)] === 1 && before[h8(SU)] === undefined && before[h8(SETUP)] === undefined,
        `the film with Grain: S2 reaches the stock texture builder ${h8(TXGET)} after their work-list site and before the set-up: stopped at ${at.pc}, ${JSON.stringify(before)}`);
      const want = [le(at.params ?? '', 0, 2) & 0xff, le(at.params ?? '', 1, 1), le(at.params ?? '', 4, 1), at.helper, le(at.params ?? '', 15, 1), 0].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('');
      ok(at.a0 === at.res && at.res !== 0 && at.block === want && at.mdr >= code && at.mdr < code + 0x10000,
        `the film with Grain: the builder is called from their code block (return ${h8(at.mdr ?? 0)}, the block at ${h8(code)}) with the still's resource manager ${h8(at.res ?? 0)} (a0 ${h8(at.a0 ?? 0)}) and Grainy Film's key block ${want} (${at.block})`);
      ok(at.key === 11 && at.texture === 0, `the film with Grain: the job is COLOR's (key ${at.key}) and holds no texture yet (job+8324 ${h8(at.texture ?? 1)})`);
      ok(last?.resumed && !last.ok && /imgpipe UNKNOWN write 0x9c201014/.test(last.error ?? ''),
        `the film with Grain: let go, the builder's build stops the session at the pipeline unit's first write (the lab has no model of that page): ${JSON.stringify(last?.resumed)} ${String(last?.error).split('\n').filter((l) => /imgpipe|stopped at/.test(l)).join(' | ').slice(0, 300)}`);
    } finally {
      const sum = g.close();
      ok(sum.pokes.length === 0 && sum.harness_inputs.length === 0, `the film with Grain: no poke and no harness input: ${JSON.stringify({ pokes: sum.pokes, harness: sum.harness_inputs })}`);
    }
  } finally {
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
