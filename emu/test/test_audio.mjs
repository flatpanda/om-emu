// The lab's audio output (src/lab/audio.mjs), S-SHUTTERSND (src/lab/shuttersnd.mjs) and the AF beep (S-AFLOCK,
// src/lab/camapp.mjs; H-UIOUTSTART, src/lab/play.mjs; S-SOUNDRES, src/lab/soundres.mjs; the audio hardware,
// src/lab/audiohw.mjs):
//   audioUnits    without firmware: an event's checks; a session's queue (AudioOut: take, the full queue's drop);
//                 the rings (AudioRing: numbering, a copy's numbers, what after N gives and drops); the samples as
//                 little-endian bytes and GET /api/audio's document; the Player's publish_audio (one batch per call,
//                 numbered across sessions, nothing without a host that plays sound, a replay's dropped); the
//                 router's /api/audio (after=-1 at once, a long poll answered by the next event, a bad after refused);
//                 the browser page's answer of the same route from what the Worker posted; the clicks (deterministic,
//                 their lengths at two rates, within full scale, loud at the start and silent at the end, open and
//                 close different) and the stand-in's two events
//   audioSession  E143 in a headless Player whose host plays sound: S1 then S2 emits exactly one open and one close
//                 click, spaced by the shutter time in use (1/125 s without S-SCENE, S-SCENE's with its live view on),
//                 the status lists S-SHUTTERSND; a Player without the host's onAudio has no sound and does not list it
//   afBeepSession E143 with the defaults (--audio auto: on; the native lens), the AF beep end to end: the status
//                 lists the chain's stand-ins and S-RESNAND serves S-SOUNDRES's lab-made area; each of two half presses
//                 in focus makes one sound request to UI_OUT (play, sound 0, volume 60) and PCM events of source
//                 'native' on the host's audio output, back to back, whose samples are the lab-made beep's sample for
//                 sample (the direct play: no gain stage), starting within 250 ms of lab time after S1 down, then
//                 UI_OUT's release (post_end, command_play_end, the player's close) once and the port idle; S-AFLOCK's
//                 take status while S1 is held; without S-AFLOCK, and with the beep Off (SET:1037=0, which sets 18),
//                 no request and no sound; S2 still gives S-SHUTTERSND's two clicks beside the half press's beep;
//                 --audio off keeps the sound area erased and has no audio hardware
//   node emu/test/test_audio.mjs [--session]
import { audioEvent, AudioOut, AudioRing, AudioError, audioDoc, pcmBytes, AUDIO_PENDING } from '../src/lab/audio.mjs';
import { shutterClick, ShutterSound, SHUTTER_RATE, CLICK_S, STAND_IN } from '../src/lab/shuttersnd.mjs';
import { base64Bytes } from '../src/util/bytes.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e instanceof cls) return true; throw e; } };
const ev = (o = {}) => ({ t_lab_ns: 1000, rate: 48000, channels: 1, samples: Int16Array.of(1, -2, 3), source: 'test', ...o });

export async function audioUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  // the event's checks
  ok(audioEvent(ev()).frames === 3 && audioEvent(ev({ channels: 2, samples: new Int16Array(4) })).frames === 2, 'frames: samples over channels');
  for (const [o, what] of [[{ t_lab_ns: -1 }, 'a negative time'], [{ t_lab_ns: 1.5 }, 'a time that is not an integer'], [{ rate: 4000 }, 'a rate below 8000'],
    [{ rate: 44100.5 }, 'a rate that is not an integer'], [{ channels: 3 }, 'three channels'], [{ samples: [1, 2] }, 'samples that are not an Int16Array'],
    [{ samples: new Int16Array(0) }, 'no samples'], [{ channels: 2, samples: new Int16Array(3) }, 'a half frame'],
    [{ samples: new Int16Array(48000 * 10 + 1) }, 'more than 10 s'], [{ source: '' }, 'an empty source'], [{ source: 'x'.repeat(65) }, 'a source of 65 characters']]) {
    ok(throwsAs(() => audioEvent(ev(o)), AudioError), `audioEvent refuses ${what}`);
  }
  // a session's queue
  const out = new AudioOut();
  ok(out.take() === null, 'an empty queue takes null');
  out.emit(ev({ t_lab_ns: 1 })); out.emit(ev({ t_lab_ns: 2 }));
  const t = out.take();
  ok(t?.length === 2 && t[0].t_lab_ns === 1 && t[1].t_lab_ns === 2 && out.take() === null && out.emitted === 2, 'take: the queued events in order, then an empty queue');
  for (let i = 0; i < AUDIO_PENDING + 3; i++) out.emit(ev({ t_lab_ns: i }));
  const full = out.take();
  ok(full.length === AUDIO_PENDING && full[0].t_lab_ns === 3 && out.dropped === 3, `a full queue drops its oldest: ${full.length}, first ${full[0].t_lab_ns}, dropped ${out.dropped}`);
  // the rings
  const ring = new AudioRing(4);
  ring.add([audioEvent(ev()), audioEvent(ev())]);
  ok(ring.seq === 2 && ring.events.map((e) => e.seq).join() === '1,2', 'add numbers from 1');
  ring.add([1, 2, 3, 4].map(() => audioEvent(ev())));
  const a0 = ring.after(0), a5 = ring.after(5), a6 = ring.after(6);
  ok(a0.events.map((e) => e.seq).join() === '3,4,5,6' && a0.dropped === 2, `after 0 with 4 kept of 6: ${JSON.stringify([a0.events.map((e) => e.seq), a0.dropped])}`);
  ok(a5.events.length === 1 && a5.dropped === 0 && a6.events.length === 0 && a6.dropped === 0, 'after 5: the sixth; after 6: nothing');
  const copy = new AudioRing();
  copy.insert(a0.events);
  ok(copy.seq === 6 && throwsAs(() => copy.insert([{ seq: 6 }]), AudioError), 'insert keeps the numbers and refuses one out of order');
  // the bytes and the document
  ok(Array.from(pcmBytes(Int16Array.of(1, -2, 0x1234))).join() === '1,0,254,255,52,18', 'samples as little-endian bytes');
  const r1 = new AudioRing();
  r1.add([audioEvent(ev({ samples: Int16Array.of(-32768, 32767, 7) }))]);
  const doc = audioDoc(r1, 0), b = base64Bytes(doc.events[0].pcm);
  ok(doc.seq === 1 && doc.events[0].frames === 3 && doc.events[0].source === 'test' && b !== null &&
    new DataView(b.buffer).getInt16(0, true) === -32768 && new DataView(b.buffer).getInt16(2, true) === 32767, `audioDoc: ${JSON.stringify(doc)}`);
  // the Player's publish_audio
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const got = [];
  const pl = new Player({ ...PLAYER_PARSER, out: '<out>' }, { onAudio: (e) => got.push(e.map((x) => x.seq)) });
  pl.publish_audio();
  const so = new AudioOut();
  pl.session = { audio: so };
  pl.publish_audio();
  so.emit(ev()); so.emit(ev());
  pl.publish_audio(); pl.publish_audio();
  pl.session = { audio: new AudioOut() };
  pl.session.audio.emit(ev());
  pl.publish_audio();
  pl.replaying = true;                 // a --replay's sound: taken and dropped
  pl.session.audio.emit(ev());
  pl.publish_audio();
  pl.replaying = false;
  const replay_left = pl.session.audio.pending.length;
  pl.publish_audio();
  pl.session = null;
  ok(JSON.stringify(got) === '[[1,2],[3]]' && pl.audio.seq === 3, `publish_audio: one batch per call with events, numbered across sessions: ${JSON.stringify(got)}`);
  ok(replay_left === 0, `publish_audio while replaying drops the queued sound: ${replay_left} left, ${JSON.stringify(got)}`);
  // the router's /api/audio
  const { PlayApi } = await import('../src/lab/playapi.mjs');
  const fake = { a: {}, audio: new AudioRing(), stop: false };
  const api = new PlayApi(fake, { timeScale: 0.02 });
  const get = async (p) => { const r = await api.handle({ method: 'GET', path: p, headers: {} }); return [r.status, r.status === 200 ? JSON.parse(new TextDecoder().decode(r.body)) : null]; };
  const [s0, d0] = await get('/api/audio?after=-1');
  ok(s0 === 200 && d0.seq === 0 && d0.events.length === 0, `after=-1: at once, the newest seq: ${s0} ${JSON.stringify(d0)}`);
  ok((await get('/api/audio?after=x'))[0] === 400 && (await get('/api/audio?after=-2'))[0] === 400, 'a bad after is refused (400)');
  const poll = get('/api/audio?after=0');
  fake.audio.add([audioEvent(ev({ t_lab_ns: 77 }))]);
  api.notify();
  const [s1, d1] = await poll;
  ok(s1 === 200 && d1.seq === 1 && d1.events[0]?.t_lab_ns === 77 && typeof d1.events[0]?.pcm === 'string', `the long poll answers the next event: ${JSON.stringify(d1)}`);
  const t1 = performance.now(), [, d2] = await get('/api/audio?after=1');
  ok(d2.events.length === 0 && performance.now() - t1 >= 400, `with nothing new it answers at its timeout with no events (${Math.round(performance.now() - t1)} ms)`);
  const [, d3] = await get('/api/audio?after=9');
  ok(d3.seq === 1 && d3.events.length === 0, 'an after past the newest (an earlier server\'s page) answers at once with the newest seq');
  // the browser page's answer (web/page.mjs)
  const { PagePlayer } = await import('../web/page.mjs');
  const PP = new PagePlayer();
  PP.worker = { postMessage() {} };
  const pp0 = await (await PP.api('/api/audio?after=-1')).json();
  const ppPoll = PP.api('/api/audio?after=0');
  PP.message({ type: 'audio', events: [{ ...audioEvent(ev({ t_lab_ns: 5 })), seq: 1 }] });
  const ppr = await ppPoll, ppd = await ppr.json();
  ok(pp0.seq === 0 && ppd.seq === 1 && ppd.events[0].t_lab_ns === 5 && ppd.events[0].samples === undefined && ppr.audio?.[0]?.samples instanceof Int16Array,
    `the page answers /api/audio from the Worker's events, the samples in its audio field: ${JSON.stringify(ppd)}`);
  // the clicks
  for (const kind of ['open', 'close']) {
    const c = shutterClick(kind), c2 = shutterClick(kind), c44 = shutterClick(kind, 44100);
    ok(c.length === Math.round(CLICK_S[kind] * SHUTTER_RATE) && c44.length === Math.round(CLICK_S[kind] * 44100), `${kind}: ${c.length} frames at 48 kHz, ${c44.length} at 44.1 kHz`);
    ok(c.every((x, i) => x === c2[i]), `${kind}: the same samples at every call`);
    let peak = 0;
    for (const x of c) peak = Math.max(peak, Math.abs(x));
    ok(peak > 8000 && peak <= 32767, `${kind}: its peak ${peak} is loud and within full scale`);
    const rms = (from, to) => Math.sqrt(c.subarray(from, to).reduce((a, x) => a + x * x, 0) / (to - from));
    const ms = SHUTTER_RATE / 1000;
    ok(rms(0, 5 * ms) > 10 * rms(c.length - 5 * ms, c.length) && c[c.length - 1] === 0, `${kind}: loud at the start, faded to 0 at the end (${Math.round(rms(0, 5 * ms))} vs ${Math.round(rms(c.length - 5 * ms, c.length))})`);
  }
  const close = shutterClick('close'), ms = SHUTTER_RATE / 1000;
  const whir = Math.sqrt(close.subarray(30 * ms, 50 * ms).reduce((a, x) => a + x * x, 0) / (20 * ms));
  ok(whir > 200, `close: the charge sounds between 30 and 50 ms (rms ${Math.round(whir)})`);
  ok(throwsAs(() => shutterClick('half'), RangeError) && throwsAs(() => shutterClick('open', 1000), RangeError), 'shutterClick refuses another kind and a rate below 8000');
  const so2 = new AudioOut(), snd = new ShutterSound(so2);
  snd.open(1000); snd.close(9000000.4);
  const e2 = so2.take();
  ok(e2.length === 2 && e2.every((e) => e.source === STAND_IN && e.rate === SHUTTER_RATE && e.channels === 1) && e2[0].t_lab_ns === 1000 && e2[1].t_lab_ns === 9000000 &&
    snd.opened === 1 && snd.closed === 1, `the stand-in: an open and a close event at their lab times: ${JSON.stringify(e2.map((e) => [e.t_lab_ns, e.frames]))}`);
  return { checks, bad };
}

export async function audioSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const SC = await import('../src/lab/scene.mjs');
  const base = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  const events = [];
  const pl = new Player(args, { ...base, onAudio: (e) => events.push(...e) });
  pl.open_session();
  const run = (inp) => { pl.submit(inp); pl.tick(); };
  const release = () => {
    events.length = 0;
    run({ type: 'key', id: 's1', action: 'down' });
    run({ type: 'key', id: 's2', action: 'down' });
    run({ type: 'token', token: 'WAIT:800' });
    run({ type: 'key', id: 's2', action: 'up' });
    run({ type: 'key', id: 's1', action: 'up' });
    run({ type: 'token', token: 'WAIT:300' });
    return events.filter((e) => e.source === STAND_IN).map((e) => [e.frames === shutterClick('open').length ? 'open' : e.frames === shutterClick('close').length ? 'close' : '?', e.t_lab_ns]);
  };
  run({ type: 'token', token: 'WAIT:1500' });
  ok(pl.phase === 'running' && pl.session.audio !== null && events.length === 0 && !pl.stand_ins_in_use().includes('S-SHUTTERSND'), `before a release: no sound, S-SHUTTERSND not listed (${pl.phase})`);
  const r1 = release();
  ok(r1.length === 2 && r1[0][0] === 'open' && r1[1][0] === 'close', `S2: one open and one close click: ${JSON.stringify(r1)}`);
  ok(r1.length === 2 && r1[1][1] - r1[0][1] === Math.round(1e9 / 125), `without S-SCENE the clicks are 1/125 s apart: ${r1.length === 2 ? r1[1][1] - r1[0][1] : '-'} ns`);
  ok(pl.status_doc.stand_ins.includes('S-SHUTTERSND') || pl.stand_ins_in_use().includes('S-SHUTTERSND'), 'the status lists S-SHUTTERSND');
  run({ type: 'scene', change: { liveview: true, ev: 9 } });
  const want = Math.round(SC.exposureOf(pl.session.scene).shutter_s * 1e9);
  const r2 = release();
  ok(r2.length === 2 && r2[0][0] === 'open' && r2[1][0] === 'close' && r2[1][1] - r2[0][1] === want,
    `with S-SCENE's live view the clicks are its shutter time apart (${want} ns): ${JSON.stringify(r2)}`);
  ok(pl.phase === 'running', `the session runs on: ${pl.phase} ${pl.error?.message ?? ''}`);
  pl.close_session();
  // without a host that plays sound
  const quiet = new Player(args, base);
  quiet.open_session();
  quiet.submit({ type: 'key', id: 's2', action: 'down' }); quiet.tick();
  quiet.submit({ type: 'token', token: 'WAIT:300' }); quiet.tick();
  ok(quiet.session.audio === null && quiet.session.camapp.shutter_sound === null && !quiet.stand_ins_in_use().includes('S-SHUTTERSND'),
    'without env.onAudio: no audio output, no S-SHUTTERSND');
  quiet.close_session();
  return { checks, bad };
}

// The AF beep end to end (E143, the defaults: --audio auto, the native lens): S1 in focus -> S-AFLOCK -> changedFocus
// -> playAfSound -> playTarget -> api_sound -> UI_OUT's sound request 0x5014f7e0 (a0 = the message's body: +0 u8 op,
// +3 u8 kind, +4 u16 the sound id, +20, +24 and +28 the volume, D) -> the type-2 table (S-RESNAND serving S-SOUNDRES's
// lab-made area) -> AUD_EXEC -> AUD_MAIN's direct play -> the audio port -> session.audio. The lab-made beep is played
// as it is: the direct play (the AF sound's key, 0x62af27d6 = 1) has no copy task and so no software gain stage
// (0x50aa8a63, entered only from AUD_COPY_DATA's copies), and the codec's volume registers are kept, not applied
// (S-WM8946): the samples on /api/audio equal soundres.mjs afBeepPcm()
const UI_OUT_SOUND = 0x5014F7E0, POST_END = 0x5014FC6E, PLAY_END = 0x50AAC800, PLAYER_CLOSE = 0x50AA9795, GAIN = 0x50AA8A63, UI_OUT_BUSY = 0xA32DB0FC;
export async function afBeepSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { A } = await import('../src/fw/model.mjs');
  const { afBeepPcm, BEEP_FRAMES, BEEP_RATE } = await import('../src/lab/soundres.mjs');
  const base = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true };
  const events = [];
  const pl = new Player(args, { ...base, onAudio: (e) => events.push(...e) });
  pl.open_session();
  const s = pl.session, lab = s?.lab;
  ok(pl.phase === 'running' && s.audio_hw && s.lens !== null && s.ui_out_tid === 38, `the defaults on E143: audio hardware, the native lens, UI_OUT (${pl.phase} ${pl.error?.message ?? ''})`);
  if (!s?.audio_hw) { pl.close_session(); return { checks, bad }; }
  const key = (id, action) => { pl.submit({ type: 'key', id, action }); pl.tick(); pl.publish_audio(); };
  const idle = (ms) => { for (let t = 0; t < ms; t += 50) { s.idle_slice(lab.lab_time() + 50e6); pl.publish_audio(); } };
  idle(1500);
  const used = pl.stand_ins_in_use();
  ok(['H-UIOUTSTART', 'H-RESINIT', 'S-RESNAND', 'S-SOUNDRES', 'H-AUDSTART', 'S-AUDCPU2', 'S-WM8946', 'A-AUDIO-1', 'H-AUDTIME'].every((x) => used.includes(x)),
    `the status lists the chain's stand-ins: ${used.filter((x) => /UIOUT|RES|AUD|WM8946|SOUND/.test(x))}`);
  const rn = s.resnand.status();
  ok(rn.sound.startsWith("the host's image") && rn.sound0[0] === '0xa4000000', `S-RESNAND serves the lab-made area, USTART_L's sound 0 loaded: ${JSON.stringify([rn.sound, rn.sound0])}`);
  const seen = { sound: [], post_end: 0, play_end: 0, close: 0, gain: 0 };
  lab.observe(A(UI_OUT_SOUND), (l, r) => {
    const b = lab.sim.read(r.a0 >>> 0, 32), dv = new DataView(b.buffer, b.byteOffset, 32);
    seen.sound.push({ op: b[0], id: dv.getUint16(4, true), vol: [20, 24, 28].map((o) => dv.getUint32(o, true)) });
  }, 'test UI_OUT sound');
  lab.observe(A(POST_END), () => { seen.post_end += 1; }, 'test post_end');
  lab.observe(A(PLAY_END), () => { seen.play_end += 1; }, 'test play_end');
  lab.observe(A(PLAYER_CLOSE), () => { seen.close += 1; }, 'test close');
  lab.observe(A(GAIN), () => { seen.gain += 1; }, 'test gain');
  const want = afBeepPcm();
  // one half press: S1 down, 600 ms, S1 up, 600 ms; what it made
  const press = () => {
    for (const k of Object.keys(seen)) seen[k] = Array.isArray(seen[k]) ? [] : 0;
    const e0 = events.length, t0 = lab.lab_time();
    key('s1', 'down'); idle(600);
    const held = [lab.sim.u32(0x62AF6D00), lab.sim.u32(0x62AF6E28)];
    key('s1', 'up'); idle(600);
    const native = events.slice(e0).filter((e) => e.source === 'native');
    const pcm = new Int16Array(native.reduce((n, e) => n + e.samples.length, 0));
    let o = 0;
    for (const e of native) { pcm.set(e.samples, o); o += e.samples.length; }
    const backToBack = native.every((e, i) => !i || e.t_lab_ns === native[i - 1].t_lab_ns + Math.round(native[i - 1].frames * 1e9 / BEEP_RATE));
    return { t0, held, native: native.map((e) => [e.t_lab_ns, e.frames, e.rate, e.channels]), pcm, backToBack, ...JSON.parse(JSON.stringify(seen)),
      busy: lab.sim.read(UI_OUT_BUSY, 1)[0], port: lab.sim.m.devices.audio.status() };
  };
  const same = (x) => x.pcm.length === want.length && x.pcm.every((v, i) => v === want[i]);
  for (const n of [1, 2]) {
    const p = press();
    const t = p.native[0]?.[0] ?? -1;
    ok(p.sound.length === 1 && p.sound[0].op === 0 && p.sound[0].id === 0 && p.sound[0].vol.join() === '60,60,60', `half press ${n}: one sound request to UI_OUT, play, sound 0, volume 60: ${JSON.stringify(p.sound)}`);
    ok(same(p) && p.native.every((e) => e[2] === 48000 && e[3] === 2) && p.backToBack, `half press ${n}: /api/audio's events carry the lab-made beep, ${BEEP_FRAMES} frames, sample for sample: ${p.pcm.length / 2} frames in ${JSON.stringify(p.native)}`);
    ok(t > p.t0 && t < p.t0 + 250e6, `half press ${n}: the beep starts ${((t - p.t0) / 1e6).toFixed(1)} ms of lab time after S1 down (want 0 to 250)`);
    ok(p.gain === 0 && p.post_end === 1 && p.play_end === 1 && p.close === 1 && p.busy === 0 && !p.port.running && p.port.playing === null,
      `half press ${n}: the direct play (no gain stage), UI_OUT's release (post_end, command_play_end, the player's close) once, the port idle: ${JSON.stringify({ gain: p.gain, post_end: p.post_end, play_end: p.play_end, close: p.close, busy: p.busy, port: p.port })}`);
    ok(p.held.join() === '6,1', `half press ${n}: S-AFLOCK's take status while S1 is held (READY | READY_FINISH, isFocus 1): ${p.held}`);
  }
  // the negative control: without S-AFLOCK's AF lock the application's getCondition sees no focus, and nothing plays
  s.camapp.aflock = false;
  const nolock = press();
  ok(nolock.sound.length === 0 && nolock.native.length === 0, `without S-AFLOCK: no sound request and no sound: ${JSON.stringify([nolock.sound, nolock.native])}`);
  s.camapp.aflock = true;
  // Off: Setup's beep item (menu mode 1037) writes settings id 18, the id playAfSound reads (X)
  pl.submit({ type: 'token', token: 'SET:1037=0' }); pl.tick();
  ok(lab.get(1037) === 0 && lab.get(18) === 0, `SET:1037=0 leaves 18 at ${lab.get(18)}`);
  const off = press();
  ok(off.sound.length === 0 && off.native.length === 0, `beep Off: no sound request and no sound: ${JSON.stringify([off.sound, off.native])}`);
  pl.submit({ type: 'token', token: 'SET:1037=60' }); pl.tick();
  // S2: S-SHUTTERSND's two clicks, and the AF beep of the half press before it
  const e0 = events.length;
  key('s1', 'down'); key('s2', 'down'); idle(800); key('s2', 'up'); key('s1', 'up'); idle(400);
  const shot = events.slice(e0);
  const clicks = shot.filter((e) => e.source === STAND_IN).map((e) => e.frames), beep = shot.filter((e) => e.source === 'native').reduce((n, e) => n + e.frames, 0);
  ok(clicks.length === 2 && clicks[0] === shutterClick('open').length && clicks[1] === shutterClick('close').length && beep === BEEP_FRAMES,
    `S2: S-SHUTTERSND's open and close clicks (${JSON.stringify(clicks)}), and the half press's beep (${beep} frames)`);
  ok(pl.stand_ins_in_use().includes('S-AFLOCK') && pl.phase === 'running', `S-AFLOCK listed, the session runs on (${pl.phase} ${pl.error?.message ?? ''})`);
  pl.close_session();
  // --audio off: the sound area stays erased and the request plays nothing (no port)
  const plain = new Player({ ...args, audio: 'off' }, base);
  plain.open_session();
  ok(plain.session.audio_hw === null && plain.session.resnand?.status().sound === 'erased' && !plain.stand_ins_in_use().includes('S-SOUNDRES'), `--audio off: no audio hardware, the sound area erased (${plain.session.resnand?.status().sound})`);
  plain.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await audioUnits();
  console.log(`audio output and S-SHUTTERSND units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await audioSession();
    console.log(`S-SHUTTERSND in play (E143): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
    const b = await afBeepSession();
    console.log(`the AF beep end to end (E143): ${b.checks - b.bad.length}/${b.checks}`);
    b.bad.forEach((x) => console.log('  ', x));
    n += b.bad.length;
  }
  process.exit(n ? 1 : 0);
}
