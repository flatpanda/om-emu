// S-SCENE: a stand-in for the image sensor and the image pipeline in front of the live-view bank. The camera's own
// path (sensor -> SLVS -> binning -> PRO -> YC bank, docs/om1-shutter-plan.md section 3) is not modelled; this module
// renders what that path would deliver: a YCbCr 4:2:2 frame of a synthetic scene, as seen through a thin lens on a
// Four Thirds sensor at a given exposure. Nothing here is firmware evidence: the picture, the exposure model and the
// focus model are the harness's own, chosen to be plausible and cheap. Pure JS (no node imports): it runs in the
// browser Worker as well as in node.
//
// The scene is a stack of layers, back to front, each at one distance from the camera, with a procedural pattern, an
// opacity mask and a horizontal speed (m/s; lab time drives the motion, so a replay renders the same frames). The
// lens is a thin lens of focal length f at f-number N focused at distance s; a layer at distance z is blurred by its
// circle of confusion c = f^2 / (N (s - f)) * |z - s| / z on the sensor. The exposure is the exposure triangle:
// a mid-grey surface of a scene at EV100 e reaches mid-grey on the sensor when N^2 / t = 2^e * ISO / 100; the
// relative exposure is 2^e * t * (ISO / 100) / N^2. A moving layer is also smeared over the distance it travels in
// the exposure time. Noise grows with the square root of ISO; it is seeded by the frame number. In auto, once the
// camera has planned (camapp.mjs S-EXPOSE sets exposure.camera), the shutter time, f-number and ISO are the camera's:
// the firmware's own exposure plan for the scene's EV, and the scene's aperture, ISO and compensation are not used.

export const SENSOR_MM = [17.4, 13.0];                  // Four Thirds image area (17.4 x 13.0 mm)
export const MIN_FOCUS_M = 0.25;
export const LIVE_VIEW_SHUTTER = [1 / 8000, 1 / 30];    // the auto exposure's shutter range for the live view

export const PRESETS = {
  // a park: sky and hills far away, a tree line in the middle, a signpost close by
  static: [
    { name: 'background', depth_m: 200, speed: 0, pattern: 'sky' },
    { name: 'midground', depth_m: 8, speed: 0, pattern: 'trees' },
    { name: 'foreground', depth_m: 1.5, speed: 0, pattern: 'post' },
  ],
  // the same with a cyclist crossing in the middle distance and a ball passing close by
  moving: [
    { name: 'background', depth_m: 200, speed: 0, pattern: 'sky' },
    { name: 'midground', depth_m: 8, speed: 3, pattern: 'rider' },
    { name: 'foreground', depth_m: 1.5, speed: -0.6, pattern: 'ball' },
  ],
  // a test chart at one distance: the depth of field and the exposure without other layers
  chart: [
    { name: 'background', depth_m: 3, speed: 0, pattern: 'chart' },
  ],
};

export function defaultScene() {
  return {
    preset: 'static',
    layers: PRESETS.static.map((l) => ({ ...l })),
    ev: 12,                                   // scene brightness, EV100 (12: overcast daylight)
    lens: { focal_mm: 25, aperture: 2.8, focus_m: 8, max_aperture: 1.2, min_aperture: 22 },
    exposure: { mode: 'auto', shutter_s: 1 / 125, iso: 200, comp_ev: 0 },
    af_point: [0.5, 0.5],                     // where S1's focus stand-in measures, as a fraction of the frame
    af: 'idle',                               // 'idle', 'ok' (focused by the S1 stand-in), 'ng'
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`scene: ${what} ${JSON.stringify(v)}: a number from ${lo} to ${hi}`);
  return v;
};
// A copy of scene with the changes of `change` applied, every value checked (an input from the page).
export function applySceneChange(scene, change) {
  if (change === null || typeof change !== 'object' || Array.isArray(change)) throw new RangeError('scene: a change is an object');
  const s = structuredClone(scene);
  for (const [k, v] of Object.entries(change)) {
    if (k === 'preset') {
      if (!Object.hasOwn(PRESETS, v)) throw new RangeError(`scene: preset ${JSON.stringify(v)}: one of ${Object.keys(PRESETS).join(', ')}`);
      s.preset = v; s.layers = PRESETS[v].map((l) => ({ ...l }));
    } else if (k === 'ev') s.ev = num(v, -6, 20, 'ev');
    else if (k === 'focal_mm') s.lens.focal_mm = num(v, 7, 400, 'focal_mm');
    else if (k === 'aperture') s.lens.aperture = num(v, s.lens.max_aperture, s.lens.min_aperture, 'aperture');
    else if (k === 'focus_m') { s.lens.focus_m = num(v, MIN_FOCUS_M, 10000, 'focus_m'); s.af = 'idle'; }
    else if (k === 'mode') { if (v !== 'auto' && v !== 'manual') throw new RangeError(`scene: mode ${JSON.stringify(v)}: auto or manual`); s.exposure.mode = v; }
    else if (k === 'shutter_s') s.exposure.shutter_s = num(v, 1 / 32000, 60, 'shutter_s');
    else if (k === 'iso') s.exposure.iso = num(v, 64, 102400, 'iso');
    else if (k === 'comp_ev') s.exposure.comp_ev = num(v, -5, 5, 'comp_ev');
    else if (k === 'af_point') {
      if (!Array.isArray(v) || v.length !== 2) throw new RangeError('scene: af_point is [x, y]');
      s.af_point = [num(v[0], 0, 1, 'af_point x'), num(v[1], 0, 1, 'af_point y')];
    } else if (k === 'layer') {
      const { index, ...f } = v ?? {};
      if (!Number.isInteger(index) || index < 0 || index >= s.layers.length) throw new RangeError(`scene: layer index ${JSON.stringify(index)}`);
      for (const [lk, lv] of Object.entries(f)) {
        if (lk === 'depth_m') s.layers[index].depth_m = num(lv, MIN_FOCUS_M, 10000, 'depth_m');
        else if (lk === 'speed') s.layers[index].speed = num(lv, -50, 50, 'speed');
        else throw new RangeError(`scene: layer field ${JSON.stringify(lk)}`);
      }
    } else throw new RangeError(`scene: unknown field ${JSON.stringify(k)}`);
  }
  return s;
}

// The exposure in use: { shutter_s, aperture, iso, exposure (relative to mid-grey), clipped: 'under' | 'over' | null }.
// Auto: the shutter time that puts mid-grey at mid-grey (plus compensation) at the set aperture and ISO, held to the
// live view's range; manual: the set shutter time.
export function exposureOf(scene) {
  const { mode, comp_ev } = scene.exposure, cam = mode === 'auto' ? scene.exposure.camera ?? null : null;
  const N = cam ? cam.aperture : scene.lens.aperture, iso = cam ? cam.iso : scene.exposure.iso;
  const ideal = N * N / (2 ** scene.ev * iso / 100) * 2 ** comp_ev;
  const t = cam ? cam.shutter_s : mode === 'auto' ? clamp(ideal, ...LIVE_VIEW_SHUTTER) : scene.exposure.shutter_s;
  const exposure = 2 ** scene.ev * t * (iso / 100) / (N * N);
  const ev = Math.log2(exposure);
  return { shutter_s: t, aperture: N, iso, exposure, ev_offset: ev, clipped: ev < -2 ? 'under' : ev > 2 ? 'over' : null };
}

// The lens as it is used: the f-number of the exposure in use (the camera's in auto once it has planned).
export const lensInUse = (scene) => ({ ...scene.lens, aperture: exposureOf(scene).aperture });
// The circle of confusion of a layer at z (m), in mm on the sensor.
export function cocMm(lens, z) {
  const f = lens.focal_mm, s = Math.max(lens.focus_m * 1000, f + 1), zz = z * 1000;
  return f * f / (lens.aperture * (s - f)) * Math.abs(zz - s) / zz;
}

// ---- patterns: reflectance [r, g, b] in 0..1 and opacity, at world coordinates (m) on the layer's plane
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const hash = (x) => { let h = Math.imul(x | 0, 0x9E3779B1) ^ 0x85EBCA6B; h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const PATTERNS = {
  sky(X, Y) {
    const hill = 18 * Math.sin(X / 37) + 9 * Math.sin(X / 13 + 1.7) - 6;
    if (Y < hill) return [[0.18, 0.32 + 0.06 * Math.sin(X / 5), 0.12], 1];
    const k = clamp((Y - hill) / 120, 0, 1);
    return [[0.45 - 0.2 * k, 0.6 - 0.15 * k, 0.85], 1];
  },
  trees(X, Y) {
    const cell = Math.floor(X / 2.2), cx = (cell + 0.5) * 2.2 + (hash(cell) - 0.5);
    const h = 1.4 + 1.6 * hash(cell + 77), r = 0.7 + 0.5 * hash(cell + 13);
    const trunk = Math.abs(X - cx) < 0.15 && Y > -1.6 && Y < h - r;
    const dx = X - cx, dy = Y - (h - r * 0.4);
    const crown = dx * dx + dy * dy < r * r;
    if (!(trunk || crown) || Y < -1.6) return [[0, 0, 0], 0];
    if (trunk && !crown) return [[0.25, 0.17, 0.1], 1];
    const leaf = 0.5 + 0.5 * Math.sin(X * 9 + Y * 7) * Math.sin(X * 5 - Y * 11);
    return [[0.08 + 0.06 * leaf, 0.28 + 0.15 * leaf, 0.07], 1];
  },
  post(X, Y) {
    if (Math.abs(X - 0.35) < 0.04 && Y > -1 && Y < 0.25) return [[0.35, 0.3, 0.28], 1];
    if (Math.abs(X - 0.35) < 0.22 && Y >= 0.1 && Y < 0.3) {
      const stripe = Math.floor((X + 1) * 30) % 2;
      return [stripe ? [0.85, 0.85, 0.82] : [0.7, 0.12, 0.1], 1];
    }
    return [[0, 0, 0], 0];
  },
  rider(X, Y) {
    const wheel = (cx) => { const d = Math.hypot(X - cx, Y + 1.25); return d < 0.35 && d > 0.29; };
    if (wheel(-0.55) || wheel(0.55)) return [[0.08, 0.08, 0.08], 1];
    if (Math.abs(Y + 0.85) < 0.04 && Math.abs(X) < 0.55) return [[0.75, 0.15, 0.1], 1];
    if (Math.hypot(X - 0.05, Y - 0.15) < 0.14) return [[0.85, 0.7, 0.55], 1];
    if (Math.abs(X + 0.05) < 0.17 && Y > -0.85 && Y < 0.02) return [[0.15, 0.35, 0.75], 1];
    if (Y < -1.6) return [[0.32, 0.3, 0.28], 1];
    return [[0, 0, 0], 0];
  },
  ball(X, Y) {
    const d = Math.hypot(X, Y + 0.2);
    if (d > 0.11) return [[0, 0, 0], 0];
    const seam = Math.abs(Math.sin((X + Y) * 40)) < 0.2;
    return [seam ? [0.1, 0.1, 0.1] : [0.9, 0.8, 0.2], 1];
  },
  chart(X, Y) {
    const sq = (Math.floor(X * 10 + 100) + Math.floor(Y * 10 + 100)) % 2;
    const ramp = clamp((X + 0.6) / 1.2, 0, 1);
    if (Y < -0.25) return [[ramp, ramp, ramp], 1];
    if (Y > 0.3) return [[0.18, 0.18, 0.18], 1];
    return [sq ? [0.9, 0.9, 0.9] : [0.05, 0.05, 0.05], 1];
  },
};

// Separable box blur of radius r (pixels, fractional by blending) along x or y of a float plane, in place.
function boxBlur(src, w, h, r, axis, tmp) {
  if (r < 0.5) return;
  const ri = Math.floor(r), frac = r - ri, n = axis === 0 ? w : h, lines = axis === 0 ? h : w;
  const step = axis === 0 ? 1 : w, lstep = axis === 0 ? w : 1;
  const norm = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lstep;
    for (let i = 0; i < n; i++) tmp[i] = src[base + i * step];
    // running sum over [i - ri, i + ri] with the edge pixels repeated, plus frac of the two next ones
    const at = (i) => tmp[i < 0 ? 0 : i >= n ? n - 1 : i];
    let sum = 0;
    for (let k = -ri; k <= ri; k++) sum += at(k);
    for (let i = 0; i < n; i++) {
      src[base + i * step] = (sum + frac * (at(i - ri - 1) + at(i + ri + 1))) * norm;
      sum += at(i + ri + 1) - at(i - ri);
    }
  }
}

// Render the scene at lab time t_s (seconds) and frame number `frame` (the noise seed) as width x height linear RGB
// floats (premultiplied composite of the layers), then expose, add noise, apply the transfer curve and return
// [width, height, rows] with rows of YCbCr 4:2:2 bytes (Y0 Cb Y1 Cr), the live-view bank's format.
// scale: the frame is rendered at width/scale x height/scale and each pixel repeated (the live view's cost).
export function renderFrame(scene, width, height, t_s, frame, scale = 2) {
  const w = Math.ceil(width / scale), h = Math.ceil(height / scale), np = w * h;
  const R = new Float32Array(np), G = new Float32Array(np), B = new Float32Array(np);
  const lr = new Float32Array(np), lg = new Float32Array(np), lb = new Float32Array(np), la = new Float32Array(np);
  const tmp = new Float32Array(Math.max(w, h));
  const { focal_mm: f } = scene.lens, exp = exposureOf(scene);
  const mmPerPx = SENSOR_MM[0] / w;
  for (const layer of scene.layers) {
    const pat = PATTERNS[layer.pattern];
    const z = layer.depth_m, shift = layer.speed * t_s;
    // world metres per pixel at this layer's distance (pinhole projection)
    const mPerPx = mmPerPx * z / f;
    // wrap moving layers so they keep crossing the frame
    const span = w * mPerPx * 1.25;
    for (let y = 0; y < h; y++) {
      const Y = (h / 2 - y) * mPerPx;
      for (let x = 0; x < w; x++) {
        let X = (x - w / 2) * mPerPx - shift;
        if (layer.speed) X = ((X % span) + span * 1.5) % span - span / 2;
        const [c, a] = pat(X, Y), i = y * w + x;
        lr[i] = c[0] * a; lg[i] = c[1] * a; lb[i] = c[2] * a; la[i] = a;
      }
    }
    // defocus (box blur x3 ~ a Gaussian of the circle of confusion's radius) and motion smear over the exposure
    const blurPx = cocMm(lensInUse(scene), z) / mmPerPx / 2;
    const smearPx = Math.abs(layer.speed * exp.shutter_s) / mPerPx;
    for (const plane of [lr, lg, lb, la]) {
      for (let k = 0; k < 3; k++) { boxBlur(plane, w, h, blurPx / Math.sqrt(3), 0, tmp); boxBlur(plane, w, h, blurPx / Math.sqrt(3), 1, tmp); }
      boxBlur(plane, w, h, smearPx / 2, 0, tmp);
    }
    for (let i = 0; i < np; i++) { const k = 1 - la[i]; R[i] = R[i] * k + lr[i]; G[i] = G[i] * k + lg[i]; B[i] = B[i] * k + lb[i]; }
  }
  // exposure, noise, transfer curve (gamma 1/2.2), full-range BT.601
  let seed = (frame * 2654435761) >>> 0 || 1;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const sigma = 0.002 + 0.004 * Math.sqrt(exp.iso / 100);
  const gain = exp.exposure;
  const enc = (v) => 255 * Math.pow(clamp(v, 0, 1), 1 / 2.2);
  const Yp = new Uint8Array(np), Cb = new Float32Array(np), Cr = new Float32Array(np);
  for (let i = 0; i < np; i++) {
    const n = (rnd() + rnd() + rnd() - 1.5) * sigma;
    const r = enc(R[i] * gain + n), g = enc(G[i] * gain + n), b = enc(B[i] * gain + n);
    Yp[i] = clamp(Math.round(0.299 * r + 0.587 * g + 0.114 * b), 0, 255);
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(2 * width), sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 2) {
      const i0 = sy * w + Math.min(w - 1, Math.floor(x / scale)), i1 = sy * w + Math.min(w - 1, Math.floor((x + 1) / scale));
      row[2 * x] = Yp[i0];
      row[2 * x + 1] = clamp(Math.round((Cb[i0] + Cb[i1]) / 2), 0, 255);
      row[2 * x + 2] = Yp[i1];
      row[2 * x + 3] = clamp(Math.round((Cr[i0] + Cr[i1]) / 2), 0, 255);
    }
    rows.push(row);
  }
  return [width, height, rows];
}

// The S1 stand-in's focus at lab time t_s: the nearest opaque layer under the AF point (its distance), or null when
// nothing is there closer than infinity that the lens can focus on (nearer than the minimum focus distance). aspect:
// the rendered frame's height over its width.
export function focusAt(scene, t_s = 0, aspect = 2 / 3) {
  const [fx, fy] = scene.af_point;
  for (const layer of [...scene.layers].reverse()) {
    const width = SENSOR_MM[0] * layer.depth_m / scene.lens.focal_mm;      // the frame's width on this layer, m
    let X = (fx - 0.5) * width - layer.speed * t_s;
    const span = width * 1.25;
    if (layer.speed) X = ((X % span) + span * 1.5) % span - span / 2;
    const Y = (0.5 - fy) * width * aspect;
    if (PATTERNS[layer.pattern](X, Y)[1] > 0.5) return layer.depth_m >= MIN_FOCUS_M ? layer.depth_m : null;
  }
  return null;
}

// The subjects of the patterns, for S-SUBJECT (subject.mjs): the class a camera's subject detection would put the
// pattern in and its extent on the layer's plane [X0, Y0, X1, Y1] (m, the pattern's own coordinates). The rider's
// two-wheeler stands for a motorsport subject (the harness's choice: the scene is synthetic); its extent runs from the
// wheels' outer edges and their bottom to the top of the head, without the ground strip. The ball is no class's.
export const SUBJECTS = {
  rider: { subject: 'motorsports', extent: [-0.9, -1.6, 0.9, 0.29] },
};
// The subjects visible at lab time t_s: for each layer whose pattern is a subject, each copy of it (a moving layer
// wraps around, so two copies can be in the frame at once) that overlaps the frame, as { layer, subject, box } with
// box [u0, v0, u1, v1] in fractions of the frame (u to the right, v down), clipped to it, and area its clipped area.
// aspect: the rendered frame's height over its width. The projection is renderFrame's and focusAt's.
export function subjectsAt(scene, t_s = 0, aspect = 2 / 3) {
  const out = [];
  for (const layer of scene.layers) {
    const sub = SUBJECTS[layer.pattern];
    if (!sub) continue;
    const width = SENSOR_MM[0] * layer.depth_m / scene.lens.focal_mm, height = width * aspect;   // the frame on this layer, m
    const [X0, Y0, X1, Y1] = sub.extent, shift = layer.speed * t_s, span = width * 1.25;
    // the pattern at X shows at frame X + shift + k span for the k that wrap it into view (k = 0 for a still layer)
    const ks = layer.speed ? [-1, 0, 1].map((d) => Math.round(-shift / span) + d) : [0];
    for (const k of ks) {
      const off = shift + k * span;
      const u0 = 0.5 + (X0 + off) / width, u1 = 0.5 + (X1 + off) / width;
      const v0 = 0.5 - Y1 / height, v1 = 0.5 - Y0 / height;
      const box = [clamp(u0, 0, 1), clamp(v0, 0, 1), clamp(u1, 0, 1), clamp(v1, 0, 1)];
      const area = (box[2] - box[0]) * (box[3] - box[1]);
      if (area > 0) out.push({ layer: layer.name, subject: sub.subject, box, area });
    }
  }
  return out;
}

// What the page shows next to the frame: the exposure in use and the circle of confusion of each layer.
export function sceneReport(scene) {
  const e = exposureOf(scene);
  return {
    preset: scene.preset, ev: scene.ev, af: scene.af, af_point: scene.af_point,
    lens: { ...scene.lens },
    exposure: { mode: scene.exposure.mode, shutter_s: e.shutter_s, aperture: e.aperture, iso: e.iso, comp_ev: scene.exposure.comp_ev, ev_offset: +e.ev_offset.toFixed(2), clipped: e.clipped },
    layers: scene.layers.map((l) => ({ name: l.name, depth_m: l.depth_m, speed: l.speed, coc_mm: +cocMm(lensInUse(scene), l.depth_m).toFixed(4) })),
  };
}
