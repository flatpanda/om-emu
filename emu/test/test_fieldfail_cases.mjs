// The E-P7 and E-M1 III field-failure cases (test/fieldfail-cases-ep7-e139.mjs), firmware-free: each case object's
// shape (the fields test_fieldfail reads, the builds' pins, the scenario's tokens through the session's own parser, the
// loader, detector and needs among the named capabilities), and, for each pinned file present under
// ~/.om-emu/thirdparty (OM_EMU_THIRDPARTY), that its sha256 is its pin. A file that is not there is listed, not failed:
// the release files live outside the tree and are fetched by hand (the case file's header has the URL pattern).
// Each case's run-time status (live, or xfail with what it needs) is printed.
//   node emu/test/test_fieldfail_cases.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CASES, CAPABILITIES, caseStatus, buildPath, buildPins } from './fieldfail-cases-ep7-e139.mjs';
import { parseToken } from '../host/session.mjs';
import { MODELS } from '../src/fw/models.mjs';

const bad = [];
let checks = 0;
const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
const SHA = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{40}$/;
const LOADERS = ['edits-json', 'mods-json'];
const sha = (b) => createHash('sha256').update(b).digest('hex');

function checkBuild(id, role, b) {
  const w = `${id}.${role}`;
  ok(b && typeof b === 'object', `${w}: not an object`);
  if (!b) return;
  for (const k of ['project', 'tag']) ok(typeof b[k] === 'string' && /^[A-Za-z0-9._-]+$/.test(b[k]), `${w}.${k}: a plain folder name`);
  ok(COMMIT.test(b.commit), `${w}.commit: a full 40-hex commit`);
  if (b.unpublished !== undefined) {
    ok(typeof b.unpublished === 'string' && b.unpublished.length > 20, `${w}.unpublished: a reason`);
    ok(b.sha256 === null && b.asset === null, `${w}: an unpublished build pins nothing`);
  } else {
    ok(SHA.test(b.sha256), `${w}.sha256: 64 hex`);
    ok(typeof b.asset === 'string' && !b.asset.startsWith('/') && !b.asset.includes('..'), `${w}.asset: a relative path`);
    ok(typeof b.src === 'string' && b.src.endsWith(b.asset.split('/').pop()), `${w}.src: the asset's upstream path`);
  }
  for (const [rel, h] of Object.entries(b.files ?? {})) {
    ok(!rel.startsWith('/') && !rel.includes('..'), `${w}.files ${rel}: a relative path`);
    ok(SHA.test(h), `${w}.files ${rel}: 64 hex`);
  }
  if (b.select !== undefined) ok(Array.isArray(b.select) && b.select.length && b.select.every((s) => typeof s === 'string'), `${w}.select: mod ids`);
}

const ids = new Set();
for (const c of CASES) {
  const id = c.id ?? '(no id)';
  ok(typeof c.id === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(c.id), `${id}: id`);
  ok(!ids.has(c.id), `${id}: a duplicate id`);
  ids.add(c.id);
  ok(Object.hasOwn(MODELS, c.body), `${id}: body ${c.body} is not a model`);
  ok(typeof c.title === 'string' && c.title.length > 10, `${id}: title`);
  ok(Array.isArray(c.links) && c.links.length > 0 && c.links.every((l) => /^https:\/\/github\.com\//.test(l)), `${id}: links (GitHub URLs)`);
  checkBuild(id, 'bad', c.bad);
  checkBuild(id, 'fixed', c.fixed);
  if (c.also_fixed) checkBuild(id, 'also_fixed', c.also_fixed);
  ok(c.fixed?.unpublished === undefined, `${id}: the fixed build must be published`);
  ok(LOADERS.includes(c.loader), `${id}: loader ${c.loader}`);
  ok(c.needs.includes(c.loader), `${id}: needs names its loader`);
  ok(Array.isArray(c.card_put) && c.card_put.every((s) => /^[^=]+=[^=]+$/.test(s)), `${id}: card_put DOS=REL`);
  for (const s of c.card_put ?? []) {
    const rel = s.split('=')[1];
    for (const b of [c.bad, c.fixed]) if (!b.unpublished) ok(Object.hasOwn(b.files ?? {}, rel), `${id}: card file ${rel} is not pinned in ${b.tag}`);
  }
  ok(Array.isArray(c.scenario) && c.scenario.length > 0, `${id}: scenario`);
  for (const t of c.scenario ?? []) {
    try { parseToken(t); ok(true); } catch (e) { ok(false, `${id}: scenario token ${t}: ${e.message}`); }
  }
  for (const t of Object.keys(c.pending_tokens ?? {})) ok(c.scenario.includes(t), `${id}: pending token ${t} is not in the scenario`);
  for (const n of [c.detector, ...c.detector_alt, ...c.needs]) ok(CAPABILITIES.includes(n), `${id}: ${n} is not a named capability`);
  ok(c.expect?.bad === 'caught' && c.expect?.fixed === 'pass', `${id}: expect bad caught, fixed pass`);
  ok(typeof c.expect?.camera_bad === 'string' && typeof c.expect?.camera_fixed === 'string', `${id}: the camera's results`);
  ok(c.blocked === undefined || c.bad.unpublished !== undefined, `${id}: blocked only for an unpublished bad build`);
  ok(c.bad.unpublished === undefined || typeof c.blocked === 'string', `${id}: an unpublished bad build is blocked`);
}

// the pins against the local copies
const absent = [];
let matched = 0;
for (const c of CASES) {
  for (const role of ['bad', 'fixed', 'also_fixed']) {
    const b = c[role];
    if (!b || b.unpublished) continue;
    for (const [rel, want] of buildPins(b)) {
      const p = buildPath(b, rel);
      if (!fs.existsSync(p)) { absent.push(`${b.project}/${b.tag}/${rel}`); continue; }
      const got = sha(fs.readFileSync(p));
      ok(got === want, `${c.id}.${role}: ${p} sha256 ${got.slice(0, 16)}... is not its pin ${want.slice(0, 16)}...`);
      if (got === want) matched++;
    }
  }
}

for (const c of CASES) console.log(`  ${c.id}: ${caseStatus(c).reason ?? 'live'}`);
if (absent.length) console.log(`  not fetched (${absent.length}): ${[...new Set(absent)].join(', ')}`);
if (bad.length) {
  for (const b of bad) console.log(`FAIL ${b}`);
  console.log(`test_fieldfail_cases: ${bad.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`test_fieldfail_cases: OK (${CASES.length} cases, ${checks} checks, ${matched} pinned files matched)`);
