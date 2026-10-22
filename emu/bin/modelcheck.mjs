#!/usr/bin/env node
// The ported models' smoke test: for each model whose firmware is unpacked (src/fw/models.mjs), update its address
// table in src/fw/ports.mjs (bin/port.mjs) and run, in a child on emu/ with OM_EMU_MODEL, a play session on the TFT
// and one on the EVF through the path every model must take: start, S1, S2 (a picture on the card), PLAY (single-frame
// playback), INFO, PLAY (back to shooting). Each step's GUI state and card count is checked; exit 1 on any failure.
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

// [key, GUI state after it, card images after it]
const PATH = [['start', null, 0], ['s1', null, 0], ['s2', null, 1], ['play', 0x508, 1], ['info', 0x50b, 1], ['play', null, 1]];
const CHILD = `
const J = process.argv[1], DEVICE = process.argv[2];
const { createHash } = await import('node:crypto');
const zlib = await import('node:zlib');
const { loadImage, loadBlock } = await import(J + '/bin/run.mjs');
const { Player } = await import(J + '/src/lab/player.mjs');
const { PLAYER_PARSER } = await import(J + '/scenarios/session_replay.mjs');
const env = { rom: loadImage(), resBlock: loadBlock(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: DEVICE }, { ...env, wallClock: () => performance.now() / 1000 });
pl.open_session();
const s = pl.session, lab = s.lab, out = [];
const rec = (k) => { let frame = null; try { const [w, h] = s.frame('boundary', true); frame = w + 'x' + h; } catch (e) { frame = 'error: ' + e.message.split('\\n')[0].slice(0, 120); } out.push([k, lab.state(), s.camapp.status().card_images, frame]); };
s.idle_slice(lab.lab_time() + 1500e6); rec('start');
for (const k of JSON.parse(process.argv[3])) { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 1200e6); rec(k); }
console.log(JSON.stringify(out));
`;
let bad = 0;
for (const m of models) {
  if (!noPort) {
    const p = spawnSync(process.execPath, ['--max-old-space-size=10240', path.join(REPO, 'emu/bin/port.mjs'), m], { encoding: 'utf8' });
    if (p.status !== 0) { console.log(`${m}: port failed: ${p.stderr.slice(-400)}`); bad++; continue; }
  }
  // the EVF runs the path up to S2: playback on the EVF navigates, but its composite uses a PLANC (0xb2) and the
  // highlight block the VSC model has not observed (open, on E143 too)
  for (const device of ['tft', 'evf']) {
  const path_ = device === 'evf' ? PATH.slice(0, 3) : PATH;
  const r = spawnSync(process.execPath, ['--max-old-space-size=6144', '--input-type=module', '-e', CHILD, path.join(REPO, 'emu'), device, JSON.stringify(path_.slice(1).map((p) => p[0]))], { encoding: 'utf8', env: { ...process.env, OM_EMU_MODEL: m }, maxBuffer: 1 << 26 });
  const line = r.stdout.trim().split('\n').pop();
  let steps;
  try { steps = JSON.parse(line); } catch { console.log(`${m} (${MODELS[m].name}) ${device}: FAILED ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 600)}`); bad++; continue; }
  const problems = [];
  steps.forEach(([k, state, images, frame], i) => {
    const [, wantState, wantImages] = path_[i];
    if (wantState !== null && state !== wantState) problems.push(`${k}: GUI state 0x${state.toString(16)}, want 0x${wantState.toString(16)}`);
    if (images !== wantImages) problems.push(`${k}: ${images} images, want ${wantImages}`);
    if (k !== 'start' && !/^\d+x\d+$/.test(frame)) problems.push(`${k}: frame ${frame}`);
  });
  console.log(`${m} (${MODELS[m].name}) ${device}: ${problems.length ? 'FAILED ' + problems.join('; ') : 'ok'} — ${steps.map(([k, st, n, f]) => `${k} 0x${st.toString(16)} ${n} ${f}`).join(', ')}`);
  if (problems.length) bad++;
  }
}
if (!models.length) console.log('modelcheck: no ported model with its firmware unpacked');
process.exit(bad ? 1 : 0);
