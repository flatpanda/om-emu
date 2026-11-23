// A power-on with the first card slot empty, and the first slot's media status around a removal and an insertion
// (src/lab/storage.mjs: the card holder's out; src/lab/media.mjs S-MEDIA's media status; src/lab/camapp.mjs S-CARD's;
// docs/hle-gaps/4.8.md 4.8.3; emu/FIDELITY-NOTES.md 7.9):
//   nocardUnits    (firmware-free) the session tokens card:out and card:in (:2 the second slot's) and the Player
//                  input each sends; a malformed card: token refused
//   nocardSession  (firmware) on the body of OM_EMU_MODEL (E143 by default; bin/test.mjs runs E147 in a process of its
//                  own): a Player whose card holder starts with the card out (out): the boot sends no insertion's
//                  request (no sector of the card read, the drive not mounted), the media status word NOT_PRESENT and
//                  the card switch at its no-card level; after S1 the shooting screen's no-card state ('No Card', 0
//                  shots); the card put in: the firmware formats the blank card and mounts it, the word OK and the
//                  screen changed; taken out: the word NOT_PRESENT, the mount state 0 and the screen the card-less
//                  start's, pixel for pixel; the session closed with the card out and opened again in the same Player
//                  (a power cycle): the slot still empty. Then through host/session.mjs (bin/session.mjs's module):
//                  --no-card, card:in, card:out, power:off and restart (the slot kept empty), the words read by the
//                  session's read: token, no poke; each session's log records the empty slot at its start
//                  (session-N.json's card_out, session-N.card.json), and --replay of session 2 (Player.run, from
//                  either form) starts with the slot empty and reads NOT_PRESENT (control: the record dropped, the
//                  card in and OK). Negative controls (by hand, 2026-11-14): with S-MEDIA's status
//                  writes left out the word read NOT_PRESENT after the insertion and OK after a removal on a card
//                  started in; with the empty slot's insertion not skipped the open stops ("the insertion's
//                  requests with the card out of the slot")
//   node emu/test/test_nocard.mjs [--units] [--session]
import { parseToken, stepInputs, TokenError } from '../host/session.mjs';

const J = JSON.stringify;
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
export function nocardUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const inp = (t) => J(stepInputs(parseToken(t)));
  ok(inp('card:out') === J([{ type: 'card', action: 'remove' }]) && inp('card:in') === J([{ type: 'card', action: 'insert' }]),
    `card:out and card:in send the Player's card input for the first slot: ${inp('card:out')} ${inp('card:in')}`);
  ok(inp('card:out:2') === J([{ type: 'card', action: 'remove', slot: 2 }]) && inp('card:in:2') === J([{ type: 'card', action: 'insert', slot: 2 }]),
    `card:out:2 and card:in:2 name the second slot: ${inp('card:out:2')} ${inp('card:in:2')}`);
  for (const t of ['card:remove', 'card:out:3', 'card:in:', 'card:']) {
    let e = null;
    try { parseToken(t); } catch (x) { e = x; }
    ok(e instanceof TokenError && /card:out or card:in/.test(e.message), `${t} is refused with the card tokens' forms: ${e?.message}`);
  }
  return { checks, bad };
}

export async function nocardSession() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL, fact } = await import('../src/fw/model.mjs');
  const { MEDIA_STATUS_E143 } = await import('../src/fw/facts.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { SdCard } = await import('../src/lab/sdcard.mjs');
  const { MEDIA_NOT_PRESENT, MEDIA_OK } = await import('../src/lab/media.mjs');
  if (!STORAGE?.hls) return { checks: 1, bad: [`${MODEL}: the lab runs no card with its HLS media side (src/fw/models.mjs card_fs.hls)`], notes };
  const WORD = fact('media_status', MEDIA_STATUS_E143), KIND = STORAGE.hls.slots[0].kind, hx = (v) => '0x' + (v >>> 0).toString(16);
  const idle = (s, ms) => { const to = s.lab.lab_time() + ms * 1e6; while (s.lab.lab_time() < to) s.idle_slice(Math.min(to, s.lab.lab_time() + 50e6)); };
  const press = (s, k) => { s.key(k, 'down'); s.camapp.pump(); idle(s, 150); s.key(k, 'up'); s.camapp.pump(); idle(s, 1000); };
  const frame = (s) => s.frame('boundary')[2];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const state = (s) => ({ word: hx(s.lab.sim.u32(WORD)), mount: s.camapp.media.mount_state(KIND), level: s.camapp.media.level(), present: s.storage.card.present,
    mounted: s.storage.mounted, drive: hx(s.storage.status_word()) });

  // ---- the Player: a card holder that starts with the card out
  const card = new SdCard(), holder = { open: () => card, save() {}, out: true };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: holder });
  try {
    pl.open_session();
    let s = pl.session;
    ok(pl.phase === 'running', `the card-less start opens: ${pl.phase} ${pl.error?.message ?? ''}`);
    idle(s, 2000);
    press(s, 's1');                                   // the date prompt off (E147 publishes its first frame after it)
    const x = state(s), empty = frame(s);
    ok(!x.present && !x.mounted && card.reads === 0 && card.writes === 0,
      `start, the slot empty: no insertion's request reached the card (${card.reads} sectors read, ${card.writes} written), the drive not mounted (status ${x.drive}): ${J(x)}`);
    ok(x.word === hx(MEDIA_NOT_PRESENT) && x.mount === 8 && x.level === 1,
      `start, the slot empty: the media status word ${hx(WORD)} NOT_PRESENT, the mount state 8 (the manager's start leaves an empty slot's so), the card switch at the no-card level 1: ${J(x)}`);
    // the card in
    pl.run_input({ type: 'card', action: 'insert' });
    idle(s, 1500);
    press(s, 's1');                                   // (the insertion brings the date prompt back)
    const y = state(s), full = frame(s);
    ok(y.present && y.mounted && s.storage.formatted && y.word === hx(MEDIA_OK) && y.mount === 8 && y.level === 0,
      `the card in: the firmware formats the blank card and mounts it, the word OK, the mount state 8, the switch's level 0: ${J(y)}`);
    ok(!same(full, empty), 'the card in: the shooting screen changed (the card\'s counts where the no-card state was)');
    // the card out again
    pl.run_input({ type: 'card', action: 'remove' });
    idle(s, 1000);
    const z = state(s), out = frame(s);
    ok(!z.present && !z.mounted && z.word === hx(MEDIA_NOT_PRESENT) && z.mount === 0 && z.level === 1,
      `the card out: the word NOT_PRESENT again, the mount state 0 (unmounted), the level 1: ${J(z)}`);
    ok(same(out, empty), 'the card out: the shooting screen is the card-less start\'s, pixel for pixel');
    notes.push(`${MODEL}: words ${x.word} at the start, ${y.word} with the card, ${z.word} after the removal`);
    // a power cycle with the card out: the slot stays empty
    pl.close_session();
    ok(holder.out === true, `the closed session leaves the holder's out set: ${holder.out}`);
    card.state = 'idle'; card.selected = false; card.bus4 = false;
    const reads = card.reads;
    pl.open_session();
    s = pl.session;
    idle(s, 1500);
    const w = state(s);
    ok(pl.phase === 'running' && !w.present && !w.mounted && w.word === hx(MEDIA_NOT_PRESENT) && card.reads === reads,
      `the next start in the same Player (a power cycle): the slot still empty, no sector read, the word NOT_PRESENT: ${J(w)}`);
  } catch (e) { bad.push(`${MODEL}: the Player: ${e.message.slice(0, 500)}`); }
  try { pl.close_session(); } catch { /* closed */ }

  // ---- host/session.mjs: --no-card, card:in, card:out, power:off, restart (the slot kept empty)
  const fs = await import('node:fs'), path = await import('node:path');
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-nocard-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const { openSession } = await import('../host/session.mjs');
    const s = await openSession({ model: MODEL, noCard: true, out: tmp });
    const word = (r) => (r.hex.match(/../g).reverse().join('').replace(/^0+(?=.)/, ''));
    const run = (t) => { const r = s.step(t); if (!r.ok) throw new Error(`step ${r.step} (${t}): ${r.error}`); return r; };
    ok(s.first.ok, `openSession with noCard opens: ${J(s.first).slice(0, 300)}`);
    run('wait:1500');
    const w0 = word(run(`read:${hx(WORD)}:4`));
    run('card:in'); run('wait:1000');
    const w1 = word(run(`read:${hx(WORD)}:4`));
    run('card:out');
    const w2 = word(run(`read:${hx(WORD)}:4`));
    run('power:off'); run('restart'); run('wait:1500');
    const w3 = word(run(`read:${hx(WORD)}:4`));
    const sum = s.close();
    ok([w0, w1, w2, w3].join() === ['1001', 'f000', '1001', '1001'].join() && sum.ok && sum.pokes.length === 0,
      `bin/session.mjs's module: --no-card ${w0}, card:in ${w1}, card:out ${w2}, after power:off and restart ${w3} (want 1001 f000 1001 1001), no poke: ${J({ ok: sum.ok, pokes: sum.pokes })}`);
  } catch (e) { bad.push(`${MODEL}: host/session.mjs: ${e.message.slice(0, 500)}`); }

  // ---- the logs record the empty slot at each session's start (session.json's card_out, session.card.json beside
  // session.jsonl), and --replay (Player.run) starts there with the slot empty: session 2 (the restart after card:out
  // and power:off) replayed from either form reads NOT_PRESENT with no card in the slot; control: the same session.json
  // with card_out dropped starts with the card in and reads OK
  try {
    const { replayCardOut } = await import('../src/lab/player.mjs');
    const doc = (k) => JSON.parse(fs.readFileSync(path.join(tmp, `session-${k}.json`), 'utf8'));
    const companion = (k) => { try { return fs.readFileSync(path.join(tmp, `session-${k}.card.json`), 'utf8'); } catch { return null; } };
    ok(doc(1).card_out === true && doc(2).card_out === true && companion(1) === '{"out":true}' && companion(2) === '{"out":true}',
      `the logs: session-1 and session-2 started with the slot empty: ${J([doc(1).card_out, doc(2).card_out, companion(1), companion(2)])}`);
    const replay = (file) => {
      const p = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, replay: file },
        { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
          readReplay: (f) => fs.readFileSync(path.isAbsolute(f) ? f : path.join(tmp, f), 'utf8') });
      let got = null;
      const close = p.close_session.bind(p);
      p.close_session = () => {
        if (p.session !== null && got === null) got = { word: hx(p.session.lab.sim.u32(WORD)), present: p.session.storage.card.present, phase: p.phase };
        close();
      };
      p.submit({ type: 'control', op: 'quit' });
      p.run();
      return got;
    };
    const ctl = path.join(tmp, 'control.json'), d2 = doc(2);
    delete d2.card_out;
    fs.writeFileSync(ctl, JSON.stringify(d2));
    const [rj, rl, rc] = [path.join(tmp, 'session-2.json'), path.join(tmp, 'session-2.jsonl'), ctl].map(replay);
    ok(rj?.word === hx(MEDIA_NOT_PRESENT) && rj.present === false && rl?.word === hx(MEDIA_NOT_PRESENT) && rl.present === false,
      `--replay of session-2 (.json and .jsonl): the slot empty from the start, NOT_PRESENT: ${J([rj, rl])}`);
    ok(rc?.word === hx(MEDIA_OK) && rc.present === true, `control: session-2.json without card_out replays with the card in, OK: ${J(rc)}`);
    ok(replayCardOut('s.json', J({ inputs: [] }), null) === false && /its card_out field "yes"/.test(thrown(() => replayCardOut('s.json', J({ card_out: 'yes' }), null))?.message ?? '')
      && /s\.card\.json 7/.test(thrown(() => replayCardOut('s.jsonl', '', () => '7'))?.message ?? ''),
      'replayCardOut: no record is the card in; a malformed record is refused');
    notes.push(`${MODEL}: --replay of session-2 ${rj?.word} (.json), ${rl?.word} (.jsonl); control ${rc?.word}`);
  } catch (e) { bad.push(`${MODEL}: the logs' empty slot and --replay: ${e.message.slice(0, 500)}`); }
  fs.rmSync(tmp, { recursive: true, force: true });
  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), all = !argv.includes('--units') && !argv.includes('--session');
  let n = 0;
  if (all || argv.includes('--units')) {
    const u = nocardUnits();
    console.log(`card tokens: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    n += u.bad.length;
  }
  if (all || argv.includes('--session')) {
    const s = await nocardSession();
    console.log(`a start with no card, and the media status around a removal: ${s.checks - s.bad.length}/${s.checks}`);
    s.notes.forEach((x) => console.log('   note:', x));
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
