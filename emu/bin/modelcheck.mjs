#!/usr/bin/env node
// The ported models' smoke test: for each model whose firmware is unpacked (src/fw/models.mjs), update its address
// table in src/fw/ports.mjs (bin/port.mjs) and run, in a child on emu/ with OM_EMU_MODEL, a play session on the TFT
// and one on the EVF (a body with one: MODELS panels.evf) through the path every model must take: start, S1, S2 (a
// picture on the card), PLAY (single-frame playback), INFO, PLAY (back to shooting), then the menu (MENU_PATH: MENU,
// DOWN, MENU; on the EVF after S2, MENU_EVF_XFAIL's bodies expected to fail). Each step's GUI state (by its name
// in the model's own state table: the numbers differ, E143's playback is 0x508, the E144 family's 0x608) and card
// count is checked, and after S1 the screen's remaining-shots count (the count probe below); exit 1 on any failure. A
// body whose start waits at a prompt S1 does not answer (START_PROMPT: E145's date and time setting) takes the
// prompt's key after the start. The menu's steps are judged by what they change, since the menu's GUI states are named
// on few builds (the E144 family's SS_MENU lies past the state table's first 12 parents, src/lab/menu.mjs state_names):
// MENU must leave the shooting screen's state for another and change the frame (the menu drawn), DOWN keep that state
// and change the frame (the cursor or the tab moved), the second MENU bring back the shooting screen's state.
// The count probe, after S1: three windows of WINDOW frames WINDOW_NS apart, at S-CARD's count, at PROBE_SHOTS and at
// the count again, each after PROBE_NS of idle. A pixel is the count's where it holds one value through the first
// window and another through the second (a pixel that changes within a window, as E146's blinking ISO item, X, is
// not); the screen shows the count the application asks S-CARD for where there is such a pixel and each of them is
// back to its first value through the third window. A "Card Full" warning, a count the screen does not draw and a
// count from another source than S-CARD's query leave no such pixel (X: E142 before the shots-query rule, E144). The
// box of the count's pixels is reported. On a body whose card's file system runs natively (src/fw/models.mjs card_fs)
// the query is the firmware's, which counts from the card: the probe answers it at PROBE_SHOTS for its second window
// with a hook of its own, removed for the third; and the card check follows the path: the card mounted, the shots the
// query answered before the probe from the card, and each picture's file found again on the card with its size by the
// independent reader refs/volume.mjs picks (refs/fat.mjs or refs/exfat.mjs, whichever file system the firmware
// formatted; an exFAT volume must also pass the reader's consistency check). --card-size GiB puts a blank card of that
// capacity in the slot in place of the default 8 GiB SDHC one (src/lab/sdcard.mjs cardSectors: above 32 an SDXC card),
// and the line says which file system the body's firmware gave it. A body whose application asks for the count only
// when its shooting screen is drawn again (PROBE_REDRAW) has the screen redrawn before each window by a key that
// cycles it back to the view it had, as a user would. A body in PROBE_XFAIL is expected to fail the probe, strictly:
// its failure is printed and does not count, its pass does, so a fix forces the table's update.
//   node emu/bin/modelcheck.mjs [MODEL ...] [--no-port] [--card-size GiB]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MODELS, romPath } from '../src/fw/models.mjs';
import { SdCard, cardSectors } from '../src/lab/sdcard.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const args = process.argv.slice(2), noPort = args.includes('--no-port');
const sizeAt = args.indexOf('--card-size');
if (sizeAt >= 0 && !(sizeAt + 1 < args.length)) { console.error('modelcheck: --card-size needs a size in GiB'); process.exit(2); }
// the card's capacity in sectors (null: the default card), checked here so that a size the card model refuses stops
// the run before any child
const SECTORS = sizeAt >= 0 ? cardSectors(args[sizeAt + 1]) : null;
const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--no-port' && a !== '--card-size' && i !== sizeAt + 1);
if (unknown.length) { console.error(`modelcheck: unknown option ${unknown[0]} (--no-port, --card-size GiB)`); process.exit(2); }
const want = args.filter((a, i) => !a.startsWith('--') && !(sizeAt >= 0 && i === sizeAt + 1));
const models = (want.length ? want : Object.keys(MODELS).filter((k) => k !== 'E143' && MODELS[k].checked))
  .filter((k) => fs.existsSync(path.join(REPO, romPath(MODELS[k]))));

// [key, GUI state name after it, card images after it]
const PATH = [['start', null, 0], ['s1', null, 0], ['s2', null, 1], ['play', 'SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE', 1],
  ['info', 'SS_PLAY_SINGLE/ID_ST_DISP_DETAIL', 1], ['play', null, 1]];
// the menu after the path: [key, null (no state name), card images, what the step must do (see the head)]
const MENU_PATH = [['menu', null, 1, 'open'], ['down', null, 1, 'move'], ['menu', null, 1, 'close']];
// the bodies whose menu is known not to run on the EVF: model -> [what the step's error must hold, the reason], held
// strictly as PROBE_XFAIL. E146 and E147: the menu's composite has the EVF's dimmed plane, PLANC 0xb2, which E143's
// compositor refuses (as for playback above). E122 and E120: at MENU on the EVF the press runs to the hook-stop limit
// with the lab clock at about 3000 s, sleeping in OlyTaSS (X, 2026-11-02; why: ?), where their TFTs and E118's EVF open
// the menu
const PLANC_B2 = [/^error: composite NONE: \["PLANC_UNOBSERVED .* value 0x000000b2/, 'the menu\'s EVF composite has a plane at PLANC 0xb2, which E143\'s compositor refuses'];
const MENU_EVF_XFAIL = {
  E146: PLANC_B2, E147: PLANC_B2,
  E122: [/^error: .*more than 300000 stub calls/, 'MENU on the EVF runs to the hook-stop limit with the lab clock at 3000 s (not read)'],
  E120: [/^error: .*more than 300000 stub calls/, 'MENU on the EVF runs to the hook-stop limit with the lab clock at 3000 s (not read)'],
};
const PROBE_NS = 1200e6, PROBE_SHOTS = 777, WINDOW = 6, WINDOW_NS = 300e6;
// the remaining-shots query (E143's, src/lab/camapp.mjs SHOTS_QUERY; the child places it through A())
const SHOTS_QUERY = 0x50419164;
// the bodies whose screens are known not to follow the probe's count, on the TFT and the EVF: model -> the reason. The
// E143 and E144 families were in it until S-CARD's card was in slot 1's detect state (docs/model-survey.md finding 18),
// the E118 family until PROBE_REDRAW (finding 61)
const PROBE_XFAIL = {};
// the bodies whose application asks for the count only when the GUI draws the shooting screen again: model -> the
// key that redraws it. The probe presses the key until the screen is back to its frame before the first
// press (at most REDRAW_MAX times: a key that does not cycle back fails the probe), then as many times before each of
// its windows, the first included, so that all three are taken on the same view. The E118 family's shooting screen
// asks the query from its count item (E122 0x50ca1608) when the screen object's update runs all its items
// (0x50c96925), on the GUI's camera events: the start, the shooting information's 3 s timer, the return from
// playback, INFO, a shot; not on an S1 that changes nothing on the screen nor at idle (X: E118, E120, E122,
// docs/model-survey.md finding 61). INFO cycles the four views of the shooting screen back to the first on both
// panels (X), where PLAY and back, which also redraws, stalls on E120's and E122's EVF
const REDRAW_MAX = 8, PROBE_REDRAW = { E118: 'info', E120: 'info', E122: 'info' };
// the bodies known to stop with an SDXC card (--card-size above 32 GiB), on the TFT and the EVF: model -> [what their
// child's output must hold, the reason]. Strictly, as PROBE_XFAIL: a body that runs the path, or stops elsewhere, fails
// the run. E144: its firmware formats the card exFAT, then at the camera application's start its movie parameters
// (0x5032553f) divide by 0 at 0x5032574f, the firmware's own result for this state (docs/hle-gaps.md 4.8.7, D): the
// blank store's movie mode, UHD 4K at 60p, has no rate in E144's table, so the first rate query fails and leaves its
// size 0, which this build does not test (E143's, E139's, E137's and E125's do); the second query answers from
// constants for an exFAT volume, so the exFAT branch runs and divides by that size. The manual leaves a divide by 0's
// result undefined (docs/mn10300-isa-spec.md 4.6, 8 item 1), so emu stops there (Fault 6, emu/FIDELITY-NOTES.md 3.2)
const SDXC_XFAIL = { E144: [/stopped at 0x[0-9a-f]+ \(disasm 0x5032574f\) fault=6/, 'its movie parameters divide by the 4K 60p rate query\'s size 0 at 0x5032574f with an exFAT card (Fault 6; the result is undefined)'] };
const SDXC = SECTORS !== null && new SdCard({ sectors: SECTORS }).kind === 'SDXC';
// the bodies whose start waits for the user at a prompt S1 does not take to the shooting screen: model -> {state, the
// prompt's GUI state; key, the key that answers it, or keys, the keys in their order; after, the GUI state's name
// after the last; why}, steps of the path after the start, held strictly: a start that ends elsewhere fails, so the
// table follows the firmware
const START_PROMPT = {
  E145: { state: 0x1103, key: 'menu', after: 'SS_COMMON/ID_ST_CA_REQ_DISP',
    why: 'the TG-7 opens its date and time setting at power-on on an unset clock (docs/model-survey.md finding 17); MENU, the screen\'s Cancel, leaves it for the clock warning, which S1 then clears as on the other bodies (S1 too leaves the setting, but only for the warning, X)' },
  E129: { state: 0x1103, key: 'menu', after: 'SS_COMMON/ID_ST_CA_REQ_DISP',
    why: 'the TG-5 opens the same date and time setting as the TG-7 at power-on on an unset clock, with Cancel on MENU (X: frames; docs/model-survey.md finding 24)' },
  E132: { state: 0x1103, keys: ['up', 'ok', 'up', 'ok', 'up', 'ok', 'up', 'ok', 'up', 'ok'], after: 'SS_COMMON/ID_ST_CA_REQ_DISP',
    why: 'the industrial TG-5 opens the date and time setting at power-on on an unset clock with Set on OK and no Cancel; UP gives each of the five fields its first value (2017.01.01 00:00) and OK takes the next, the fifth OK sets the clock (X: frames; docs/model-survey.md finding 24)' },
};
const CHILD = `
const J = process.argv[1], DEVICE = process.argv[2], PROBE_NS = ${PROBE_NS}, PROBE_SHOTS = ${PROBE_SHOTS},
  WINDOW = ${WINDOW}, WINDOW_NS = ${WINDOW_NS}, SECTORS = ${SECTORS}, REDRAW = process.argv[4] || null,
  REDRAW_MAX = ${REDRAW_MAX};
const { createHash } = await import('node:crypto');
const zlib = await import('node:zlib');
const { loadImage, loadBlock } = await import(J + '/bin/run.mjs');
const { Player } = await import(J + '/src/lab/player.mjs');
const { PLAYER_PARSER } = await import(J + '/scenarios/session_replay.mjs');
const { A } = await import(J + '/src/fw/model.mjs');
const { runtime } = await import(J + '/src/lab/hle.mjs');
const { openVolume } = await import(J + '/refs/volume.mjs');
const { memoryCard } = await import(J + '/src/lab/sdcard.mjs');
const SHOTS_QUERY = ${SHOTS_QUERY}, card = {};
const env = { rom: loadImage(), resBlock: loadBlock(), createHash, ...(SECTORS === null ? {} : { card: memoryCard({ sectors: SECTORS }) }), deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: DEVICE }, { ...env, wallClock: () => performance.now() / 1000 });
pl.open_session();
const s = pl.session, lab = s.lab, out = [];
const rec = (k) => { let frame = null, digest = null; try { const [w, h, raw] = s.frame('boundary', true); frame = w + 'x' + h; digest = createHash('sha256').update(raw).digest('hex').slice(0, 16); } catch (e) { frame = 'error: ' + e.message.split('\\n')[0].slice(0, 120); } out.push([k, lab.state(), lab.state_names.get(lab.state()) ?? '?', s.camapp.status().card_images, frame, digest]); };
s.idle_slice(lab.lab_time() + 1500e6); rec('start');
// the count probe's window: WINDOW frames (the composite's words) WINDOW_NS apart, each pixel's first value and whether
// it held it through the window
const window_ = () => {
  let w, h, val, stable;
  for (let k = 0; k < WINDOW; k++) {
    if (k) s.idle_slice(lab.lab_time() + WINDOW_NS);
    const [fw, fh, raw] = s.frame('boundary', true), px = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + 4 * fw * fh));
    if (!k) { [w, h, val, stable] = [fw, fh, px, new Uint8Array(px.length).fill(1)]; continue; }
    if (fw !== w || fh !== h) throw new Error('the frame changed size');
    for (let i = 0; i < px.length; i++) if (px[i] !== val[i]) stable[i] = 0;
  }
  return { w, val, stable };
};
// the box [x0, y0, x1, y1] of the pixels want(i) holds for, or null
const boxOf = (w, n, want) => {
  let box = null;
  for (let i = 0; i < n; i++) if (want(i)) {
    const x = i % w, y = (i - x) / w;
    box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
  }
  return box;
};
// a key pressed as a step of the path: 150 ms down, then 1200 ms of idle
const press = (k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 1200e6); };
// PROBE_REDRAW's key, where the body has one: pressed until the screen is back to its frame and GUI state before the
// first press, n times; redraw() then presses it n times and checks the GUI state came back
const cycle = () => {
  const bytes = () => s.frame('boundary', true)[2].slice(), f0 = bytes(), state = lab.state();
  for (let n = 1; n <= REDRAW_MAX; n++) {
    press(REDRAW);
    const f = bytes();
    if (lab.state() === state && f.length === f0.length && f.every((v, i) => v === f0[i])) return { n, state };
  }
  throw new Error(REDRAW + ' did not bring the screen back to its frame in ' + REDRAW_MAX + ' presses');
};
let probe = null;
for (const k of JSON.parse(process.argv[3])) {
  // a step that stops the session ends the path: its error in place of the frame, no step after it (the card is
  // still read back below)
  try { press(k); } catch (e) { out.push([k, lab.state(), lab.state_names.get(lab.state()) ?? '?', s.camapp.status().card_images, 'error: ' + e.message.split('\\n')[0].slice(0, 200), null]); break; }
  rec(k);
  if (k !== 's1') continue;
  try {
    const turn = REDRAW ? cycle() : null, redraw = () => {
      if (!turn) return;
      for (let i = 0; i < turn.n; i++) press(REDRAW);
      if (lab.state() !== turn.state) throw new Error(REDRAW + ' x' + turn.n + ' left GUI state 0x' + lab.state().toString(16));
    };
    // the count the query answers: S-CARD's, or with the card's file system native the firmware's own, which the probe
    // replaces for its second window by an answer of the query at PROBE_SHOTS (a hook of its own, then removed)
    const q = A(SHOTS_QUERY), set = (n) => {
      if (!s.storage) { s.camapp.card_shots = n; return; }
      if (n === null) lab.hooks.delete(runtime(q)); else lab.hook(q, (h, r) => h.finish(r, { d0: n }), 'count probe');
    };
    if (s.storage) card.shots = lab.call(q, { d0: 0 }, null, null, 2000000).d0 | 0;
    const keep = s.storage ? null : s.camapp.card_shots, a = window_();
    set(PROBE_SHOTS); redraw(); s.idle_slice(lab.lab_time() + PROBE_NS); const b = window_();
    set(keep); redraw(); s.idle_slice(lab.lab_time() + PROBE_NS); const c = window_();
    const count = (i) => a.stable[i] && b.stable[i] && a.val[i] !== b.val[i], n = a.val.length;
    probe = { count: boxOf(a.w, n, count), back: boxOf(a.w, n, (i) => count(i) && (!c.stable[i] || c.val[i] !== a.val[i])), redraw: turn ? turn.n : 0 };
  } catch (e) { probe = { error: e.message.split('\\n')[0].slice(0, 120) }; }
}
// with the card's file system native: the card read back independently (refs/volume.mjs: refs/fat.mjs or
// refs/exfat.mjs, an exFAT volume checked for consistency), each picture's file found at its path with its size
if (s.storage) {
  const st = s.storage, c = st.card;
  Object.assign(card, { kind: c.kind, gib: c.sectors / 2097152, mounted: st.mounted, formatted: st.formatted, files: st.files.length, found: 0 });
  try {
    const vol = openVolume((lba, n) => c.read(lba, n));
    Object.assign(card, { type: vol.type, label: vol.label.trim(), start: vol.start, cluster_kib: vol.spc / 2 });
    if (vol.type === 'exFAT') { const p = vol.check(); if (p.length) card.error = 'exFAT check: ' + p.slice(0, 3).join('; ').slice(0, 200); }
    for (const f of st.files) { const e = vol.find(f.path.slice(3).replaceAll('\\\\', '/')); if (e && !e.dir && e.size === f.size) card.found += 1; }
  } catch (e) { card.error = e.message.slice(0, 120); }
}
console.log(JSON.stringify({ steps: out, probe, card: s.storage ? card : null }));
`;
let bad = 0;
for (const m of models) {
  if (!noPort) {
    const p = spawnSync(process.execPath, ['--max-old-space-size=10240', path.join(REPO, 'emu/bin/port.mjs'), m], { encoding: 'utf8' });
    if (p.status !== 0) { console.log(`${m}: port failed: ${p.stderr.slice(-400)}`); bad++; continue; }
  }
  // the EVF runs the path up to S2: playback on the EVF navigates, but its composite uses a PLANC (0xb2) and the
  // highlight block the VSC model has not observed (open, on E143 too)
  for (const device of MODELS[m].panels?.evf === null ? ['tft'] : ['tft', 'evf']) {
  const prompt = START_PROMPT[m], answer = prompt ? (prompt.keys ?? [prompt.key]).map((k, i, ks) => [k, i === ks.length - 1 ? prompt.after : null, 0]) : [];
  const full = [PATH[0], ...answer, ...PATH.slice(1)];
  const path_ = [...(device === 'evf' ? full.slice(0, full.indexOf(PATH[2]) + 1) : full), ...MENU_PATH], menuAt = path_.length - MENU_PATH.length;
  const r = spawnSync(process.execPath, ['--max-old-space-size=6144', '--input-type=module', '-e', CHILD, path.join(REPO, 'emu'), device, JSON.stringify(path_.slice(1).map((p) => p[0])), PROBE_REDRAW[m] ?? ''], { encoding: 'utf8', env: { ...process.env, OM_EMU_MODEL: m }, maxBuffer: 1 << 26 });
  const xs = SDXC ? SDXC_XFAIL[m] : null;
  if (xs) {
    const stopped = r.status !== 0 && xs[0].test(r.stdout + r.stderr);
    console.log(`${m} (${MODELS[m].name}) ${device}: ${stopped ? 'xfail' : 'FAILED, expected to stop (update SDXC_XFAIL):'} with a ${SECTORS / 2097152} GiB SDXC card: ${xs[1]}${stopped ? '' : ` | ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 400)}`}`);
    if (!stopped) bad++;
    continue;
  }
  const line = r.stdout.trim().split('\n').pop();
  let steps, probe, card;
  try { ({ steps, probe, card } = JSON.parse(line)); } catch { console.log(`${m} (${MODELS[m].name}) ${device}: FAILED ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 600)}`); bad++; continue; }
  const problems = [], notes = [];
  if (prompt && steps[0][1] !== prompt.state) problems.push(`start: GUI state 0x${steps[0][1].toString(16)}, want the prompt 0x${prompt.state.toString(16)} (START_PROMPT: ${prompt.why})`);
  steps.forEach(([k, state, name, images, frame], i) => {
    const [, wantState, wantImages] = path_[i];
    if (wantState !== null && name !== wantState) problems.push(`${k}: GUI state 0x${state.toString(16)} ${name}, want ${wantState}`);
    if (images !== wantImages) problems.push(`${k}: ${images} images, want ${wantImages}`);
    if (k !== 'start' && i < menuAt && !/^\d+x\d+$/.test(frame)) problems.push(`${k}: frame ${frame}`);
  });
  // the menu (MENU_PATH): each step against the state and frame before it, held against MENU_EVF_XFAIL on the EVF; a
  // step not run because an earlier one stopped the session is that one's problem
  const menuMissed = [], shoot = steps[menuAt - 1];
  steps.slice(menuAt).forEach(([k, state, , , frame, digest], j) => {
    const prev = steps[menuAt + j - 1], what = MENU_PATH[j][3];
    if (!/^\d+x\d+$/.test(frame)) { menuMissed.push(`menu ${k.toUpperCase()} (${what}): frame ${frame}`); return; }
    if (what === 'open' && (state === shoot[1] || digest === shoot[5])) menuMissed.push(`menu ${k.toUpperCase()}: GUI state 0x${state.toString(16)}${digest === shoot[5] ? ', the frame unchanged' : ''}, want the menu over the shooting screen's 0x${shoot[1].toString(16)}`);
    if (what === 'move' && (state !== prev[1] || digest === prev[5])) menuMissed.push(`menu ${k.toUpperCase()}: GUI state 0x${state.toString(16)}${digest === prev[5] ? ', the frame unchanged' : ''}, want the menu's 0x${prev[1].toString(16)} with the frame changed`);
    if (what === 'close' && state !== shoot[1]) menuMissed.push(`menu ${k.toUpperCase()}: GUI state 0x${state.toString(16)}, want the shooting screen's 0x${shoot[1].toString(16)} back`);
  });
  const mx = device === 'evf' ? MENU_EVF_XFAIL[m] : null;
  if (!mx) problems.push(...menuMissed);
  else if (menuMissed.some((x) => mx[0].test(x.replace(/^menu \S+ \(\w+\): frame /, '')))) notes.push(`xfail ${menuMissed.join('; ').slice(0, 200)} (${mx[1]})`);
  else if (!menuMissed.length && steps.length === path_.length) problems.push(`menu: passes on the EVF, expected to fail (${mx[1]}); update MENU_EVF_XFAIL`);
  else problems.push(...menuMissed);
  const box = (b) => b.join(',');
  const missed = [];                     // the count probe's own failures, held against PROBE_XFAIL
  if (!probe) problems.push('count probe: not run');
  else if (probe.error) problems.push(`count probe: ${probe.error}`);
  else {
    if (!probe.count) missed.push(`count probe: the screen does not show the card's count (no change at ${PROBE_SHOTS} shots)`);
    if (probe.back) missed.push(`count probe: the screen did not come back with the count (${box(probe.back)})`);
  }
  const xfail = PROBE_XFAIL[m];
  if (!xfail) problems.push(...missed);
  else if (missed.length) notes.push(`xfail ${missed.join('; ')} (${xfail})`);
  else if (probe && !probe.error) problems.push(`count probe: passes, expected to fail (${xfail}); update PROBE_XFAIL`);
  // the card with its file system native: mounted, counted from, and each picture's file read back
  const pictures = steps[steps.length - 1][3];
  if (card && (!card.mounted || !(card.shots > 0) || card.files !== pictures || card.found !== card.files || card.error)) {
    problems.push(`card: ${JSON.stringify(card)}, want mounted, shots from the card and ${pictures} file(s) read back`);
  }
  const shown = (probe?.count && !probe.back ? `, count at ${box(probe.count)}${probe.redraw ? ` (redrawn by ${probe.redraw} x ${PROBE_REDRAW[m].toUpperCase()})` : ''}` : '')
    + (card ? `; card ${card.gib} GiB ${card.kind}: ${card.type ?? '?'} '${card.label}'${card.cluster_kib ? ` at sector ${card.start} (${card.cluster_kib} KiB clusters)` : ''} ${card.formatted ? 'formatted, ' : ''}${card.shots} shots, ${card.found} file(s) read back` : '');
  console.log(`${m} (${MODELS[m].name}) ${device}: ${problems.length ? 'FAILED ' + problems.join('; ') : 'ok'} — ${steps.map(([k, st, , n, f]) => `${k} 0x${st.toString(16)} ${n} ${f}`).join(', ')}${shown}${notes.length ? '; ' + notes.join('; ') : ''}`);
  if (problems.length) bad++;
  }
}
if (!models.length) console.log('modelcheck: no ported model with its firmware unpacked');
process.exit(bad ? 1 : 0);
