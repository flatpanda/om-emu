// The play module natively under control camapp 3 on the body of OM_EMU_MODEL (E143, E146, E147; the Player's
// camapp_play_native, src/lab/playmod.mjs; docs/hle-gaps.md 4.8.11, 4.8.13, 4.8.18):
//   playBodySession  the session of test_c3take.mjs stillSession up to one full shot, with the play opt-in: H-PLAYSTART
//                    starts the six PLAY tasks the body's rule reads (src/fw/facts.mjs playTasks), each waiting on its
//                    queue afterwards; the shot's picture is on the card; PLAY shows the single-frame view
//                    (ID_ST_DISP_SIMPLE): the play module loads the file and asks the image library for one view
//                    decode, which runs on the pipeline block's model (S-IMGPIPE) with no pre-reduction (S-PLAYDEC
//                    not used): the library's own scale ratios at its prefilter's call are the lab's, the run reads
//                    the file from SOI and writes the request's destination, whose bytes are the test's own
//                    computation from the independent decoder's samples (test_imgpipe.mjs expectedView, the prefilter
//                    taps of the library's row for 1620 to 900), and IMG1 shows that bank one pixel per pixel.
//                    On E146 and E147 PLAY gets as far as the decode's go: the request is recorded with E143's
//                    values through the body's own layout (playDecode), the library's ratios are the lab's, and the
//                    go is refused at its stream, whose address (the play buffer) no backed range of om1.bus holds
//                    there (docs/hle-gaps.md 4.8.18): the test pins that stop
//   node emu/test/test_playmod.mjs            (OM_EMU_MODEL=E146 / E147 for the other bodies)
import { fileURLToPath } from 'node:url';

const GUI_SHOOTING = '0x0108', GUI_DISP_SIMPLE = '0x0508', WAI = 4;
// the picture's size and the view's, the library's prefilter taps [centre, next, outer] for 1620 to 900 (test_camapp.mjs
// playDecodeSession, X on E143) and its ratios, .10 fixed, at its prefilter's call (E143 0x504782ac, the port's place)
const PICTURE = [1620, 1080], VIEW = [900, 600], TAPS = [68, 34, -4], RATIO = [1844, 1844], PREFILTER_CALL = 0x504782AC;
const STAND_INS = ['H-PLAYSTART', 'S-IMGPIPE', 'A-IMGPIPE-1', 'A-IMGPIPE-2', 'S-PLAYDEC', 'A-JPEGDHT-1'];
// the request's source format (the lab's 4:2:2 picture), the view's bank, format and pitch in pixels (X, all three)
const SOURCE_FORMAT = 7170, VIEW_BANK = 0x98D4D800, VIEW_FORMAT = 3074, VIEW_PITCH = 5568;
// E146's and E147's stop (X, 2026-11-22): the file's second read lands at the play buffer 0xbc857f00 (E143's
// 0xaefce700), above the lab's 384 MiB of bus DRAM (0xa0000000..0xb8000000) and outside the two live-view ranges, so
// S-SDCARD's write of it is skipped (a debugger write onto an unbacked part of the CPU window) and S-IMGPIPE refuses
// the go at its stream
const PLAY_BUFFER_E146 = 0xBC857F00;
const STREAM_STOP = /om1\.imgpipe UNKNOWN write 0x9c2000f4 size 4 value 0x00000005 .*\(the stream's address is not on the bus's memory\)/;

export async function playBodySession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { A, MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { PLAY_TASK_NAMES } = await import('../src/fw/facts.mjs');
  const { openVolume } = await import('../refs/volume.mjs');
  const { decodeJpeg } = await import('../refs/jpeg.mjs');
  const { expectedView } = await import('./test_imgpipe.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.camapp_components = true; pl.camapp_native_tra = true; pl.camapp_play_native = true;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, ca = s.camapp, pm = ca.play_native;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const key = (k, d) => { s.key(k, d); ca.pump(); };
    const tap = (k) => { key(k, 'down'); idle(100); key(k, 'up'); idle(900); return s.status().gui; };
    const used = pl.stand_ins_in_use();
    ok(pm && STAND_INS.every((x) => used.includes(x)) && !['S-PLAYSEQ', 'S-PLAYCOMP', 'S-PLAYVIEW'].some((x) => used.includes(x)),
      `${MODEL}: the stand-ins ${used.filter((x) => /PLAY|JPEGDHT|IMGPIPE/.test(x))}`);
    const waiting = pm.tids.map(([t]) => (lab.nk.state(t) & 0xF) === WAI);
    ok(JSON.stringify(pm.tids.map(([, n]) => n)) === JSON.stringify(PLAY_TASK_NAMES) && waiting.every(Boolean),
      `${MODEL}: H-PLAYSTART's tasks ${JSON.stringify(pm.tids)} waiting ${waiting}`);
    // one full shot (S-RELSEQ's picture, test_camapp.mjs playNativeSession)
    idle(2000);
    key('s1', 'down'); idle(600); key('s2', 'down'); idle(700);
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    const img = ca.images.at(-1), st = s.storage, vol = openVolume((lba, n) => st.card.read(lba, n));
    const file = img?.file ? vol.data(vol.find(img.file.path.slice(3).replaceAll('\\', '/'))) : null, pic = file ? decodeJpeg(file) : null;
    ok(s.status().gui === GUI_SHOOTING && ca.card_images() === 1 && pic?.width === PICTURE[0] && pic?.height === PICTURE[1],
      `${MODEL}: the shot: ${s.status().gui}, ${ca.card_images()} pictures on the card, decoded ${pic?.width} x ${pic?.height}`);
    // PLAY: the view decoded on the pipeline block's model
    const ratios = [];
    lab.observe(A(PREFILTER_CALL), (l, r) => ratios.push([r.d0 & 0xFFFF, r.d1 & 0xFFFF]), 'test: the library\'s scale ratios');
    let play = null, stop = null;
    try { play = tap('play'); } catch (e) { stop = e.message; }
    const dec = pm.decodes[0] ?? {}, run = pm.unit.last() ?? {}, bus = lab.sim.m.devices.bus;
    if (MODEL !== 'E143') {
      // E146, E147: the decode's go refused at its stream, the play buffer outside om1.bus's backed ranges
      ok(stop !== null && STREAM_STOP.test(stop) && /SS_PLAY_SINGLE\/ID_ST_DRAWING/.test(stop) && pm.decodes.length === 1 && !dec.stood_in && pm.unit.runs === 0
        && dec.from === pm.P.issue.from[1] && dec.width === PICTURE[0] && dec.height === PICTURE[1] && dec.area_width === PICTURE[0] && dec.area_height === PICTURE[1]
        && dec.format === SOURCE_FORMAT && dec.dst === VIEW_BANK && dec.dst_format === VIEW_FORMAT && dec.pitch === VIEW_PITCH && dec.dst_width === VIEW[0] && dec.dst_height === VIEW[1]
        && JSON.stringify(dec.ratio) === JSON.stringify(RATIO) && JSON.stringify(ratios) === JSON.stringify([RATIO]) && dec.src === PLAY_BUFFER_E146 && !bus.span(dec.src, 1),
        `${MODEL}: PLAY stops at the decode's go (${stop?.split('\n').filter((l) => /imgpipe|GUI state/.test(l)).map((l) => l.slice(0, 160)).join(' | ')}); the request ${JSON.stringify(dec)}; the library's ratios ${JSON.stringify(ratios)}; its source on om1.bus ${bus.span(dec.src ?? 0, 1)}`);
      return { checks, bad };
    }
    if (stop !== null) throw new Error(stop);
    ok(play === GUI_DISP_SIMPLE && pm.decodes.length === 1 && pm.waits === 1 && !dec.stood_in && pm.unit.runs === 1
      && dec.width === PICTURE[0] && dec.height === PICTURE[1] && dec.dst_width === VIEW[0] && dec.dst_height === VIEW[1]
      && JSON.stringify(dec.ratio) === JSON.stringify(RATIO) && JSON.stringify(ratios) === JSON.stringify([RATIO]),
      `${MODEL}: PLAY shows ${play}; the decode's requests ${JSON.stringify(pm.decodes)} (${pm.waits} waits), ${pm.unit.runs} runs; the library's ratios ${JSON.stringify(ratios)}`);
    ok(file && run.stream === dec.src && run.bytes === file.length && run.width === PICTURE[0] && run.height === PICTURE[1] && run.dst === dec.dst && run.pitch === 2 * dec.pitch
      && run.dst_width === VIEW[0] && run.dst_height === VIEW[1] && JSON.stringify(run.taps) === JSON.stringify([TAPS, TAPS]),
      `${MODEL}: the run decodes the file (${file?.length} bytes) to the request's destination: ${JSON.stringify(run)}`);
    // the bank's bytes against the test's own computation from the independent decoder's samples
    const row = 2 * VIEW[0], got = new Uint8Array(row * VIEW[1]);
    if (pic && run.dst) for (let y = 0; y < VIEW[1]; y++) bus.read(run.dst + y * run.pitch, got, y * row, row);
    const want = pic ? expectedView(pic, ...VIEW, TAPS).out : new Uint8Array(0);
    let wrong = 0;
    for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) wrong++;
    ok(pic && wrong === 0, `${MODEL}: the bank's ${got.length} bytes are the test's own computation (${wrong} differ)`);
    s.frame();
    const img1 = s.last_planes?.planes?.IMG1 ?? {};
    ok(img1.result === 'drawn' && img1.base === run.dst && img1.stride === run.pitch && img1.w === VIEW[0] && img1.h === VIEW[1],
      `${MODEL}: IMG1 shows the bank one pixel per pixel: ${JSON.stringify(img1)}`);
  } catch (e) { bad.push(`${MODEL}: ${e.message.slice(0, 800)}`); }
  finally { pl.close_session(); }
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const r = await playBodySession();
  console.log(`the play module natively under control camapp 3 (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
