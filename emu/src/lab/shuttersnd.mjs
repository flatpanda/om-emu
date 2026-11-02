// S-SHUTTERSND: the sound of the mechanical shutter at a release, synthesized. On the camera that sound is the
// mechanism's own (the curtains, the magnets, the charge motor; docs/hle-gaps.md section 7), not the firmware's: the
// stock firmware plays nothing at a release (X: no call of the sound engine's play method and no access to the audio
// blocks at S2, docs/om1-shutter-spec.md section 7 item 61), and the electronic shutter is silent. The lab has no
// mechanism, so this stand-in makes the two sounds a listener hears: an open click as the exposure starts (S-RELSEQ's
// START_EXPOSE) and a close click with the charge as it ends (END_EXPOSE, the shutter time in use later: S-SCENE's,
// else 1/125 s). Which shutter the camera's drive setting selects is not decoded (?), so the stand-in takes the
// mechanical shutter at every release. It sounds only where the host plays sound (PlaySession.audio, src/lab/audio.mjs).
//
// The clicks are procedural and deterministic (no audio asset, no host randomness): seeded noise and a low thump
// through a few decaying resonators, under an exponential envelope; the close adds the charge, a short motor whir,
// and a latch. Nothing about them is measured from a camera: they are the lab's choice, made to be short and plausible.
// Worker-safe.

export const SHUTTER_RATE = 48000;             // the clicks' rate (frames per second, mono)
export const CLICK_S = { open: 0.030, close: 0.095 };
export const STAND_IN = 'S-SHUTTERSND';

// The parts of a click: [start s, gain, decay time constant s, noise resonators [Hz, bandwidth Hz, weight], thump Hz]
const HITS = {
  open: [[0, 1, 0.0045, [[2400, 500, 1], [4100, 700, 0.7], [6800, 1200, 0.45]], 190]],
  close: [[0, 1, 0.006, [[1800, 400, 1], [3300, 600, 0.8], [5200, 900, 0.5]], 140],
    [0.068, 0.35, 0.0025, [[3000, 800, 1], [6000, 1500, 0.5]], 0]],          // the latch at the charge's end
};
const PEAK = { open: 0.5, close: 0.65 };       // the peak as a fraction of full scale
const WHIR = { from: 0.016, to: 0.066, gain: 0.5, hz: [420, 260], band: [900, 700] };   // the close's charge motor

// xorshift32: the noise, seeded per click so that a click is the same at every run
function noise(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2147483648 - 1; };
}
// a two-pole resonator at f Hz with bandwidth bw Hz, fed sample by sample
function resonator(f, bw, rate) {
  const r = Math.exp(-Math.PI * bw / rate), a1 = 2 * r * Math.cos(2 * Math.PI * f / rate), a2 = -r * r;
  let y1 = 0, y2 = 0;
  return (x) => { const y = x + a1 * y1 + a2 * y2; y2 = y1; y1 = y; return y; };
}

// One click, 'open' or 'close', at rate frames per second: an Int16Array (mono), the same for the same arguments.
export function shutterClick(kind, rate = SHUTTER_RATE) {
  if (!Object.hasOwn(CLICK_S, kind)) throw new RangeError(`shutterClick: kind ${JSON.stringify(kind)}: open or close`);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new RangeError(`shutterClick: rate ${rate} is not 8000..192000`);
  const n = Math.round(CLICK_S[kind] * rate), x = new Float64Array(n);
  const rnd = noise(kind === 'open' ? 0x5eed1 : 0x5eed2);
  for (const [t0, gain, tau, res, thump] of HITS[kind]) {
    const i0 = Math.round(t0 * rate), fs = res.map(([f, bw, w]) => [resonator(f, bw, rate), w]);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / rate, env = gain * Math.exp(-t / tau) * Math.min(1, t * rate / 8);   // an 8-frame attack
      const e = env * rnd();
      let s = 0;
      for (const [f, w] of fs) s += w * f(e);
      x[i] += s + (thump ? 6 * env * Math.sin(2 * Math.PI * thump * t) : 0);
    }
  }
  if (kind === 'close') {                       // the charge: band-limited noise, amplitude-modulated by the motor
    const i0 = Math.round(WHIR.from * rate), i1 = Math.round(WHIR.to * rate), len = i1 - i0;
    const fs = WHIR.band.map((f) => resonator(f, 300, rate));
    let ph = 0;
    for (let i = i0; i < i1; i++) {
      const u = (i - i0) / len, hz = WHIR.hz[0] + (WHIR.hz[1] - WHIR.hz[0]) * u;
      ph += 2 * Math.PI * hz / rate;
      const env = WHIR.gain * Math.sin(Math.PI * u) ** 2 * (0.6 + 0.4 * Math.sin(ph));
      const e = rnd();
      x[i] += env * fs.reduce((s, f) => s + f(e), 0) * 0.05;
    }
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const fade = Math.round(0.002 * rate), out = new Int16Array(n), k = peak ? PEAK[kind] * 32767 / peak : 0;
  for (let i = 0; i < n; i++) out[i] = Math.round(x[i] * k * Math.min(1, (n - 1 - i) / fade));   // a 2 ms fade to 0
  return out;
}

// The stand-in: the clicks of each release to a session's audio output (AudioOut). The clicks are made once per
// process and shared (an event keeps its samples, which nothing writes).
const CLICKS = new Map();
const click = (kind) => { let c = CLICKS.get(kind); if (!c) CLICKS.set(kind, c = shutterClick(kind)); return c; };
export class ShutterSound {
  constructor(out) {
    this.out = out;
    this.opened = 0;             // open clicks emitted (the player lists S-SHUTTERSND once one was)
    this.closed = 0;
  }
  // the exposure starts at lab time t_ns (S-RELSEQ's START_EXPOSE)
  open(t_ns) { this.emit('open', t_ns); this.opened += 1; }
  // it ends at t_ns (END_EXPOSE's due time)
  close(t_ns) { this.emit('close', t_ns); this.closed += 1; }
  emit(kind, t_ns) {
    this.out.emit({ t_lab_ns: Math.round(t_ns), rate: SHUTTER_RATE, channels: 1, samples: click(kind), source: STAND_IN });
  }
}
