// S-MODPOST, the posts to S-MODACK's module queues that do not come through the application's API sender
// (src/lab/camapp.mjs MODPOST_E143; docs/hle-gaps.md 4.1.11), and S-MODACK's PC_PD_CMD_EXEC by its object name
// (src/fw/facts.mjs objectNameId; docs/model-survey.md finding 130):
//   modpostUnits   (no firmware) the rule modpost_entry: each post it lists (eighteen, from the API layer's direct
//                  senders and 0x503a05fb) matches by its queue, OlyQeWr's return in the sender's wrapper and the whole
//                  16-byte message; a reply queue, another command, parameter, token, return or queue, a message of
//                  another length and another body are not taken; the blocked-send guard's report names what
//                  S-MODPOST passed on (modpost_note through PlaySession.check_sends); objectNameId on synthetic name
//                  tables (the id, none, a record outside a run of records, two records)
//   modpostSession E143 in play. Control camapp 3: the start's TAKE_FUNC command 29 (from 0x503a05fb) is taken, the
//                  queue holds nothing and the player lists S-MODPOST; once the menu has restarted the through image
//                  S2 posts TAKE_EXEC command 5 (the take API's control 0x40: the S2 of a take-ready not finished,
//                  so with S-TAKERDY off, src/lab/camapp.mjs takerdy_on), taken too; over a long workload (the
//                  heapWorkloadSession pattern: passes of S1, S2, the menu and playback) no queue of S-MODACK's holds a
//                  message; the control (S-MODPOST's list emptied) leaves one message in each queue, named with its
//                  sender and task. The default session (camapp 1): the same workload makes no direct post and leaves
//                  every queue empty; each listed API-layer sender run from the lab (API 0x20030's six kinds among
//                  them) has its post taken, no queue holding it; a post S-MODPOST does not list (ZOOM_EXEC's
//                  command 3, which no sender posts, through the API's direct post from the lab) stays: ZOOM_EXEC
//                  holds one message, the second send waits, and the guard names the queue and the two posts with
//                  their sender
//   node emu/test/test_modpost.mjs [units|session]
const h8 = (v) => '0x' + (v >>> 0).toString(16);
// TAKE's queue count (0x502ce6ae, d0 the queue: ref_dtq's message count, D; test_take_release.mjs uses it for
// TAKE_EXEC); TAKE_EXEC and TAKE_FUNC (src/fw/facts.mjs API_TARGETS_E143's targets 6 and 25); the senders' wrappers'
// OlyQeWr returns: the API's direct post 0x503ebe46 and TAKE's send 0x502ce57b (D)
const QUEUE_COUNT = 0x502CE6AE, TAKE_EXEC = 0x5A, TAKE_FUNC = 0x5E, VIA_API_POST = 0x503EBE71, VIA_TAKE_SEND = 0x502CE58C;
// the API layer's direct senders S-MODPOST lists, run from the lab ([entry, d0 (API 0x20014's kind), how: 'call' for an
// entry the call's register list frames, 'calls' for one with its own movm (0x50411caa)], D: docs/hle-gaps.md 4.1.11),
// and the posts each makes, API 0x20030 (api_rec 0x504100f2) by its kinds 1, 2, 3, 4, 7, 8 among them (ZOOM_EXEC
// {0, 0, 2 / 1 / 9 / 8 / 7 / 6, 0} through 0x503ebe46, D); the post S-MODPOST does not list: ZOOM_EXEC {0, 0, 3, 0}
// through 0x503ebe46 from the lab (its struct {queue, timeout, size, 0, message}, D: 0x503ebe46's reads; command 3 is
// API 0x20030's kind 0, a synchronous send, and no sender of the scan posts it, D); ZOOM_EXEC holds one message (X:
// the second send waits); OlyQeWr's tsnd_dtq call returns to 0x5002c1f8
const API_ZOOM = 0x504100F2, API_DIRECT_POST = 0x503EBE46, ZOOM_EXEC = 0x7D, ZOOM_HOLDS = 1, TSND_RETURN = '0x5002c1f8';
const ZOOM_KINDS = [[1, 2], [2, 1], [3, 9], [4, 8], [7, 7], [8, 6]], ZOOM_UNLISTED = 3;
const API_SENDERS = [[0x5040F040, 1, 'call', 'TAKE_EXEC (90) cmd 17'], [0x5040F040, 2, 'call', 'TAKE_EXEC (90) cmd 15'],
  [0x5040F040, 3, 'call', 'TAKE_EXEC (90) cmd 14'], [0x5040F040, 4, 'call', 'TAKE_EXEC (90) cmd 16'],
  [0x5040F040, 5, 'call', 'TAKE_FUNC (94) cmd 54'], [0x504148DC, 0, 'call', 'TAKE_EXEC (90) cmd 19'],
  [0x50418CDB, 0, 'call', 'TAKE_EXEC (90) cmd 20'], [0x50411CAA, 0, 'calls', 'TAKE_EXEC (90) cmd 14'],
  [0x50411E33, 0, 'call', 'TAKE_FUNC (94) cmd 5'], [0x5041C726, 0, 'call', 'TAKE_FUNC (94) cmd 37'],
  [0x50416123, 0, 'call', 'TAKE_FUNC (94) cmd 29'],
  ...ZOOM_KINDS.map(([kind, c]) => [API_ZOOM, kind, 'call', `ZOOM_EXEC (125) cmd ${c}`])];
const QUEUES = { TAKE_EXEC, TAKE_FUNC, ZOOM_EXEC };

export async function modpostUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { modpost_entry, MODPOST_E143, CamApp } = await import('../src/lab/camapp.mjs');
  const { PlaySession } = await import('../src/lab/play.mjs');
  const { objectNameId } = await import('../src/fw/facts.mjs');
  const take = (q, ra, w, queues = QUEUES, onLab = true) => modpost_entry(q, ra, w, queues, onLab)?.[0] ?? null;
  const LISTED = [[TAKE_EXEC, VIA_API_POST, [5, 17, 15, 14, 16, 19, 20]], [TAKE_EXEC, VIA_TAKE_SEND, [14]],
    [TAKE_FUNC, VIA_API_POST, [5, 37, 54]], [ZOOM_EXEC, VIA_API_POST, ZOOM_KINDS.map(([, c]) => c)]];
  const want = [...LISTED.flatMap(([q, ra, cmds]) => cmds.map((c) => [q, ra, [0, 0, c, 0]])), [TAKE_FUNC, VIA_TAKE_SEND, [0, 0, 29, 0x62A3F2BE]]];
  const named = Object.fromEntries(Object.entries(QUEUES).map(([n, q]) => [q, n]));
  ok(MODPOST_E143.length === want.length && want.every(([q, ra, w]) => take(q, ra, w) === named[q]),
    `the ${want.length} listed posts are taken (${MODPOST_E143.length} listed)`);
  const not = [
    ['a reply queue', TAKE_EXEC, VIA_API_POST, [6, 0, 5, 0]], ['a token', TAKE_EXEC, VIA_API_POST, [0, 1, 5, 0]],
    ['another command', TAKE_EXEC, VIA_API_POST, [0, 0, 18, 0]], ['another parameter', TAKE_FUNC, VIA_TAKE_SEND, [0, 0, 29, 0]],
    ['another sender\'s wrapper', TAKE_EXEC, VIA_TAKE_SEND, [0, 0, 5, 0]], ['another queue', ZOOM_EXEC, VIA_API_POST, [0, 0, 5, 0]],
    ['a message of another length', TAKE_EXEC, VIA_API_POST, null], ['ZOOM_EXEC\'s unlisted command', ZOOM_EXEC, VIA_API_POST, [0, 0, ZOOM_UNLISTED, 0]]];
  for (const [what, q, ra, w] of not) ok(take(q, ra, w) === null, `not taken: ${what}`);
  ok(take(TAKE_EXEC, VIA_API_POST, [0, 0, 5, 0], { TAKE_EXEC: 0x5B }) === null, 'not taken: the queue is the body\'s TAKE_EXEC only');
  ok(take(TAKE_EXEC, VIA_API_POST, [0, 0, 5, 0], QUEUES, false) === null, 'not taken: another body (its senders are not read)');
  // the guard's report: what S-MODPOST passed on to the full queue, after the blocked send
  const left = new Map([[TAKE_EXEC, [{ what: 'TAKE_EXEC (90) cmd 19', from: h8(VIA_API_POST), task: 160 }, { what: 'TAKE_EXEC (90) cmd 19', from: h8(VIA_API_POST), task: 160 }]]]);
  const note = (q) => CamApp.prototype.modpost_note.call({ modpost_left: left }, q);
  const lab = { tsnd_pending: new Map([['160:x', 1]]), blocked_sends: () => [[TAKE_EXEC, 'X', 'idle', 160]], task_states: () => ({}), queue_note: note };
  let msg = null;
  try { PlaySession.prototype.check_sends.call({ lab }, 'test'); } catch (e) { msg = e.message; }
  ok(note(TAKE_FUNC) === '' && /queue 90 from X in task 160 \(since step idle\) \[S-MODPOST passed on 2 direct posts to it: 2 x TAKE_EXEC \(90\) cmd 19 from 0x503ebe71 in task 160\]/.test(msg ?? ''),
    `the guard names the full queue and the posts S-MODPOST passed on: ${msg}`);
  // objectNameId: {char name[24], u16 id} records in a run of at least 100
  const table = (names, at = 64) => {
    const img = new Uint8Array(at + 26 * names.length + 64);
    names.forEach(([n, id], k) => { const o = at + 26 * k; [...n].forEach((c, i) => { img[o + i] = c.charCodeAt(0); }); img[o + 24] = id & 0xff; img[o + 25] = id >> 8; });
    return img;
  };
  const run = Array.from({ length: 120 }, (_, k) => [`OBJ_${k}`, k + 1]);
  const withName = run.map((x, k) => (k === 60 ? ['PC_PD_CMD_EXEC', 0xCF] : x));
  ok(objectNameId(table(withName), 'PC_PD_CMD_EXEC') === 0xCF, 'objectNameId: the record\'s id');
  ok(objectNameId(table(run), 'PC_PD_CMD_EXEC') === null, 'objectNameId: none where no record holds the name');
  ok(objectNameId(table([['PC_PD_CMD_EXEC', 0xCF], ...run.slice(0, 20)]), 'PC_PD_CMD_EXEC') === null, 'objectNameId: none outside a run of 100 records');
  let two = null;
  try { objectNameId(table([...withName, ['PC_PD_CMD_EXEC', 0xD6]]), 'PC_PD_CMD_EXEC'); } catch (e) { two = e.message; }
  ok(/2 records named PC_PD_CMD_EXEC/.test(two ?? ''), `objectNameId: two records refused: ${two}`);
  return { checks, bad };
}

export async function modpostSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODPOST_E143 } = await import('../src/lab/camapp.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const open = (mode, control = false) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
    pl.camapp_components = mode === 3; pl.camapp_native_tra = mode === 3;
    const saved = MODPOST_E143.splice(0, control ? MODPOST_E143.length : 0);    // the control: none taken
    const close = () => { pl.close_session(); MODPOST_E143.push(...saved); };       // (until the session closes)
    try { pl.open_session(); } catch (e) { close(); throw e; }
    const s = pl.session, lab = s.lab, ca = s.camapp;
    // S-TAKERDY off (docs/hle-gaps.md 4.1.12): with it S1's take-ready finishes at once and S2 asks for the picture
    // through the API sender (command 11); the take API's control 0x40, the direct post of command 5, is the S2 of a
    // take-ready not yet finished, which the lab reaches only so
    ca.takerdy_on = false;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const key = (k) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); };
    const pass = (more = true) => {
      s.key('s1', 'down'); s.camapp.pump(); idle(600);
      s.key('s2', 'down'); s.camapp.pump(); idle(700);
      s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(500);
      if (more) { key('menu'); key('menu'); key('play'); key('play'); idle(2000); }
    };
    const held = (q) => lab.call(QUEUE_COUNT, { d0: q }, null, null, 200000).d0;
    const holding = () => [...ca.module_queues].map((q) => [q, held(q)]).filter(([, n]) => n);
    const posts = () => [...s.steps.flatMap((x) => x.camapp ?? []), ...ca.log].filter(([k]) => k === 'modpost').map(([, d]) => d);
    return { pl, close, s, lab, ca, idle, key, pass, held, holding, posts };
  };
  const PASSES = 6;
  // control camapp 3: the two posts taken; then the long workload
  {
    const t = open(3);
    try {
      const start = t.posts();
      ok(start.length === 1 && /^TAKE_FUNC \(94\) cmd 29 \[0x00000000 0x00000000 0x0000001d 0x62a3f2be\] from \S+ \(disasm 0x502ce58c\): taken/.test(start[0])
        && t.held(TAKE_FUNC) === 0 && t.pl.stand_ins_in_use().includes('S-MODPOST'),
        `camapp 3: the start's TAKE_FUNC 29 taken (${JSON.stringify(start)}), TAKE_FUNC holds ${t.held(TAKE_FUNC)}, S-MODPOST listed ${t.pl.stand_ins_in_use().includes('S-MODPOST')}`);
      t.idle(2000);
      t.pass(false); t.key('menu'); t.key('menu'); t.pass(false); t.idle(1000);       // S1 passes the guard after the menu
      const s2 = t.posts().slice(1);
      ok(s2.length === 1 && /^TAKE_EXEC \(90\) cmd 5 \[0x00000000 0x00000000 0x00000005 0x00000000\] from \S+ \(disasm 0x503ebe71\): taken/.test(s2[0])
        && t.held(TAKE_EXEC) === 0 && t.ca.modpost_taken === 2,
        `camapp 3: S2's TAKE_EXEC 5 taken (${JSON.stringify(s2)}), TAKE_EXEC holds ${t.held(TAKE_EXEC)}, taken ${t.ca.modpost_taken}`);
      const kept = [];
      for (let i = 0; i < PASSES; i++) { t.pass(); const hq = t.holding(); if (hq.length) kept.push([i, hq]); }
      ok(!kept.length && t.posts().length === 2 && !t.ca.modpost_left.size,
        `camapp 3: over ${PASSES} passes of S1, S2, the menu and playback no module queue holds a message (${JSON.stringify(kept)}), no further direct post (${t.posts().length - 2})`);
    } catch (e) { bad.push(`camapp 3: ${e.message.slice(0, 600)}`); }
    t.close();
  }
  // the control: S-MODPOST's list emptied, both messages stay, each named with its sender and task
  {
    const t = open(3, true);
    try {
      const f = t.held(TAKE_FUNC), lf = t.ca.modpost_left.get(TAKE_FUNC) ?? [];
      t.idle(2000);
      t.pass(false); t.key('menu'); t.key('menu'); t.pass(false); t.idle(1000);
      const e = t.held(TAKE_EXEC), le = t.ca.modpost_left.get(TAKE_EXEC) ?? [];
      ok(f === 1 && e === 1 && lf.length === 1 && lf[0].from === h8(VIA_TAKE_SEND) && lf[0].task === 57 && le.length === 1 && le[0].from === h8(VIA_API_POST) && le[0].task === 57
        && !t.pl.stand_ins_in_use().includes('S-MODPOST'),
        `control: with none taken TAKE_FUNC holds ${f} (${JSON.stringify(lf)}) and TAKE_EXEC ${e} (${JSON.stringify(le)})`);
    } catch (e) { bad.push(`control: ${e.message.slice(0, 600)}`); }
    t.close();
  }
  // the default session: no direct post over the workload; a post S-MODPOST does not take stays, and the guard names it
  {
    const t = open(1);
    try {
      t.idle(10000);
      const kept = [];
      for (let i = 0; i < PASSES; i++) { t.pass(); const hq = t.holding(); if (hq.length) kept.push([i, hq]); }
      ok(!kept.length && !t.posts().length && t.s.status().gui === '0x0108',
        `camapp 1: over ${PASSES} passes no direct post (${JSON.stringify(t.posts().slice(0, 2))}) and no module queue holds a message (${JSON.stringify(kept)}), GUI ${t.s.status().gui}`);
      // the API layer's listed senders run from the lab: each post taken, no queue holding it
      const runs = [];
      for (const [fn, d0, how, what] of API_SENDERS) {
        const n0 = t.ca.modpost_taken, p0 = t.posts().length;
        if (how === 'calls') t.lab.calls(fn, { d0, d1: 0 }, undefined, undefined, 2000000); else t.lab.call(fn, { d0, d1: 0 }, null, null, 2000000);
        const p = t.posts().slice(p0);
        runs.push([h8(fn), d0, t.ca.modpost_taken - n0, p.length === 1 && p[0].startsWith(what + ' ') && /: taken as /.test(p[0]), t.held(TAKE_EXEC), t.held(TAKE_FUNC), t.held(ZOOM_EXEC)]);
      }
      ok(runs.every(([, , n, named, e, f, z]) => n === 1 && named && !e && !f && !z) && !t.ca.modpost_left.size,
        `camapp 1: each listed API sender's post taken, TAKE_EXEC, TAKE_FUNC and ZOOM_EXEC holding none: ${JSON.stringify(runs.filter(([, , n, named, e, f, z]) => n !== 1 || !named || e || f || z))}`);
      // a post S-MODPOST does not list stays: ZOOM_EXEC holds one, the second send waits, the guard names both
      const post = () => {
        const msg = new Uint8Array(16), st = new Uint8Array(20), m = new DataView(msg.buffer), v = new DataView(st.buffer);
        m.setUint32(8, ZOOM_UNLISTED, true);
        [ZOOM_EXEC, 0xFFFFFFFF, 16, 0, t.lab.alloc(msg, 4)].forEach((w, k) => v.setUint32(4 * k, w >>> 0, true));
        t.lab.call(API_DIRECT_POST, { a0: t.lab.alloc(st, 4) }, null, null, 2000000);
      };
      let n = 0, stop = null;
      try { for (; n <= ZOOM_HOLDS; n++) post(); } catch (e) { stop = e.message; }
      const left = t.ca.modpost_left.get(ZOOM_EXEC) ?? [];
      let guard = null;
      try { t.s.check_sends('test'); } catch (e) { guard = e.message; }
      const zoom = `ZOOM_EXEC \\(125\\) cmd ${ZOOM_UNLISTED} \\[0x00000000 0x00000000 0x0000000${ZOOM_UNLISTED} 0x00000000\\] from 0x503ebe71 in task \\d+`;
      const re = new RegExp(`waits on a full queue: queue ${ZOOM_EXEC} from \\S+ \\(disasm ${TSND_RETURN}\\) in task \\d+ \\(since step [^)]*\\) \\[S-MODPOST passed on ${ZOOM_HOLDS + 1} direct posts to it: ${ZOOM_HOLDS + 1} x ${zoom}\\]`);
      ok(n === ZOOM_HOLDS && stop !== null && t.held(ZOOM_EXEC) === ZOOM_HOLDS && left.length === ZOOM_HOLDS + 1 && re.test(guard ?? ''),
        `camapp 1: ZOOM_EXEC's unlisted command ${ZOOM_UNLISTED} stays: ${n} sent, ZOOM_EXEC holds ${t.held(ZOOM_EXEC)}, the next waits (${stop?.slice(0, 120)}); the guard: ${guard?.slice(0, 400)}`);
    } catch (e) { bad.push(`camapp 1: ${e.message.slice(0, 600)}`); }
    t.close();
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  const u = !only || only === 'units' ? await modpostUnits() : { checks: 0, bad: [] };
  const s = !only || only === 'session' ? await modpostSession() : { checks: 0, bad: [] };
  console.log(`S-MODPOST units: ${u.checks - u.bad.length}/${u.checks}; in play: ${s.checks - s.bad.length}/${s.checks}`);
  [...u.bad, ...s.bad].forEach((x) => console.log('  ', x));
  process.exit(u.bad.length || s.bad.length ? 1 : 0);
}
