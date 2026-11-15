// What a picture is, said at the picture (src/lab/sources.mjs: the pages' line under the screen and Card panel note,
// a scripted session's shot record):
//   sourcesUnits    (firmware-free) the sentences: a frame is the lab's composite for the device shown, its image
//                   plane S-SCENE's (the drawn scene, or black) once S-SCENE's live view has been on and no live-view
//                   image before, never a sensor image; a picture taken in the session by the stand-ins in use (the
//                   firmware's header and the lab's JPEG under S-JPEGENC for both forms of the recorder, S-RECFILE's
//                   whole file without it,
//                   nothing on a body that writes none); every stand-in a sentence names has a row in the Stand-ins
//                   tab; both pages carry the table verbatim, pick from it as the module's functions do (the page's
//                   own function run on a made-up status for every device, scene and recorder), and no longer say a
//                   picture's file is S-RECFILE's on every body
//   sourcesSession  (the process's model; E147 in bin/test.mjs's child) through host/session.mjs: a shot's record
//                   carries the sentence for its device without S-SCENE; after a scene input turns the live view on
//                   (the module API's input) the next shot's says S-SCENE's drawn scene and the frame has changed;
//                   control: the two sentences differ; with the live view turned off again the sentence stays (the
//                   session still reports S-SCENE) and the picture is no longer the live view's (the sentence's black)
//   node emu/test/test_sources.mjs [--units] [--session]       (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, frameSource, pictureSource } from '../src/lab/sources.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

export async function sourcesUnits() {
  const t = tester(), { ok } = t;
  const { recStandIns } = await import('../src/lab/rec.mjs');
  const { standInRows } = await import('../src/lab/playapi.mjs');
  // the frame's sentences
  for (const [dev, name] of [['tft', 'TFT'], ['evf', 'EVF']]) {
    const off = frameSource(dev, false), on = frameSource(dev, true);
    ok(off === `the lab's ${name} frame: the VSC model's composite of the planes the firmware programmed, not a capture of a panel; S-SCENE's live view has not been on in this session: it holds no live-view image`, `${dev} without S-SCENE: ${off}`);
    ok(on.startsWith(`the lab's ${name} frame: `) && on.includes('S-SCENE\'s live view has been on in this session') && on.endsWith('is S-SCENE\'s, its drawn scene or black (its live view off or stopped, a picture taken without it), not a sensor image and not the camera\'s development') && on !== off, `${dev} with S-SCENE: ${on}`);
  }
  ok(thrown(() => frameSource('hdmi', false)) instanceof RangeError && thrown(() => frameSource(undefined, true)) instanceof RangeError, 'a device that is neither display is refused');
  // a taken picture's, by the stand-ins in use: both forms of the recorder, no recorder, no card
  const rec = (image) => recStandIns({ image, precon_by_rec: () => image, imgpro_by_rec: () => image });
  const header = pictureSource(['S-CARD', ...rec(true)]), header2 = pictureSource(rec(false)), file = pictureSource(['S-CARD', 'S-RECFILE']);
  ok(header === header2 && header === 'A picture taken in this session is the firmware\'s own file header (its Exif filled from S-EXIFPRM\'s inputs) followed by the lab\'s JPEG (S-JPEGENC): S-SCENE\'s frame at the capture with each 8 x 8 block its mean (black without the live view), not the camera\'s development. A file put on the card from elsewhere is what it was.',
    `a picture where the recorder runs: ${header} | ${header2}`);
  ok(file === 'A picture taken in this session is S-RECFILE\'s file, a JPEG the lab encodes, with no EXIF: S-SCENE\'s frame at the capture with each 8 x 8 block its mean (black without the live view), not the camera\'s development. A file put on the card from elsewhere is what it was.', `a picture where it does not: ${file}`);
  ok(pictureSource(['S-CARD']) === '' && pictureSource(undefined) === '' && rec(true).includes('S-EXIFPRM') && rec(false).includes('S-EXIFPRM') && !rec(true).includes('S-RECFILE'), 'no sentence where the lab writes no picture; the recorder\'s lists name S-EXIFPRM and not S-RECFILE');
  // every stand-in a sentence names has a row
  const texts = [...Object.values(SOURCES.frame).flatMap((x) => Object.values(x)), ...Object.values(SOURCES.picture)];
  const named = new Set(texts.flatMap((x) => x.match(/\b[SH]-[A-Z0-9]+\b/g) ?? [])), rows = standInRows();
  ok(named.size >= 4 && [...named].every((l) => typeof rows[l] === 'string'), `the stand-ins the sentences name have rows: ${[...named].filter((l) => !(l in rows)).join(' ') || [...named].join(' ')}`);
  // the pages: the table verbatim, their own pick the module's, the old sentence gone
  for (const page of ['play.html', 'index.html']) {
    const html = fs.readFileSync(path.join(EMU, 'web', page), 'utf8');
    ok(html.includes(`const SOURCES = ${JSON.stringify(SOURCES)};`), `${page} carries SOURCES verbatim`);
    ok(html.includes('<div id="s-source" class="note"></div>') && html.includes('<span id="card-source"></span>') && html.includes('  showSources(s);') && !html.includes('a picture\'s file is S-RECFILE\'s'),
      `${page}: the line under the status bar, the Card panel's note, the call from showStatus, and not the sentence that named S-RECFILE for every body`);
    const i = html.indexOf('function showSources(s) {'), j = html.indexOf('\n}\n', i);
    const pick = i < 0 ? null : new Function('$', 'SOURCES', `${html.slice(i, j + 2)}; return showSources;`);
    let same = pick !== null, n = 0;
    for (const device of ['tft', 'evf', undefined]) for (const scene of [false, true]) for (const list of [rec(true), rec(false), ['S-RECFILE'], []]) {
      const els = { 's-source': { textContent: null }, 'card-source': { textContent: null } };
      const stand_ins = [...list, ...(scene ? ['S-SCENE', 'H-REQ'] : [])];
      if (pick !== null) pick((id) => els[id], SOURCES)({ device, stand_ins });
      same &&= els['s-source'].textContent === (device ? 'What this picture is: ' + frameSource(device, scene) : '') && els['card-source'].textContent === pictureSource(stand_ins);
      n += 1;
    }
    ok(same && n === 24, `${page}'s showSources picks what frameSource and pictureSource pick (${n} cases)`);
  }
  return t;
}

export async function sourcesSession() {
  const t = tester(), { ok } = t;
  const { openSession } = await import('../host/session.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const out = path.join(process.env.HOME, '.cache/om-emu-tmp/test-sources-' + process.pid);
  let s = null;
  try {
    s = await openSession({ out });
    const w = s.step('wait:1500'), a = s.step('shot:before.png');
    ok(s.first.ok && w.ok && a.ok && a.device === 'tft' && a.source === frameSource('tft', false) && fs.existsSync(a.file), `${MODEL} a shot without S-SCENE: ${JSON.stringify({ ok: a.ok, device: a.device, source: a.source, error: a.error })}`);
    const r = s.input({ type: 'scene', change: { liveview: true } });
    const w2 = s.step('wait:500'), b = s.step('shot:after.png');
    ok(!r.error && w2.ok && b.ok && b.source === frameSource('tft', true) && s.summary().stand_ins.includes('S-SCENE'), `${MODEL} a shot after a scene input: ${JSON.stringify({ ok: b.ok, source: b.source, error: b.error ?? r.error })}`);
    ok(a.source !== b.source && /no live-view image$/.test(a.source) && /not a sensor image/.test(b.source) && w.frame !== w2.frame && !fs.readFileSync(a.file).equals(fs.readFileSync(b.file)),
      `${MODEL} control: the two shots' sentences and pictures differ (frames ${w.frame} ${w2.frame})`);
    // the live view turned off again: the session still reports S-SCENE and the sentence stays, and the plane is no
    // longer the drawn scene (the sentence's 'or black'): the picture differs from the live view's
    const r3 = s.input({ type: 'scene', change: { liveview: false } });
    const w3 = s.step('wait:500'), c = s.step('shot:off.png');
    ok(!r3.error && w3.ok && c.ok && c.source === b.source && / or black \(its live view off or stopped/.test(c.source) && !fs.readFileSync(c.file).equals(fs.readFileSync(b.file)),
      `${MODEL} the live view off again: the sentence stays and the picture is not the live view's: ${JSON.stringify({ ok: c.ok, same: c.source === b.source, error: c.error ?? r3.error })}`);
  } finally {
    try { s?.close(); } finally { fs.rmSync(out, { recursive: true, force: true }); }
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  const say = (name, r) => { console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); fail += r.bad.length; };
  if (all || process.argv.includes('--units')) say('what a picture is, units', await sourcesUnits());
  if (process.argv.includes('--session')) say(`what a picture is, a session's shots (${process.env.OM_EMU_MODEL ?? 'E143'})`, await sourcesSession());
  process.exit(fail ? 1 : 0);
}
