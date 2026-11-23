// The firmware's setting names (src/fw/setnames.mjs, host/setnames.mjs; docs/om1-settings-spec.md section 10):
//   setnamesUnits    (firmware-free) the rule on synthetic block bodies: a table found by its form wherever it lies,
//                    its count up to MODE_LABEL_PLAT_END; refused: no table, two tables, a run that does not end at
//                    MODE_LABEL_PLAT_END, a MODE_DRIVE with no MODE_ record after it (the 72-byte form of the older
//                    bodies); a record's padding not NUL, lower case; the reader; SettingNames by id and by name, an
//                    id past the table (no name), a name the body lacks and a name the table gives twice refused
//   setnamesSession  (the process's model, E143, E146 or E147; bin/test.mjs runs each in a process of its own) a
//                    session through host/session.mjs: setting:MODE_MOVIE and setting:44 the same setting, its value
//                    by the getter equal to play's GET:44; 897's name the body's (E147 MODE_COLORTONE_DIAL, E143 and
//                    E146 MODE_COLORTONE_DIAL_NEUTRAL); expect:setting by name; SET:MODE_SLEEP=60 read back by name;
//                    an id past the table (4000) read with no name; on E147 MODE_MOVIE 1 at the still / movie
//                    switch's position 0 and 0 at 2, MODE_ACTION_DIAL 2 at 0; the live route's setting op through
//                    input(): read false, an unknown name refused (BadRequest), a malformed request refused; a token
//                    naming a setting the body lacks a usage error before the boot (bin/session.mjs exit 2)
//   node emu/test/test_setnames.mjs [--units] [--session]       (OM_EMU_MODEL=E146 or E147 for those bodies)
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordAt, nameTable, readNames, SettingNames, SettingNameError, NAME_RECORD } from '../src/fw/setnames.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

// a body of `size` bytes with 52-byte records of `names` at `at`
const body = (size, at, names) => {
  const b = new Uint8Array(size);
  names.forEach((s, i) => b.set(new TextEncoder().encode(s), at + i * NAME_RECORD));
  return b;
};
const TABLE = ['MODE_DRIVE', 'MODE_AE', 'MODE_EXPREV', 'MODE_MOVIE', 'MODE_LABEL_PLAT_END'];

export function setnamesUnits() {
  const t = tester(), { ok } = t;
  const b = body(4096, 0x3f0, [...TABLE, 'COUNT_STB_LIGHT', 'DAMAGE_INFO']);
  ok(recordAt(b, 0x3f0) === 'MODE_DRIVE' && recordAt(b, 0x3f0 + 52) === 'MODE_AE' && recordAt(b, 0) === null && recordAt(b, 0x3f1) === null, 'recordAt: a record, an empty one, one off its start');
  const tb = nameTable(b);
  ok(tb.offset === 0x3f0 && tb.count === 5, `nameTable: ${JSON.stringify(tb)}`);
  ok(JSON.stringify(readNames(b, tb)) === JSON.stringify(TABLE), `readNames: ${JSON.stringify(readNames(b, tb))}`);
  // found by its form wherever it lies
  ok(nameTable(body(4096, 0x804, TABLE)).offset === 0x804, 'found at another offset');
  // refusals
  const refused = (what, blk, re) => { const e = thrown(() => nameTable(blk)); ok(e instanceof SettingNameError && re.test(e.message), `refused, ${what}: ${e?.message ?? 'taken'}`); };
  refused('no table', new Uint8Array(4096), /no table of 52-byte names from MODE_DRIVE/);
  const two = body(8192, 0x100, TABLE); two.set(body(8192, 0x1000, TABLE).subarray(0x1000, 0x1000 + 5 * 52), 0x1000);
  refused('two tables', two, /2 tables of 52-byte names from MODE_DRIVE, at 0x100, 0x1000; want one/);
  refused('a run that ends elsewhere', body(4096, 0x100, ['MODE_DRIVE', 'MODE_AE', 'MODE_X']), /ends at its record 2, MODE_X, not MODE_LABEL_PLAT_END/);
  // the older bodies' 72-byte records: MODE_DRIVE with no 52-byte MODE_ record after it
  const old = new Uint8Array(4096);
  old.set(new TextEncoder().encode('MODE_DRIVE'), 0x404); old.set([0x38, 0x3b, 1, 0, 6], 0x434); old.set(new TextEncoder().encode('MODE_AE'), 0x44c);
  refused('the 72-byte form', old, /no table/);
  const pad = body(4096, 0x100, TABLE); pad[0x100 + 52 + 40] = 1;
  ok(recordAt(pad, 0x100 + 52) === null, 'a record whose padding is not NUL is no name');
  ok(recordAt(body(64, 0, ['Mode_x']), 0) === null && recordAt(body(64, 0, ['X'.repeat(52)]), 0) === null, 'lower case, and 52 characters with no NUL, are no name');
  // SettingNames
  const n = new SettingNames(['MODE_DRIVE', 'MODE_AE', 'MODE_LONG_NAME_CUT', 'MODE_LONG_NAME_CUT', 'MODE_LABEL_PLAT_END'], { model: 'EX' });
  ok(n.count === 5 && n.name(1) === 'MODE_AE' && n.name(5) === null && n.name(-1) === null && n.id('MODE_AE') === 1, 'name(id), id(name), past the table');
  ok(JSON.stringify(n.resolve('MODE_AE')) === '{"id":1,"name":"MODE_AE"}' && JSON.stringify(n.resolve('1')) === '{"id":1,"name":"MODE_AE"}'
    && JSON.stringify(n.resolve('0x4')) === '{"id":4,"name":"MODE_LABEL_PLAT_END"}' && JSON.stringify(n.resolve('4000')) === '{"id":4000,"name":null}', 'resolve: a name, an id, a hex id, an id past the table');
  const u = thrown(() => n.resolve('MODE_NOPE')), d = thrown(() => n.id('MODE_LONG_NAME_CUT')), big = thrown(() => n.resolve('70000'));
  ok(u instanceof SettingNameError && /EX has no setting named MODE_NOPE \(its table: 5 names, ids 0\.\.4\)/.test(u.message), `an unknown name refused: ${u?.message}`);
  ok(d instanceof SettingNameError && /names MODE_LONG_NAME_CUT more than once/.test(d.message), `a name given twice refused: ${d?.message}`);
  ok(big instanceof SettingNameError, 'an id over 16 bits refused');
  return t;
}

// The process's model through the scripted session's module (host/session.mjs) and bin/session.mjs
export async function setnamesSession() {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  const { openSession, TokenError } = await import('../host/session.mjs');
  const { settingNames } = await import('../host/setnames.mjs');
  const names = settingNames(MODEL);
  const FAMILY = { E143: 'MODE_COLORTONE_DIAL_NEUTRAL', E146: 'MODE_COLORTONE_DIAL_NEUTRAL', E147: 'MODE_COLORTONE_DIAL' };
  ok(names.name(44) === 'MODE_MOVIE' && names.name(897) === FAMILY[MODEL], `${MODEL}: 44 ${names.name(44)}, 897 ${names.name(897)}`);
  const s = await openSession({ model: MODEL });
  try {
    const rec = (tok) => s.step(tok);
    const a = rec('setting:MODE_MOVIE'), b = rec('setting:44'), g = rec('GET:44');
    ok(a.ok && b.ok && JSON.stringify(a.setting) === JSON.stringify(b.setting) && a.setting.id === 44 && a.setting.name === 'MODE_MOVIE' && a.setting.value === 0,
      `${MODEL}: setting:MODE_MOVIE and setting:44: ${JSON.stringify(a.setting)} ${JSON.stringify(b.setting)}`);
    ok(g.ok && g.setting?.value === a.setting?.value && g.setting?.name === 'MODE_MOVIE', `${MODEL}: GET:44 names its setting and reads the same: ${JSON.stringify(g.setting)}`);
    const f = rec('setting:897');
    ok(f.ok && f.setting?.name === FAMILY[MODEL], `${MODEL}: setting:897 ${JSON.stringify(f.setting)}`);
    const e = rec('expect:setting:MODE_EXPOSE=3');
    ok(e.ok && e.setting?.id === 24, `${MODEL}: expect:setting:MODE_EXPOSE=3 at P: ${JSON.stringify(e)}`);
    const set = rec('SET:MODE_SLEEP=60'), back = rec('setting:32');
    ok(set.ok && set.setting?.id === 32 && set.setting?.value === 60 && back.setting?.value === 60 && back.setting?.name === 'MODE_SLEEP', `${MODEL}: SET:MODE_SLEEP=60 read back: ${JSON.stringify(set.setting)} ${JSON.stringify(back.setting)}`);
    const past = rec('setting:4000');
    ok(past.ok && past.setting?.name === null && Number.isInteger(past.setting?.value), `${MODEL}: an id past the table: ${JSON.stringify(past.setting)}`);
    if (MODEL === 'E147') {
      // the name and the role: the still / movie switch moves MODE_MOVIE and MODE_ACTION_DIAL (docs/hle-gaps/4.1.md 4.1.13)
      const sw = rec('switch:still_movie=0'), m0 = rec('setting:MODE_MOVIE'), ad = rec('setting:MODE_ACTION_DIAL'), sw2 = rec('switch:still_movie=2'), m2 = rec('setting:MODE_MOVIE');
      ok(sw.ok && sw2.ok && m0.setting?.value === 1 && ad.setting?.id === 2188 && ad.setting?.value === 2 && m2.setting?.value === 0,
        `E147: MODE_MOVIE at the switch's 0 ${m0.setting?.value}, MODE_ACTION_DIAL ${JSON.stringify(ad.setting)}, MODE_MOVIE at 2 ${m2.setting?.value}`);
    }
    // the live route's op through input()
    const op = (q) => s.input({ type: 'debug', op: 'setting', ...q }).debug;
    const r0 = op({ setting: 'MODE_MOVIE', read: false }), nope = op({ setting: 'MODE_NOPE' }), bad = op({ setting: -1 }), badRead = op({ setting: 44, read: 'no' });
    ok(r0?.ok && JSON.stringify(r0.setting) === '{"id":44,"name":"MODE_MOVIE"}' && r0.steps === undefined, `${MODEL}: setting read false: ${JSON.stringify(r0)}`);
    ok(nope && !nope.ok && nope.error?.type === 'BadRequest' && new RegExp(`${MODEL} has no setting named MODE_NOPE`).test(nope.error.message), `${MODEL}: an unknown name refused: ${JSON.stringify(nope)}`);
    ok(bad && !bad.ok && badRead && !badRead.ok, `${MODEL}: malformed requests refused: ${JSON.stringify(bad?.error)} ${JSON.stringify(badRead?.error)}`);
    // a token naming a setting the body lacks: a usage error, from the module and from the command line before the boot
    ok(thrown(() => s.step('setting:MODE_NOPE')) instanceof TokenError, `${MODEL}: setting:MODE_NOPE a TokenError`);
  } finally { s.close(); }
  const c = spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), '--model', MODEL, 'wait:100', 'expect:setting:MODE_NOPE=1'], { encoding: 'utf8', timeout: 120000 });
  ok(c.status === 2 && /expect:setting:MODE_NOPE=1: .*has no setting named MODE_NOPE/.test(c.stderr) && !c.stdout.trim(), `${MODEL}: bin/session.mjs with an unknown name: rc ${c.status} ${c.stderr.slice(0, 300)}`);
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let bad = 0;
  const report = (name, r) => { console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); bad += r.bad.length; };
  if (all || process.argv.includes('--units')) report('setting names: the rule and the lookups', setnamesUnits());
  if (all || process.argv.includes('--session')) report(`setting names in a session (${process.env.OM_EMU_MODEL ?? 'E143'})`, await setnamesSession());
  process.exit(bad ? 1 : 0);
}
