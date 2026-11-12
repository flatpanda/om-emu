// The VSC's histogram unit in play (E143, control camapp 3; docs/hle-gaps.md 4.2.7, docs/om1-vsc-spec.md section 13;
// the device's own units are test_dev.mjs vscHistUnits):
//   histLiveSession  the live histogram with S-SCENE's live view, without and with --cpu2 native: the session runs on
//                  where it stopped at the first end with IMG1 on (HIST_UNMODELLED at 0x501e153d); the run the live
//                  view starts under has no source and its bins, which the firmware keeps, read 0 (A-VSCHIST-5); from
//                  then on the firmware's read (0x501e150e) returns the unit's bins, 128 a run, the full area and
//                  the spot area in turn; the unit's bins are the histogram of IMG1 as the TFT's composite shows it
//                  inside the area, scaled and clipped as HIST3 says (A-VSCHIST-4), counted here from the composite;
//                  they reach the GUI's drawHistogram request (the two series the GUI copies for OSD_DRAW_CPU2);
//                  without CPU 2 the box stays as the GUI cleared it (S-MODACK answers the send), with --cpu2 native
//                  OSD_DRAW_CPU2 draws every column from them (0x51015fe9..0x51016087: the spot series from the
//                  bottom, the full series above it); with a moving scene the bins change from run to run with no
//                  composite taken in between (the unit asks S-SCENE for the frame of its time)
//   histInfoSession  playback's histogram with the play module native (the Player's camapp_play_native), without and
//                  with --cpu2 native: INFO's detail view runs the unit four times on the picture's plane (IMG1, found
//                  by its DMA address), HIST2[25:24] 0, 1, 2, 3 for Y, R, G, B, 32 bins each; the bins are the
//                  histograms of a test pattern the test writes into the plane at the first start (S-PLAYDEC, the
//                  lab's stand-in for the decode, writes no pixel), counted here by the lab's PNG conversion
//                  (A-VSCHIST-6); they reach CapPlh's four buffers and the GUI draws them as four panels of bars in
//                  GUI layer 1, white, red, green and blue, each bar ceil(bin * 78 / 32) rows high; the detail view's
//                  frame is refused for the highlight unit's area alone (HIAREA1-3, FEATURE_UNOBSERVED): the next stop
//   histEvfSession  the EVF switch under the running histogram (docs/hle-gaps.md 4.2.7, 4.3.6, 4.3.10): the lab's
//                  DISPLAY cmd 2 OPEN of the EVF made with a run on (the open of the lab's own switch, camapp 1 and
//                  2's, and camapp 3's until its switch became the firmware's own): the run that is on ends on the
//                  TFT's channel, which still runs (the open has changed the opened word and not yet closed the
//                  channel), and the ISR does what its code says (0x501dec88..e4): the device not open, errlog
//                  0x37001418, the done callback posted with the channel's device bit, INTST1 bit 8 acknowledged.
//                  LV under camapp 3, the firmware's own output change (play.mjs native_switch), stops the histogram
//                  first: DISPLAY cmd 15 waits for the run that is on, which ends on the TFT still open (the same end
//                  branch with the device open, no errlog), and only then does TRA 588 open the EVF
//   node emu/test/test_hist.mjs [live|info|evf]
const h8 = (v) => '0x' + (v >>> 0).toString(16);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the TFT's channel and its registers (docs/om1-vsc-spec.md sections 1 and 13)
const TFT = 2;
const R = { INTEN1: 0x00C, INTST1: 0x010, DMAEN: 0x060, IMG1_SADR: 0x390, IMG1_LD: 0x3A8, OSD2_SADR: 0x3A0, VIDEOAREA1: 0x420,
  VIDEOAREA2: 0x424, HISTAREA1: 0x474, HISTAREA2: 0x478, HIST2: 0x748, HIST3: 0x74C, OSDCP2: 0x4E0 };
// the driver (D): the return of the bins' read in 0x501d70e6 (a3 the request's buffer, one u32 a bin; the call
// 0x501e150e at 0x501d7121), the request's bin count (u16 0x62a3eacc), the start path 0x501d6bec (a0 the mode: 1 the
// live view's, 2 playback's; d1 the kind), the ISR's end branch (a2 the channel's open device, 0 where it is closed),
// its post of the done callback 0x501d6a03 (d0 the device mask) and its return after the acknowledge (0x501e14fc
// writes INTST1 = 0x100)
const BIN_READ_RETURN = 0x501D7128, REQ_BINS = 0x62A3EACC, START_PATH = 0x501D6BEC, ISR_END = 0x501DEC88, DONE_POST = 0x501D6A03, ISR_ACKED = 0x501DECE4;
// the live view's two areas (X: HISTAREA1 of the full area, 800 x 600 at {148, 8}, and of the spot, 100 x 75 at
// {498, 271}) and the firmware's values for them: 128 bins, clip 64, HIST3[15:0] = 2 s with s = 1024 << 16 / (800 *
// 600) = 139 and (1024 >> 3) << 16 / (100 * 75) = 1118 (0x501d6d24..4b, 0x501d6d87..b1)
const LIVE = { full: 0x00940320, spot: 0x01F20064, hist2: 0x00100112, hist3: { full: 0x00400116, spot: 0x004008BC }, bins: 128 };
// the GUI's copy of its drawHistogram request for OSD_DRAW_CPU2 (docs/hle-gaps.md 4.6.2: 36 bytes, then the plane
// descriptor and the two series): x, y, width, height at +4, the series at +12 (the full area's) and +16 (the
// spot's), the scale at +20, the bin count at +24, the two bin limits at +26 / +28 and the colours at +31..+34
const DRAW_REQ = 0xA33EB558, DRAW_SERIES = [0xA33EB58C, 0xA33EB78C], OSD_STRIDE = 1664;
// playback (X: INFO's request, CapPlh::execute 0x50be03c2): 32 bins, clip 32, the detail view's picture 474 x 316 at
// {24, 62} of the window, HIST3[15:0] = 2 * (256 << 15 / (474 * 316)) = 112; CapPlh's buffers of kinds 1..4 (Y, R,
// G, B: 0x50be033a); the four panels of the detail view in GUI layer 1 (X): bars of 11 pixels every 10 from x 555,
// the panels' bottom rows, 78 rows a panel
const PLAY = { hist2: 0x00100110, hist3: 0x00200070, bins: 32, area: [24, 62, 474, 316], buffers: [0x62B1205C, 0x62B11E5C, 0x62B11C5C, 0x62B11A5C] };
const PANEL = { x: 555, pitch: 10, bottoms: [129, 215, 301, 387], rows: 78 };
const GUI_DISP_DETAIL = '0x050b';
// the opened word and the histogram's run word (vsc spec section 13), the ISR's error log
const OPENED = 0xA32DB39C, HIST_RUN = 0x62A3EAF8, HIST_ERRLOG = 0x37001418, OPEN_TFT = 1, OPEN_EVF = 2;
// the histogram's stop, DISPLAY cmd 15 (0x501d709f: waits up to 50 ms for the running run's end; hle-gaps 4.2.7)
const HIST_STOP = 0x501D709F;

async function setup() {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { ycc_to_rgb } = await import('../src/lab/display.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const player = (opts = {}, a15 = 'on') => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15, out: '<out>', no_wait_on_error: true, ...(opts.cpu2 ? { cpu2: 'native' } : {}) }, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    if (opts.play) pl.camapp_play_native = true;
    pl.open_session();
    return pl;
  };
  // the session's helpers: idle, a key, memory words, the TFT channel's banks, the bins' reads the firmware makes
  const tools = (pl) => {
    const s = pl.session, lab = s.lab, vsc = lab.sim.m.devices.vsc, ch = vsc.ch[TFT];
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const key = (k) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); return s.status().gui; };
    const words = (a, n) => { const b = lab.sim.read(a, 4 * n), dv = new DataView(b.buffer, b.byteOffset, b.length); return Array.from({ length: n }, (_, i) => dv.getUint32(4 * i, true)); };
    const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    const reads = [];
    lab.observe(BIN_READ_RETURN, (l, r) => {
      const n = u16(REQ_BINS);
      reads.push({ ns: l.lab_time(), n, buffer: r.a3 >>> 0, got: words(r.a3 >>> 0, n), unit: vsc.histBins(TFT), area: ch.m[R.HISTAREA1 / 4],
        area2: ch.m[R.HISTAREA2 / 4], hist2: ch.m[R.HIST2 / 4], hist3: ch.m[R.HIST3 / 4] });
    }, 'test: the bins read');
    const refused = () => lab.vsc.errors()[1].filter((e) => e.name === 'HIST_UNMODELLED').length;
    return { s, lab, vsc, ch, idle, key, words, u16, reads, refused };
  };
  return { player, tools, ycc_to_rgb };
}
// what the unit's arithmetic makes of pixel counts (A-VSCHIST-4): count * HIST3[15:0] >> 17, at most HIST3[31:16]
const scaled = (counts, hist3) => counts.map((c) => Math.min(hist3 >>> 16, Math.floor(c * (hist3 & 0xFFFF) / 131072)));

export async function histLiveSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, tools } = await setup();
  for (const cpu2 of [false, true]) {
    const tag = `live${cpu2 ? ' --cpu2 native' : ''}`;
    let pl = null;
    try {
      pl = player({ cpu2 });
      const { s, lab, vsc, ch, idle, words, reads, refused } = tools(pl);
      idle(1000);
      // before the live view: IMG1 off, every run without a source, its bins 0 and discarded (A-VSCHIST-2)
      const before = reads.length;
      ok(before >= 10 && reads.every((r) => r.unit?.source === false && r.got.every((x) => x === 0)) && vsc.histMeasured() === 0 && vsc.histKeptReads() === 0,
        `${tag}: before the live view ${before} runs without a source read 0 (measured ${vsc.histMeasured()}, kept ${vsc.histKeptReads()})`);
      // the live view starts while a run is on: that run's frame had IMG1 off, and the firmware keeps its bins
      for (let k = 0; lab.vsc.hist(TFT).state !== 2; k++) {
        if (k >= 100) throw new Error('no histogram run began in 200 ms');
        s.idle_slice(lab.lab_time() + 2e6);
      }
      pl.run_input({ type: 'scene', change: { preset: 'static', liveview: true } });
      idle(1500);
      const after = reads.slice(before), kept = after.filter((r) => r.unit?.source === false), counted = after.filter((r) => r.unit?.source === true);
      const used = pl.stand_ins_in_use();
      ok(after.length >= 20 && refused() === 0 && kept.length === 1 && kept[0] === after[0] && vsc.histKeptReads() === LIVE.bins / 2
        && ['A-VSCHIST-1', 'A-VSCHIST-2', 'A-VSCHIST-4', 'A-VSCHIST-5'].every((x) => used.includes(x)) && !used.includes('A-VSCHIST-6'),
        `${tag}: the session runs on with IMG1 on (${after.length} runs read, HIST_UNMODELLED ${refused()}); the run the live view started under has no source and is kept (${kept.length}, kept reads ${vsc.histKeptReads()}); ${used.filter((x) => /HIST/.test(x))}`);
      // every later read returns the unit's bins: 128 of the full area and of the spot in turn
      const areas = counted.map((r) => r.area), turn = areas.every((a, i) => a === (areas[0] === LIVE.full ? [LIVE.full, LIVE.spot] : [LIVE.spot, LIVE.full])[i % 2]);
      ok(counted.length === after.length - 1 && counted.every((r) => r.n === LIVE.bins && r.hist2 === LIVE.hist2 && same(r.got, r.unit.bins)) && turn
        && counted.every((r) => r.hist3 === (r.area === LIVE.full ? LIVE.hist3.full : LIVE.hist3.spot)),
        `${tag}: each of the ${counted.length} later reads returns the unit's ${LIVE.bins} bins, the full area and the spot in turn (${turn}; HIST2 ${[...new Set(counted.map((r) => h8(r.hist2)))]}, HIST3 ${[...new Set(counted.map((r) => h8(r.hist3)))]})`);
      // the bins are the histogram of IMG1 as the composite shows it inside the area: counted here from the TFT's
      // composite of IMG1 alone (the lab's view mask), Y in bin Y >> 1, scaled and clipped as HIST3 says
      const frame = s.frame()[2];
      lab.vsc.set_view(TFT, 1);
      const img = lab.compose('tft', false, false);
      lab.vsc.set_view(TFT, 0x3F);
      const ox = ch.m[R.VIDEOAREA1 / 4] >>> 16, oy = ch.m[R.VIDEOAREA2 / 4] >>> 16, W = img.header.width;
      const want = {}, last = {};
      for (const [name, a1] of [['full', LIVE.full], ['spot', LIVE.spot]]) {
        const r = last[name] = counted.findLast((x) => x.area === a1), a2 = r?.area2 ?? 0;
        const x0 = a1 >>> 16, w = a1 & 0xFFFF, y0 = a2 >>> 16, h = a2 & 0xFFFF, counts = new Array(LIVE.bins).fill(0);
        for (let y = y0 - oy; y < y0 - oy + h; y++) for (let x = x0 - ox; x < x0 - ox + w; x++) counts[(img.words[y * W + x] & 0xFF) >> 1]++;
        want[name] = scaled(counts, LIVE.hist3[name]);
      }
      const sum = (b) => b.reduce((x, y) => x + y, 0);
      ok(Array.isArray(frame) && img.status === 'NONE' && img.header.drawn === 1 && last.full?.area2 === (8 << 16 | 600) && last.spot?.area2 === (271 << 16 | 75)
        && same(last.full.unit.bins, want.full) && same(last.spot.unit.bins, want.spot) && want.full.filter((x) => x).length >= 8,
        `${tag}: the unit's bins are the composite's histogram of IMG1 inside the area: full ${last.full && same(last.full.unit.bins, want.full)} (${want.full.filter((x) => x).length} bins set, sum ${sum(want.full)}), spot ${last.spot && same(last.spot.unit.bins, want.spot)} (sum ${sum(want.spot)}); the frame composes (${Array.isArray(frame)}, IMG1 alone ${img.status})`);
      // they reach the GUI's drawHistogram request: the series it copies for OSD_DRAW_CPU2
      idle(300);
      const req = lab.sim.read(DRAW_REQ, 36), q16 = (o) => req[o] | req[o + 1] << 8, n = q16(24);
      const series = DRAW_SERIES.map((a) => words(a, LIVE.bins));
      ok(n === LIVE.bins && same(series[0], want.full) && same(series[1], want.spot),
        `${tag}: the GUI's drawHistogram request (${n} bins) carries them: the series at +12 the full area's (${same(series[0], want.full)}), at +16 the spot's (${same(series[1], want.spot)})`);
      // the box in GUI layer 1: untouched without CPU 2; with it every column drawn from the two series
      const box = { x: q16(4), y: q16(6), w: q16(8), h: q16(10), scale: (req[20] | req[21] << 8 | req[22] << 16 | req[23] << 24) >>> 0 };
      const base = (ch.m[R.OSD2_SADR / 4] << 4) >>> 0, px = lab.sim.read(base + OSD_STRIDE * box.y, OSD_STRIDE * box.h);
      const at = (x, row) => px[OSD_STRIDE * row + box.x + x];
      if (!cpu2) {
        const values = new Set();
        for (let row = 0; row < box.h; row++) for (let x = 0; x < box.w; x++) values.add(at(x, row));
        ok(box.w === 256 && box.h === 63 && values.size === 1, `${tag}: no CPU 2: the ${box.w} x ${box.h} box at {${box.x}, ${box.y}} holds one value (${[...values]}): S-MODACK answers the send, nothing is drawn`);
      } else {
        const o = s.cpu2.osd, limits = [q16(26), q16(28)], colours = { low: req[31], mid: req[32], high: req[33], spot: req[34] };
        let wrong = 0, drawn = 0;
        const above = new Set();
        for (let x = 0; x < box.w; x++) {
          const b = Math.floor(x * n / box.w), rs = Math.floor(series[1][b] * box.h / box.scale), rf = Math.floor(series[0][b] * box.h / box.scale);
          const c = b < limits[0] ? colours.low : b < limits[1] ? colours.mid : colours.high;
          for (let k = 0; k < box.h; k++) {                           // k rows up from the box's bottom row
            const v = at(x, box.h - 1 - k);
            if (k < rs) { drawn++; if (v !== colours.spot) wrong++; } else if (k < rf) { drawn++; if (v !== c) wrong++; } else above.add(v);
          }
        }
        ok(o.sent > 0 && o.taken.length === o.sent && box.scale === 64 && wrong === 0 && drawn > 1000 && above.size === 1 && !Object.values(colours).includes([...above][0]),
          `${tag}: OSD_DRAW_CPU2 took ${o.taken.length} of ${o.sent} sends and drew the box from the series: ${drawn} bar pixels, ${wrong} wrong, above the bars ${[...above]} (colours ${JSON.stringify(colours)}, limits ${limits}, scale ${box.scale})`);
      }
      // a moving scene: the bins follow it with no composite taken (the unit asks for the scene's frame of its time)
      pl.run_input({ type: 'scene', change: { preset: 'moving' } });
      const n0 = reads.length, f0 = s.scene.frame_no;
      idle(600);
      const moving = reads.slice(n0).filter((r) => r.area === LIVE.full && r.unit?.source), distinct = new Set(moving.map((r) => r.unit.bins.join()));
      ok(moving.length >= 4 && distinct.size >= 3 && s.scene.frame_no > f0 + 3 && refused() === 0,
        `${tag}: a moving scene: ${distinct.size} different full-area histograms in ${moving.length} runs with no composite taken (S-SCENE's frames ${f0} -> ${s.scene.frame_no})`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 700)}`); }
    try { pl?.close_session(); } catch { /* the session stopped */ }
  }
  return { checks, bad };
}

export async function histInfoSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, tools, ycc_to_rgb } = await setup();
  // the test's picture, in place of the decode S-PLAYDEC does not make: Y x / 2 in column x, Cb 96, Cr 176
  const pattern = (x) => [Math.min(255, x >> 1), 96, 176];
  for (const cpu2 of [false, true]) {
    const tag = `INFO${cpu2 ? ' --cpu2 native' : ''}`;
    let pl = null;
    try {
      pl = player({ cpu2, play: true });
      const { s, lab, vsc, ch, idle, key, words, reads, refused } = tools(pl);
      const bus = lab.sim.m.devices.bus;
      for (let i = 0; i < 2; i++) {
        s.key('s1', 'down'); s.camapp.pump(); idle(600); s.key('s2', 'down'); s.camapp.pump(); idle(700);
        s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(2000);
      }
      key('play');
      // at playback's first start: the pattern over IMG1's plane (its written address and line length)
      const starts = [];
      let plane = null;
      lab.observe(START_PATH, (l, r) => {
        const mode = r.a0 & 0xFFFF, kind = r.d1 & 0xFFFF;
        starts.push([mode, kind]);
        if (mode !== 2 || plane !== null) return;
        plane = { base: (ch.w[R.IMG1_SADR / 4] << 4) >>> 0, stride: (ch.w[R.IMG1_LD / 4] >>> 3) * 128 };
        const row = new Uint8Array(2 * 900);
        for (let x = 0; x < 900; x++) { const [y, cb, cr] = pattern(x); row[2 * x] = y; row[2 * x + 1] = x & 1 ? cr : cb; }
        for (let j = 0; j < 600; j++) bus.write(plane.base + j * plane.stride, row);
      }, 'test: the start path');
      const n0 = reads.length, m0 = vsc.histMeasured();
      const info = key('info');
      const runs = reads.slice(n0).filter((r) => (r.hist2 & ~0x03000000) === PLAY.hist2).slice(-4), used = pl.stand_ins_in_use();
      ok(info === GUI_DISP_DETAIL && refused() === 0 && same(starts.filter(([m]) => m === 2).map(([, k]) => k).slice(-4), [1, 2, 3, 4])
        && ['A-VSCHIST-4', 'A-VSCHIST-6'].every((x) => used.includes(x)),
        `${tag}: INFO reaches ${info} with no HIST_UNMODELLED (${refused()}); playback's starts of kinds ${starts.filter(([m]) => m === 2).map(([, k]) => k)}; ${used.filter((x) => /HIST/.test(x))}`);
      ok(runs.length === 4 && same(runs.map((r) => r.hist2 >>> 24), [0, 1, 2, 3]) && runs.every((r) => r.n === PLAY.bins && r.hist3 === PLAY.hist3 && r.unit?.source === true && same(r.got, r.unit.bins))
        && vsc.histMeasured() - m0 >= 4 && vsc.histColour() >= 3,
        `${tag}: four runs on IMG1, HIST2[25:24] ${runs.map((r) => r.hist2 >>> 24)}, ${PLAY.bins} bins each, HIST3 ${[...new Set(runs.map((r) => h8(r.hist3)))]}; each read returns the unit's bins (counted ${vsc.histMeasured() - m0}, colour runs ${vsc.histColour()})`);
      // the four histograms of the pattern over the picture's area, counted here with the lab's PNG conversion
      const [ax, , aw, ah] = PLAY.area, want = [0, 1, 2, 3].map(() => new Array(PLAY.bins).fill(0));
      for (let x = ax; x < ax + aw; x++) {
        const [y, cb, cr] = pattern(x), rgb = ycc_to_rgb((cr << 16 | cb << 8 | y) >>> 0);
        [y, ...rgb].forEach((v, c) => { want[c][v >> 3] += ah; });
      }
      const bins = want.map((c) => scaled(c, PLAY.hist3));
      ok(runs.length === 4 && runs.every((r, c) => same(r.unit.bins, bins[c])) && new Set(bins.map((b) => b.join())).size === 4,
        `${tag}: the bins are the pattern's Y, R, G and B histograms over the picture's ${aw} x ${ah}: ${runs.map((r, c) => same(r.unit.bins, bins[c]))} (Y ${bins[0].join(' ')}; B ${bins[3].join(' ')})`);
      // CapPlh's buffers hold them, kind by kind
      const held = PLAY.buffers.map((a) => words(a, PLAY.bins));
      ok(runs.length === 4 && held.every((b, c) => same(b, bins[c])) && same(runs.map((r) => r.buffer), PLAY.buffers),
        `${tag}: CapPlh's buffers ${PLAY.buffers.map(h8)} hold them (${held.map((b, c) => same(b, bins[c]))}; the reads' buffers ${runs.map((r) => h8(r.buffer))})`);
      // the GUI draws them: four panels of bars in GUI layer 1 (OSD plane 2's buffer), each bar ceil(bin * 78 / 32)
      // rows of the panel's colour from its bottom row
      idle(300);
      const base = (ch.m[R.OSD2_SADR / 4] << 4) >>> 0, px = lab.sim.read(base, OSD_STRIDE * 400), at = (x, y) => px[OSD_STRIDE * y + x];
      const cp2 = ch.m[R.OSDCP2 / 4], bank = (0x800 + (((cp2 >>> 4) & 1) ? 0x400 : 0)) / 4;
      const colours = [], heights = [];
      for (let p = 0; p < 4; p++) {
        const b0 = bins[p].findIndex((v) => v > 0), colour = at(PANEL.x + PANEL.pitch * b0 + 5, PANEL.bottoms[p]);
        colours.push(colour);
        heights.push(bins[p].map((_, b) => { let k = 0; while (k < PANEL.rows + 2 && at(PANEL.x + PANEL.pitch * b + 5, PANEL.bottoms[p] - k) === colour) k++; return k; }));
      }
      const tall = bins.map((b) => b.map((v) => Math.ceil(v * PANEL.rows / PLAY.bins)));
      const rgb = colours.map((c) => ycc_to_rgb(vsc.ch[TFT].pal[bank + c] & 0xFFFFFF));
      const hue = rgb.map(([r, g, b]) => (Math.min(r, g, b) > 200 ? 'white' : r > g && r > b ? 'red' : g > r && g > b ? 'green' : b > r && b > g ? 'blue' : '?'));
      ok(heights.every((h, p) => same(h, tall[p])) && same(hue, ['white', 'red', 'green', 'blue']),
        `${tag}: the GUI's four panels of bars follow the bins (${heights.map((h, p) => same(h, tall[p]))}; e.g. B's bars ${heights[3].join(' ')}), drawn ${hue.join(', ')} (palette indices ${colours.map(h8)}: ${JSON.stringify(rgb)})`);
      // the detail view's frame, the next stop (X), outside the unit: refused for the highlight unit's area HIAREA1-3
      // alone (written at PLAY by 0x501e1c14 / 0x501e1c47 / 0x501e1c51, in A13's never-written class):
      // FEATURE_UNOBSERVED at each of the three and at nothing else
      let frame = null;
      try { frame = Array.isArray(s.frame()[2]) ? 'composes' : 'no frame'; } catch (e) { frame = e.message; }
      const refusals = [...frame.matchAll(/"(\w+) pc 0x[0-9a-f]+ ch (\d) off 0x([0-9a-f]{4}) /g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
      ok(/^composite FEATURE_UNOBSERVED: /.test(frame) && same(refusals, ['048c', '0490', '0494'].map((o) => `FEATURE_UNOBSERVED ${TFT} ${o}`)),
        `${tag}: the detail view's frame is refused for HIAREA1-3 alone (${refusals.join(', ')}): ${frame.slice(0, 300)}`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 700)}`); }
    try { pl?.close_session(); } catch { /* the session stopped */ }
  }
  return { checks, bad };
}

export async function histEvfSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, tools } = await setup();
  // the ISR's end branch, the done callback's post and the ISR's return, as observed in a session
  const watchIsr = (lab, vsc, ch) => {
    const ends = [], posts = [], acked = [];
    lab.observe(ISR_END, (l, r) => ends.push({ ns: l.lab_time(), open: r.a2 >>> 0, opened: l.sim.u32(OPENED), running: vsc.ch[TFT].running,
      inten: ch.w[R.INTEN1 / 4], intst: ch.w[R.INTST1 / 4], dmaen: ch.w[R.DMAEN / 4], runs: vsc.ch[TFT].histRuns }), 'test: the ISR\'s end branch');
    lab.observe(DONE_POST, (l, r) => posts.push(r.d0 >>> 0), 'test: the done callback\'s post');
    lab.observe(ISR_ACKED, () => acked.push(ch.w[R.INTST1 / 4]), 'test: the ISR\'s return');
    return { ends, posts, acked };
  };
  // The lab's DISPLAY cmd 2 OPEN of the EVF with a run on. Since the display switch under camapp 3 is the firmware's
  // own output change (2026-11-11, 4.3.10) LV no longer makes that open (X: the run ends on the open TFT, below);
  // the open is the one the lab's own switch makes (display.mjs open, camapp 1 and 2's SWITCH, where no histogram
  // runs, 4.2.7), so the test makes it itself, under the run, as LV did before. Its step refuses the error log.
  let pl = null;
  try {
    pl = player({}, 'auto');
    const { lab, vsc, ch } = tools(pl);
    const run = lab.sim.u32(HIST_RUN), o0 = lab.sim.u32(OPENED), t0 = lab.lab_time();
    const { ends, posts, acked } = watchIsr(lab, vsc, ch);
    const runs0 = vsc.ch[TFT].histRuns;
    let err = null;
    try { lab.open('evf'); } catch (e) { err = e; }
    const e = ends[0], frame = vsc.nextBoundary(TFT) - ch.frameStart;
    ok(run === 1 && o0 === OPEN_TFT && ends.length === 1 && e.runs === runs0 + 1 && e.ns - t0 <= 2 * frame && e.running === true && (e.inten & e.intst & 0x100) !== 0 && e.dmaen !== 0,
      `the lab's OPEN of the EVF with a run on (run word ${run}, opened ${h8(o0)}): the run ends on the TFT's channel ${((e?.ns - t0) / 1e6).toFixed(1)} ms later (a frame is ${(frame / 1e6).toFixed(1)} ms), the channel still running (${e?.running}; INTEN1 ${h8(e?.inten ?? 0)}, INTST1 ${h8(e?.intst ?? 0)}, DMAEN ${h8(e?.dmaen ?? 0)})`);
    ok(ends.length === 1 && e.open === 0 && e.opened === OPEN_EVF && same(posts, [OPEN_TFT]) && acked.length === 1 && !(acked[0] & 0x100)
      && err && new RegExp(`firmware error log: ${h8(HIST_ERRLOG)} from \\S+ \\(disasm 0x501deccc\\)`).test(err.message),
      `the ISR's end branch as its code says: the channel's device not open (a2 ${h8(e?.open ?? 1)}, the opened word ${h8(e?.opened ?? 0)}), errlog ${h8(HIST_ERRLOG)}, the done callback posted with the channel's device bit (${posts.map(h8)}), INTST1 bit 8 acknowledged (INTST1 ${acked.map(h8)} at its return): ${err?.message.slice(0, 160)}`);
    // the open's close of the TFT's channel came after it (DMAEN 0, INTEN1 0), and no run was on then
    ok(ch.w[R.DMAEN / 4] === 0 && ch.w[R.INTEN1 / 4] === 0 && lab.vsc.hist(TFT).state === 0 && vsc.ch[TFT].histRuns === runs0 + 1,
      `the open then closed the channel (DMAEN ${h8(ch.w[R.DMAEN / 4])}, INTEN1 ${h8(ch.w[R.INTEN1 / 4])}) with the unit idle (${lab.vsc.hist(TFT).state}) and no further run (${vsc.ch[TFT].histRuns - runs0})`);
  } catch (e) { bad.push(`evf: ${e.message.slice(0, 700)}`); }
  try { pl?.close_session(); } catch { /* the session stopped */ }
  // LV with a run on, the firmware's own output change: the application's stop (TRA 937, DISPLAY cmd 15) waits for
  // the run, which ends on the TFT still open, and the EVF opens after it (TRA 588; test_c3power evfSwitchSession
  // pins the transactions' order)
  pl = null;
  try {
    pl = player({}, 'auto');
    const { lab, vsc, ch } = tools(pl);
    const run = lab.sim.u32(HIST_RUN), o0 = lab.sim.u32(OPENED), e0 = lab.kernel.errors.length, stops = [];
    const { ends, posts, acked } = watchIsr(lab, vsc, ch);
    lab.observe(HIST_STOP, (l) => stops.push(l.lab_time()), 'test: the histogram\'s stop');
    const runs0 = vsc.ch[TFT].histRuns;
    const rec = pl.run_input({ type: 'key', id: 'lv', action: 'down' }), e = ends[0];
    const logged = lab.kernel.errors.slice(e0).filter(([c]) => c === HIST_ERRLOG).length;
    ok(run === 1 && o0 === OPEN_TFT && rec.switch?.native === true && rec.switch.changed === true && stops.length === 1 && ends.length === 1
      && stops[0] <= e.ns && e.open === OPEN_TFT && e.opened === OPEN_TFT && same(posts, [OPEN_TFT]) && acked.length === 1 && !(acked[0] & 0x100) && logged === 0,
      `LV with a run on (run word ${run}, opened ${h8(o0)}) is the firmware's own change (${rec.switch?.native}, made ${rec.switch?.changed}): the stop (${stops.length}) waits for the run, which ends ${((e?.ns - stops[0]) / 1e6).toFixed(1)} ms after it on the TFT still open (a2 ${h8(e?.open ?? 0)}, the opened word ${h8(e?.opened ?? 0)}); the done callback posted with ${posts.map(h8)}, INTST1 ${acked.map(h8)} at the ISR's return, ${h8(HIST_ERRLOG)} logged ${logged} time(s)`);
    ok(lab.sim.u32(OPENED) === OPEN_EVF && lab.sim.u32(HIST_RUN) === 0 && lab.vsc.hist(TFT).state === 0 && vsc.ch[TFT].histRuns === runs0 + 1,
      `then the EVF opens (the opened word ${h8(lab.sim.u32(OPENED))}) with the histogram stopped (run word ${lab.sim.u32(HIST_RUN)}, the unit ${lab.vsc.hist(TFT).state}) and no further run (${vsc.ch[TFT].histRuns - runs0})`);
  } catch (e) { bad.push(`evf LV: ${e.message.slice(0, 700)}`); }
  try { pl?.close_session(); } catch { /* the session stopped */ }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ?? 'all';
  let failed = 0;
  for (const [name, fn, title] of [['live', histLiveSession, 'the live histogram'], ['info', histInfoSession, 'playback\'s histogram'], ['evf', histEvfSession, 'the EVF switch under a run']]) {
    if (which !== 'all' && which !== name) continue;
    const r = await fn();
    console.log(`the VSC's histogram unit, ${title}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    failed += r.bad.length;
  }
  process.exit(failed ? 1 : 0);
}
