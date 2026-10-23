#!/usr/bin/env node
// The ported models' smoke test: for each model whose firmware is unpacked (src/fw/models.mjs), update its address
// table in src/fw/ports.mjs (bin/port.mjs) and run, in a child on emu/ with OM_EMU_MODEL, a play session on the TFT
// and one on the EVF (a body with one: MODELS panels.evf) through the path every model must take: start, S1, S2 (a
// picture on the card), PLAY (single-frame playback), INFO, PLAY (back to shooting). Each step's GUI state (by its name
// in the model's own state table: the numbers differ, E143's playback is 0x508, the E144 family's 0x608) and card
// count is checked, and after S1 the screen's remaining-shots count (the count probe below); exit 1 on any failure.
// The count probe, after S1: three windows of WINDOW frames WINDOW_NS apart, at S-CARD's count, at PROBE_SHOTS and at
// the count again, each after PROBE_NS of idle. A pixel is the count's where it holds one value through the first
// window and another through the second (a pixel that changes within a window, as E146's blinking ISO item, X, is
// not); the screen shows the count the application asks S-CARD for where there is such a pixel and each of them is
// back to its first value through the third window. A "Card Full" warning, a count the screen does not draw and a
// count from another source than S-CARD's query leave no such pixel (X: E142 before the shots-query rule, E144). The
// box of the count's pixels is reported.
//   node emu/bin/modelcheck.mjs [MODEL ...] [--no-port]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MODELS, romPath } from '../src/fw/models.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const args = process.argv.slice(2), noPort = args.includes('--no-port');
const want = args.filter((a) => !a.startsWith('--'));
const models = (want.length ? want : Object.keys(MODELS).filter((k) => k !== 'E143' && MODELS[k].checked))
  .filter((k) => fs.existsSync(path.join(REPO, romPath(MODELS[k]))));

// [key, GUI state name after it, card images after it]
const PATH = [['start', null, 0], ['s1', null, 0], ['s2', null, 1], ['play', 'SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE', 1],
  ['info', 'SS_PLAY_SINGLE/ID_ST_DISP_DETAIL', 1], ['play', null, 1]];
const PROBE_NS = 1200e6, PROBE_SHOTS = 777, WINDOW = 6, WINDOW_NS = 300e6;
const CHILD = `
const J = process.argv[1], DEVICE = process.argv[2], PROBE_NS = ${PROBE_NS}, PROBE_SHOTS = ${PROBE_SHOTS},
  WINDOW = ${WINDOW}, WINDOW_NS = ${WINDOW_NS};
const { createHash } = await import('node:crypto');
const zlib = await import('node:zlib');
const { loadImage, loadBlock } = await import(J + '/bin/run.mjs');
const { Player } = await import(J + '/src/lab/player.mjs');
const { PLAYER_PARSER } = await import(J + '/scenarios/session_replay.mjs');
const env = { rom: loadImage(), resBlock: loadBlock(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: DEVICE }, { ...env, wallClock: () => performance.now() / 1000 });
pl.open_session();
const s = pl.session, lab = s.lab, out = [];
const rec = (k) => { let frame = null; try { const [w, h] = s.frame('boundary', true); frame = w + 'x' + h; } catch (e) { frame = 'error: ' + e.message.split('\\n')[0].slice(0, 120); } out.push([k, lab.state(), lab.state_names.get(lab.state()) ?? '?', s.camapp.status().card_images, frame]); };
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
let probe = null;
for (const k of JSON.parse(process.argv[3])) {
  s.key(k, 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 1200e6); rec(k);
  if (k !== 's1') continue;
  try {
    const keep = s.camapp.card_shots, a = window_();
    s.camapp.card_shots = PROBE_SHOTS; s.idle_slice(lab.lab_time() + PROBE_NS); const b = window_();
    s.camapp.card_shots = keep; s.idle_slice(lab.lab_time() + PROBE_NS); const c = window_();
    const count = (i) => a.stable[i] && b.stable[i] && a.val[i] !== b.val[i], n = a.val.length;
    probe = { count: boxOf(a.w, n, count), back: boxOf(a.w, n, (i) => count(i) && (!c.stable[i] || c.val[i] !== a.val[i])) };
  } catch (e) { probe = { error: e.message.split('\\n')[0].slice(0, 120) }; }
}
console.log(JSON.stringify({ steps: out, probe }));
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
  const path_ = device === 'evf' ? PATH.slice(0, 3) : PATH;
  const r = spawnSync(process.execPath, ['--max-old-space-size=6144', '--input-type=module', '-e', CHILD, path.join(REPO, 'emu'), device, JSON.stringify(path_.slice(1).map((p) => p[0]))], { encoding: 'utf8', env: { ...process.env, OM_EMU_MODEL: m }, maxBuffer: 1 << 26 });
  const line = r.stdout.trim().split('\n').pop();
  let steps, probe;
  try { ({ steps, probe } = JSON.parse(line)); } catch { console.log(`${m} (${MODELS[m].name}) ${device}: FAILED ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 600)}`); bad++; continue; }
  const problems = [];
  steps.forEach(([k, state, name, images, frame], i) => {
    const [, wantState, wantImages] = path_[i];
    if (wantState !== null && name !== wantState) problems.push(`${k}: GUI state 0x${state.toString(16)} ${name}, want ${wantState}`);
    if (images !== wantImages) problems.push(`${k}: ${images} images, want ${wantImages}`);
    if (k !== 'start' && !/^\d+x\d+$/.test(frame)) problems.push(`${k}: frame ${frame}`);
  });
  const box = (b) => b.join(',');
  if (!probe) problems.push('count probe: not run');
  else if (probe.error) problems.push(`count probe: ${probe.error}`);
  else {
    if (!probe.count) problems.push(`count probe: the screen does not show the card's count (no change at ${PROBE_SHOTS} shots)`);
    if (probe.back) problems.push(`count probe: the screen did not come back with the count (${box(probe.back)})`);
  }
  const shown = probe?.count && !probe.back ? `, count at ${box(probe.count)}` : '';
  console.log(`${m} (${MODELS[m].name}) ${device}: ${problems.length ? 'FAILED ' + problems.join('; ') : 'ok'} — ${steps.map(([k, st, , n, f]) => `${k} 0x${st.toString(16)} ${n} ${f}`).join(', ')}${shown}`);
  if (problems.length) bad++;
  }
}
if (!models.length) console.log('modelcheck: no ported model with its firmware unpacked');
process.exit(bad ? 1 : 0);
