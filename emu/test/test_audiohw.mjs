// The audio hardware (--audio on; src/dev/audio.mjs, src/lab/wm8946.mjs, src/lab/audiohw.mjs; docs/hle-gaps.md 4.5):
//   audioHwUnits    without firmware: no port without the machine's audio option; the port's register file and
//                   interrupt enables; TX enable rising sets status bit 4 and IRQ 43 follows status & +0x50; a write
//                   of 1s clears status bits; a start plays slot A then slot B, each fetched from memory as it starts,
//                   one slot of 768 bytes every 4 ms of lab time (48 kHz, 16-bit stereo), each end setting its done
//                   bit and bit 5; a re-arm keeps the stream going and a slot ending with the other not armed is an
//                   underrun; an end whose last interrupt was not taken counts an overrun; TX run cleared lets the
//                   slot playing play out with no interrupt; the played slots come out of take() in order with their
//                   start times; refused: RX use (+0x00 bit 6, the RX words, an RX arm), a start without the port and
//                   TX enabled or with another format, an arm of a slot outside memory, another +0x44 bit, a halfword,
//                   a debugger write, an SCA start; the SCA page's storage; the sound IC's register file (a write
//                   kept, a read answering it, a read of an unwritten register and another frame refused) and its
//                   volume registers; the sink: consecutive slots merged into one event of source 'native', a gap
//                   starting another, nothing emitted (but counted) without an audio output
//   audioHwSession  (E143 firmware) a play session with --audio on: H-AUDSTART (AUD_MAIN and AUD_COPY_DATA waiting,
//                   both CPU 2 starts answered by S-AUDCPU2, IRQ 43 and 45 attached), the status lists H-AUDSTART,
//                   S-AUDCPU2, S-WM8946 and A-AUDIO-1; then AUD_EXEC posted directly as UI_OUT's sound handler would
//                   (no UI_OUT, no sound table): a player opened (0x50aa9715), cmd 0x22 (volume), cmd 0x41 (usr_wave,
//                   the descriptor 0xa32db094 pointing at a synthesized 48 kHz 16-bit stereo WAV the test writes into
//                   memory, its data chunk off 128-byte alignment) and cmd 0x45 (play start): aud_seq_play, the play
//                   start, AUD_COPY_DATA's cmd 1 and 0x80000002 posts, the TX open, flag 0xed's callback and the TX
//                   start in that order; the prefill and every copy through the memcpy converter 0x50aa7439, the
//                   gain stage at 0 dB; IRQ 43 every 4 ms of lab time with one cmd 3 per period; the codec's register
//                   writes; the WAV's samples out of session.audio in order, unchanged, as back-to-back events; the
//                   port stopped by the firmware at the sound's end with no underrun; and a session without --audio has
//                   no port and does not list them
//   node emu/test/test_audiohw.mjs [--session]
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { CTRL, TX_CTRL, TX_ADDR, TX_LEN, TX_STATUS, TX_IE, RX_IE, TX_FMT_A, ARM, S_READY, S_SLOT, S_DONE, SCA_START } from '../src/dev/audio.mjs';
import { Wm8946, Wm8946Error, VOLUME_REGS } from '../src/lab/wm8946.mjs';
import { AudioHw, NATIVE_SOURCE } from '../src/lab/audiohw.mjs';
import { AudioOut } from '../src/lab/audio.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const SLOT = 768, PERIOD_NS = 4000000;
// the TX configuration the driver writes for a 48 kHz 16-bit stereo WAV (X, audioHwSession)
const FMT04 = 0x0010201f, FMT30 = 0x40;

function portTests(ok) {
  {
    const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
    ok(m.devices.audio === undefined, 'no audio port without the machine\'s audio option');
  }
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0, audio: true });
  const { audio: p, intc, clock } = m.devices, irq = BOARD.audio.irq;
  const rd = (o, w = 4) => p.read(o, w, false), wr = (o, v, w = 4) => p.write(o, v, w, false);
  const line = () => intc.line[irq] === 1;
  const A0 = 0xA4100000, B0 = A0 + SLOT, A1 = A0 + 2 * SLOT;
  const fill = (at, seed) => { const b = new Uint8Array(SLOT); for (let i = 0; i < SLOT; i++) b[i] = (seed + i * 7) & 255; m.dbgWrite(at, b); return b; };
  const a0 = fill(A0, 1), b0 = fill(B0, 2), a1 = fill(A1, 3);
  const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  ok(rd(CTRL) === 0 && rd(TX_STATUS) === 0 && !line(), 'the port starts with its words at 0 and IRQ 43 low');
  wr(RX_IE, 0xf); wr(TX_IE, 0x38); wr(0x100, 0x1234); wr(TX_FMT_A, FMT04);
  ok(rd(RX_IE) === 0xf && rd(TX_IE) === 0x38 && rd(0x100) === 0x1234 && rd(TX_FMT_A) === FMT04, 'the interrupt enables and the configuration words are storage');
  wr(TX_ADDR[0], A0 >>> 4); wr(TX_ADDR[1], B0 >>> 4); wr(TX_LEN[0], SLOT); wr(TX_LEN[1], SLOT); wr(TX_STATUS, ARM[0] | ARM[1]);
  ok(p.armed[0]?.addr === A0 && p.armed[1]?.addr === B0 && p.armed[1].len === SLOT, '0xc00 arms both slots at their address << 4 and length');
  wr(CTRL, 0x11); wr(TX_CTRL, FMT30);
  ok(rd(TX_STATUS) === 0 && !line(), 'nothing is raised before TX enable');
  wr(TX_CTRL, FMT30 | 4);
  ok(rd(TX_STATUS) === S_READY && line(), `TX enable rising sets status bit 4 and IRQ 43 follows status & +0x50 (status 0x${rd(TX_STATUS).toString(16)})`);
  wr(TX_STATUS, S_READY);
  ok(rd(TX_STATUS) === 0 && !line(), 'a write of 1s clears the status bits it names and IRQ 43 drops');
  const t0 = clock.t;
  wr(CTRL, 0x31);
  ok(p.playing?.slot === 0 && p.playing.t0 === t0 && p.format?.rate === 48000 && p.format.channels === 2, 'a start plays slot A at once, 48 kHz 16-bit stereo');
  clock.advance(t0 + PERIOD_NS - 1, true);
  ok(rd(TX_STATUS) === 0 && p.take().length === 0, 'nothing before 4 ms of lab time');
  clock.advance(t0 + PERIOD_NS, true);
  const st1 = rd(TX_STATUS), t1 = p.take();
  ok(st1 === (S_DONE[0] | S_SLOT) && line() && p.playing?.slot === 1, `slot A ends after 4 ms: done bit 0 and bit 5 (0x${st1.toString(16)}), IRQ 43 high, slot B playing`);
  ok(t1.length === 1 && t1[0].t_ns === t0 && same(t1[0].bytes, a0) && t1[0].rate === 48000 && t1[0].channels === 2, 'take() hands over slot A\'s bytes with its start time');
  m.dbgWrite(A0, new Uint8Array(SLOT));      // after the fetch: the played slot keeps the bytes it fetched
  wr(TX_STATUS, st1); wr(TX_ADDR[0], A1 >>> 4); wr(TX_LEN[0], SLOT); wr(TX_STATUS, ARM[0]);
  ok(!line() && p.armed[0]?.addr === A1, 'the ISR\'s write-back clears the status and a re-arm reloads slot A');
  clock.advance(t0 + 2 * PERIOD_NS, true);
  const st2 = rd(TX_STATUS), t2 = p.take();
  ok(st2 === (S_DONE[1] | S_SLOT) && t2.length === 1 && t2[0].t_ns === t0 + PERIOD_NS && same(t2[0].bytes, b0) && p.playing?.slot === 0, `slot B ends 4 ms later (0x${st2.toString(16)}), its bytes at its start time, the re-armed slot A playing`);
  clock.advance(t0 + 3 * PERIOD_NS, true);       // the interrupt not taken: an overrun; slot B not armed: an underrun
  const t3 = p.take();
  ok(p.stats.overruns === 1 && p.stats.underruns === 1 && p.playing === null && t3.length === 1 && same(t3[0].bytes, a1), `an end with the last interrupt not taken counts an overrun, and with the other slot not armed an underrun (${JSON.stringify(p.stats)})`);
  // a stop lets the slot playing play out with no interrupt
  wr(TX_STATUS, 0x3f); wr(CTRL, 0x11);
  wr(TX_ADDR[0], A0 >>> 4); wr(TX_ADDR[1], B0 >>> 4); wr(TX_STATUS, ARM[0] | ARM[1]);
  const t4 = clock.t;
  wr(CTRL, 0x31); wr(CTRL, 0x11);
  clock.advance(t4 + 3 * PERIOD_NS, false);
  const t5 = p.take();
  ok(t5.length === 1 && t5[0].t_ns === t4 && rd(TX_STATUS) === 0 && p.playing === null && p.armed[1] !== null, `TX run cleared: the slot playing plays out with no interrupt and slot B does not start (${t5.length} block(s), status 0x${rd(TX_STATUS).toString(16)})`);
  // refusals
  for (const [what, fn] of [['+0x00 bit 6 (RX run)', () => wr(CTRL, 0x51)], ['the RX control word', () => wr(0x0c, 4)], ['an RX slot', () => wr(0x10, 1)],
    ['an RX arm', () => wr(0x20, 0x300)], ['another +0x44 bit', () => wr(TX_STATUS, 0x1000)], ['a halfword read', () => rd(TX_CTRL, 2)], ['an unaligned write', () => wr(0x31, 0)],
    ['a debugger write', () => p.write(TX_CTRL, 0, 4, true)], ['an arm outside memory', () => { wr(TX_ADDR[0], 0x01000000); wr(TX_STATUS, ARM[0]); }],
    ['an SCA start', () => p.scaWrite(SCA_START, 1, 4, false)]]) ok(throwsAs(fn, BUS), `${what} is a bus error`);
  wr(0x20, 0);
  ok(rd(0x20) === 0, 'the ISR\'s write-back of an RX status of 0 is taken');
  wr(TX_ADDR[0], A0 >>> 4); wr(TX_STATUS, ARM[0]);
  wr(TX_CTRL, 0x04);
  ok(throwsAs(() => wr(CTRL, 0x31), BUS), 'a start with another TX configuration is a bus error');
  wr(TX_CTRL, FMT30); wr(CTRL, 0x11);
  ok(throwsAs(() => wr(CTRL, 0x31), BUS), 'a start with TX not enabled is a bus error');
  p.scaWrite(0x08, 0x3e0, 4, false); p.scaWrite(0x3b0, 1, 4, false);
  ok(p.scaRead(0x08, 4, false) === 0x3e0 && p.scaRead(0x3b0, 4, false) === 1 && !intc.line[BOARD.audio.sca_irq], 'the SCA page keeps its init\'s writes; its IRQ stays low');
}

function chipTests(ok) {
  const c = new Wm8946();
  ok(c.transfer(Uint8Array.of(0x00, 0x0a, 0x01, 0xc0), 0).length === 0 && c.regs.get(0x0a) === 0x1c0, 'a write frame {address, data} keeps the 16-bit value');
  const r = c.transfer(Uint8Array.of(0x80, 0x0a), 2);
  ok(r.length === 2 && r[0] === 0x01 && r[1] === 0xc0 && c.reads === 1, 'a read (2 + 2 bytes, bit 7 set) answers the value last written');
  ok(throwsAs(() => c.transfer(Uint8Array.of(0x80, 0x0b), 2), Wm8946Error), 'a read of a register not written is refused');
  ok(throwsAs(() => c.transfer(Uint8Array.of(0x00, 0x0a, 0x01), 0), Wm8946Error) && throwsAs(() => c.transfer(Uint8Array.of(0x00, 0x0a), 2), Wm8946Error), 'a frame of another form is refused');
  c.transfer(Uint8Array.of(0x00, 0x28, 0x00, 0x75), 0);
  ok(JSON.stringify(c.volume()) === JSON.stringify({ '0x0a': 0x1c0, '0x28': 0x75 }) && VOLUME_REGS.includes(0x47), `the volume registers written: ${JSON.stringify(c.volume())}`);
}

function sinkTests(ok) {
  const blocks = [];
  const port = { take: () => blocks.splice(0) };
  const block = (t, v) => ({ t_ns: t, rate: 48000, channels: 2, bytes: new Uint8Array(new Int16Array(384).fill(v).buffer) });
  const out = new AudioOut(), hw = new AudioHw({ lab: { sim: { m: { devices: { audio: port } } } }, audio: out });
  blocks.push(block(0, 1), block(PERIOD_NS, 2), block(3 * PERIOD_NS, 3));
  hw.drain();
  const ev = out.take();
  ok(ev?.length === 2 && ev[0].t_lab_ns === 0 && ev[0].frames === 384 && ev[0].samples[0] === 1 && ev[0].samples[767] === 2 && ev[1].t_lab_ns === 3 * PERIOD_NS &&
    ev.every((e) => e.source === NATIVE_SOURCE && e.rate === 48000 && e.channels === 2), `consecutive slots merge into one event, a gap starts another: ${JSON.stringify(ev?.map((e) => [e.t_lab_ns, e.frames]))}`);
  const quiet = new AudioHw({ lab: { sim: { m: { devices: { audio: port } } } }, audio: null });
  blocks.push(block(0, 1));
  quiet.drain();
  ok(quiet.unplayed === 192 && quiet.events === 0, 'without an audio output nothing is emitted, the frames are counted');
}

export function audioHwUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  for (const t of [portTests, chipTests, sinkTests]) {
    try { t(ok); } catch (e) { bad.push(`${t.name} threw: ${e.stack}`); }
  }
  return { checks, bad };
}

// ---- the firmware test
const OPEN = 0x50AA9715, SYNC_SEND = 0x5002E39D, EXEC_QUEUE = 0x600431D4, DESC = 0xA32DB094, DESC_POST = 0xA32DB0F4, OPEN_REC = 0xA32DB164;
const WAV_AT = 0xA4000040;                 // UI_OUT's sound buffer 0xa4000000 (D), the data chunk at +0x6c: not 128-aligned
const SEQ = { 0x50AAC292: 'aud_seq_play', 0x50AAC5A2: 'play start', 0x50AA8D9B: 'TX open', 0x50AAD28A: 'flag 0xed', 0x50AA8E9A: 'TX start' };
const DTQ_POST = 0x50A644AE, COPY_MEMCPY = 0x50AA7439, GAIN = 0x50AA8A63, ISR = 0x50AA90E2, PERIOD_CB = 0x50AAD2A0, COPY_CMD3 = 0x50AA79E6;

// a 48 kHz 16-bit stereo WAV of `frames` frames: two tones, lab-made
export function labWav(frames) {
  const pcm = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) { pcm[2 * i] = Math.round(8000 * Math.sin(2 * Math.PI * 1000 * i / 48000)); pcm[2 * i + 1] = Math.round(4000 * Math.sin(2 * Math.PI * 1500 * i / 48000)); }
  const data = new Uint8Array(pcm.buffer), wav = new Uint8Array(44 + data.length), dv = new DataView(wav.buffer);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) wav[o + i] = t.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + data.length, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, 48000, true); dv.setUint32(28, 48000 * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, data.length, true); wav.set(data, 44);
  return { wav, pcm };
}

export async function audioHwSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const base = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  const events = [];
  const pl = new Player({ ...args, audio: 'on' }, { ...base, onAudio: (e) => events.push(...e) });
  pl.open_session();
  const s = pl.session, lab = s?.lab;
  ok(pl.phase === 'running' && s?.audio_hw, `--audio on: the session runs with the audio hardware (${pl.phase} ${pl.error?.message?.slice(0, 300) ?? ''})`);
  if (!s?.audio_hw) { pl.close_session(); return { checks, bad }; }
  const hw = s.audio_hw, st = hw.status(), sim = lab.sim, port = sim.m.devices.audio;
  ok(lab.nk.state(st.main_tid) === 4 && JSON.stringify(st.cpu2) === JSON.stringify({ '0x2017': 'AUD_WAKEUP', '0x200e': 'AUD_LEVEL_MONITOR' }),
    `H-AUDSTART: AUD_MAIN (${st.main_tid}) waits, S-AUDCPU2 answered both CPU 2 starts: ${JSON.stringify(st.cpu2)}`);
  const attached = lab.kernel.events.filter((e) => e[0] === 'irq_attach').map((e) => e[1]);
  ok(attached.includes(`irq=${BOARD.audio.irq} level=3`) && attached.includes(`irq=${BOARD.audio.sca_irq} level=5`), `AUD_MAIN's driver init attaches IRQ 43 at level 3 and IRQ 45 at level 5: ${JSON.stringify(attached.slice(-6))}`);
  const used = pl.stand_ins_in_use();
  ok(['H-AUDSTART', 'S-AUDCPU2', 'S-WM8946', 'A-AUDIO-1'].every((x) => used.includes(x)), 'the status lists H-AUDSTART, S-AUDCPU2, S-WM8946 and A-AUDIO-1');
  // the path, observed
  const seq = [], posts = [], isr = [], periods = [];
  let copies = 0, gains = new Set(), cmd3 = 0;
  const hooked = [];
  const watch = (a, fn, name) => { if (lab.hooks.has(runtime(a))) hooked.push(name); lab.observe(a, fn, `obs-audiohw-${name}`); };
  for (const [a, name] of Object.entries(SEQ)) watch(Number(a), () => seq.push(name), name);
  watch(DTQ_POST, (l, r) => posts.push(r.d1 >>> 0), 'dtq');
  watch(COPY_MEMCPY, () => { copies += 1; }, 'memcpy');
  watch(GAIN, (l, r) => gains.add(r.d1 >>> 0), 'gain');
  watch(ISR, () => isr.push(lab.lab_time()), 'isr');
  watch(PERIOD_CB, () => periods.push(lab.lab_time()), 'period');
  watch(COPY_CMD3, () => { cmd3 += 1; }, 'cmd3');
  ok(!hooked.length, `the test's observers replace no hook of the lab's: ${JSON.stringify(hooked)}`);
  const codec0 = st.codec.writes;
  // UI_OUT's sound handler's sends (0x5014f7e0, D), from the lab task, with lab time running while it waits
  const FRAMES = 4800, { wav, pcm } = labWav(FRAMES);
  sim.write(WAV_AT, wav);
  const desc = new Uint8Array(96), dd = new DataView(desc.buffer);
  dd.setUint32(0, 1, true); dd.setUint32(4, WAV_AT, true); dd.setUint32(8, wav.length, true);    // wav_mode 1 (UI_OUT's init), io_adr, io_length
  sim.write(DESC, desc);
  sim.write(OPEN_REC, new Uint8Array(8));
  const timed = (fn) => {
    const prev = lab.lt.on_idle;
    lab.lt.on_idle = () => { lab.run_to_event(lab.lab_time() + 1e9); return 'again'; };
    try { return fn(); } finally { lab.lt.on_idle = prev; }
  };
  s.begin('99-audiohw AUD_EXEC');
  const player = timed(() => lab.call(OPEN, { a0: OPEN_REC, d0: 300 }, null, null, 200000)).d0 >>> 0;
  const q = sim.read(EXEC_QUEUE, 2), qid = q[0] | q[1] << 8;
  const vols = lab.alloc(new Uint8Array(new Int32Array([100, 100, 100, 0]).buffer), 16);
  const send = (cmd, fill) => {
    const m = new Uint8Array(64), md = new DataView(m.buffer);
    m[0] = cmd; fill(md);
    return timed(() => lab.call(SYNC_SEND, { d0: qid, a0: lab.alloc(m, 16), d1: 1 }, null, null, 2000000)).d0 | 0;
  };
  const rcs = [send(0x22, (md) => md.setUint32(48, vols, true)),
    send(0x41, (md) => { md.setUint32(4, player, true); md.setUint32(12, DESC, true); md.setUint32(40, DESC_POST, true); }),
    send(0x45, (md) => { md.setUint32(4, player, true); md.setUint32(12, DESC, true); md.setUint32(40, DESC_POST, true); })];
  s.settle('audiohw AUD_EXEC');
  s.end('audiohw AUD_EXEC', 'debug', [], []);
  ok(player <= 2 && rcs.every((r) => r === 0), `the player ${player} opened, the three sends answered 0: ${JSON.stringify(rcs)}`);
  ok(JSON.stringify(seq) === JSON.stringify(['aud_seq_play', 'play start', 'TX open', 'flag 0xed', 'TX start']), `aud_seq_play, the play start, the TX open, flag 0xed's callback and the TX start in order: ${JSON.stringify(seq)}`);
  ok(posts.length >= 2 && (posts[0] & 0xfff) === 1 && posts[1] === 0x80000002, `the play start posts AUD_COPY_DATA cmd 1, then 0x80000002 (the prefill): ${JSON.stringify(posts.map((x) => '0x' + x.toString(16)))}`);
  ok(port.status().running && port.status().format === 's16 stereo 48 kHz', `the port runs 48 kHz 16-bit stereo: ${JSON.stringify(port.status())}`);
  ok(hw.status().codec.writes > codec0, `the play start's sound-IC list writes the codec (${codec0} -> ${hw.status().codec.writes} writes)`);
  for (const ms of [60, 60, 100]) { s.idle_slice(lab.lab_time() + ms * 1e6); pl.publish_audio(); }
  const ps = port.status();
  const slots = periods.map((t, i) => (i ? t - periods[i - 1] : PERIOD_NS));
  ok(isr.length === periods.length + 1, `IRQ 43's handler runs once for TX ready and once per period: ${isr.length} runs, ${periods.length} periods`);
  ok(periods.length === FRAMES / 192 - 1 && slots.every((d) => d === PERIOD_NS), `IRQ 43 every 4 ms of lab time with a period callback each: ${periods.length} callbacks, gaps ${JSON.stringify([...new Set(slots)])}`);
  ok(cmd3 === periods.length, `one AUD_COPY_DATA cmd 3 per period: ${cmd3} for ${periods.length}`);
  ok(copies === FRAMES / 192 && JSON.stringify([...gains]) === '[0]', `every period copied through the memcpy converter (${copies}), the gain stage at 0 dB (${JSON.stringify([...gains])})`);
  ok(!ps.running && ps.slots === FRAMES / 192 && ps.underruns === 0 && ps.overruns === 0 && ps.stops === 1, `the firmware stops the port at the sound's end: ${JSON.stringify(ps)}`);
  const native = events.filter((e) => e.source === NATIVE_SOURCE);
  const got = new Int16Array(native.reduce((n, e) => n + e.samples.length, 0));
  let o = 0;
  for (const e of native) { got.set(e.samples, o); o += e.samples.length; }
  const backToBack = native.every((e, i) => !i || e.t_lab_ns === native[i - 1].t_lab_ns + Math.round(native[i - 1].frames * 1e9 / 48000));
  ok(got.length === pcm.length && got.every((v, i) => v === pcm[i]), `the WAV's samples come out of session.audio in order and unchanged: ${got.length} of ${pcm.length}`);
  ok(native.length >= 1 && backToBack && native.every((e) => e.rate === 48000 && e.channels === 2), `as back-to-back 48 kHz stereo events: ${JSON.stringify(native.map((e) => [e.t_lab_ns, e.frames]))}`);
  ok(pl.phase === 'running', `the session runs on: ${pl.phase} ${pl.error?.message ?? ''}`);
  pl.close_session();
  // without --audio
  const plain = new Player(args, base);
  plain.open_session();
  ok(plain.session.audio_hw === null && plain.session.lab.sim.m.devices.audio === undefined && !plain.stand_ins_in_use().includes('H-AUDSTART'),
    'without --audio: no audio port, no H-AUDSTART');
  plain.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = audioHwUnits();
  console.log(`audio port, sound IC and sink units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await audioHwSession();
    console.log(`the audio hardware in play (E143): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
  }
  process.exit(n ? 1 : 0);
}
