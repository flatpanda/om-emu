// The field-failure corpus: patched firmware that failed on a real camera, run in the lab as a bad build and its
// fixed build (test/fieldfail-cases.mjs CASES, and test/fieldfail-cases-ep7-e139.mjs's adapted below). The rule, after caduceus-om3's tools/test runner (--without BUILD):
// the lab must CATCH the bad build (the case's detector fires on the scenario) and the fixed build must PASS the same
// scenario (no step fails and no detector fires). Each case ends as one of
//   caught            both halves of the rule hold
//   missed            the detector did not fire on the bad build (a failure: the lab passes a build a camera failed)
//   fixed-fails       the fixed build failed or a detector fired on it (a failure: a lab regression or a false catch)
//   xfail(needs X)    the case needs a capability that does not exist yet (CAPABILITIES; probed at run time, so the
//                     case turns live when X lands): a known miss, not a failure. Its builds still run where present,
//                     and what the lab sees is reported (a fixed build that fails is still fixed-fails)
//   skip              a build's file is not here (or not its pin): the line says how to fetch or make it; never a pass
// Third-party builds are read from $OM_THIRDPARTY (default ~/.om-emu/thirdparty)/<project>/<tag>/, each file against
// its sha256 pin; nothing is fetched unless asked (--fetch). The self-control (case self-unmapped-hook, E143) needs no
// download: its bad build is a hook the test writes from the stock block jumping to an unmapped address, its fix the
// same hook into a cave holding the moved instructions.
//   fieldfailUnits    (firmware-free) the error classifier on the lab's messages; the detectors on made-up
//                     observations; the rule's verdicts (caught, missed, fixed-fails, xfail with and without builds,
//                     skip); the pins against made-up files (missing, a changed digest, a source build's prefix and
//                     suffix); the capability probes on made-up modules (an export found, a strict mode named, a loader
//                     that recognises its sample and one that refuses it as the reader refuses anything); the cases
//                     table well formed (unique ids, known capabilities, the detector a detector, pins 64 hex digits,
//                     commits 40, a URL maker per project, the self-control live)
//   fieldfailSession  every case: the capabilities probed, the files checked, each build's scenario in a process of
//                     its own with OM_EMU_MODEL the case's body (OM_FIELDFAIL_JOBS at once, default 3), the verdicts;
//                     fails on missed, fixed-fails, a self-control that is not caught, or a child that crashed
//   node emu/test/test_fieldfail.mjs [--units] [--session] [--case ID]
//   node emu/test/test_fieldfail.mjs --fetch          the pinned release files, downloaded and checked
//   node emu/test/test_fieldfail.mjs --run ID --build bad|fixed --tmp DIR    one build's run: one JSON line
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CASES as OM3_CASES, CAPABILITIES as FRAME_CAPABILITIES, RELEASE_URL as FRAME_RELEASE_URL } from './fieldfail-cases.mjs';
import { CASES as EP7_E139_CASES, capabilityPresent as ep7CapabilityPresent } from './fieldfail-cases-ep7-e139.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const SELF = new URL(import.meta.url).pathname;
const tester = () => {
  const bad = [], notes = [];
  let checks = 0;
  return { bad, notes, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
export const thirdpartyRoot = (env = process.env) => env.OM_THIRDPARTY || path.join(os.homedir(), '.om-emu/thirdparty');
const FETCH = 'node emu/test/test_fieldfail.mjs --fetch';

// ---- the E-P7 and E-M1 III cases (test/fieldfail-cases-ep7-e139.mjs) in this runner's shape ----------------------
// That file describes a build as {project, tag, commit, src, asset, sha256, files, select?, unpublished?} and names
// lab features of its own (key:shortcut, e139-still-chain) and the detector 'crash' (the lab-error detector here: a
// CPU trap, pc 0 included, stops the session). A case whose loader or lab feature is missing does not run its builds:
// the loader would refuse the file and a pending token (shortcut) would be refused, so the run would say nothing about
// the build. Its also_fixed build is pinned there (test_fieldfail_cases.mjs) and not run here.
const EXT_REPO = { 'caduceus-ep7': 'cakelesscoder/caduceus-ep7', 'E-M1-Miii': 'dfeldt91-blip/E-M1-Miii' };
export const CAPABILITIES = {
  ...FRAME_CAPABILITIES,
  'key:shortcut': { kind: 'lab', what: "the E-P7 Shortcut button as a session input on E142 (no om-emu input names it yet)", probe: () => ep7CapabilityPresent('key:shortcut') },
  'e139-still-chain': { kind: 'lab', what: "E139's still image chain built at S2 (S-JPEGENC stands in for the image library's run, FIDELITY-NOTES 7.9)", probe: () => ep7CapabilityPresent('e139-still-chain') },
};
export const RELEASE_URL = {
  ...FRAME_RELEASE_URL,
  ...Object.fromEntries(Object.entries(EXT_REPO).map(([project, repo]) => [project, (b, name) => `https://raw.githubusercontent.com/${repo}/${b.commit}/${b.dir}/${name}`])),
};
function extBuild(b, cardPut) {
  if (b.unpublished) return { kind: 'unpublished', project: b.project, tag: b.tag, commit: b.commit, why: b.unpublished };
  return { kind: 'release', project: b.project, tag: b.tag, commit: b.commit, dir: path.posix.dirname(b.src), files: { [b.asset]: b.sha256, ...(b.files ?? {}) }, patch: b.asset,
    ...(b.select ? { select: b.select } : {}), ...(cardPut?.length ? { card_put: cardPut } : {}) };
}
export function adaptExtCase(c) {
  const detector = c.detector === 'crash' ? 'lab-error' : c.detector;
  const needs = c.needs.filter((n) => n !== 'crash');
  return { id: c.id, body: c.body, title: c.title, sources: c.links, camera: c.expect?.camera_bad ?? '', cause: '', detector, needs,
    run_needs: needs.filter((n) => CAPABILITIES[n] && CAPABILITIES[n].kind !== 'detector'), scenario: c.scenario, session: {},
    bad: extBuild(c.bad, c.card_put), fixed: extBuild(c.fixed, c.card_put), ...(c.blocked ? { blocked: c.blocked } : {}) };
}
export const CASES = [...OM3_CASES, ...EP7_E139_CASES.map(adaptExtCase)];

// ---- what a run saw -----------------------------------------------------------------------------------------------
// A failed step's error text (and its token) -> its kind: the CPU's trap by its reason ('pc0', 'illegal', 'bus-error'
// (an unmapped access), 'misaligned', 'undefined', 'hang', else 'trap'), 'unloaded-code' (S-STALERAM: code the boot does not load), 'patched-hook' (the hook rule), 'hang' (a
// budget ran out), 'expect' (a failed expect: token), 'refused' (an input the lab did not take), else 'error'
export function classifyError(msg, token = '') {
  const m = String(msg ?? '');
  if (/^expect:/.test(token)) return 'expect';
  if (/runs code the boot does not load|UnloadedCode/.test(m)) return 'unloaded-code';
  if (/lab hook .* on bytes the patch overlay changed|PatchHooked/.test(m)) return 'patched-hook';
  if (/more than \d+ stub calls|insn-limit|fault=7\b|instruction limit/.test(m)) return 'hang';
  // the CPU's trap line (src/core/cpu.mjs trapLines) and its reason (src/core/mem.mjs, interp.mjs, cpu.mjs Fault
  // codes): 1 an illegal instruction, 2 a bus error (an access to nothing mapped, or a store into the flash view),
  // 3 a misaligned access, 6 undefined flags or a bad divide, 7 the instruction limit
  const trap = /trap reason=(\d+) pc=(0x[0-9a-f]+) address=(0x[0-9a-f]+)/.exec(m);
  if (trap?.[2] === '0x00000000' || /stopped at 0x00000000\b/.test(m)) return 'pc0';
  if (trap) return { 1: 'illegal', 2: 'bus-error', 3: 'misaligned', 6: 'undefined', 7: 'hang' }[trap[1]] ?? 'trap';
  if (/stopped at 0x[0-9a-f]{8} .*fault=\d/.test(m)) return 'trap';
  if (/not wired|was not taken|refused/.test(m)) return 'refused';
  return 'error';
}

const KNOWN_SUMMARY = new Set(['summary', 'ok', 'model', 'osd_errors_policy', 'patch', 'patch_audit', 'stand_ins', 'pokes', 'harness_inputs', 'calls', 'card', 'card_file', 'nvram', 'errors', 'steps', 'failed', 'traces', 'ended_at_stop', 'strict']);
const KNOWN_AUDIT = new Set(['hooks', 'ported', 'unloaded', 'tasks', 'sec_ready']);
const nonEmpty = (v) => v !== null && v !== undefined && v !== false && v !== 0 && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
// A session's close summary and records -> the observation the detectors read (the child prints it). findings: the
// opt-in reports' (the strict mode's strict.findings, --sec-ready's patch_audit.sec_ready.findings), one shape:
// {class, site, disasm, addr?}
export function observe(sum, records) {
  const steps = records.map((r) => ({ token: r.token, ok: r.ok, gui: r.gui ?? null, ...(r.ok ? {} : { error: String(r.error ?? '').slice(0, 2000), kind: classifyError(r.error, r.token) }) }));
  const a = sum.patch_audit;
  const extra = {};
  for (const [k, v] of Object.entries(sum)) if (!KNOWN_SUMMARY.has(k) && nonEmpty(v)) extra[k] = v;
  for (const [k, v] of Object.entries(a ?? {})) if (!KNOWN_AUDIT.has(k) && nonEmpty(v)) extra[`patch_audit.${k}`] = v;
  const findings = [...(sum.strict?.findings ?? []), ...(a?.sec_ready?.findings ?? [])].map((f) => ({ class: f.class, site: f.site, disasm: f.disasm, ...(f.addr ? { addr: f.addr } : {}) }));
  return { ok: sum.ok, failed: sum.failed ? { step: sum.failed.step, token: sum.failed.token, kind: classifyError(sum.failed.message, sum.failed.token ?? ''), message: String(sum.failed.message).slice(0, 2000) } : null,
    steps, audit: a ? { hooks: a.hooks?.length ?? null, unloaded: a.unloaded?.length ?? null } : null, findings, extra, errors: sum.errors.map((e) => String(e).slice(0, 2000)) };
}
// The detectors that fired on an observation: {name: what}. The present ones by the failed step's kind and the audit;
// a report's (classes) by a finding of one of its classes
export function firedDetectors(obs, caps = CAPABILITIES) {
  const out = {};
  const f = obs.failed;
  if (f && f.kind !== 'expect' && f.kind !== 'refused') out['lab-error'] = `${f.kind} at step ${f.step} (${f.token}): ${f.message.split('\n')[0].slice(0, 200)}`;
  const gui = obs.steps.find((s) => !s.ok && s.kind === 'expect' && /^expect:gui/.test(s.token));
  if (gui) out['gui-not-reached'] = `${gui.token} at gui ${gui.gui}`;
  if (f?.kind === 'hang') out.hang = out['lab-error'];
  else if (gui) out.hang = out['gui-not-reached'];
  if (obs.audit && (obs.audit.hooks > 0 || obs.audit.unloaded > 0)) out.audit = `patch audit: ${obs.audit.hooks ?? 0} hook(s) on patched bytes, ${obs.audit.unloaded ?? 0} unloaded run(s)`;
  for (const [name, c] of Object.entries(caps)) {
    if (c.kind !== 'detector' || !c.classes) continue;
    const hit = (obs.findings ?? []).filter((f) => c.classes.includes(f.class));
    if (hit.length) out[name] = `${hit.length} finding(s): ${hit.slice(0, 3).map((f) => `${f.class} at ${f.disasm ?? f.site}${f.addr ? ` (${f.addr})` : ''}`).join(', ')}${hit.length > 3 ? ', ...' : ''}`;
  }
  return out;
}

// ---- the rule -----------------------------------------------------------------------------------------------------
// A case's verdict. caps: {name: {ok, why}}; bad and fixed: {skip: why} | {obs} | {crash: why} | null (not run)
export function verdict(c, caps, bad, fixed) {
  const missing = c.needs.filter((n) => !caps[n]?.ok);
  const firedOn = (r) => (r?.obs ? firedDetectors(r.obs) : null);
  const fb = firedOn(bad), ff = firedOn(fixed);
  const seen = [];
  if (bad?.obs) seen.push(`bad: ${Object.keys(fb).length ? Object.entries(fb).map(([k, v]) => `${k} (${v})`).join('; ') : 'no detector fired'}`);
  if (fixed?.obs) seen.push(`fixed: ${Object.keys(ff).length ? Object.entries(ff).map(([k, v]) => `${k} (${v})`).join('; ') : 'passed'}`);
  for (const [k, r] of [['bad', bad], ['fixed', fixed]]) if (r?.skip) seen.push(`${k}: not run: ${r.skip}`);
  for (const [k, r] of [['bad', bad], ['fixed', fixed]]) if (r?.crash) return { verdict: 'crash', why: `${k} build's run crashed: ${r.crash}`, seen };
  const fixedBad = ff && (Object.keys(ff).length || !fixed.obs.ok);
  if (fixedBad) return { verdict: 'fixed-fails', why: `the fixed build ${Object.keys(ff).length ? `fired ${Object.keys(ff).join(', ')}` : `failed at step ${fixed.obs.failed?.step} (${fixed.obs.failed?.token}): ${fixed.obs.failed?.message?.split('\n')[0]}`}`, seen };
  if (missing.length) return { verdict: 'xfail', needs: missing, why: missing.map((n) => `needs ${n}${caps[n]?.why ? ` (${caps[n].why})` : ''}`).join('; ') + (c.blocked ? `; blocked: ${c.blocked}` : ''), seen, unexpected: fb && fb[c.detector] ? `the bad build fired ${c.detector} anyway` : null };
  for (const [k, r] of [['bad', bad], ['fixed', fixed]]) if (!r?.obs) return { verdict: 'skip', why: `${k} build: ${r?.skip ?? 'not run'}`, seen };
  if (!fb[c.detector]) return { verdict: 'missed', why: `${c.detector} did not fire on the bad build${Object.keys(fb).length ? ` (fired: ${Object.keys(fb).join(', ')})` : ''}`, seen };
  return { verdict: 'caught', why: `${c.detector}: ${fb[c.detector]}`, seen };
}
export const verdictLabel = (v) => (v.verdict === 'xfail' ? `xfail(${v.needs.map((n) => `needs ${n}`).join(', ')})` : v.verdict);

// ---- the builds' files --------------------------------------------------------------------------------------------
// A build's files against their pins: {ok, local (what openSession takes), why (not ok: what is wrong and how to get
// it)}. read(path) the bytes or null.
export function buildFiles(b, root, read) {
  if (b.kind === 'synthetic') return { ok: true, local: null };
  if (b.kind === 'unpublished') return { ok: false, why: `never published, nothing to run: ${b.why}` };
  if (b.kind === 'source') {
    const p = path.join(root, b.path), bytes = read(p);
    if (bytes === null) return { ok: false, why: `${p} is not here (never published: build it at ${b.commit.slice(0, 12)}: ${b.build}; sha256 ${b.sha256_prefix}...${b.sha256_suffix})` };
    const h = sha(bytes);
    if (!h.startsWith(b.sha256_prefix) || !h.endsWith(b.sha256_suffix)) return { ok: false, why: `${p}: sha256 ${h.slice(0, 16)}... is not the build their notes name (${b.sha256_prefix}...${b.sha256_suffix})` };
    return { ok: true, local: { main: p } };
  }
  if (b.kind === 'release') {
    const dir = path.join(root, b.project, b.tag);
    for (const [name, want] of Object.entries(b.files)) {
      const bytes = read(path.join(dir, name));
      if (bytes === null) return { ok: false, why: `${path.join(dir, name)} is not here (${FETCH})` };
      if (sha(bytes) !== want) return { ok: false, why: `${path.join(dir, name)}: sha256 ${sha(bytes).slice(0, 16)}... is not its pin ${want.slice(0, 16)}... (${FETCH} replaces it)` };
    }
    const cardPut = (b.card_put ?? []).map((s) => { const at = s.indexOf('='); return `${s.slice(0, at)}=${path.join(dir, s.slice(at + 1))}`; });
    return { ok: true, local: { patch: [path.join(dir, b.patch) + (b.select ? `#${b.select.join(',')}` : '')], ...(cardPut.length ? { cardPut } : {}) } };
  }
  throw new Error(`build kind ${b.kind}`);
}
const readOrNull = (p) => { try { return fs.readFileSync(p); } catch { return null; } };

// ---- the capabilities ---------------------------------------------------------------------------------------------
// Whether a capability exists: {ok, why}. ctx: {importer(spec) -> module namespace or throws, readPatchText}
export async function probeCapability(name, ctx, caps = CAPABILITIES) {
  const c = caps[name];
  if (!c) return { ok: false, why: `no capability ${name} in fieldfail-cases.mjs` };
  if (c.now) return { ok: true, why: 'present' };
  if (c.kind === 'lab') return typeof c.probe === 'function' && c.probe() ? { ok: true, why: 'present' } : { ok: false, why: c.what };
  if (c.kind === 'detector') {
    // a report's detector: its module's export lists every class it fires on
    let ns = null;
    try { ns = await ctx.importer(c.module); } catch { /* not in this tree */ }
    const list = ns?.[c.export];
    if (Array.isArray(list) && c.classes.every((k) => list.includes(k))) return { ok: true, why: `${c.module.replace('../', 'emu/')} ${c.export} names ${c.classes.join(', ')}` };
    return { ok: false, why: `not in this tree: ${c.what}` };
  }
  if (c.kind === 'loader') {
    // the reader recognises the sample (parses it, or refuses it with a reason other than the one it gives any
    // object it does not know)
    const attempt = (text) => { try { ctx.readPatchText(text, 'probe.json'); return null; } catch (e) { return String(e.message); } };
    const generic = attempt('{"no_such_field": 1}'), got = attempt(JSON.stringify(c.sample));
    if (got === null || got !== generic) return { ok: true, why: got === null ? 'the patch reader parses its sample' : `the patch reader recognises its sample (${got.slice(0, 120)})` };
    return { ok: false, why: `not in this tree: ${c.what}` };
  }
  return { ok: false, why: `capability kind ${c.kind}` };
}
async function probeAll(names) {
  const ctx = { importer: (m) => import(new URL(m, import.meta.url).href), readPatchText: (await import('../src/fw/patch.mjs')).readPatchText };
  const out = {};
  for (const n of names) out[n] = await probeCapability(n, ctx);
  return out;
}

// ---- one build's run (in a process whose model is the case's body) ------------------------------------------------
async function syntheticPatch(b, tmp) {
  const { ORIGINAL, readBytes, checkImage } = await import('../checks/lib/env.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const main = checkImage(readBytes(ORIGINAL));
  const b64 = (x) => Buffer.from(x).toString('base64');
  const here = Buffer.from(main.subarray(b.site, b.site + b.site_bytes.length / 2)).toString('hex');
  if (here !== b.site_bytes) throw new Error(`synthetic ${b.make}: the stock bytes at 0x${b.site.toString(16)} are ${here}, not ${b.site_bytes} (the self-control's site moved)`);
  const jmp = (toOffset) => { const j = Buffer.alloc(5); j[0] = 0xdc; j.writeInt32LE((toOffset - b.site) | 0, 1); return j; };     // jmp (d32,pc)
  const site = main.subarray(b.site, b.site + 5);
  let list;
  if (b.make === 'hook') list = [{ block: 0, offset: b.site, old: b64(site), new: b64(jmp(b.to - MODEL_INFO.image_base)), label: 'hook to an unmapped address' }];
  else if (b.make === 'hook-cave') {
    const cave = main.subarray(b.cave, b.cave + 5);
    if (!cave.every((x) => x === 0xff)) throw new Error(`synthetic hook-cave: 0x${b.cave.toString(16)} is not 0xFF padding`);
    list = [{ block: 0, offset: b.site, old: b64(site), new: b64(jmp(b.cave)), label: 'hook to the cave' }, { block: 0, offset: b.cave, old: b64(cave), new: b64(site), label: 'the moved instructions' }];
  } else throw new Error(`synthetic make ${b.make}`);
  const file = path.join(tmp, `synthetic-${b.make}.json`);
  fs.writeFileSync(file, JSON.stringify(list));
  return { patch: [file] };
}
export async function runBuild(c, which, tmp) {
  const t0 = Date.now();
  const b = c[which];
  const { openSession } = await import('../host/session.mjs');
  const out = path.join(tmp, `${c.id}-${which}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const local = b.kind === 'synthetic' ? await syntheticPatch(b, out) : buildFiles(b, thirdpartyRoot(), readOrNull).local;
  const s = await openSession({ model: c.body, ...c.session, ...(CAPABILITIES[c.detector]?.session ?? {}), ...local, out });
  if (s.first.ok) for (const t of c.scenario) { const r = s.step(t); if (!r.ok) break; }
  const sum = s.close();
  return { obs: observe(sum, s.records), seconds: (Date.now() - t0) / 1000 };
}

// ---- the corpus ---------------------------------------------------------------------------------------------------
export async function fieldfailSession({ only = null } = {}) {
  const t = tester(), { ok, notes } = t;
  const cases = CASES.filter((c) => !only || c.id === only);
  ok(cases.length > 0, `no case ${only}`);
  const caps = await probeAll([...new Set(cases.flatMap((c) => c.needs))]);
  const root = thirdpartyRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-fieldfail-'));
  t.results = [];
  try {
    const jobs = [];
    const plan = cases.map((c) => {
      const p = { c, runs: {} };
      const cannot = (c.run_needs ?? []).filter((n) => !caps[n]?.ok);
      for (const which of ['bad', 'fixed']) {
        const f = buildFiles(c[which], root, readOrNull);
        if (!f.ok) p.runs[which] = { skip: f.why };
        else if (cannot.length) p.runs[which] = { skip: `cannot run without ${cannot.join(', ')}` };
        else jobs.push([p, which]);
      }
      return p;
    });
    const one = (c, which) => new Promise((done) => {
      const ch = spawn(process.execPath, [SELF, '--run', c.id, '--build', which, '--tmp', tmp], { env: { ...process.env, OM_EMU_MODEL: c.body } });
      let o = '', e = '';
      ch.stdout.on('data', (d) => { o += d; }); ch.stderr.on('data', (d) => { e += d; });
      ch.on('close', (rc) => {
        let res = null;
        try { res = JSON.parse(o.trim().split('\n').at(-1)); } catch { /* reported */ }
        done(rc === 0 && res ? res : { crash: `exit ${rc}: ${(o + e).trim().split('\n').slice(-4).join(' | ').slice(0, 600)}` });
      });
    });
    const width = Math.max(1, Number(process.env.OM_FIELDFAIL_JOBS) || 3), queue = [...jobs];
    await Promise.all(Array.from({ length: width }, async () => { while (queue.length) { const [p, which] = queue.shift(); p.runs[which] = await one(p.c, which); } }));
    for (const { c, runs } of plan) {
      const v = verdict(c, caps, runs.bad ?? null, runs.fixed ?? null);
      t.results.push({ id: c.id, ...v });
      const secs = ['bad', 'fixed'].map((w) => runs[w]?.seconds).filter((x) => x !== undefined).map((x) => `${x.toFixed(1)} s`).join(', ');
      notes.push(`${c.id}: ${verdictLabel(v)}: ${v.why}${secs ? ` [${secs}]` : ''}`);
      for (const s of v.seen) notes.push(`  ${c.id} ${s}`);
      if (v.unexpected) notes.push(`  ${c.id}: ${v.unexpected} (a present detector caught it: check whether the case still needs ${v.needs.join(', ')})`);
      ok(!['missed', 'fixed-fails', 'crash'].includes(v.verdict), `${c.id}: ${verdictLabel(v)}: ${v.why}`);
      if (c.bad.kind === 'synthetic') ok(v.verdict === 'caught', `${c.id}: the self-control is ${v.verdict}, not caught`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

// ---- units (firmware-free) ----------------------------------------------------------------------------------------
export function fieldfailUnits() {
  const t = tester(), { ok } = t;
  // the classifier, on the lab's own messages (shapes as host/session.mjs and src/lab/hle.mjs print them)
  const trapMsg = 'NavError: S-CAMAPP CA_MAIN: stopped at 0x00008940 (disasm 0xeffe7920) fault=3: om-emu: scpu\nom-emu: MN10300 trap reason=3 pc=0x00008940 address=0x00000001';
  const kinds = [[trapMsg, 'misaligned'], ['stopped at 0x60aa0000 (disasm 0x50a7efe0) fault=2: om-emu: MN10300 trap reason=2 pc=0x60aa0000 address=0xe0000000', 'bus-error'], ['FirmwareError: stopped at 0x00000000 (disasm 0x00000000) fault=3: x', 'pc0'], ['stopped at 0x6012abcd (disasm 0x5001) fault=1: om-emu: MN10300 trap reason=1 pc=0x6012abcd address=0x6012abcd', 'illegal'], ['stopped at 0x6012abcd (disasm 0x5001) fault=9: no trap line', 'trap'],
    ['--patch: runs code the boot does not load: 0x60f49800..0x6103f000 lies past section 6\'s loaded end', 'unloaded-code'],
    ['error: lab hook malloc reached at 0x50002fdc (disasm 0x50002fdc), on bytes the patch overlay changed (body 0x00002fdd+1)', 'patched-hook'],
    ['FirmwareError: more than 200000 stub calls', 'hang'],
    ['Front upper button: not wired (0x1226 is not in E147\'s UI_IN tables)', 'refused'], ['KeyError: 7', 'error']];
  for (const [m, k] of kinds) ok(classifyError(m) === k, `classifyError(${JSON.stringify(m.slice(0, 50))}): ${classifyError(m)}, want ${k}`);
  ok(classifyError('GUI "SS_COMMON/ID_ST_CA_REQ_DISP", want one containing "MENU"', 'expect:gui~MENU') === 'expect', 'classifyError: a failed expect by its token');
  // the detectors on made-up observations
  const obs = (o = {}) => ({ ok: true, failed: null, steps: [], audit: { hooks: 0, unloaded: 0 }, extra: {}, errors: [], ...o });
  const failedAt = (kind, message, token = 'open') => ({ ok: false, failed: { step: 0, token, kind, message }, steps: [{ token, ok: false, kind, error: message }], errors: [`step 0 (${token}): ${message}`] });
  ok(Object.keys(firedDetectors(obs())).length === 0, 'firedDetectors: a clean run fires nothing');
  const trapped = firedDetectors(obs(failedAt('misaligned', trapMsg)));
  ok(Object.keys(trapped).join() === 'lab-error' && /^misaligned at step 0 \(open\)/.test(trapped['lab-error']), `firedDetectors: a trap at the open: ${JSON.stringify(trapped)}`);
  const hung = firedDetectors(obs(failedAt('hang', 'more than 200000 stub calls', 's1')));
  ok(hung['lab-error'] && hung.hang, `firedDetectors: a hang: ${JSON.stringify(hung)}`);
  const gui = firedDetectors(obs({ ok: false, failed: { step: 4, token: 'expect:gui~MENU', kind: 'expect', message: 'expect:gui~MENU: ...' }, steps: [{ token: 'expect:gui~MENU', ok: false, kind: 'expect', gui: 'SS_COMMON/ID_ST_BLACK_SCREEN' }] }));
  ok(Object.keys(gui).sort().join() === 'gui-not-reached,hang', `firedDetectors: a failed expect:gui is gui-not-reached and hang, not lab-error: ${JSON.stringify(gui)}`);
  ok(firedDetectors(obs({ audit: { hooks: 0, unloaded: 3 } })).audit, 'firedDetectors: unloaded runs in the audit');
  ok(Object.keys(firedDetectors(obs(failedAt('refused', 'not wired', 'front1')))).length === 0, 'firedDetectors: a refused input is no detector (the scenario is wrong, not the build)');
  // the opt-in reports' findings, through observe as a session's summary carries them
  const sumOf = (o = {}) => ({ ok: true, failed: null, errors: [], patch_audit: { hooks: [], unloaded: [] }, ...o });
  const o1 = observe(sumOf({ patch_audit: { hooks: [], unloaded: [], sec_ready: { static: { hooks: 1, crossings: 1, gated: 0 }, watched: true, findings: [{ class: 'ungated-branch', site: '0x6057fb1b', disasm: '0x5057fb1b', addr: '0x60f4ad2d', branch: 'jmp' }] } },
    strict: { model: 'E142', findings: [{ class: 'init-read', site: '0x60210900', disasm: '0x501f08e0', addr: '0x6025aa98' }], allowed: [{ kind: 'image-store', at: 'any', addr: 'any', why: 'stock', n: 9 }], dropped: 0 } }), []);
  const sr = firedDetectors(o1);
  ok(Object.keys(o1.extra).length === 0 && o1.findings.length === 2 && sr['section-ready'] && sr['strict-flash-init'] && !sr['strict-misaligned'] && !sr['strict-image-write'] && /init-read at 0x501f08e0 \(0x6025aa98\)/.test(sr['strict-flash-init']),
    `firedDetectors: a report's detector by its classes' findings, not by an allowed stock site: ${JSON.stringify(sr)}`);
  const o2 = observe(sumOf({ strict: { model: 'E142', findings: [], allowed: [{ kind: 'image-store', at: 'any', addr: 'any', why: 'stock', n: 9 }], dropped: 0 } }), []);
  ok(Object.keys(firedDetectors(o2)).length === 0, `firedDetectors: a report with no finding fires nothing: ${JSON.stringify(firedDetectors(o2))}`);
  // the rule
  const C = { id: 'x', detector: 'lab-error', needs: [] };
  const caps = { 'section-ready': { ok: false, why: 'not in this tree' }, have: { ok: true } };
  const B = { obs: obs(failedAt('misaligned', trapMsg)) }, F = { obs: obs() };
  ok(verdict(C, caps, B, F).verdict === 'caught', `verdict: caught ${JSON.stringify(verdict(C, caps, B, F))}`);
  ok(verdict(C, caps, F, F).verdict === 'missed', 'verdict: the bad build passes: missed');
  ok(verdict({ ...C, detector: 'audit' }, caps, B, F).verdict === 'missed', 'verdict: another detector fired, not the case\'s: missed');
  ok(verdict(C, caps, B, B).verdict === 'fixed-fails', 'verdict: the fixed build caught too: fixed-fails');
  const sk = verdict(C, caps, { skip: 'not here (fetch)' }, F);
  ok(sk.verdict === 'skip' && /not here/.test(sk.why), `verdict: a missing build is skip, never caught: ${JSON.stringify(sk)}`);
  const xf = verdict({ ...C, detector: 'section-ready', needs: ['section-ready'] }, caps, F, F);
  ok(xf.verdict === 'xfail' && verdictLabel(xf) === 'xfail(needs section-ready)' && xf.seen.join('|') === 'bad: no detector fired|fixed: passed', `verdict: xfail with what the lab sees: ${JSON.stringify(xf)}`);
  ok(verdict({ ...C, needs: ['section-ready'] }, caps, { skip: 'x' }, { skip: 'y' }).verdict === 'xfail', 'verdict: xfail without the builds');
  ok(verdict({ ...C, needs: ['section-ready'] }, caps, F, B).verdict === 'fixed-fails', 'verdict: an xfail case whose fixed build fails is fixed-fails');
  ok(verdict({ ...C, needs: ['have'] }, caps, B, F).verdict === 'caught', 'verdict: a need that exists is live');
  ok(verdict({ ...C, needs: ['section-ready'] }, caps, B, F).unexpected, 'verdict: an xfail case caught anyway says so');
  ok(verdict(C, caps, { crash: 'exit 1' }, F).verdict === 'crash', 'verdict: a crashed child');
  // the pins on made-up files
  const files = { '/r/p/v1/patch.json': Buffer.from('one'), '/r/p/src/E.BIN': Buffer.from('two') };
  const rd = (p) => files[p] ?? null;
  const rel = { kind: 'release', project: 'p', tag: 'v1', commit: 'c'.repeat(40), files: { 'patch.json': sha(Buffer.from('one')) }, patch: 'patch.json' };
  const r1 = buildFiles(rel, '/r', rd);
  ok(r1.ok && r1.local.patch[0] === '/r/p/v1/patch.json', `buildFiles: a release as pinned: ${JSON.stringify(r1)}`);
  const r2 = buildFiles({ ...rel, files: { 'patch.json': sha(Buffer.from('uno')) } }, '/r', rd);
  ok(!r2.ok && /is not its pin/.test(r2.why) && r2.why.includes('--fetch'), `buildFiles: a changed digest: ${JSON.stringify(r2)}`);
  const r3 = buildFiles({ ...rel, tag: 'v2' }, '/r', rd);
  ok(!r3.ok && /is not here \(node emu\/test\/test_fieldfail.mjs --fetch\)/.test(r3.why), `buildFiles: a missing file names the fetch: ${JSON.stringify(r3)}`);
  const h2 = sha(Buffer.from('two'));
  const src = { kind: 'source', commit: 'd'.repeat(40), path: 'p/src/E.BIN', sha256_prefix: h2.slice(0, 8), sha256_suffix: h2.slice(-4), build: 'make it' };
  ok(buildFiles(src, '/r', rd).ok, 'buildFiles: a source build matching its prefix and suffix');
  ok(!buildFiles({ ...src, sha256_suffix: 'zzzz' }, '/r', rd).ok, 'buildFiles: a source build with another digest');
  const r4 = buildFiles({ ...src, path: 'p/src/none.BIN' }, '/r', rd);
  ok(!r4.ok && r4.why.includes('make it') && r4.why.includes('never published'), `buildFiles: a source build not here says how to make it: ${JSON.stringify(r4)}`);
  // the E-P7 / E-M1 III shape, adapted
  const ext = adaptExtCase({ id: 'e', body: 'E142', title: 't', links: [], detector: 'crash', needs: ['edits-json', 'key:shortcut', 'strict-flash-init'], scenario: ['s1'], card_put: ['EP7MOD/AP.BIN=card/EP7MOD/AP.BIN'],
    bad: { project: 'p', tag: 'v1', commit: 'c'.repeat(40), unpublished: 'never released' }, fixed: { project: 'p', tag: 'v1', commit: 'c'.repeat(40), src: 'releases/v1/patch.json', asset: 'patch.json', sha256: sha(Buffer.from('one')), files: { 'card/EP7MOD/AP.BIN': sha(Buffer.from('ap')) } }, blocked: 'b' });
  ok(ext.detector === 'lab-error' && ext.run_needs.join() === 'edits-json,key:shortcut' && ext.blocked === 'b', `adaptExtCase: crash is lab-error, the loader and lab features gate the runs: ${JSON.stringify(ext)}`);
  const eb = buildFiles(ext.bad, '/r', rd);
  ok(!eb.ok && /never published.*never released/.test(eb.why), `buildFiles: an unpublished build: ${JSON.stringify(eb)}`);
  const ef = buildFiles(ext.fixed, '/r', (p) => ({ ...files, '/r/p/v1/card/EP7MOD/AP.BIN': Buffer.from('ap') })[p] ?? null);
  ok(ef.ok && ef.local.patch[0] === '/r/p/v1/patch.json' && ef.local.cardPut?.[0] === 'EP7MOD/AP.BIN=/r/p/v1/card/EP7MOD/AP.BIN', `buildFiles: an adapted release with card files: ${JSON.stringify(ef)}`);
  ok(RELEASE_URL['caduceus-ep7']({ commit: 'abc', dir: 'releases/v0.33' }, 'edits.json') === 'https://raw.githubusercontent.com/cakelesscoder/caduceus-ep7/abc/releases/v0.33/edits.json', 'RELEASE_URL: an E-P7 file at its commit and folder');
  const xb = verdict({ id: 'x', detector: 'lab-error', needs: ['key:shortcut'], blocked: 'never published' }, { 'key:shortcut': { ok: false } }, { skip: 'a' }, { skip: 'b' });
  ok(xb.verdict === 'xfail' && /blocked: never published/.test(xb.why), `verdict: a blocked case says so: ${JSON.stringify(xb)}`);
  return t;
}

// the probes and the table (async: the probes import)
export async function fieldfailTableUnits() {
  const t = tester(), { ok } = t;
  const fake = (mods, reader) => ({ importer: async (m) => { if (!mods[m]) throw new Error('ENOENT'); return mods[m]; }, readPatchText: reader ?? ((text) => { const d = JSON.parse(text); if (!Array.isArray(d)) throw new Error('probe.json: not a list of patches, nor an object whose patches is one'); return d; }) });
  ok((await probeCapability('section-ready', fake({}))).ok === false, 'probe: section-ready absent');
  ok((await probeCapability('section-ready', fake({ '../src/lab/secready.mjs': { SEC_READY_CLASSES: ['ungated-branch', 'unready-run'] } }))).ok, 'probe: section-ready by its classes export');
  ok(!(await probeCapability('section-ready', fake({ '../src/lab/secready.mjs': { SEC_READY_CLASSES: ['ungated-branch'] } }))).ok, 'probe: section-ready with a class missing');
  const strictMods = { '../src/lab/strict.mjs': { STRICT_CLASSES: ['misaligned', 'image-store'] } };
  ok((await probeCapability('strict-misaligned', fake(strictMods))).ok && (await probeCapability('strict-image-write', fake(strictMods))).ok && !(await probeCapability('strict-flash-init', fake(strictMods))).ok,
    'probe: strict classes by the names its export lists');
  // the real tree: every report detector and loader the patch-audit work built is present
  const real = { importer: (m) => import(new URL(m, import.meta.url).href), readPatchText: (await import('../src/fw/patch.mjs')).readPatchText };
  for (const n of ['section-ready', 'strict-misaligned', 'strict-image-write', 'strict-flash-init', 'edits-json', 'mods-json']) {
    const p = await probeCapability(n, real);
    ok(p.ok, `probe in this tree: ${n}: ${p.why}`);
  }
  ok(!(await probeCapability('edits-json', fake({}))).ok, 'probe: a reader that refuses the sample as it refuses anything: no loader');
  const knows = (text) => { const d = JSON.parse(text); if (d.edits) throw new Error('probe.json: edit 0: expect 00 is not the stock byte'); throw new Error('probe.json: not a list of patches'); };
  ok((await probeCapability('edits-json', fake({}, knows))).ok, 'probe: a reader that refuses the sample for its content: the loader exists');
  ok(!(await probeCapability('lv-magnify', fake({}))).ok && (await probeCapability('lab-error', fake({}))).ok, 'probe: a lab feature not built; a present detector');
  // the table
  const ids = CASES.map((c) => c.id);
  ok(new Set(ids).size === ids.length, `cases: duplicate ids ${ids}`);
  for (const c of CASES) {
    ok(CAPABILITIES[c.detector]?.kind === 'detector', `${c.id}: detector ${c.detector} is not a detector in CAPABILITIES`);
    for (const n of c.needs) ok(CAPABILITIES[n], `${c.id}: needs ${n}, not in CAPABILITIES`);
    for (const n of c.run_needs ?? []) ok(c.needs.includes(n) && CAPABILITIES[n]?.kind !== 'detector', `${c.id}: run_needs ${n} is not a non-detector need`);
    ok(CAPABILITIES[c.detector].now || c.needs.includes(c.detector), `${c.id}: its detector ${c.detector} is not present and not among its needs`);
    ok(Array.isArray(c.scenario) && c.scenario.length > 0 && typeof c.body === 'string', `${c.id}: no scenario or body`);
    for (const w of ['bad', 'fixed']) {
      const b = c[w];
      if (b.kind === 'release') {
        ok(/^[0-9a-f]{40}$/.test(b.commit) && RELEASE_URL[b.project] && Object.values(b.files).every((h) => /^[0-9a-f]{64}$/.test(h)) && b.files[b.patch], `${c.id} ${w}: a release pin malformed`);
      } else if (b.kind === 'source') ok(/^[0-9a-f]{40}$/.test(b.commit) && /^[0-9a-f]{8}$/.test(b.sha256_prefix) && /^[0-9a-f]{4}$/.test(b.sha256_suffix) && b.build, `${c.id} ${w}: a source pin malformed`);
      else if (b.kind === 'unpublished') ok(w === 'bad' && /^[0-9a-f]{40}$/.test(b.commit) && b.why && c.blocked, `${c.id} ${w}: an unpublished build is the bad one, with a reason, and the case blocked`);
      else ok(b.kind === 'synthetic', `${c.id} ${w}: kind ${b.kind}`);
    }
  }
  const self = CASES.find((c) => c.bad.kind === 'synthetic');
  ok(self && !self.needs.length && CAPABILITIES[self.detector].now, 'cases: a live self-control');
  return t;
}

// ---- fetch --------------------------------------------------------------------------------------------------------
async function fetchAll() {
  const root = thirdpartyRoot();
  let fail = 0;
  const seen = new Set();
  for (const c of CASES) {
    for (const w of ['bad', 'fixed']) {
      const b = c[w];
      if (b.kind === 'source') { const f = buildFiles(b, root, readOrNull); if (!f.ok) console.log(`${c.id} ${w}: ${f.why}`); continue; }
      if (b.kind !== 'release') continue;
      for (const [name, want] of Object.entries(b.files)) {
        const p = path.join(root, b.project, b.tag, name);
        if (seen.has(p)) continue;
        seen.add(p);
        const have = readOrNull(p);
        if (have && sha(have) === want) { console.log(`${p}: as pinned`); continue; }
        const url = RELEASE_URL[b.project](b, name);
        const r = await fetch(url);
        const bytes = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
        if (!bytes || sha(bytes) !== want) { console.log(`${p}: ${url}: ${bytes ? `sha256 ${sha(bytes).slice(0, 16)}... is not its pin` : `HTTP ${r.status}`}`); fail++; continue; }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, bytes);
        console.log(`${p}: fetched (${bytes.length} bytes, as pinned)`);
      }
    }
  }
  return fail;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  if (arg('--run')) {
    const c = CASES.find((x) => x.id === arg('--run'));
    console.log(JSON.stringify(await runBuild(c, arg('--build'), arg('--tmp'))));
    process.exit(0);
  }
  if (argv.includes('--fetch')) process.exit(await fetchAll() ? 1 : 0);
  const all = !argv.includes('--units') && !argv.includes('--session');
  let fail = 0;
  if (all || argv.includes('--units')) {
    const u = fieldfailUnits(), v = await fieldfailTableUnits();
    console.log(`field-failure corpus units: ${u.checks - u.bad.length}/${u.checks}; probes and table ${v.checks - v.bad.length}/${v.checks}`);
    [...u.bad, ...v.bad].forEach((x) => console.log('  ', x));
    fail += u.bad.length + v.bad.length;
  }
  if (all || argv.includes('--session')) {
    const s = await fieldfailSession({ only: arg('--case') });
    const n = (k) => s.results.filter((r) => r.verdict === k).length;
    console.log(`field-failure corpus: ${s.results.length} case(s): ${n('caught')} caught, ${n('missed')} missed, ${n('xfail')} xfail, ${n('skip')} skip${n('fixed-fails') ? `, ${n('fixed-fails')} fixed-fails` : ''}${n('crash') ? `, ${n('crash')} crash` : ''}`);
    s.notes.forEach((x) => console.log('   note:', x));
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
