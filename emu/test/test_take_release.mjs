// The release route to TAKE_EXEC (src/lab/take.mjs round 2, --take probe; docs/hle-gaps.md 4.1.7), E143:
//   releaseSession  three play sessions. Under control camapp 3 without the probe the sequence parts take S1 (event
//                   826, Trig1Release, in phase 101) but refuse it at their S1 guard (0x50c8d4a4 -> 0x50bcdef7):
//                   CapThr's state word is its static 0x02010202, and CapTak_Take's take request is never made. Under
//                   camapp 3 with --take probe (H-TAKEMAIN, S-THRTAKEOVER) the guard passes, CapTak_Take asks the take
//                   API 0x50417cd9 with control 0x20 at S1 and 0x40 at S2, and TAKE_MAIN takes S1's request natively:
//                   TAKE_EXEC command 0 in its state Idle, then FACE_FD 15 (S-TAKEREQ), TAKE_FUNC 80 (native),
//                   TAKE_FOCUS 0x300 with its callback record (S-TAKEREQ, reply token 1 to TAKE_POST), its reply,
//                   TAKE_FUNC 80 again; nothing in its mailbox. TAKE_MAIN then waits in RdyFcsRdy1 with the pending
//                   bits 0x5e for TAKE_FOCUS's callbacks, and S2's TAKE_EXEC command 5 waits in its queue. Under camapp
//                   1 with the probe TAKE_MAIN runs and S1 reaches nothing (no S-THRTAKEOVER). S-RELSEQ in all three
//   node emu/test/test_take_release.mjs
import { fileURLToPath } from 'node:url';

const h8 = (v) => '0x' + (v >>> 0).toString(16);
// TAKE_MAIN's state (u16), its state table (20 bytes a state, +4 the name), its pending bits and wait pattern, TAKE's
// queue count 0x502ce6ae (d0 the queue; 0x50399827 calls it for TAKE_EXEC), CapThr's state word
const MAIN_STATE = 0x62A3F018, MAIN_STATES = 0x605BFBC8, MAIN_PENDING = 0x62A3F03C, MAIN_PATTERN = 0x62A3F024;
const QUEUE_COUNT = 0x502CE6AE, TAKE_EXEC = 0x5A, THR_STATE = 0x60362B38;
// observed: the take API (its d0 control and caller), the S1 guard's CapThr test (0x50c8d4bb, d0), the sequence's
// state-4 handler after the event id and the phase (0x50c5b2f2: d0 the phase, the id at (16,sp))
const TAKE_API = 0x50417CD9, S1_GUARD_TEST = 0x50C8D4BB, SEQ_EVENT = 0x50C5B2F2, HISTOGRAM = 944;
const PROBE2 = ['H-TAKEMAIN', 'S-THRTAKEOVER'];

// the record in a canonical form: '<task> <= <queue> <command or token> [in <state>]' for what TAKE takes, '<task> ->
// <target> <command> [sync] (<answer kind>)' for a request, '<task> -> reply' for its reply
export function canon2(r, stateName) {
  if (r.dir === 'in') {
    const what = r.command === null || r.command === undefined ? `token ${r.token}` : `${r.command}`;
    return `${r.task} <=${r.queue ? ' ' + r.queue : ''} ${what}${r.state !== undefined ? ` in ${stateName(r.state)}` : ''}${r.handler ? ` (handler ${h8(r.handler)})` : ''}`;
  }
  const kind = r.answer.startsWith('native: TAKE') ? 'reply' : r.answer.startsWith('native') ? 'native' : r.answer.startsWith('none') ? 'unanswered' : 'answered';
  if (kind === 'reply') return `${r.task} -> reply`;
  const what = r.queue === null ? r.name.replace(/ \(.*$/, '') : `${r.name} ${r.command}`;
  return `${r.task} -> ${what}${r.sync ? ' sync' : ''} (${kind})`;
}
export const S1_RECORD = ['TAKE_MAIN <= TAKE_EXEC 0 in Idle (handler 0x503a1172)', 'TAKE_MAIN -> FACE_FD 15 sync (answered)',
  'TAKE_MAIN -> TAKE_FUNC 80 (native)', 'TAKE_FUNC <= 80', 'TAKE_FUNC -> reply', 'TAKE_MAIN -> TAKE_FOCUS 768 (answered)',
  'TAKE_MAIN <= TAKE_POST token 1 in RdyFcsRdy1', 'TAKE_MAIN -> TAKE_FUNC 80 (native)', 'TAKE_FUNC <= 80', 'TAKE_FUNC -> reply'];

export async function releaseSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  for (const [tag, mode, probe] of [['camapp 3', 3, false], ['camapp 3 --take probe', 3, true], ['camapp 1 --take probe', 1, true]]) {
    const pl = new Player({ ...args, ...(probe ? { take: 'probe' } : {}) }, env);
    pl.camapp_components = mode >= 2; pl.camapp_native_tra = mode === 3;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, take = s.camapp.take;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
      const str = (a) => { let t = ''; for (let c; (c = lab.sim.read(a + t.length, 1)[0]) && t.length < 32;) t += String.fromCharCode(c); return t; };
      const stateName = (n) => str(lab.sim.u32(MAIN_STATES + 20 * n + 4) >>> 0);
      const seen = [];
      lab.observe(TAKE_API, (l, r) => seen.push(`take API ${h8(r.d0)} from ${h8(disasm(r.mdr))}`), 'test take API');
      lab.observe(S1_GUARD_TEST, (l, r) => seen.push(`S1 guard ${r.d0}`), 'test S1 guard');
      lab.observe(SEQ_EVENT, (l, r) => {
        const id = l.sim.read((r.sp >>> 0) + 16, 2).reduce((a, b, k) => a | b << 8 * k, 0);
        if (id !== HISTOGRAM) seen.push(`event ${id} in phase ${r.d0}`);
      }, 'test sequence');
      let n = take ? take.requests.length : 0;
      const since = () => { const out = take ? take.requests.slice(n).map((r) => canon2(r, stateName)) : []; n = take ? take.requests.length : 0; return out; };
      const used = pl.stand_ins_in_use(), thr = lab.sim.u32(THR_STATE) >>> 0;
      ok(s.status().gui === '0x0108' && used.includes('S-RELSEQ') && PROBE2.every((x) => used.includes(x) === (probe && (x === 'H-TAKEMAIN' || mode === 3))) && thr === (probe && mode === 3 ? 0x01010202 : 0x02010202),
        `${tag}: the start reaches the shooting screen (GUI ${s.status().gui}), S-RELSEQ ${used.includes('S-RELSEQ')}, round 2's stand-ins ${used.filter((x) => PROBE2.includes(x))}, CapThr's state ${h8(thr)}`);
      if (probe) {
        const st = Object.values(take.main_tids).map((t) => lab.nk.state(t) & 0xF);
        ok(st.every((x) => x === 4) && u16(MAIN_STATE) === 0 && !take.requests.some((r) => r.dir === 'in' && /^TAKE_MAIN/.test(r.task)),
          `${tag}: TAKE_MAIN and TAKE_MAIN_CP wait (${st}) in ${stateName(u16(MAIN_STATE))}, nothing taken at the start`);
      }
      idle(1000);
      since(); seen.length = 0;
      s.key('s1', 'down'); s.camapp.pump(); idle(600);
      const s1 = since(), seen1 = seen.splice(0);
      if (!probe && mode === 3) {
        ok(JSON.stringify(seen1) === JSON.stringify(['event 826 in phase 101', 'S1 guard 0']),
          `${tag}: S1 is event 826 in phase 101, refused at the S1 guard, no take request: ${JSON.stringify(seen1)}`);
      } else if (mode === 3) {
        // (the guard twice: phase 101's case for 826, 0x50c5cc94, calls the controller's vt[1306], which calls vt[111],
        // the guard, then vt[110] and, that one 0, vt[111] itself at 0x50c5cce7)
        ok(JSON.stringify(seen1) === JSON.stringify(['event 826 in phase 101', 'S1 guard 1', 'S1 guard 1', 'take API 0x20 from 0x50bc7c8e']),
          `${tag}: S1 passes the S1 guard and CapTak_Take asks for the take: ${JSON.stringify(seen1)}`);
        ok(JSON.stringify(s1) === JSON.stringify(S1_RECORD), `${tag}, S1: the record ${JSON.stringify(s1)}, want ${JSON.stringify(S1_RECORD)}`);
      } else {
        ok(!seen1.length && !s1.length, `${tag}: S1 reaches neither the sequence nor TAKE (${JSON.stringify(seen1)}, ${JSON.stringify(s1)})`);
      }
      if (probe) {
        const count = lab.call(QUEUE_COUNT, { d0: TAKE_EXEC }, null, null, 200000).d0;
        const want = mode === 3 ? ['RdyFcsRdy1', 0x5E, 0x5] : ['Idle', 0, 0x7];
        const got = [stateName(u16(MAIN_STATE)), lab.sim.u32(MAIN_PENDING) >>> 0, lab.sim.u32(MAIN_PATTERN) >>> 0];
        ok(JSON.stringify(got) === JSON.stringify(want) && count === 0,
          `${tag}: after S1 TAKE_MAIN is in ${got[0]} with the pending bits ${h8(got[1])}, the wait pattern ${h8(got[2])} (want ${JSON.stringify(want)}), TAKE_EXEC holds ${count}`);
        s.key('s2', 'down'); s.camapp.pump(); idle(700);
        const s2 = since(), seen2 = seen.splice(0), count2 = lab.call(QUEUE_COUNT, { d0: TAKE_EXEC }, null, null, 200000).d0;
        const want2 = mode === 3 ? ['event 824 in phase 102', 'take API 0x40 from 0x50bc7b89'] : [];
        ok(JSON.stringify(seen2) === JSON.stringify(want2) && !s2.length && count2 === (mode === 3 ? 1 : 0) && stateName(u16(MAIN_STATE)) === want[0],
          `${tag}: S2 ${JSON.stringify(seen2)}, TAKE takes nothing (${JSON.stringify(s2)}), TAKE_EXEC holds ${count2}, TAKE_MAIN in ${stateName(u16(MAIN_STATE))}`);
        s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(800);
        const up = since();
        ok(!up.some((x) => /^TAKE_MAIN/.test(x)) && take.pending.length === 0 && s.status().gui === '0x0108',
          `${tag}: the releases reach TAKE_MAIN with nothing (${JSON.stringify(up)}), nothing left to answer (${take.pending.length}), GUI ${s.status().gui}`);
      }
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  }
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await releaseSession();
  console.log(`the release route to TAKE_EXEC: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
