// Scripted session --lang option (bin/session.mjs, host/session.mjs openSession):
//   sessionLangUnits    (firmware-free) validateLang defaults/accepts/refuses, bin/session.mjs header doc and CLI arg
//                       parsing (--lang missing value, empty value, accepted --lang CODE and --lang=CODE before token
//                       checks).
//   sessionLangSession  (with firmware, if present for the process's model) bin/session.mjs --lang refuses unknown
//                       language codes with exit 2, starts in the requested language (verified via LANG_SETTING),
//                       preserves it across restart, and defaults to 'en'; openSession refuses unknown language codes
//                       with TokenError.
//   node emu/test/test_session_lang.mjs [--units] [--session]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../checks/lib/args.mjs';
import { validateLang, TokenError } from '../host/session.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const BIN = path.join(EMU, 'bin/session.mjs');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const cli = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: opts.timeout ?? 300000, env: { ...process.env, ...(opts.env ?? {}) } });
  const lines = [];
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { lines.push({ unparsed: l }); } }
  const sum = lines.find((x) => x.summary) ?? null;
  return { rc: r.status, lines, steps: lines.filter((x) => !x.summary), sum, err: r.stderr ?? '', last: (r.stderr ?? '').trim().split('\n').at(-1) ?? '' };
};

// ---- firmware-free ---------------------------------------------------------------------------------------------
export function sessionLangUnits() {
  const t = tester(), { ok } = t;
  const supported = ['ja', 'en', 'de'];

  // validateLang: default, valid, and refusals
  ok(validateLang(undefined, supported) === 'en', 'validateLang defaults to en');
  ok(validateLang('ja', supported) === 'ja', 'validateLang accepts supported language');
  ok(validateLang('fr') === 'fr', 'validateLang accepts non-empty string when supported list is omitted');
  for (const bad of ['', null, 42]) {
    const e = thrown(() => validateLang(bad, supported));
    ok(e instanceof TokenError && e instanceof UsageError, `validateLang refuses ${JSON.stringify(bad)}: ${e?.message ?? 'accepted'}`);
  }
  const unk = thrown(() => validateLang('xx', supported));
  ok(unk instanceof TokenError && unk instanceof UsageError && /--lang xx: one of de, en, ja/.test(unk.message),
    `validateLang refuses unknown code with sorted choices: ${unk?.message ?? 'accepted'}`);

  // bin/session.mjs header doc includes [--lang CODE]
  const head = fs.readFileSync(BIN, 'utf8').split('\nimport ')[0];
  ok(head.includes('[--lang CODE]'), 'bin/session.mjs header documents [--lang CODE]');

  // CLI arg parsing (firmware-free: fails at UsageError before any lab import)
  for (const [args, re, what] of [
    [['--lang'], /--lang needs a value/, '--lang without value'],
    [['--lang', ''], /--lang: language code must not be empty/, '--lang empty string'],
    [['--lang', 'ja', 'OK'], /OK: not a token/, '--lang ja accepted by CLI parser'],
    [['--lang=de', 'OK'], /OK: not a token/, '--lang=de accepted by CLI parser'],
  ]) {
    const r = cli(args, { timeout: 30000 });
    ok(r.rc === 2 && re.test(r.err) && !r.lines.length, `CLI ${what}: rc ${r.rc} ${r.err.slice(0, 200)}`);
  }
  return t;
}

// ---- firmware session (skipped if model firmware blocks are absent) --------------------------------------------
export async function sessionLangSession() {
  const t = tester(), { ok } = t;
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { blocksPresent } = await import('../host/blobs.mjs');
  if (!blocksPresent(MODEL_INFO)) {
    console.log(`session lang (${MODEL}): firmware blocks not present, skipping session checks`);
    return t;
  }
  const { loadImage, loadBlock } = await import('../checks/lib/env.mjs');
  const { languages } = await import('../src/lab/resources.mjs');
  const { LANG_SETTING } = await import('../src/lab/text.mjs');
  const { openSession } = await import('../host/session.mjs');

  const langs = new Map(languages(loadImage(), loadBlock()).map((e) => [e.lang, e.setting]));
  const enSetting = langs.get('en'), jaSetting = langs.get('ja');
  ok(enSetting !== undefined && jaSetting !== undefined && enSetting !== jaSetting,
    `${MODEL} has distinct en (${enSetting}) and ja (${jaSetting}) language settings`);

  // Unknown language refused by CLI (exit 2, no stdout) and by openSession (TokenError)
  const badCli = cli(['--model', MODEL, '--lang', 'xx', 'wait:100']);
  ok(badCli.rc === 2 && /--lang xx: one of /.test(badCli.err) && badCli.err.includes('en') && !badCli.lines.length,
    `${MODEL} CLI refuses unknown --lang xx: rc ${badCli.rc} ${badCli.err.slice(0, 200)}`);

  let apiErr = null;
  try { await openSession({ model: MODEL, lang: 'xx' }); } catch (e) { apiErr = e; }
  ok(apiErr instanceof TokenError && /--lang xx: one of /.test(apiErr.message),
    `${MODEL} openSession refuses unknown lang: ${apiErr?.message ?? 'accepted'}`);

  // --lang ja sets LANG_SETTING to jaSetting and preserves it across restart
  const rJa = cli(['--model', MODEL, '--lang', 'ja',
    'wait:500', `setting:${LANG_SETTING}`, `expect:setting:${LANG_SETTING}=${jaSetting}`,
    'restart', 'wait:500', `setting:${LANG_SETTING}`, `expect:setting:${LANG_SETTING}=${jaSetting}`]);
  const jaReads = rJa.steps.filter((x) => x.token === `setting:${LANG_SETTING}`).map((x) => x.setting?.value);
  ok(rJa.rc === 0 && rJa.sum?.ok === true && JSON.stringify(jaReads) === JSON.stringify([jaSetting, jaSetting]),
    `${MODEL} --lang ja across restart: rc ${rJa.rc} reads ${JSON.stringify(jaReads)} want [${jaSetting}, ${jaSetting}] | ${rJa.last}`);

  // Default (no --lang) starts in en
  const rEn = cli(['--model', MODEL, 'wait:500', `expect:setting:${LANG_SETTING}=${enSetting}`]);
  ok(rEn.rc === 0 && rEn.sum?.ok === true, `${MODEL} default --lang is en (${enSetting}): rc ${rEn.rc} | ${rEn.last}`);

  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = sessionLangUnits();
    console.log(`session lang units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await sessionLangSession();
    const { MODEL } = await import('../src/fw/model.mjs');
    console.log(`session lang (${MODEL}): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
