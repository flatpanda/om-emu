#!/usr/bin/env node
// The browser player on other engines than Chrome's: the published site (bin/site.mjs) from a plain static server
// under /om-emu/ (bin/site.mjs serveSite, as bin/sitegate.mjs serves it), in headless Firefox (geckodriver) and in
// WebKit (WebKitGTK's MiniBrowser through WebKitWebDriver, on Xvfb when there is no display), driven over W3C
// WebDriver (host/webdriver.mjs: node's fetch, no npm packages). Per browser, in a fresh profile:
// - the landing page at the prefix and its player link; the firmware help naming the model's .BIN;
// - the .BIN chosen through the file input (WebDriver's send keys to the input) to the shooting screen (the GUI state
//   SS_COMMON/ID_ST_CA_REQ_DISP, 0x0108 on E143) with a frame drawn, and the canvas read back equal to the RGBA the
//   Worker sent for that frame (sha16);
// - the keys and the touch of webgate's B6 (test/test_web.mjs PAGE_B6_INPUTS): M, ArrowDown, M, a mouse press on the
//   monitor at (35, 465) of the 900 x 600 composite, Enter, each through WebDriver's input actions, each with a new
//   frame and the listed GUI state (and the touch's answer in the page's touch log);
// - a picture: S1 (F) back to the shooting screen and S2 (Space) onto the card, then the Card panel: the card's file
//   system read in the Worker, the picture's thumbnail and its view decoded and drawn on canvases;
// - LV (V) to the EVF and back: the screen's layout class and the 1600 x 1200 canvas, read back as above;
// - the lab's pace at --idle wall over 10 s of the wall clock (reported, not judged);
// - a second page that starts from the OPFS cache the first filled ("Start from the cached firmware");
// - one other body (--other, default E144) by ?model= with its own .BIN to its shooting screen;
// - every request a body-less GET (or HEAD) under the prefix, answered 200 (a 301 for the prefix without its slash),
//   and no error event from a page's Worker (web/page.mjs events).
// The drop of a .BIN is sitegate's (Chrome's Input.dispatchDragEvent; classic WebDriver has no file drop). Screenshots
// go to emu/out/web/<browser>/. On the lab model only (src/fw/model.mjs LAB_MODEL).
//   node emu/bin/browsergate.mjs [--browser firefox|webkit|all] [--bin FILE] [--other CODE|none] [--other-bin FILE]
//                                [--driver PATH] [--binary PATH] [--prefix /om-emu/] [--keep]
// --bin: E143's .BIN (default $OM_BIN, else $OM_FW_DIR/<its name>); --other-bin: the other body's (default
// $OM_FW_DIR/<its name>); missing: exit 2. --driver, --binary: the driver and browser executables (with one
// --browser; default: host/webdriver.mjs BROWSERS' search). --keep: keep the built tree, the profiles and the logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL, MODEL_INFO, LAB_MODEL, ON_LAB_MODEL } from '../src/fw/model.mjs';
import { MODELS } from '../src/fw/models.mjs';
import { buildSite, serveSite } from './site.mjs';
import { startBrowser, BROWSERS, KEYS } from '../host/webdriver.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const fwFile = (name) => (process.env.OM_FW_DIR ? path.resolve(process.env.OM_FW_DIR, name) : null);
const BIN = path.resolve(opt('--bin', process.env.OM_BIN || fwFile(MODEL_INFO.bin) || ''));
const OTHER = opt('--other', 'E144');
const OTHER_BIN = OTHER === 'none' ? null : path.resolve(opt('--other-bin', fwFile(MODELS[OTHER]?.bin ?? '') || ''));
const PREFIX = opt('--prefix', '/om-emu/');
const WHICH = opt('--browser', 'all');
const LIST = WHICH === 'all' ? Object.keys(BROWSERS) : [WHICH];
const TMP_ROOT = path.join(os.homedir(), '.cache/om-emu-tmp');
const SHOOT_NAME = 'SS_COMMON/ID_ST_CA_REQ_DISP';
// whether each browser keeps the firmware in OPFS (web/opfs.mjs); one that does not runs from the .BIN alone and says why
const CACHES = { firefox: true, webkit: false, 'webkit-storage': false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const log = (x) => console.log(x);

const usage = (m) => { console.error(`browsergate: ${m}`); process.exit(2); };
if (!ON_LAB_MODEL) usage(`the gate runs on ${LAB_MODEL} only (OM_EMU_MODEL is ${MODEL})`);
if (!/^\/[\w.-]+\/$/.test(PREFIX)) usage(`--prefix must look like /name/ (${PREFIX})`);
for (const b of LIST) if (!BROWSERS[b]) usage(`--browser: ${b} is not one of ${Object.keys(BROWSERS).join(', ')}, all`);
if (LIST.length > 1 && (argv.includes('--driver') || argv.includes('--binary'))) usage('--driver and --binary need one --browser');
if (!fs.existsSync(BIN) || !fs.statSync(BIN).isFile()) usage(`no firmware .BIN (${BIN || 'set --bin, OM_BIN or OM_FW_DIR'})`);
if (OTHER !== 'none') {
  if (!MODELS[OTHER] || OTHER === LAB_MODEL) usage(`--other: ${OTHER} is not another model of src/fw/models.mjs`);
  if (!fs.existsSync(OTHER_BIN) || !fs.statSync(OTHER_BIN).isFile()) usage(`no .BIN for ${OTHER} (${OTHER_BIN || 'set --other-bin or OM_FW_DIR'}; --other none skips it)`);
}
fs.mkdirSync(TMP_ROOT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(TMP_ROOT, 'browsergate-')), SITE = path.join(TMP, 'site');
const built = buildSite(SITE);
const { server, served, base: BASE } = await serveSite(SITE, PREFIX);
log(`site: ${built.files} files, ${(built.bytes / 2 ** 20).toFixed(2)} MiB (bin/site.mjs), served at ${BASE}`);

let session = null;
const cleanup = () => {
  session?.kill();
  server.close();
  if (argv.includes('--keep')) console.log(`kept ${TMP}`); else fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', cleanup);
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => { process.exit(code); });

const READY = `!!window.__playPage && !!window.__player && document.readyState === 'complete'`;
// the shooting screen with a frame drawn: {gui, gui_name, seq, lab_s, fwstatus}
const SHOOTING = `(() => { const p = window.__playPage, s = p && p.status, d = p && p.drawn; return s && d && s.phase === 'running' && s.gui_name === ${JSON.stringify(SHOOT_NAME)} && d.seq >= 1 ? { gui: s.gui, gui_name: s.gui_name, seq: d.seq, lab_s: s.lab_ns / 1e9, fwstatus: document.getElementById('fwstatus').textContent } : null; })()`;
const STATE = `(() => { const p = window.__playPage, s = p && p.status, d = p && p.drawn, pl = window.__player; return { phase: s && s.phase, gui: s && s.gui, gui_name: s && s.gui_name, error: s && s.error, seq: d && d.seq, lab_s: s && s.lab_ns / 1e9, fw: document.getElementById('fwstatus').textContent, ovl: document.getElementById('ovl').textContent, events: pl ? pl.events.filter((e) => e.type === 'error' || e.type === 'boot-failed').map((e) => e.message) : null, sent: pl ? pl.sent.slice(-3) : null, log: pl ? pl.log.slice(-3) : null }; })()`;
// the drawn canvas equals the RGBA the Worker sent for the frame it shows
const CANVAS = `(() => { const p = window.__playPage, f = window.__player.frame, d = p.drawn; if (!d || !f || d.seq !== f.seq) return null; const c = p.canvasSha16(); return { seq: d.seq, canvas: c, sent: f.rgba_sha16, w: f.w, h: f.h }; })()`;
const ERRORS = `window.__player ? window.__player.events.filter((e) => e.type === 'error').map((e) => e.message + (e.stack ? ' ' + e.stack.slice(0, 600) : '')) : []`;

async function runBrowser(name) {
  const out = path.join(EMU, 'out/web', name);
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, `${name}-`));
  const fail = (x) => { problems.push(`${name}: ${x}`); log(`FAIL ${name}: ${x}`); };
  const t0 = performance.now();
  try {
    session = await startBrowser(name, { driver: opt('--driver') ?? undefined, binary: opt('--binary') ?? undefined, dir });
  } catch (e) { fail(`did not start: ${e.message}`); return; }
  const S = session;
  log(`${name}: ${S.version} (${Math.round(performance.now() - t0)} ms to a session)`);
  await S.timeouts({ script: 120000, pageLoad: 60000, implicit: 0 });
  const shot = (n) => S.screenshot(path.join(out, `${n}.png`)).catch((e) => log(`  screenshot ${n}: ${e.message}`));
  const state = () => S.exec(`return ${STATE};`).catch((e) => ({ error: e.message }));
  const errorsOf = async (what) => { for (const e of await S.exec(`return ${ERRORS};`).catch(() => [])) fail(`${what}: the Worker's error: ${e}`); };
  // the shooting screen after the boot (ms: its limit), with the time and the lab seconds it took; a boot that failed,
  // or a Worker error, ends the wait at once
  const shooting = async (what, ms = 600000) => {
    const t = performance.now(), st = await S.until(`${SHOOTING} || (window.__player && (window.__player.bootFailed || window.__player.events.some((e) => e.type === 'error')) ? { failed: true } : null)`, ms);
    if (!st || st.failed) { fail(`${what}: no shooting screen: ${JSON.stringify(await state()).slice(0, 900)}`); return null; }
    log(`  ${what}: shooting screen ${st.gui} ${st.gui_name}, frame ${st.seq}, lab ${st.lab_s.toFixed(2)} s, ${((performance.now() - t) / 1000).toFixed(1)} s; ${st.fwstatus}`);
    return st;
  };

  try {
    // ---- the landing page, the player through its link, the firmware help
    await S.navigate(BASE.slice(0, -1));                 // the prefix without its slash: the server's 301 adds it
    const landing = await S.until(`document.readyState === 'complete' && location.href === ${JSON.stringify(BASE)} && document.getElementById('player') ? { title: document.title, href: document.getElementById('player').href } : null`, 30000);
    if (!landing) fail(`the landing page did not load at ${BASE}`);
    else if (landing.href !== BASE + 'web/index.html') fail(`the landing page's player link is ${landing.href}`);
    else log(`  landing: '${landing.title}', player link ${landing.href}`);
    await S.click(await S.find('#player'));
    if (!await S.until(`location.pathname === ${JSON.stringify(PREFIX + 'web/index.html')} && ${READY}`, 60000)) {
      fail(`the player did not load from the landing page's link: ${JSON.stringify(await state()).slice(0, 600)}`);
      return;
    }
    const help = await S.exec(`return { name: document.getElementById('fwname').textContent, open: document.getElementById('fwhelp').open };`);
    if (help.name !== MODEL_INFO.bin || !help.open) fail(`the firmware help: ${JSON.stringify(help)}`);
    await shot('player-help');

    // ---- the .BIN through the file input, to the shooting screen; the canvas against the frame the Worker sent
    await S.sendKeys(await S.find('#fwfile'), BIN);
    const first = await shooting('from the file input');
    if (!first) return;
    const cv = await S.until(CANVAS, 30000);
    if (!cv || cv.canvas !== cv.sent) fail(`the canvas read back is not the frame's RGBA: ${JSON.stringify(cv)}`);
    else log(`  canvas: frame ${cv.seq} ${cv.w} x ${cv.h} read back equal to the Worker's RGBA (${cv.sent})`);
    await shot('shooting');

    // ---- keys and the touch (PAGE_B6_INPUTS's), each with a new frame and its GUI state
    const canvas = await S.find('#cv');
    const steps = [
      ['key M', () => S.key('m'), '0x0b02', 'menu'],
      ['key ArrowDown', () => S.key(KEYS.ArrowDown), '0x0b02', 'menu-down'],
      ['key M', () => S.key('m'), '0x0108', null],
      ['touch (35, 465)', async () => { const r = await S.rect(canvas); await S.press(canvas, 35 / 900 * r.width, 465 / 600 * r.height); }, '0x0108', 'touch'],
      ['key Enter', () => S.key(KEYS.Enter), '0x0403', 'enter'],
    ];
    for (const [what, act, gui, png] of steps) {
      const before = await S.exec(`return { seq: window.__playPage.drawn.seq, row: window.__playPage.status.menu ? window.__playPage.status.menu.row : null, touch: document.getElementById('touchlog').textContent.length };`);
      await act();
      const want = `(() => { const p = window.__playPage, s = p.status; return s.phase === 'running' && s.gui === ${JSON.stringify(gui)} && p.drawn.seq > ${before.seq}`
        + (what === 'key ArrowDown' ? ` && s.menu && s.menu.row !== ${JSON.stringify(before.row)}` : '')
        + (what.startsWith('touch') ? ` && document.getElementById('touchlog').textContent.slice(${before.touch}).includes('answer')` : '')
        + ` ? { gui: s.gui, seq: p.drawn.seq, row: s.menu ? s.menu.row : null } : null; })()`;
      const got = await S.until(want, 30000);
      if (!got) fail(`${what}: not in ${gui} with a new frame: ${JSON.stringify(await state()).slice(0, 1500)}`);
      else log(`  ${what}: ${got.gui}, frame ${got.seq}${what === 'key ArrowDown' ? `, menu row ${before.row} -> ${got.row}` : ''}`);
      if (png) { await sleep(500); await shot(png); }
    }

    // ---- a picture: S1 (F) back to the shooting screen, S2 (Space) onto the card; the Card panel reads the card (the
    // Worker's reader, web/cardfiles.mjs), draws the picture's thumbnail and its view (refs/jpeg.mjs) on canvases
    await S.key('f');
    if (!await S.until(`window.__playPage.status.gui === '0x0108' && window.__playPage.status.phase === 'running'`, 30000)) fail(`key F (S1): not back to 0x0108: ${JSON.stringify(await state()).slice(0, 600)}`);
    await S.key(' ', 300);
    const shot1 = await S.until(`(() => { const s = window.__playPage.status; return s.phase === 'running' && s.gui === '0x0108' && s.camapp && s.camapp.card_images >= 1 ? { images: s.camapp.card_images, lab_ns: s.lab_ns } : null; })()`, 60000);
    if (!shot1) fail(`key Space (S2): no picture on the card: ${JSON.stringify(await state()).slice(0, 600)}`);
    else {
      await S.click(await S.find('#cardpanel > summary'));
      const thumb = `(() => { const t = document.querySelector('#card-files canvas.thumb'); return /FAT|exFAT/.test(document.getElementById('card-state').textContent) && t && t.width > 1 ? { state: document.getElementById('card-state').textContent, thumb: t.width + ' x ' + t.height } : null; })()`;
      const card = await S.until(thumb, 60000);
      if (!card) fail(`the Card panel: ${await S.exec(`return document.getElementById('card-state').textContent + ' | ' + document.getElementById('card-files').innerHTML.slice(0, 300);`)}`);
      else {
        await S.click(await S.find('#card-files [data-view]'));
        const view = await S.until(`/decoded by refs\\/jpeg\\.mjs/.test(document.getElementById('card-caption').textContent) ? document.getElementById('card-caption').textContent : null`, 60000);
        if (!view) fail(`the card picture's view: ${await S.exec(`return document.getElementById('card-caption').textContent;`)}`);
        else log(`  picture: ${shot1.images} on the card; Card panel '${card.state}', thumbnail ${card.thumb}; view '${view}'`);
        await shot('card');
      }
    }

    // ---- LV (V) to the EVF and back: the screen's layout class and the canvas follow the frames' device, the EVF's
    // 1600 x 1200 canvas read back equal to the Worker's RGBA. First 1.5 lab s past S2's picture: the lab's switch
    // stops the session when LV comes in the about 0.2 lab s after the rec view where E143's GUI has shown panel 0 and
    // not yet the shooting screen's panel 10 (docs/ROADMAP.md, Debug API follow-ups item 7), and the Card panel's
    // read can leave the lab there
    if (shot1 && !await S.until(`window.__playPage.status.lab_ns > ${shot1.lab_ns + 1.5e9}`, 60000)) fail(`the lab 1.5 s past S2: ${JSON.stringify(await state()).slice(0, 600)}`);
    for (const dev of ['evf', 'tft']) {
      await S.key('v');
      const got = await S.until(`(() => { const p = window.__playPage, d = p.drawn; return d && d.device === ${JSON.stringify(dev)} && document.getElementById('screen').classList.contains('evf') === ${dev === 'evf'} ? { w: d.w, h: d.h } : null; })()`, 30000);
      const c = got && await S.until(`(() => { const x = ${CANVAS}; return x && x.w === ${got.w} ? x : null; })()`, 30000);
      if (!got || !c || c.canvas !== c.sent) fail(`LV to the ${dev.toUpperCase()}: ${JSON.stringify({ got, c, state: await state() }).slice(0, 600)}`);
      else log(`  LV: the ${dev.toUpperCase()}, ${c.w} x ${c.h}, frame ${c.seq} read back equal to the Worker's RGBA (${c.sent})`);
      if (dev === 'evf') { await sleep(500); await shot('evf'); }
    }

    // ---- the pace at idle wall: lab seconds over 10 wall seconds
    const pace = await S.execAsync(`const done = arguments[arguments.length - 1], p = window.__playPage, l0 = p.status.lab_ns, t0 = performance.now();
      setTimeout(() => done({ lab: (p.status.lab_ns - l0) / 1e9, wall: (performance.now() - t0) / 1000 }), 10000);`);
    log(`  pace (idle wall): ${pace.lab.toFixed(2)} lab s in ${pace.wall.toFixed(2)} s, ${(pace.lab / pace.wall).toFixed(2)} x real time`);
    await errorsOf('the first page');

    // ---- a second page from the OPFS cache the first one filled, where the browser keeps one (CACHES); where it does
    // not, the first page said why and the second offers no cache and says so
    await S.navigate(BASE + 'web/index.html');
    if (CACHES[name]) {
      const cached = await S.until(`${READY} && !document.getElementById('fwcache').disabled ? document.getElementById('fwstatus').textContent : null`, 60000);
      if (!cached) fail(`the second page offers no cached firmware: ${JSON.stringify(await state()).slice(0, 600)}`);
      else {
        log(`  cache: ${cached}`);
        await S.click(await S.find('#fwcache'));
        const st = await shooting('from the cache', 300000);
        if (st && !st.fwstatus.includes('from the cache')) fail(`the cached start's status: ${st.fwstatus}`);
        await shot('cache');
      }
    } else {
      if (!/not cached \(.+\)/.test(first.fwstatus)) fail(`the first page does not say why the firmware was not cached: ${first.fwstatus}`);
      const none = await S.until(`${READY} && window.__player.events.some((e) => e.stage === 'cache') ? { cache: !document.getElementById('fwcache').disabled, fw: document.getElementById('fwstatus').textContent, opt: document.getElementById('optnote').textContent, nvram: !document.getElementById('opt-nvram').disabled } : null`, 60000);
      if (!none || none.cache) fail(`the second page: ${JSON.stringify(none ?? await state()).slice(0, 600)}`);
      else log(`  cache: none offered; the first page: '${first.fwstatus.replace(/^.*(not cached \(.+?\)).*$/, '$1')}'; the second: '${none.fw}' '${none.opt}'${none.nvram ? '' : ' (Keep the settings disabled)'}`);
      await shot('no-cache');
    }
    await errorsOf('the second page');

    // ---- another body by ?model= with its own .BIN
    if (OTHER !== 'none') {
      await S.navigate(BASE + `web/index.html?model=${OTHER}`);
      if (!await S.until(`${READY} && document.getElementById('fwname').textContent === ${JSON.stringify(MODELS[OTHER].bin)}`, 60000)) fail(`the ${OTHER} page did not get ready`);
      else {
        await S.sendKeys(await S.find('#fwfile'), OTHER_BIN);
        await shooting(`${OTHER} from the file input`);
        await shot(`model-${OTHER}`);
      }
      await errorsOf(`the ${OTHER} page`);
    }
  } catch (e) {
    fail(`${e.message}: ${JSON.stringify(await state()).slice(0, 600)}`);
  } finally {
    await S.close();
    session = null;
    log(`  ${name}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
}

for (const b of LIST) await runBrowser(b);

// ---- the network, as the server saw it: GETs (or HEADs) under the prefix, all answered
const unanswered = served.filter(([m, p, code]) => !(m === 'GET' || m === 'HEAD') || !(code === 200 || (code === 301 && p === PREFIX.slice(0, -1))));
for (const [m, p, code] of unanswered) { problems.push(`network: ${m} ${p} ${code}`); log(`FAIL the server answered ${m} ${p} with ${code}`); }
log(`network: the server answered ${served.length} requests, ${unanswered.length} not a GET answered 200 (or the prefix's 301)`);
log(problems.length ? `FAILED (${problems.length})` : 'all passed');
process.exit(problems.length ? 1 : 0);
