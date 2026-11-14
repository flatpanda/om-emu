// A local regression run of every published caduceus-om3 release (androidfanman/caduceus-om3: film-look patches for
// the OM-3, E147; analysis/caduceus-om3/README.md 4.2 and 7.1): an om-emu change that breaks a camera-tested
// downstream build is seen here before it is published. Gated on OM_CADUCEUS, a caduceus-om3 checkout (its releases/
// folder is read, nothing else; nothing is fetched): without it the run prints one SKIPPED line and passes. It drives
// the supported surface only: the patch reader (src/fw/patch.mjs), the scripted session (host/session.mjs
// openSession) and bin/card.mjs.
//   caduceusUnits   (firmware-free) the pin checks on made-up folders: a file whose digest differs from its pin, a
//                   pinned file missing, a release folder with no pin (reported, not failed), an observation that
//                   differs from its pin in one field
//   caduceusSession (E147: bin/test.mjs runs it in a child with OM_EMU_MODEL=E147) per release folder of
//                   $OM_CADUCEUS/releases: its files against the pins (test/fixtures/caduceus-releases.json: each
//                   file's sha256, no bytes), the reader's main_sha256 before and after and its counts, then its flow
//                   in a process of its own (OM_CADUCEUS_JOBS at once, default 3), whose observations must equal the
//                   pinned ones (the flow below). Controls: v0.29's block with section 6's end word put back to stock
//                   (made here from the release and the stock block, --main) stops at the open naming section 6; a pin
//                   with one digest character changed fails.
// The flow (flowRun): a card bin/card.mjs made, with the pinned card files put; the session under the loaded-ranges
// mode (the patch audit pinned); 4.5 s of lab time, the copied mask and their state word (0 before the half press);
// S1 (the state word set: their card load ran); OK OK to the Picture Mode page; with films: the string getter's names
// of FILM 1, 2 and 20 (the ids their title and list ask for), right x5 to FILM 2, OK; S2 and the picture's Exif (their
// photo code where the release writes one); the page again and its title through the string getter (the selected
// film's name); the card's OM3MOD listing; power:off, restart (on a blank card where the films live in the camera),
// S1, S2's Exif and the title again (the selection kept); for the no-card fix (v0.29.1; v0.29 and v0.29-beta as its
// contrast) power:off, restart, the card taken out, the SD medium word set to NO_MOUNT (a poke: the lab leaves S-CARD's
// OK there after a removal), S1 and the title. No frame hash is pinned.
//   OM_CADUCEUS=DIR node emu/test/test_caduceus.mjs [--units] [--session]   (OM_EMU_MODEL=E147 for --session)
//   OM_CADUCEUS=DIR OM_EMU_MODEL=E147 node emu/test/test_caduceus.mjs --pin VERSION [--flow JSON]
//     prints the release's row for the pins file: its digests, the reader's result, the flow (defaults from the
//     folder: every .BIN of it on the card under OM3MOD, films when it has LOOKS.BIN) and what the run observed; read
//     it against the release's NOTES before adding it
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
export const PINS = path.join(EMU, 'test/fixtures/caduceus-releases.json');
const SELF = new URL(import.meta.url).pathname;
const tester = () => {
  const bad = [], notes = [];
  let checks = 0;
  return { bad, notes, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the pins (firmware-free) -----------------------------------------------------------------------------------
// A release's files against its pin: [finding...], each naming the file. files: {release-relative path: sha256};
// read(rel) the file's bytes or null when it is not there.
export function fileFindings(version, files, read) {
  const out = [];
  for (const [rel, want] of Object.entries(files)) {
    const b = read(rel);
    if (b === null) out.push(`${version}: ${rel} is pinned but missing`);
    else if (sha(b) !== want) out.push(`${version}: ${rel} sha256 ${sha(b).slice(0, 16)}... is not its pin ${want.slice(0, 16)}...: upstream changed a published release`);
  }
  return out;
}
// The release folders against the pins: {pinned: [...], unpinned: [...], absent: [...]}
export function folderPlan(folders, pins) {
  // release order: numbers as numbers, a suffix (-alpha, -beta) before the release it tests, v0.29.1 after v0.29
  const v = (s) => s.replace(/^v/, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const rank = (p) => (p === undefined ? 1 : typeof p === 'string' ? 0 : 2);
  const order = (a, b) => {
    const x = v(a), y = v(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (rank(x[i]) !== rank(y[i])) return rank(x[i]) - rank(y[i]);
      return x[i] < y[i] ? -1 : 1;
    }
    return 0;
  };
  const rel = folders.filter((f) => /^v\d/.test(f)).sort(order);
  return { pinned: rel.filter((f) => Object.hasOwn(pins, f)), unpinned: rel.filter((f) => !Object.hasOwn(pins, f)), absent: Object.keys(pins).filter((f) => !rel.includes(f)).sort(order) };
}
// An observation against its pin: [finding...], one per top-level field that differs
export function observationFindings(version, want, got) {
  const out = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (!same(want[k], got[k])) out.push(`${version}: ${k} ${JSON.stringify(got[k])}, pinned ${JSON.stringify(want[k])}`);
  }
  return out;
}

export function caduceusUnits() {
  const t = tester(), { ok } = t;
  const files = { 'v1/patch.json': sha(new TextEncoder().encode('one')), 'v1/LOOKS.BIN': sha(new TextEncoder().encode('two')) };
  const have = { 'v1/patch.json': new TextEncoder().encode('one'), 'v1/LOOKS.BIN': new TextEncoder().encode('two') };
  const read = (r) => have[r] ?? null;
  ok(fileFindings('v1', files, read).length === 0, 'fileFindings: the pinned files as pinned');
  // one digest character changed: the release fails, naming the file
  const bent = { ...files, 'v1/LOOKS.BIN': (files['v1/LOOKS.BIN'][0] === '0' ? '1' : '0') + files['v1/LOOKS.BIN'].slice(1) };
  const f1 = fileFindings('v1', bent, read);
  ok(f1.length === 1 && f1[0].includes('v1/LOOKS.BIN') && f1[0].includes('upstream changed a published release'), `fileFindings: a pin with one digit changed: ${JSON.stringify(f1)}`);
  const f2 = fileFindings('v1', { ...files, 'v1/TONES.BIN': files['v1/LOOKS.BIN'] }, read);
  ok(f2.length === 1 && f2[0].includes('v1/TONES.BIN is pinned but missing'), `fileFindings: a pinned file missing: ${JSON.stringify(f2)}`);
  const p = folderPlan(['v0.9', 'README.md', 'v0.29.1', 'v0.29', 'v0.29-beta', 'v0.10'], { 'v0.9': {}, 'v0.29': {}, 'v0.29-beta': {}, 'v0.8': {} });
  ok(same(p, { pinned: ['v0.9', 'v0.29-beta', 'v0.29'], unpinned: ['v0.10', 'v0.29.1'], absent: ['v0.8'] }), `folderPlan: ${JSON.stringify(p)}`);
  const want = { state: { before_s1: '0000', after_s1: 'set' }, title: 'Gold 200' };
  ok(observationFindings('v1', want, structuredClone(want)).length === 0, 'observationFindings: the pinned observation');
  const o1 = observationFindings('v1', want, { ...want, title: 'Portra 400' });
  ok(o1.length === 1 && o1[0] === 'v1: title "Portra 400", pinned "Gold 200"', `observationFindings: one field changed: ${JSON.stringify(o1)}`);
  const o2 = observationFindings('v1', want, { state: want.state });
  ok(o2.length === 1 && o2[0].startsWith('v1: title undefined'), `observationFindings: a field missing: ${JSON.stringify(o2)}`);
  return t;
}

// ---- one release's flow (in a process whose model is E147) ------------------------------------------------------
// The defaults of a release folder's flow (--pin): every .BIN of the folder on the card under OM3MOD; films when it
// has LOOKS.BIN; the second session on the same card
function defaultFlow(dir, version) {
  const bins = fs.readdirSync(path.join(dir, version)).filter((f) => /\.BIN$/.test(f)).sort();
  return { card: Object.fromEntries(bins.map((f) => [`OM3MOD/${f}`, `${version}/${f}`])), films: bins.includes('LOOKS.BIN'), restart_card: 'same', nocard: false };
}

// What the reader makes of the release's patch.json (src/fw/patch.mjs with the stock E147 block)
async function readerResult(file) {
  const { readPatchText, applyPatches, patchLayout } = await import('../src/fw/patch.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const { ORIGINAL, readBytes, checkImage } = await import('../checks/lib/env.mjs');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const patches = readPatchText(fs.readFileSync(file, 'utf8'), path.basename(file));
  const r = applyPatches({ main: checkImage(readBytes(ORIGINAL)) }, patches, { layout: patchLayout(MODEL_INFO), createHash });
  const b = r.summary.blocks.find((x) => x.block === 'main');
  return { result: { format: doc.format, runs: r.summary.applied, bytes: r.summary.bytes, main_sha256_before: b.stock_sha256, main_sha256_after: b.sha256,
    not_applied: (r.summary.not_applied ?? []).map((x) => x.field) }, main: r.blocks.main };
}

// The flow's run: {observed, seconds, error?}
async function flowRun(dir, version, flow, tmp) {
  const { openSession } = await import('../host/session.mjs');
  const { A, fact } = await import('../src/fw/model.mjs');
  const GET_STRING = A(0x510BB079), TITLE = 203, FILM_NAME = 0x7f10;   // E143's GET_STRING ported; their ids (D, their source)
  const MEDIA_SD = fact('media_status');                                  // the SD card's HLS media status word (S-CARD's)
  const t0 = Date.now(), out = path.join(tmp, version), blank = path.join(tmp, 'blank.omsd');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(blank, path.join(out, 'card.omsd'));
  fs.copyFileSync(blank, path.join(out, 'blank.omsd'));
  const o = {};
  const s = await openSession({ model: 'E147', patch: [path.join(dir, version, 'patch.json')], card: path.join(out, 'card.omsd'),
    cardPut: Object.entries(flow.card).map(([dos, rel]) => `${dos}=${path.join(dir, rel)}`), nvram: path.join(out, 'nv.json'), out });
  let failed = null;
  const step = (tok) => {
    if (failed) throw failed;
    const r = s.step(tok);
    if (!r.ok) { failed = new Error(`step ${r.step} (${tok}): ${r.error}`); throw failed; }
    return r;
  };
  const run = (...toks) => toks.flat().map(step);
  const hex = (tok) => step(tok).hex;
  // a string by the firmware's string getter (theirs where they hook it): UTF-16 up to its NUL
  const string = (id) => {
    const r = step(`call:0x${GET_STRING.toString(16)}:d0=${id}`);
    const h = hex(`read:${r.regs.a0}:64`);
    let x = '';
    for (let i = 0; i + 4 <= h.length; i += 4) { const c = parseInt(h.slice(i + 2, i + 4) + h.slice(i, i + 2), 16); if (!c) break; x += String.fromCharCode(c); }
    return x;
  };
  const exif = () => {
    const e = step('exif:DCIM/100OMSYS/*.JPG').exif;
    const uc = String(e.UserComment ?? ''), at = uc.indexOf(' om3.1.');      // their code's prefix, without the code
    return { description: e.ImageDescription ?? null, photo_code: /^Caduceus /.test(uc) ? (at < 0 ? uc : uc.slice(0, at + ' om3.1.'.length)) : null };
  };
  const set = (h) => (/^0+$/.test(h) ? h : 'set');
  const shoot = () => run('s1', 's2:down', 'wait:300', 's2:up', 'wait:5000');
  try {
    if (!s.first.ok) throw new Error(`step 0 (open): ${s.first.error}`);
    o.open = 'ok';
    run('wait:1500', 'wait:3000');
    o.mask = hex('read:0xa32de590:4');
    const before = hex('read:0x62b4dd16:2');
    run('s1', 'wait:1200');
    o.state = { before_s1: before, after_s1: set(hex('read:0x62b4dd16:2')) };
    run('ok', 'ok');
    o.picture_mode = s.records.at(-1).gui;
    if (flow.films) {
      o.films = [0, 1, 19].map((j) => string(FILM_NAME + j));
      run('right', 'right', 'right', 'right', 'right', 'ok');
    } else run('ok');
    shoot();
    o.exif = exif();
    run('ok', 'ok');
    o.title = string(TITLE);
    run('ok');
    o.card = step('card-ls').card.filter((x) => /^OM3MOD\//.test(x.path)).map((x) => x.path.slice('OM3MOD/'.length)).sort();
    run('power:off', flow.restart_card === 'blank' ? 'restart:card=blank.omsd' : 'restart', 'wait:1500', 's1', 'wait:1200');
    o.restart = { card: flow.restart_card, state_after_s1: set(hex('read:0x62b4dd16:2')) };
    shoot();
    o.restart.exif = exif();
    run('ok', 'ok');
    o.restart.title = string(TITLE);
    run('ok');
    if (flow.nocard) {
      run('power:off', 'restart', 'wait:1500');
      const r = s.input({ type: 'card', action: 'remove' });
      if (r.error) throw new Error(`card remove: ${r.error}`);
      run(`write:0x${MEDIA_SD.toString(16)}=00000000`, 's1', 'wait:1200');
      o.nocard = { state_after_s1: set(hex('read:0x62b4dd16:2')) };
      run('ok', 'ok');
      o.nocard.title = string(TITLE);
    }
  } catch (e) {
    if (e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError) throw e;     // a bug here
    o.error = e.message;                                                                                 // a step that failed
  }
  const sum = s.close();
  const a = sum.patch_audit;
  o.audit = a && { hooks: a.hooks?.map((h) => h.at ?? h) ?? null, ported: a.ported?.map((p) => p.at) ?? null, unloaded: a.unloaded?.length ?? null, tasks: a.tasks };
  o.pokes = sum.pokes.map((p) => p.addr);
  return { observed: o, seconds: (Date.now() - t0) / 1000 };
}

// The control: v0.29's block with section 6's end word put back to stock, as --main (made here, then removed)
async function brokenSec6(dir, tmp) {
  const { openSession } = await import('../host/session.mjs');
  const { fact, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { ORIGINAL, readBytes } = await import('../checks/lib/env.mjs');
  const { main } = await readerResult(path.join(dir, 'v0.29', 'patch.json'));
  const word = fact('sections').ends[5] - MODEL_INFO.image_base, stock = readBytes(ORIGINAL);
  const block = main.slice();
  block.set(stock.subarray(word, word + 4), word);
  const file = path.join(tmp, 'broken-sec6.bin');
  fs.writeFileSync(file, block);
  try {
    const s = await openSession({ model: 'E147', main: file });
    const sum = s.close();
    return { first: s.first, unloaded: sum.patch_audit?.unloaded ?? null, changed: [...main].reduce((n, v, i) => n + (v !== block[i]), 0) };
  } finally { fs.rmSync(file, { force: true }); }
}

// ---- the matrix (E147) ------------------------------------------------------------------------------------------
export async function caduceusSession() {
  const t = tester(), { ok, notes } = t;
  const root = process.env.OM_CADUCEUS;
  if (!root) { t.skipped = 'set OM_CADUCEUS to a caduceus-om3 checkout'; return t; }
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E147') { ok(false, `test_caduceus: the releases are E147's, this process's model is ${MODEL}`); return t; }
  const dir = path.join(root, 'releases');
  const pins = JSON.parse(fs.readFileSync(PINS, 'utf8')).releases;
  const plan = folderPlan(fs.readdirSync(dir), pins);
  for (const v of plan.unpinned) notes.push(`${v}: unpinned (a new upstream release: pin it with --pin ${v})`);
  for (const v of plan.absent) notes.push(`${v}: pinned, but not in ${dir} (an older checkout?)`);
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-caduceus-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // the files and the reader, every pinned release
    const runnable = [];
    for (const v of plan.pinned) {
      const pin = pins[v];
      const f = fileFindings(v, pin.files, (rel) => { try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } });
      f.forEach((x) => ok(false, x));
      if (f.length) continue;
      const { result } = await readerResult(path.join(dir, v, 'patch.json'));
      const rf = observationFindings(`${v} reader`, pin.reader, result);
      rf.forEach((x) => ok(false, x));
      ok(true, `${v}: files and reader`);
      if (!rf.length) runnable.push(v);
    }
    // the control on the pins: one digest character changed fails (the first pinned release present)
    if (plan.pinned.length) {
      const v = plan.pinned[0], files = { ...pins[v].files }, k = `${v}/patch.json`;
      files[k] = (files[k][0] === '0' ? '1' : '0') + files[k].slice(1);
      ok(fileFindings(v, files, (rel) => fs.readFileSync(path.join(dir, rel))).length === 1, `${v}: a pin with one digest character changed did not fail`);
    }
    // the flows, each release in a process of its own
    const r = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', path.join(tmp, 'blank.omsd'), '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
    ok(r.status === 0, `card.mjs new: rc ${r.status} ${r.stderr.slice(0, 300)}`);
    const jobs = Math.max(1, Number(process.env.OM_CADUCEUS_JOBS) || 3);
    const one = (v) => new Promise((done) => {
      const c = spawn(process.execPath, [SELF, '--release', v, '--tmp', tmp], { env: { ...process.env, OM_EMU_MODEL: 'E147' } });
      let o = '', e = '';
      c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { e += d; });
      c.on('close', (rc) => done([v, rc, o, e]));
    });
    const queue = [...runnable], results = [];
    if (r.status === 0) await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) results.push(await one(queue.shift())); }));
    results.sort((x, y) => runnable.indexOf(x[0]) - runnable.indexOf(y[0]));
    for (const [v, rc, o, e] of results) {
      let res = null;
      try { res = JSON.parse(o.trim().split('\n').at(-1)); } catch { /* reported below */ }
      if (rc !== 0 || !res) { ok(false, `${v}: the flow's process exited ${rc}: ${(o + e).trim().split('\n').slice(-5).join(' | ')}`); continue; }
      const f = observationFindings(v, pins[v].expect, res.observed);
      f.forEach((x) => ok(false, x));
      ok(true, `${v} flow`);
      notes.push(`${v}: ${f.length ? 'FAILED' : 'as pinned'} (${res.seconds.toFixed(1)} s${pins[v].expect.open === 'ok' ? '' : `; ${pins[v].expect.open}`})`);
    }
    // the control on the lab: v0.29 with section 6's end word put back stops at the open, naming section 6
    if (fs.existsSync(path.join(dir, 'v0.29', 'patch.json')) && runnable.includes('v0.29')) {
      const b = await brokenSec6(dir, tmp);
      ok(b.changed === 2, `broken-sec6: ${b.changed} bytes put back (want the 2 v0.29 changes in the end word)`);
      ok(b.first.ok === false && /runs code the boot does not load: 0x60f49800\.\.0x6103f000 lies past section 6's loaded end/.test(b.first.error ?? ''),
        `broken-sec6: the open ${JSON.stringify(b.first).slice(0, 400)}`);
      ok(Array.isArray(b.unloaded) && b.unloaded.length === 651 && b.unloaded.every((u) => u.n === 6), `broken-sec6: the audit's unloaded ${JSON.stringify(b.unloaded?.length)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  if (arg('--release')) {                    // one flow, for caduceusSession: one JSON line
    const v = arg('--release'), pins = JSON.parse(fs.readFileSync(PINS, 'utf8')).releases;
    const res = await flowRun(path.join(process.env.OM_CADUCEUS, 'releases'), v, pins[v].flow, arg('--tmp'));
    console.log(JSON.stringify(res));
    process.exit(0);
  }
  if (arg('--pin')) {                        // a release's row for the pins file
    const v = arg('--pin'), dir = path.join(process.env.OM_CADUCEUS ?? '', 'releases');
    if (!process.env.OM_CADUCEUS || !fs.existsSync(path.join(dir, v, 'patch.json'))) { console.error(`--pin ${v}: no ${path.join(dir, v, 'patch.json')} (set OM_CADUCEUS)`); process.exit(2); }
    const flow = arg('--flow') ? JSON.parse(arg('--flow')) : defaultFlow(dir, v);
    const files = Object.fromEntries([`${v}/patch.json`, ...Object.values(flow.card)].map((rel) => [rel, sha(fs.readFileSync(path.join(dir, rel)))]));
    const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-caduceus-pin-' + process.pid);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const r = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', path.join(tmp, 'blank.omsd'), '--model', 'E147'], { encoding: 'utf8' });
      if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
      const { result } = await readerResult(path.join(dir, v, 'patch.json'));
      const res = await flowRun(dir, v, flow, tmp);
      console.log(JSON.stringify({ [v]: { files, reader: result, flow, expect: res.observed } }, null, 1));
      console.error(`${v}: ${res.seconds.toFixed(1)} s`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    process.exit(0);
  }
  const all = !argv.includes('--units') && !argv.includes('--session');
  let fail = 0;
  if (all || argv.includes('--units')) {
    const u = caduceusUnits();
    console.log(`caduceus-om3 pin units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || argv.includes('--session')) {
    const s = await caduceusSession();
    if (s.skipped) console.log(`caduceus-om3 releases: SKIPPED (${s.skipped})`);
    else {
      console.log(`caduceus-om3 releases: ${s.checks - s.bad.length}/${s.checks}`);
      s.notes.forEach((x) => console.log('   note:', x));
      s.bad.forEach((x) => console.log('  ', x));
    }
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
