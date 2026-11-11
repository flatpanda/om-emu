// S-DISPQ's queue (src/lab/dispq.mjs, src/lab/play.mjs; docs/hle-gaps.md 4.1.9), E143:
//   dispqUnits     the queue discipline without firmware: a message posted while a DISPLAY run is open runs after
//                  the outermost run's end, in the order of the posts, a kept message's own posts behind the ones
//                  before it, one at a time; a run nested in an open one (a handler's send) runs at once; a throw
//                  drops what is kept
//   dispqSession   control camapp 3, PLAY pressed at the start's end: the OXF main thread's (task 57) synchronous
//                  DISPLAY cmd 15 waits for the histogram's end, task 168 sends cmd 4 meanwhile; its send runs
//                  natively, S-DISPQ keeps its post and runs it when cmd 15's run ends, its reply goes to the send's
//                  own queue and task 168 goes on (its cmd 17, the display manager's cmd 18 from 0x503eba07, whose
//                  reply S-CAMAPP's pump takes to queue 6); PLAY shows No Picture, the same frame as PLAY after 2 s
//                  of idle, and PLAY returns. Control: the dispq-at-once mutant (the lab's discipline before 4.1.9)
//                  runs cmd 4 inside cmd 15's run and stops at the cmd 18 post (depth 1), as 4.2.4 recorded
//   node emu/test/test_dispq.mjs
import { fileURLToPath } from 'node:url';

const h8 = (v) => '0x' + (v >>> 0).toString(16);

export function dispqUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  return import('../src/lab/dispq.mjs').then(({ DisplayQueue }) => {
    // a run's body records itself (its name, the runs open while it runs) and posts what posts[name] lists
    const make = (posts = {}) => {
      const q = new DisplayQueue(), log = [];
      const run = (task, name) => q.run(task, () => {
        log.push(`${name}@${task}/${q.runs.length}`);
        for (const [who, m] of posts[name] ?? []) {
          if (m.startsWith('nested:')) run(who, m.slice(7));          // a handler's send: run at once
          else q.post({ name: m, task: who });
        }
        return name;
      }, (m) => run('runner', m.name));
      return { q, log, run };
    };
    {
      const { q, log, run } = make({ A: [['y', 'B'], ['z', 'C']], B: [['y', 'D']] });
      const got = run('x', 'A');
      ok(got === 'A' && JSON.stringify(log) === JSON.stringify(['A@x/1', 'B@runner/1', 'C@runner/1', 'D@runner/1'])
        && !q.open && !q.pending.length && !q.draining,
        `kept messages run after the outermost run, in order, one at a time, a kept one's post behind the others: ${JSON.stringify(log)} (returned ${got})`);
    }
    {
      const { q, log, run } = make({ A: [['y', 'B'], ['x', 'nested:N']], N: [['z', 'C']] });
      run('x', 'A');
      ok(JSON.stringify(log) === JSON.stringify(['A@x/1', 'N@x/2', 'B@runner/1', 'C@runner/1']) && !q.pending.length,
        `a run nested in an open one runs at once and drains nothing; its post waits for the outermost's end: ${JSON.stringify(log)}`);
    }
    {
      const q = new DisplayQueue();
      let threw = null;
      try { q.post({ name: 'B' }); } catch (e) { threw = e.message; }
      ok(threw !== null && !q.pending.length, `a post with no run open is refused: ${threw}`);
      let inside = null;
      q.run('x', () => { inside = [q.runs_on('x'), q.runs_on('y'), q.open]; }, () => {});
      ok(JSON.stringify(inside) === JSON.stringify([true, false, true]) && !q.open && !q.runs_on('x'),
        `runs_on names the open runs' tasks only while they are open: ${JSON.stringify(inside)}`);
    }
    {
      const q = new DisplayQueue(), ran = [];
      let threw = null;
      try { q.run('x', () => { q.post({ name: 'B' }); throw new Error('stop'); }, (m) => ran.push(m.name)); } catch (e) { threw = e.message; }
      q.run('x', () => {}, (m) => ran.push(m.name));
      ok(threw === 'stop' && !ran.length && !q.pending.length && !q.draining && !q.open,
        `a run that throws drains nothing and drops what it kept (threw ${threw}, ran ${JSON.stringify(ran)})`);
    }
    {
      const q = new DisplayQueue(), ran = [];
      let threw = null;
      const drain = (m) => q.run('runner', () => { ran.push(m.name); if (m.name === 'B') throw new Error('in B'); }, drain);
      try { q.run('x', () => { q.post({ name: 'B' }); q.post({ name: 'C' }); }, drain); } catch (e) { threw = e.message; }
      ok(threw === 'in B' && JSON.stringify(ran) === JSON.stringify(['B']) && !q.pending.length && !q.draining && !q.open,
        `a kept message's run that throws ends the drain and drops the rest (threw ${threw}, ran ${JSON.stringify(ran)})`);
    }
    return { checks, bad };
  });
}

// E143: the reply's OlyQeWr in 0x501c48bf for status 0 (d0 the queue in the message's word 0, a0 the 12-byte reply
// {0, word 1, word 3}); SYNC_SEND's post (S-DISPQ keeps it); the display manager's request (0x503eba07)
const REPLY_CALL = 0x501C490C, SYNC_POST = 0x5002E411, REQUEST = 0x503EBA07, APP_QUEUE = 6;
const OXF_MAIN = 57, GUI_168 = 168, GUI_SHOOTING = '0x0108', GUI_NO_PICTURE = '0x0505';
const CONTROL_STOP = /^UI_IN group 3: OlyQeWr to the DISPLAY queue from 0x[0-9a-f]{8} \(disasm 0x503eba07\) \(depth 1\)/;

export async function dispqSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const { unpack } = await import('../src/util/bytes.mjs');
  const D = await import('../src/lab/display.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const frames = {};
  for (const [tag, mutant, wait] of [['PLAY at the start\'s end', null, 0], ['control dispq-at-once', 'dispq-at-once', 0], ['PLAY after 2 s', null, 2000]]) {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, x_mutant: mutant }, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const frame = () => { try { return s.frame()[2]; } catch (e) { return e.message.slice(0, 300); } };
      idle(wait);
      // the DISPLAY runs as they start (the label, the task, the open task runs, the message), the status-0 replies
      const runs = [], replies = [], tm = lab.task_message.bind(lab);
      lab.task_message = (loop, qa, msg, label, ...rest) => {
        if (loop === D.DISPLAY_LOOP) runs.push({ label, task: lab._tsnd_task(), depth: lab.depth, words: unpack('<4I', msg) });
        return tm(loop, qa, msg, label, ...rest);
      };
      if (lab.hooks.has(runtime(REPLY_CALL))) throw new Error(`${h8(REPLY_CALL)} is hooked already (${lab.hooks.get(runtime(REPLY_CALL))[1]})`);
      lab.observe(REPLY_CALL, (l, r) => replies.push({ q: r.d0 & 0xFFFF, task: l._tsnd_task(), w: unpack('<3I', l.sim.read(l.sim.u32(r.a0 >>> 0) >>> 0, 12)) }), 'test DISPLAY reply');
      const s0 = s.steps.length;
      let stop = null, play = null;
      try { s.key('play', 'down'); s.camapp.pump(); idle(100); s.key('play', 'up'); s.camapp.pump(); idle(800); play = s.status().gui; } catch (e) { stop = e; }
      const recs = s.steps.slice(s0).flatMap((x) => x.dispq ?? []), log = [];
      if (mutant) {
        const nested = runs.find((x) => x.depth > 0 && x.words[2] === 4);
        ok(stop !== null && CONTROL_STOP.test(stop.message) && runs[0]?.label === 'DISPLAY cmd 15' && runs[0].task === OXF_MAIN
          && nested?.task === GUI_168 && nested.label === 'DISPLAY cmd 4',
          `${tag}: task ${GUI_168}'s cmd 4 runs inside cmd 15's run (${JSON.stringify(nested ?? null)}) and the cmd 18 post stops at S-DISPQ: ${stop ? stop.message.slice(0, 200) : 'no stop'}`);
        continue;
      }
      ok(stop === null && play === GUI_NO_PICTURE, `${tag}: PLAY shows No Picture (${play}; ${stop ? stop.message.slice(0, 300) : 'no stop'})`);
      if (stop) continue;
      frames[tag] = frame();
      const back = (() => { s.key('play', 'down'); s.camapp.pump(); idle(100); s.key('play', 'up'); s.camapp.pump(); idle(800); return s.status().gui; })();
      ok(back === GUI_SHOOTING, `${tag}: PLAY again returns to the shooting screen (${back})`);
      ok(runs.every((x) => x.depth === 0), `${tag}: no DISPLAY run starts inside another (${JSON.stringify(runs.filter((x) => x.depth > 0).map((x) => [x.label, x.task, x.depth]))})`);
      if (wait) continue;
      // cmd 15's run, then the kept cmd 4 on the same task once it has ended, nothing between them
      const kept = recs.filter((x) => x.kept);
      const k = kept[0], w0 = runs[1]?.words?.[0];
      ok(runs[0]?.label === 'DISPLAY cmd 15' && runs[0].task === OXF_MAIN && runs[1]?.label === 'S-DISPQ DISPLAY cmd 4'
        && runs[1].task === OXF_MAIN && runs[1].depth === 0 && kept.length === 1 && k.cmd === 4 && k.kept.task === GUI_168
        && k.kept.from === h8(SYNC_POST) && w0 !== 0 && w0 !== APP_QUEUE,
        `${tag}: cmd 15's run (${JSON.stringify(runs[0] ?? null)}), then task ${GUI_168}'s cmd 4 kept from SYNC_SEND's post and run once it ended (${JSON.stringify(runs[1] ?? null)}; kept ${JSON.stringify(kept)})`);
      // its reply to the send's own queue ({0, word 1, word 3}); task 168 goes on: its cmd 17, the display manager's
      // cmd 18 through S-DISPQ, whose reply goes to queue 6 through the pump
      const rep = replies.find((x) => x.q === w0);
      const later = runs.slice(2).map((x) => [x.label, x.task]);
      const i17 = later.findIndex(([l, t]) => l === 'DISPLAY cmd 17' && t === GUI_168);
      const i18 = later.findIndex(([l, t]) => l === 'S-DISPQ DISPLAY cmd 18' && t === GUI_168);
      const r18 = recs.find((x) => x.cmd === 18 && !x.kept);
      ok(rep && rep.task === OXF_MAIN && rep.w[0] === 0 && rep.w[1] === runs[1].words[1] && rep.w[2] === runs[1].words[3],
        `${tag}: the kept cmd 4's reply goes to the send's queue ${w0}: ${JSON.stringify(rep ?? replies)}`);
      ok(i17 >= 0 && i18 > i17 && r18?.words[0] === h8(APP_QUEUE) && r18.replies === 1 && !replies.some((x) => x.q !== APP_QUEUE && x.q !== w0),
        `${tag}: task ${GUI_168} goes on to its cmd 17 and the request cmd 18 (${JSON.stringify(later)}), cmd 18's one reply to queue 6 (${JSON.stringify(r18 ?? null)}), no reply elsewhere`);
      for (const st of s.steps.slice(s0)) for (const [kind, d] of st.camapp ?? []) if (kind === 'dispq') log.push(d);
      const le = (v) => [0, 1, 2, 3].map((n) => ((v >>> 8 * n) & 255).toString(16).padStart(2, '0')).join('');
      const want = r18 ? `DISPLAY reply [${le(0)}${le(Number(r18.words[1]))}${le(Number(r18.words[3]))}] -> queue ${APP_QUEUE}` : null;
      ok(want !== null && log.includes(want), `${tag}: S-CAMAPP's pump takes cmd 18's reply to queue 6 (${want}): ${JSON.stringify(log)}`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 600)}`); }
    finally { pl.close_session(); }
  }
  const [a, b] = [frames["PLAY at the start's end"], frames['PLAY after 2 s']];
  ok(Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]),
    `No Picture at the start's end is the frame of PLAY after 2 s of idle (${Array.isArray(a) ? 'a frame' : a}, ${Array.isArray(b) ? 'a frame' : b})`);
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const u = await dispqUnits();
  console.log(`S-DISPQ's queue discipline: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  const s = await dispqSession();
  console.log(`S-DISPQ's queue in play (camapp 3, PLAY at the start's end): ${s.checks - s.bad.length}/${s.checks}`);
  s.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length || s.bad.length ? 1 : 0);
}
