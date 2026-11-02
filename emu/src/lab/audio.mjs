// The lab's audio output: PCM events the lab emits for its hosts to play (the node play server's page and the browser
// player's page play them with WebAudio). Nothing here is firmware evidence; it is the harness's channel to the hosts.
// Worker-safe.
//
// An event is one block of PCM:
//   t_lab_ns  the lab time its first frame sounds at (an integer, ns on the lab clock)
//   rate      frames per second (an integer, AUDIO_RATES[0]..AUDIO_RATES[1])
//   channels  1 (mono) or 2 (stereo, the samples interleaved left, right)
//   samples   an Int16Array of frames x channels signed 16-bit samples (at most AUDIO_MAX_S seconds)
//   source    who made it: a stand-in's label ('S-SHUTTERSND') or, for PCM the firmware itself produces, 'native...'
// A source that streams emits consecutive blocks whose t_lab_ns is the previous block's end (its t_lab_ns plus
// frames / rate seconds, rounded to ns); the pages play such a block right after the one before it (within 1 ms of
// lab time), and every other event at its own lab time, overlapping where it falls (S2's close click comes 1/125 s
// after its open click, inside the 30 ms the open click lasts).
//
// The interface a native source uses (the firmware's own sound, docs/hle-gaps.md 4.5: for example 48 kHz stereo PCM16
// tapped where the firmware copies a block of its output to the audio buffer) is the one S-SHUTTERSND uses:
//   session.audio?.emit({ t_lab_ns: lab.lab_time(), rate: 48000, channels: 2, samples, source: 'native' })
// with samples a copy (the event keeps the array: the guest memory it came from changes). session.audio is null when
// the host plays no sound (env.onAudio absent: the gates, golden, the checks, nav), so a source does nothing there and
// costs nothing; emit() checks the event and queues it, and nothing else runs until the Player drains the queue.
//
// The way to the page:
//   AudioOut (PlaySession.audio)  emit(ev) queues; take() hands the queued events over (null when none). At most
//                                 AUDIO_PENDING events wait (the oldest go first, counted in dropped).
//   Player.publish_audio()        after every tick (and as a session closes): the batch numbered (seq, from 1, across
//                                 the Player's sessions) into the Player's AudioRing and handed to env.onAudio(events).
//   node host                     host/labworker.mjs posts the batch to the main thread, whose PlayerProxy keeps it in
//                                 its own AudioRing; GET /api/audio?after=N (src/lab/playapi.mjs) long-polls it.
//   browser player                web/worker.mjs posts the batch to the page; web/page.mjs answers the same
//                                 GET /api/audio?after=N from it.
//   page (web/play.html,          plays each event at its lab time relative to the run's first (a lead of 0.15 s);
//   web/index.html)               the AudioContext starts at the first key or pointer press, Sound toggles it.
// GET /api/audio?after=N answers audioDoc(): {seq (the newest), dropped (events after N no longer kept), events: [{seq,
// t_lab_ns, rate, channels, frames, source, pcm}]}, pcm the samples as base64 of little-endian 16-bit words (the
// browser's page.mjs gives the same document with the samples as Int16Arrays in the answer's audio field instead);
// after=-1 answers the newest seq with no events, where a page starts.
import { bytesBase64 } from '../util/bytes.mjs';

export const AUDIO_RATES = [8000, 192000];      // the rates an event may have (frames per second)
export const AUDIO_MAX_S = 10;                  // the longest event, in seconds
export const AUDIO_PENDING = 256;               // events a session queues between two drains
export const AUDIO_KEEP = 64;                   // events a ring keeps for GET /api/audio

export class AudioError extends RangeError { get name() { return 'AudioError'; } }

// The event emit() takes, checked: a copy of its fields with frames added. A malformed event is the emitter's bug
// (an AudioError), not a lab failure.
export function audioEvent(ev) {
  const { t_lab_ns, rate, channels, samples, source } = ev ?? {};
  if (!Number.isSafeInteger(t_lab_ns) || t_lab_ns < 0) throw new AudioError(`audio: t_lab_ns ${t_lab_ns} is not a lab time in ns`);
  if (!Number.isInteger(rate) || rate < AUDIO_RATES[0] || rate > AUDIO_RATES[1]) throw new AudioError(`audio: rate ${rate} is not ${AUDIO_RATES.join('..')} frames a second`);
  if (channels !== 1 && channels !== 2) throw new AudioError(`audio: channels ${channels} is not 1 or 2`);
  if (!(samples instanceof Int16Array)) throw new AudioError('audio: samples is not an Int16Array');
  if (samples.length === 0 || samples.length % channels) throw new AudioError(`audio: ${samples.length} samples are not whole frames of ${channels} channels`);
  const frames = samples.length / channels;
  if (frames > rate * AUDIO_MAX_S) throw new AudioError(`audio: ${frames} frames are more than ${AUDIO_MAX_S} s at ${rate}`);
  if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new AudioError(`audio: source ${JSON.stringify(source)} is not a name of 1 to 64 characters`);
  return { t_lab_ns, rate, channels, frames, samples, source };
}

// A session's queue of events (PlaySession.audio, made only when the host plays sound).
export class AudioOut {
  constructor() {
    this.pending = [];
    this.emitted = 0;            // events emitted in the session
    this.dropped = 0;            // events dropped from a full queue
  }
  emit(ev) {
    const e = audioEvent(ev);
    if (this.pending.length >= AUDIO_PENDING) { this.pending.shift(); this.dropped += 1; }
    this.pending.push(e);
    this.emitted += 1;
  }
  // the queued events, oldest first, and an empty queue; null when nothing is queued
  take() {
    if (this.pending.length === 0) return null;
    const out = this.pending;
    this.pending = [];
    return out;
  }
}

// The newest events by seq (the Player's, numbering them; the node host's proxy, keeping the Player's numbers).
export class AudioRing {
  constructor(keep = AUDIO_KEEP) {
    this.keep = keep;
    this.events = [];
    this.seq = 0;                // the newest event's seq (0: none yet)
  }
  // events without a seq: numbered from the ring's next
  add(events) {
    for (const e of events) { this.seq += 1; e.seq = this.seq; this.events.push(e); }
    this.trim();
    return events;
  }
  // events numbered elsewhere, in order
  insert(events) {
    for (const e of events) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= this.seq) throw new AudioError(`audio: event seq ${e.seq} after ${this.seq}`);
      this.seq = e.seq;
      this.events.push(e);
    }
    this.trim();
  }
  trim() { if (this.events.length > this.keep) this.events.splice(0, this.events.length - this.keep); }
  // the events after seq `after` still kept, and how many after it are not
  after(after) {
    const events = this.events.filter((e) => e.seq > after);
    const first = events.length ? events[0].seq : this.seq + 1;
    return { seq: this.seq, dropped: Math.max(0, first - Math.max(after, 0) - 1), events };
  }
}

// little-endian bytes of 16-bit samples
export function pcmBytes(samples) {
  const b = new Uint8Array(samples.length * 2), dv = new DataView(b.buffer);
  for (let i = 0; i < samples.length; i++) dv.setInt16(2 * i, samples[i], true);
  return b;
}
// GET /api/audio?after=N's document (see the header)
export function audioDoc(ring, after) {
  const r = ring.after(after);
  return { seq: r.seq, dropped: r.dropped, events: r.events.map((e) => ({ seq: e.seq, t_lab_ns: e.t_lab_ns, rate: e.rate, channels: e.channels,
    frames: e.frames, source: e.source, pcm: bytesBase64(pcmBytes(e.samples)) })) };
}
