// S-SOUNDRES: a lab-made sound area for the camera's operation sounds (docs/hle-gaps.md 4.5 "The operation sounds").
// The firmware plays its operation sounds from its type-2 resources (RES_MODE_SOUND), the area at NAND 0x4e420000
// that USTART_L's loader indexes (src/lab/resnand.mjs H-RESINIT). That area is factory data: no update carries it (D,
// no block of the .BIN loads there), and the lab has no copy of a camera's. So where the audio hardware runs
// (--audio on, src/lab/audiohw.mjs) and the host gives no image of its own (env.soundArea), S-RESNAND serves this
// one instead of the erased area: the TG-7's format (src/fw/nand.mjs soundArea: an OE head, 16-byte entries, 512-aligned
// RIFF WAVE files; the TG-7's update is the only one that ships such an area, X), holding one sound:
//   id 0, the AF confirmation (playAfSound 0x51052444 asks for sound 0, D): LAB-MADE, two short tone bursts synthesized
//          here, 48 kHz, 16-bit, stereo (the format the TG-7's sounds have and the play path pairs with its 48 kHz
//          ring, D: 0x50aac51b..48). It is not the camera's sound, which nobody here has heard from a capture: its
//          pitch, length and level are the lab's choice, made to be short and plain.
// USTART_L loads sound 0 into 0xa4000000 at the boot (H-RESINIT), 0x3d000 bytes below the GUI's icons record at
// 0xa403d000 (src/lab/resources.mjs): a sound 0 longer than that would run into it (X: a 2 s tone did, and the
// application's start stopped), so the beep is kept short. The background music the aud_debug command reads as ids
// 1..5 is left out: the index holds entry 0 and zeros after
// it, as the TG-7's index is padded (X). No lab input asks for another id (X: docs/hle-gaps.md 4.5).
// The WAV carries the AF sound's key in its INFO chunk (BEEP_KEY), as the TG-7's AF sound does, and the driver then
// plays it directly from its buffer (infoWav's comment); its samples start 16-byte but not 128-byte aligned, so that a
// play through the copy task would take the memcpy converter 0x50aa7439, not the SCA, which the lab does not model
// (src/dev/audio.mjs). Deterministic and worker-safe; no audio asset.
import { soundArea, SOUND_LOAD_E143 } from '../fw/nand.mjs';

export const STAND_IN = 'S-SOUNDRES';
export const BEEP_RATE = 48000, BEEP_CHANNELS = 2;
// the AF beep: two bursts of BEEP_HZ, each BURST_FRAMES long with RAMP_FRAMES raised-cosine edges, GAP_FRAMES apart,
// at BEEP_PEAK of full scale: 2 x 52 ms + 24 ms = 128 ms, 6144 frames (32 periods of the play path's 192 frames)
export const BEEP_HZ = 2700, BURST_FRAMES = 2496, GAP_FRAMES = 1152, RAMP_FRAMES = 240, BEEP_PEAK = 0.25;
export const BEEP_FRAMES = 2 * BURST_FRAMES + GAP_FRAMES;

// The lab-made AF beep's samples: an Int16Array of BEEP_FRAMES stereo frames (left and right the same), the same at
// every call.
export function afBeepPcm() {
  const pcm = new Int16Array(BEEP_FRAMES * BEEP_CHANNELS), amp = Math.round(BEEP_PEAK * 32767);
  for (const start of [0, BURST_FRAMES + GAP_FRAMES]) {
    for (let i = 0; i < BURST_FRAMES; i++) {
      const edge = Math.min(i, BURST_FRAMES - 1 - i), env = edge >= RAMP_FRAMES ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * edge / RAMP_FRAMES);
      const v = Math.round(amp * env * Math.sin(2 * Math.PI * BEEP_HZ * i / BEEP_RATE));
      pcm[2 * (start + i)] = v; pcm[2 * (start + i) + 1] = v;
    }
  }
  return pcm;
}

// A RIFF WAVE file of 16-bit PCM samples with a LIST INFO chunk {INAM name, IKEY key} between fmt and data, the layout
// of the TG-7's sound files (X: its AF sound is fmt, LIST INFO {INAM, ICRD, IKEY "PRM_AUD_AFOK_VOL"}, LIST EXIF, data).
// The name is padded with NULs so that the samples start at a multiple of DATA_ALIGN in the file: the direct play
// sends the data in place to the audio port, whose slot address registers hold the address >> 4 (the TX open
// 0x50aa9379 and its re-arm 0x50aa9652 write it so, D), so samples off a 16-byte boundary would play from the boundary
// below them (X: with the samples at +140 the port played 12 bytes of the header first)
export const DATA_ALIGN = 16;
export function infoWav(samples, { rate = BEEP_RATE, channels = BEEP_CHANNELS, name, key }) {
  const enc = new TextEncoder(), sub = (id, text, extra = 0) => {
    const b = new Uint8Array(enc.encode(text).length + 1 + extra), n = b.length + (b.length & 1), out = new Uint8Array(8 + n);
    b.set(enc.encode(text));
    for (let k = 0; k < 4; k++) out[k] = id.charCodeAt(k);
    new DataView(out.buffer).setUint32(4, b.length, true);
    out.set(b, 8);
    return out;
  };
  const ikey = sub('IKEY', key);
  let inam = null;
  for (let extra = 0; !inam || (12 + 24 + 12 + inam.length + ikey.length + 8) % DATA_ALIGN; extra++) inam = sub('INAM', name, extra);
  const items = [inam, ikey], infoLen = 4 + items.reduce((t, x) => t + x.length, 0);
  const n = samples.length * 2, total = 12 + 24 + 8 + infoLen + 8 + n, b = new Uint8Array(total), dv = new DataView(b.buffer);
  const tag = (o, t) => { for (let k = 0; k < 4; k++) b[o + k] = t.charCodeAt(k); };
  tag(0, 'RIFF'); dv.setUint32(4, total - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * 2, true); dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true);
  let o = 36;
  tag(o, 'LIST'); dv.setUint32(o + 4, infoLen, true); tag(o + 8, 'INFO'); o += 12;
  for (const x of items) { b.set(x, o); o += x.length; }
  tag(o, 'data'); dv.setUint32(o + 4, n, true); o += 8;
  for (let i = 0; i < samples.length; i++) dv.setInt16(o + 2 * i, samples[i], true);
  return b;
}

// The sound's name in its INFO chunk (the lab's, so that a dump of the area says what it is) and its key: the AF
// confirmation's key in the driver's wave-type table (aud_ikey_to_wavetype_is_short_sound 0x50aaa824 compares the IKEY
// with the 18 names at 0x60dbf174; "PRM_AUD_AFOK_VOL" is the TG-7's AF sound's IKEY, X, and the OM-1 table's 13th name,
// D), which picks how the driver plays and ends it (0x50aacb14: 0x62af27d6)
export const BEEP_NAME = 'om-emu lab-made AF beep (not the camera\'s sound)', BEEP_KEY = 'PRM_AUD_AFOK_VOL';

// The lab-made sound area: {image, sounds: [{id, name, pcm, wav}]}, the image in the TG-7's format at E143's address.
export function labSoundArea({ load = SOUND_LOAD_E143 } = {}) {
  const pcm = afBeepPcm(), wav = infoWav(pcm, { name: BEEP_NAME, key: BEEP_KEY });
  return { image: soundArea([{ id: 0, wav }], { load }), sounds: [{ id: 0, name: BEEP_NAME, key: BEEP_KEY, pcm, wav }] };
}
