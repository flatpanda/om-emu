// The TAKE probe (src/lab/take.mjs, --take probe; docs/hle-gaps.md 4.1.4), E143:
//   takeSession  a default session has no probe (camapp.take null, no take option in the recorded options, S-MODACK
//                answers TAKE_FUNC's queue); with --take probe, under camapp 1 and camapp 2 (control camapp 2), the
//                application's start reaches the shooting screen with TAKE_FUNC and TAKE_FUNC_CP native, and the
//                record of what they take and ask is exactly START (camapp 2: START_COMPONENTS): command 0's start
//                sequence in TAKE_FUNC_CP (the camera driver's requests 148 and 6, BC_EXEC, the native LENS_EXEC,
//                STB_EXTERNAL twice and the dust filter, each answered where TAKE waits, then TAKE's reply to the
//                application), commands 13 and 18 (and with the components 29 and 22); then a live view, S1, S2, MENU
//                in and out reach TAKE with nothing, a mode change P -> A is MODE_CHANGE, and the through start
//                (command 25) is never taken: the shooting component that would start the through image does not
//                get TRA 991 while S-TRAACK answers it (docs/hle-gaps.md 4.1.2)
//   node emu/test/test_take.mjs
import { fileURLToPath } from 'node:url';

// the record in a canonical form: '<task> <= <command>' for a message TAKE takes, '<task> -> <target> <command>
// [sync] (<answer kind>)' for a request
export function canon(r) {
  if (r.dir === 'in') return `${r.task} <= ${r.command}`;
  const kind = r.answer.startsWith('native: TAKE') ? 'reply' : r.answer.startsWith('native') ? 'native' : r.answer.startsWith('none') ? 'unanswered' : 'answered';
  if (kind === 'reply') return `${r.task} -> reply`;
  const what = r.queue === null ? r.name.replace(/ \(.*$/, '') : `${r.name} ${r.command}`;
  return `${r.task} -> ${what}${r.sync ? ' sync' : ''} (${kind})`;
}
const CP0 = ['TAKE_FUNC <= 0', 'TAKE_FUNC -> TAKE_FUNC_CP 0 (native)', 'TAKE_FUNC_CP <= 0',
  'TAKE_FUNC_CP -> camera driver request 148 (answered)', 'TAKE_FUNC_CP -> BC_EXEC 0 (answered)',
  'TAKE_FUNC_CP -> LENS_EXEC 1 (native)', 'TAKE_FUNC_CP -> camera driver request 6 (answered)',
  'TAKE_FUNC_CP -> STB_EXTERNAL 1 (answered)', 'TAKE_FUNC_CP -> dust filter gate on (answered)',
  'TAKE_FUNC_CP -> STB_EXTERNAL 4 (answered)', 'TAKE_FUNC_CP -> reply'];
export const START = [...CP0, 'TAKE_FUNC <= 13', 'TAKE_FUNC -> TAKE_EXPOSE 0 sync (answered)', 'TAKE_FUNC -> reply',
  'TAKE_FUNC <= 18', 'TAKE_FUNC -> TAKE_FOCUS 0 (unanswered)', 'TAKE_FUNC -> reply'];
export const START_COMPONENTS = [...START, 'TAKE_FUNC <= 29', 'TAKE_FUNC -> reply', 'TAKE_FUNC <= 22',
  'TAKE_FUNC -> TAKE_FOCUS 2 sync (answered)', 'TAKE_FUNC -> reply'];
const PROBE_STAND_INS = ['H-TAKEINIT', 'S-TAKEREQ', 'S-TAKECAM', 'S-TAKEUSF'];
const C22 = ['TAKE_FUNC <= 22', 'TAKE_FUNC -> TAKE_FOCUS 2 sync (answered)', 'TAKE_FUNC -> reply'];
export const MODE_CHANGE = [...C22, ...C22, ...C22];

export async function takeSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  // off by default: no probe, TAKE_FUNC's queue answered by S-MODACK as before
  {
    const pl = new Player(args, env);
    try {
      pl.open_session();
      const s = pl.session, acks = s.steps.flatMap((st) => st.camapp ?? []).filter(([k, d]) => k === 'ack' && /^queue 94 /.test(d));
      ok(s.camapp.take === null && !('take' in pl.opts()) && !pl.stand_ins_in_use().some((x) => PROBE_STAND_INS.includes(x)) && acks.length === 1,
        `default: no probe (camapp.take ${s.camapp.take}, options ${JSON.stringify(pl.opts())}), S-MODACK answers TAKE_FUNC's command 0 (${acks.length} acks)`);
    } catch (e) { bad.push(`default: ${e.message.slice(0, 600)}`); }
    pl.close_session();
  }
  for (const mode of [1, 2]) {
    const pl = new Player({ ...args, take: 'probe' }, env);
    pl.camapp_components = mode === 2;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, take = s.camapp.take;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) { s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); s.frame(); } };
      let n = 0;
      const since = () => { const out = take.requests.slice(n).map(canon); n = take.requests.length; return out; };
      const same = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `camapp ${mode}, ${what}: the record ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      ok(pl.opts().take === 'probe' && [...PROBE_STAND_INS, 'S-MODACK'].every((x) => pl.stand_ins_in_use().includes(x)) && s.status().gui === '0x0108',
        `camapp ${mode}: the probe runs and the start reaches the shooting screen (GUI ${s.status().gui}, stand-ins ${pl.stand_ins_in_use().filter((x) => x.includes('TAKE'))})`);
      same(since(), mode === 2 ? START_COMPONENTS : START, 'the start');
      idle(1000);
      s.scene_input({ liveview: true }); s.camapp.pump(); idle(1000);
      s.key('s1', 'down'); s.camapp.pump(); idle(600);
      s.key('s2', 'down'); s.camapp.pump(); idle(700);
      s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(800);
      for (let k = 0; k < 2; k++) { s.key('menu', 'down'); s.camapp.pump(); idle(100); s.key('menu', 'up'); s.camapp.pump(); idle(800); }
      same(since(), [], 'a live view, S1, S2, MENU in and out');
      const names = s.status().mode_dial_positions.map((p) => p.name);
      s.switch_input('mode_dial', names.indexOf('A')); s.camapp.pump(); idle(2000);
      same(since(), MODE_CHANGE, 'the mode change P -> A');
      ok(!take.requests.some((r) => r.dir === 'in' && r.command === 25) && s.status().gui === '0x0108' && take.pending.length === 0,
        `camapp ${mode}: no through start (command 25) taken, nothing left to answer (${take.pending.length}), GUI ${s.status().gui}`);
    } catch (e) { bad.push(`camapp ${mode}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  }
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await takeSession();
  console.log(`the TAKE probe: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
