// The scripted session (host/session.mjs openSession, bin/session.mjs):
//   sessionUnits    (firmware-free) the script splitter (quotes, comments), every token form and its refusals, each
//                   step's Player inputs (a press: down, 150 ms, up, the settle), every expect on fakes with its
//                   negative control (gui = and ~, mem = and !=, card, standin, exif = and ~), the Exif fields by
//                   name (UserComment after its character code), the parser's rest positional, and bin/session.mjs's
//                   usage errors (exit 2 before any lab: an unknown option or token, a bad --loaded, --settle -1, a
//                   malformed --card-put, --main with --patch, a missing --script)
//   sessionSession  (the process's model, through bin/session.mjs end to end) E143 (bin/test.mjs's process): a card the
//                   firmware formatted with a file put by --card-put, read back (expect:card, card-get), the loaded
//                   mask read and expected, S-SECLOADED, the settings getter called, S1 and S2 with the picture's Exif
//                   read and expected, a shot, power:off and restart on the kept state (the stores M, E and B
//                   restored), the card kept across the restart, a write reported as a poke (summary and the last
//                   line); controls: a failed expect exits 1 naming the step and runs nothing after it, a restart with
//                   --nvram off restores nothing, a restart after power:off carries the mode dial and the Fn lever and
//                   a second restart (no power:off) does not, a call over its budget exits 1, with --loaded on a call
//                   into a gap refused and a callee that reaches one ending the run (the session cannot go on), an
//                   --out it cannot make and a shot it cannot write exit 1 with the reason on one line, a control the
//                   model lacks is a usage error; main_dial:+1 and sub_dial:-1 each run and change the frame; the
//                   module API's input(): a harness token (SET:) and a call sent through it are listed in the summary
//                   (harness_inputs, calls, via 'input'), a read and a call that fails (over its budget) are not. E147
//                   (bin/test.mjs runs it in a child with OM_EMU_MODEL=E147): a synthetic om3-patch-2 file the test
//                   writes (16 bytes of the main block's 0xFF padding at 0x107f00, in the tail of the reset head's
//                   first copy, loaded, never run) as --patch: the patched and audit start lines, S-SECLOADED and
//                   S-STALERAM, the loaded mask, the patched bytes at run time, the card file, S2's Exif, the creative
//                   dial's setting by the getter, power:off and restart with the stores restored and the dial still at
//                   ART (the getter's 899, the record's carried), no poke; control: the same file with a run in the
//                   0xFF tail past section 10's loaded end, reported by the start line and the summary's audit
//                   (unloaded), read as S-STALERAM's fill, a write reported as a poke, a failed expect exiting 1
//   node emu/test/test_session.mjs [--units] [--session]       (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { splitScript, parseToken, stepInputs, expectFails, exifFields, TokenError, PRESS_MS, SETTLE_MS } from '../host/session.mjs';
import { parseArgs } from '../checks/lib/args.mjs';

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
export function sessionUnits() {
  const t = tester(), { ok } = t;
  // the splitter
  ok(JSON.stringify(splitScript('ok ok  # a comment\n\n right\twait:100\n# all a comment\nexpect:gui~"FILM 1" "a\\"b"')) === '["ok","ok","right","wait:100","expect:gui~FILM 1","a\\"b"]',
    `splitScript: ${JSON.stringify(splitScript('ok ok  # a comment\n\n right\twait:100\n# all a comment\nexpect:gui~"FILM 1" "a\\"b"'))}`);
  ok(JSON.stringify(splitScript('expect:exif:A.JPG:X=a#b')) === '["expect:exif:A.JPG:X=a#b"]', 'a # inside a token is kept');
  ok(thrown(() => splitScript('expect:gui~"open')) instanceof TokenError, 'an unclosed quote refused');
  // every form
  const p = (x) => { const s = parseToken(x); delete s.text; return JSON.stringify(s); };
  const forms = [
    ['ok', '{"kind":"press","id":"ok"}'], ['s2:down', '{"kind":"edge","id":"s2","action":"down"}'], ['s2:up', '{"kind":"edge","id":"s2","action":"up"}'],
    ['hold:menu', `{"kind":"hold","id":"menu","ms":2000}`], ['hold:ok:500', '{"kind":"hold","id":"ok","ms":500}'],
    ['main_dial:+3', '{"kind":"dial","id":"main_dial","detents":3}'], ['sub_dial:-8', '{"kind":"dial","id":"sub_dial","detents":-8}'],
    ['wait:1500', '{"kind":"wait","ms":1500}'], ['WAIT:20', '{"kind":"token","token":"WAIT:20"}'], ['SET:24=3', '{"kind":"token","token":"SET:24=3"}'], ['OPEN', '{"kind":"token","token":"OPEN"}'],
    ['switch:creative_dial=3', '{"kind":"switch","id":"creative_dial","value":3}'], ['switch:mode_dial-1', '{"kind":"switch","id":"mode_dial","by":-1}'],
    ['power:off', '{"kind":"power"}'], ['restart', '{"kind":"restart","card":null}'], ['restart:card=b.omsd', '{"kind":"restart","card":"b.omsd"}'],
    ['shot:a/b.png', '{"kind":"shot","file":"a/b.png"}'], ['read:0xa32de590:4', `{"kind":"read","addr":${0xa32de590},"len":4}`],
    ['write:0x10=00ff', '{"kind":"write","addr":16,"hex":"00ff"}'],
    ['call:0x603f0111:d0=901,a0=0x10,limit=5000', `{"kind":"call","fn":${0x603f0111},"regs":{"d0":901,"a0":16},"limit":5000,"space":null}`],
    ['call:0x10:space=notation', '{"kind":"call","fn":16,"regs":{},"limit":null,"space":"notation"}'],
    ['card-ls', '{"kind":"card-ls"}'], ['card-get:\\DCIM\\X.JPG=x.jpg', '{"kind":"card-get","path":"DCIM/X.JPG","local":"x.jpg"}'], ['exif:DCIM/100OMSYS/*.JPG', '{"kind":"exif","path":"DCIM/100OMSYS/*.JPG"}'],
    ['expect:gui=SS_MENU/ID_ST_MENU', '{"kind":"expect","expect":{"what":"gui","op":"=","text":"SS_MENU/ID_ST_MENU"}}'],
    ['expect:gui~PICTUREMODE', '{"kind":"expect","expect":{"what":"gui","op":"~","text":"PICTUREMODE"}}'],
    ['expect:mem:0x20=FF03', '{"kind":"expect","expect":{"what":"mem","addr":32,"op":"=","hex":"ff03"}}'],
    ['expect:mem:0x20!=0000', '{"kind":"expect","expect":{"what":"mem","addr":32,"op":"!=","hex":"0000"}}'],
    ['expect:card:OM3MOD/LOOKS.BIN', '{"kind":"expect","expect":{"what":"card","path":"OM3MOD/LOOKS.BIN"}}'],
    ['expect:standin:S-SECLOADED', '{"kind":"expect","expect":{"what":"standin","name":"S-SECLOADED"}}'],
    ['expect:exif:D/*.JPG:UserComment~FILM 5', '{"kind":"expect","expect":{"what":"exif","path":"D/*.JPG","field":"UserComment","op":"~","text":"FILM 5"}}'],
  ];
  for (const [x, want] of forms) { const got = thrown(() => p(x)) ?? p(x); ok(got === want, `${x}: ${got}`); }
  const refusals = ['', 'OK', 'ok:sideways', 'main_dial:+9', 'main_dial:+0', 'wait:-1', 'wait:1.5', 'read:0x10:0', 'read:0x10:70000', 'read:zz:4', 'write:0x10=abc',
    'write:0x1ffffffff=00', 'call:0x10:sp=1', 'call:0x10:d0', 'call:0x10:d0=0x100000000', 'call:0x10:space=flash', 'shot:a.jpg', 'card-get:A.JPG', 'exif:DCIM/*/A.JPG',
    'expect:gui', 'expect:mem:0x10=a', 'expect:exif:A.JPG:Nope=1', 'expect:standin:lower', 'expect:nothing', 'switch:creative_dial', 'hold:ok:x', 'restart:x', 'a-b'];
  for (const x of refusals) ok(thrown(() => parseToken(x)) instanceof TokenError, `refused: ${JSON.stringify(x)} -> ${thrown(() => parseToken(x))?.message ?? 'taken'}`);
  // the Player inputs
  const inp = (x, settle) => JSON.stringify(stepInputs(parseToken(x), settle));
  ok(inp('ok') === JSON.stringify([{ type: 'key', id: 'ok', action: 'down' }, { type: 'token', token: `WAIT:${PRESS_MS}` }, { type: 'key', id: 'ok', action: 'up' }, { type: 'token', token: `WAIT:${SETTLE_MS}` }]), `a press: ${inp('ok')}`);
  ok(inp('hold:ok:900', 50) === JSON.stringify([{ type: 'key', id: 'ok', action: 'down' }, { type: 'token', token: 'WAIT:900' }, { type: 'key', id: 'ok', action: 'up' }, { type: 'token', token: 'WAIT:50' }]), `a hold: ${inp('hold:ok:900', 50)}`);
  ok(inp('s2:down') === '[{"type":"key","id":"s2","action":"down"}]' && inp('wait:7') === '[{"type":"token","token":"WAIT:7"}]', 'an edge, a wait');
  ok(inp('main_dial:-2', 10) === '[{"type":"dial","id":"main","detents":-2},{"type":"token","token":"WAIT:10"}]' && inp('sub_dial:+1', 0).startsWith('[{"type":"dial","id":"sub",'),
    `a dial (the Player's ids main, sub): ${inp('main_dial:-2', 10)} ${inp('sub_dial:+1', 0)}`);
  ok(inp('switch:creative_dial=4', 0) === '[{"type":"switch","id":"creative_dial","value":4},{"type":"token","token":"WAIT:0"}]' && inp('switch:mode_dial+2', 0).includes('"step":2'), 'a switch by value and by step');
  ok(inp('power:off') === '[{"type":"switch","id":"power","value":0}]', 'power:off is the lever off');
  ok(inp('read:16:4') === '[{"type":"debug","op":"read","addr":16,"size":4}]' && inp('write:16=ab') === '[{"type":"debug","op":"write","addr":16,"hex":"ab"}]', 'read and write');
  ok(inp('call:0x50000010:d1=2,limit=9') === '[{"type":"debug","op":"call","fn":1342177296,"regs":{"d1":2},"limit":9}]', `a call: ${inp('call:0x50000010:d1=2,limit=9')}`);
  ok(['restart', 'shot:a.png', 'card-ls', 'exif:A.JPG', 'expect:gui=X'].every((x) => inp(x) === '[]'), 'the session\'s own steps are not inputs');
  // the expects on fakes: each passes on its match and fails (with what it found) on a mismatch
  const card = new Set(['OM3MOD/LOOKS.BIN']);
  const got = { gui: 'SS_MENU_LV/ID_ST_DIRECT_PICTUREMODE_ART', mem: (a, n) => (a === 0x20 ? 'ff030000' : '00'.repeat(n)).slice(0, 2 * n), card: (x) => (card.has(x) ? {} : null),
    exif: (x) => (x === 'A.JPG' ? { Model: 'OM-3            ', UserComment: 'Caduceus FILM 5' } : null), standins: ['S-SECLOADED'] };
  const ex = (x) => expectFails(parseToken(x).expect, got);
  const pass = ['expect:gui=SS_MENU_LV/ID_ST_DIRECT_PICTUREMODE_ART', 'expect:gui~PICTUREMODE', 'expect:mem:0x20=ff030000', 'expect:mem:0x20!=00000000', 'expect:mem:0x30=0000',
    'expect:card:OM3MOD/LOOKS.BIN', 'expect:standin:S-SECLOADED', 'expect:exif:A.JPG:Model~OM-3', 'expect:exif:A.JPG:UserComment=Caduceus FILM 5'];
  const fail = [['expect:gui=SS_MENU_LV', /GUI "SS_MENU_LV\/ID_ST_DIRECT_PICTUREMODE_ART", want "SS_MENU_LV"/], ['expect:gui~SHOOTING', /want one containing "SHOOTING"/],
    ['expect:mem:0x20=ff030001', /0x00000020 holds ff030000, want ff030001/], ['expect:mem:0x30!=0000', /holds 0000, want anything but 0000/],
    ['expect:card:OM3MOD/OTHER.BIN', /no OM3MOD\/OTHER.BIN on the card/], ['expect:standin:S-STALERAM', /S-STALERAM is not among/],
    ['expect:exif:A.JPG:Model=OM-3', /Model "OM-3            ", want "OM-3"/], ['expect:exif:A.JPG:ImageDescription~FILM', /ImageDescription absent/], ['expect:exif:B.JPG:Model~OM', /no B.JPG on the card/]];
  for (const x of pass) ok(ex(x) === null, `${x} holds: ${ex(x)}`);
  for (const [x, re] of fail) ok(re.test(ex(x) ?? ''), `control ${x}: ${ex(x) ?? 'held'}`);
  // the Exif fields
  const uc = new Uint8Array([...new Uint8Array(8), ...new TextEncoder().encode('Caduceus FILM 1\0\0')]);
  const f = exifFields({ ifd0: new Map([[0x010f, 'OM Digital Solutions'], [0x010e, 'FILM 1 Portra 400'], [0x0112, 1]]), exif: new Map([[0x9286, uc], [0x829a, [10, 10]]]) });
  ok(JSON.stringify(f) === '{"Make":"OM Digital Solutions","ImageDescription":"FILM 1 Portra 400","Orientation":1,"ExposureTime":"10/10","UserComment":"Caduceus FILM 1"}', `exifFields: ${JSON.stringify(f)}`);
  // the parser's rest positional
  const spec = [{ name: 'tokens', positional: true, rest: true, metavar: 'TOKEN' }, { opt: '--x', type: 'str' }];
  const r1 = parseArgs('t', ['a', '--x', 'v', 'b', 'c'], spec), r0 = parseArgs('t', [], spec);
  ok(JSON.stringify(r1.tokens) === '["a","b","c"]' && r1.x === 'v' && JSON.stringify(r0.tokens) === '[]', `rest positional: ${JSON.stringify(r1)} ${JSON.stringify(r0)}`);
  // the command line's usage errors: exit 2, before any lab (nothing on stdout)
  for (const [args, re, what] of [[['--nope'], /unknown option --nope/, 'an unknown option'], [['OK'], /OK: not a token/, 'an unknown token'], [['--loaded', 'maybe'], /--loaded maybe: one of auto, on, off/, '--loaded'],
    [['--settle', '-1'], /--settle -1: not a lab time/, '--settle -1'], [['--card-put', 'NOEQUALS'], /--card-put NOEQUALS: DOS\/PATH=LOCAL/, 'a malformed --card-put'],
    [['--main', 'm.bin', '--patch', 'p.json'], /--main and --patch exclude each other/, '--main with --patch'], [['--script', path.join(EMU, 'no-such-script.txt')], /--script .*: cannot read it/, 'a missing --script'],
    [['ok', 'main_dial:+20'], /main_dial:\+20: a dial step of 1\.\.8/, 'a dial step over the cap']]) {
    const r = cli(args, { timeout: 30000 });
    ok(r.rc === 2 && re.test(r.err) && !r.lines.length, `usage ${what}: rc ${r.rc} ${r.err.slice(0, 200)}`);
  }
  return t;
}

// ---- firmware sessions through bin/session.mjs ---------------------------------------------------------------------
export async function sessionSession() {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-session-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const T = (...p) => path.join(tmp, ...p);
  const newCard = (file) => {
    const r = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', file, '--model', MODEL], { encoding: 'utf8', timeout: 120000 });
    ok(r.status === 0, `${MODEL} card.mjs new: rc ${r.status} ${r.stderr.slice(0, 300)}`);
  };
  const step = (r, token) => r.steps.find((x) => x.token === token) ?? {};
  const hello = new TextEncoder().encode('om-emu session test\n');
  fs.writeFileSync(T('hello.txt'), hello);
  const sameFile = (f, b) => { try { const x = fs.readFileSync(f); return x.length === b.length && x.every((v, i) => v === b[i]); } catch { return false; } };
  try {
    if (MODEL === 'E143') await e143(t, { T, newCard, step, sameFile, hello });
    else if (MODEL === 'E147') await e147(t, { T, newCard, step, sameFile, hello });
    else ok(false, `test_session: no session part for ${MODEL}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

async function e143({ ok }, { T, newCard, step, sameFile, hello }) {
  newCard(T('card.omsd'));
  const MASK = '0xa32df1f8';
  const r = cli(['--model', 'E143', '--card', T('card.omsd'), '--card-put', `TEST/HELLO.TXT=${T('hello.txt')}`, '--nvram', T('nv.json'), '--out', T('out1'),
    `wait:1500 expect:standin:S-SECLOADED read:${MASK}:4 expect:mem:${MASK}=ff030000 expect:card:TEST/HELLO.TXT card-get:TEST/HELLO.TXT=got.txt`,
    'call:0x503c49ab:d0=24', 's1 wait:1200 s2:down wait:300 s2:up wait:5000', 'expect:exif:DCIM/100OMSYS/*.JPG:Make~"OM Digital"', 'exif:DCIM/100OMSYS/*.JPG', 'shot:live.png',
    'power:off restart wait:1500 expect:card:DCIM/100OMSYS/*.JPG s1', `write:${MASK}=ff030000`]);
  ok(r.rc === 0 && r.sum?.ok === true && r.steps.length === r.sum.steps && r.steps.every((x) => x.ok), `E143 run: rc ${r.rc} ${r.err.slice(-600)}`);
  ok(r.err.includes('session.mjs: settings and clock kept in') && r.err.includes(`session.mjs: card ${T('card.omsd')} (written back in place); --card-put TEST/HELLO.TXT (${hello.length} bytes)`), `E143 the start lines: ${r.err.slice(0, 400)}`);
  ok(step(r, `read:${MASK}:4`).hex === 'ff030000' && r.sum?.stand_ins?.includes('S-SECLOADED'), `E143 the loaded mask: ${JSON.stringify(step(r, `read:${MASK}:4`))}`);
  ok(sameFile(T('out1', 'got.txt'), hello) && step(r, 'card-get:TEST/HELLO.TXT=got.txt').size === hello.length, 'E143 the card file read back');
  ok(step(r, 'call:0x503c49ab:d0=24').d0 === '0x00000003' && r.sum?.calls?.length === 1, `E143 the getter: ${JSON.stringify(step(r, 'call:0x503c49ab:d0=24')).slice(0, 200)}`);
  const ex = step(r, 'exif:DCIM/100OMSYS/*.JPG');
  ok(/^DCIM\/100OMSYS\/P.*\.JPG$/.test(ex.path ?? '') && /OM Digital/.test(ex.exif?.Make ?? '') && typeof ex.exif?.DateTimeOriginal === 'string', `E143 S2's Exif: ${JSON.stringify(ex).slice(0, 300)}`);
  const png = (() => { try { return fs.readFileSync(T('out1', 'live.png')); } catch { return null; } })();
  ok(png && png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === step(r, 'shot:live.png').size?.[0], `E143 the shot: ${png?.length} bytes, ${JSON.stringify(step(r, 'shot:live.png'))}`);
  ok(step(r, 'power:off').phase === 'off' && JSON.stringify(step(r, 'restart').nvram?.loaded) === '["M","E","B"]' && step(r, 'restart').session === 2, `E143 power:off and restart: ${JSON.stringify(step(r, 'power:off'))} ${JSON.stringify(step(r, 'restart'))}`);
  ok(r.sum?.card?.some((x) => x.path === 'TEST/HELLO.TXT') && r.sum.card.some((x) => /^DCIM\/100OMSYS\/P.*\.JPG$/.test(x.path)), `E143 the card kept across the restart: ${JSON.stringify(r.sum?.card)}`);
  ok(r.sum?.pokes?.length === 1 && r.sum.pokes[0].addr === MASK && r.sum.pokes[0].step === r.steps.length - 1 && /passed; .*; POKED: 1 write\(s\) \(step \d+ 0xa32df1f8\)/.test(r.last), `E143 the write is a poke: ${JSON.stringify(r.sum?.pokes)} | ${r.last}`);
  ok(fs.existsSync(T('out1', 'session-1.json')) && fs.existsSync(T('out1', 'session-2.json')), 'E143 the two sessions\' logs');
  const ls = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'ls', T('card.omsd'), '--recursive'], { encoding: 'utf8' });
  ok(/TEST\/HELLO\.TXT/.test(ls.stdout) && /DCIM\/100OMSYS\/P\w+\.JPG/.test(ls.stdout), `E143 --card written back in place: ${ls.stdout.slice(0, 300)}`);
  // control: a failed expect ends the run (exit 1, the step named), nothing after it; --nvram off restores nothing
  const f = cli(['--model', 'E143', 'wait:500', 'power:off', 'restart', 'expect:gui=NO_SUCH_STATE', 's1']);
  ok(f.rc === 1 && f.sum?.ok === false && f.steps.length === 5 && f.steps.at(-1).ok === false && /^session\.mjs: FAILED at step 4 \(expect:gui=NO_SUCH_STATE\): expect failed: GUI "SS_COMMON\/ID_ST_CA_REQ_DISP", want "NO_SUCH_STATE"; 5 step\(s\) on E143; no poke$/.test(f.last),
    `E143 control: a failed expect: rc ${f.rc} ${f.steps.length} steps | ${f.last}`);
  ok(step(f, 'restart').nvram === null && f.sum?.stand_ins?.includes('S-SETSAVE') && !f.sum.stand_ins.includes('S-NVRAM'), `E143 control: --nvram off: ${JSON.stringify(step(f, 'restart'))}`);
  // a restart after power:off carries the physical controls (the mode dial, the Fn lever); one without is a battery
  // pull, a fresh start
  const pr = cli(['--model', 'E143', 'wait:500', 'switch:lever=0', 'power:off', 'restart', 'wait:500', 'restart', 'wait:100']);
  const [r1, r2] = pr.steps.filter((x) => x.token === 'restart');
  ok(pr.rc === 0 && r1?.carried?.lever === 0 && Number.isInteger(r1.carried.mode_dial) && r2?.carried === null, `E143 restart after power:off carries the controls, a second restart does not: ${JSON.stringify(r1?.carried)} ${JSON.stringify(r2?.carried)} | ${pr.last}`);
  // control: a call over its budget is the step's failure
  const c = cli(['--model', 'E143', 'call:0x503c49ab:d0=24,limit=5', 'wait:100']);
  ok(c.rc === 1 && /FAILED at step 1 \(call:0x503c49ab:d0=24,limit=5\): call: CallLimit/.test(c.last) && c.steps.length === 2, `E143 control: CallLimit: rc ${c.rc} | ${c.last}`);
  // S-STALERAM (--loaded on): a call into a gap is refused before it runs (the step fails, the run ends); a callee
  // that jumps into a gap (a patch the test writes: a call at section 6's 0xFF tail to a `mov imm32,a0; jmp (a0)`
  // there, the call site giving the frame) fails the step and ends the run, saying the session cannot go on
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { sectionsFact } = await import('../src/lab/sim.mjs');
  const { bootLoads } = await import('../src/fw/sections.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const main = loadImage(), base = MODEL_INFO.image_base, gap = bootLoads(main, base, sectionsFact()).gaps[0].lo + 0x10, h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
  const g = cli(['--model', 'E143', '--loaded', 'on', 'wait:500', `call:${h8(gap)}`, 'wait:100']);
  ok(g.rc === 1 && g.steps.length === 3 && g.last.startsWith(`session.mjs: FAILED at step 2 (call:${h8(gap)}): call: BadRequest: `) && g.last.includes(`refused before it runs: pc ${h8(gap)} runs code the boot does not load`),
    `E143 control: a call into a gap: rc ${g.rc} ${g.steps.length} steps | ${g.last.slice(0, 300)}`);
  const SITE = 0x60F28F00, FN = 0x60F28F40, le = (v) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24 & 0xff];
  const pt = (at, bytes) => ({ block: 0, offset: at - base, old: Buffer.from(main.subarray(at - base, at - base + bytes.length)).toString('base64'), new: Buffer.from(bytes).toString('base64') });
  ok(main.subarray(SITE - base, FN - base + 8).every((x) => x === 0xff), 'E143: 0xFF at the callee patch\'s place');
  fs.writeFileSync(T('callee.json'), JSON.stringify([pt(SITE, [0xdd, ...le(FN - SITE), 0, 0]), pt(FN, [0xfc, 0xdc, ...le(gap), 0xf0, 0xf4])]));
  const k = cli(['--model', 'E143', '--patch', T('callee.json'), 'wait:500', `call:${h8(FN)}`, 'wait:100']);
  ok(k.rc === 1 && k.steps.length === 3 && k.last.startsWith(`session.mjs: FAILED at step 2 (call:${h8(FN)}): call: UnloadedCode: `) && k.last.includes(`pc ${h8(gap)} runs code the boot does not load`) &&
    k.last.includes('the session cannot go on') && k.steps.at(-1).ok === false, `E143 control: a callee in a gap: rc ${k.rc} ${k.steps.length} steps | ${k.last.slice(0, 200)} ... ${k.last.slice(-300)}`);
  // a local file the run cannot write: an --out through a file is refused at the start, a shot onto a directory is the
  // step's failure, each with the reason on one line (no Node stack), exit 1
  const o = cli(['--model', 'E143', '--out', T('hello.txt', 'x'), 'wait:100']);
  ok(o.rc === 1 && o.err.endsWith(`session.mjs: --out ${T('hello.txt', 'x')}: cannot make it (ENOTDIR)\n`) && !/\n {4}at /.test(o.err) && o.sum?.ok === false && !o.steps.length,
    `E143 an --out it cannot make: rc ${o.rc} ${o.err.slice(-300)}`);
  fs.mkdirSync(T('out2', 'd.png'), { recursive: true });
  const w = cli(['--model', 'E143', '--out', T('out2'), 'wait:300', 'shot:d.png', 'wait:100']);
  ok(w.rc === 1 && w.steps.length === 3 && step(w, 'shot:d.png').error === `${T('out2', 'd.png')}: cannot write it (EISDIR)` && /^session\.mjs: FAILED at step 2 \(shot:d\.png\): .*: cannot write it \(EISDIR\); /.test(w.last),
    `E143 a shot it cannot write: rc ${w.rc} ${JSON.stringify(step(w, 'shot:d.png'))} | ${w.last}`);
  // control: a control the model does not have is a usage error before the boot
  // the dials in a live session: each detent step runs and changes the picture (the token's control id is the Player's
  // dial id plus _dial; play's dial_input refuses 'main_dial')
  const d = cli(['--model', 'E143', 'wait:1500', 'main_dial:+1', 'sub_dial:-1']);
  const fr = ['wait:1500', 'main_dial:+1', 'sub_dial:-1'].map((x) => step(d, x).frame);
  ok(d.rc === 0 && d.sum?.ok === true && d.steps.every((x) => x.ok) && fr.every((x) => typeof x === 'string') && new Set(fr).size === 3,
    `E143 the dials in a session: rc ${d.rc} frames ${JSON.stringify(fr)} | ${d.last.slice(0, 300)}`);
  const u = cli(['--model', 'E143', 'no_such_key']);
  ok(u.rc === 2 && /no_such_key: E143 has no control "no_such_key"/.test(u.err) && !u.lines.length, `E143 control: an unknown control: rc ${u.rc} ${u.err.slice(0, 200)}`);
  // the module API's input(): what changes the camera or runs its code is listed as the tokens' are; controls: a read
  // and a call that fails are not
  const { openSession } = await import('../host/session.mjs');
  const m = await openSession({ model: 'E143', nvram: 'off' });
  m.step('wait:500');
  const set = m.input({ type: 'token', token: 'SET:1037=0' }), got = m.input({ type: 'debug', op: 'call', fn: 0x503c49ab, regs: { d0: 1037 } });
  const rd = m.input({ type: 'debug', op: 'read', addr: Number(MASK), size: 4 }), over = m.input({ type: 'debug', op: 'call', fn: 0x503c49ab, regs: { d0: 24 }, limit: 5 });
  const ms = m.close();
  ok(set.record?.kind === 'set' && got.debug?.ok === true && got.debug.regs.d0 === '0x00000000' && JSON.stringify(ms.harness_inputs) === '[{"step":2,"token":"SET:1037=0","via":"input"}]',
    `E143 input(): a harness token listed: ${JSON.stringify(set.record ?? set).slice(0, 160)} | ${JSON.stringify(ms.harness_inputs)}`);
  ok(rd.debug?.ok === true && over.debug?.ok === false && JSON.stringify(ms.calls) === '[{"step":2,"fn":"0x503c49ab","via":"input"}]' && ms.pokes.length === 0,
    `E143 input(): the call listed, the read and the failed call not: ${JSON.stringify(ms.calls)} ${JSON.stringify(ms.pokes)} | ${JSON.stringify(over.debug).slice(0, 160)}`);
}

async function e147({ ok }, { T, newCard, step, sameFile, hello }) {
  const { ORIGINAL, readBytes } = await import('../checks/lib/env.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const hx = (a) => '0x' + (a >>> 0).toString(16).padStart(8, '0');
  const main = readBytes(ORIGINAL);
  // a made-up om3-patch-2 file (not caduceus bytes): 16 bytes of 0xFF padding inside the boot's loaded range (the tail
  // of the reset head's first copy), and for the control a second run in the 0xFF tail past section 10's loaded end
  const PAD = 0x107f00, TAIL = 0x1ffff00, NEW = new TextEncoder().encode('om-emu session.!');
  ok(main.subarray(PAD, PAD + 16).every((x) => x === 0xff) && main.subarray(TAIL, TAIL + 16).every((x) => x === 0xff), 'E147: 0xFF padding at both runs');
  const doc = (offs) => {
    const want = main.slice();
    for (const o of offs) want.set(NEW, o);
    return { format: 'om3-patch-2', name: 'om-emu session test', version: 'v0', main_base: hx(MODEL_INFO.image_base), main_sha256_before: MODEL_INFO.rom_sha256,
      main_sha256_after: sha(want), runs: offs.map((o) => [hx(MODEL_INFO.image_base + o), Buffer.from(NEW).toString('hex')]) };
  };
  fs.writeFileSync(T('patch.json'), JSON.stringify(doc([PAD])));
  fs.writeFileSync(T('tail.json'), JSON.stringify(doc([PAD, TAIL])));
  const run = hx(MODEL_INFO.image_base + PAD), tail = hx(MODEL_INFO.image_base + TAIL), newHex = Buffer.from(NEW).toString('hex');
  newCard(T('card.omsd'));
  const GET = 'call:0x603f0111:d0=897';
  const r = cli(['--model', 'E147', '--patch', T('patch.json'), '--card', T('card.omsd'), '--card-put', `TEST/HELLO.TXT=${T('hello.txt')}`, '--nvram', T('nv.json'), '--out', T('out1'),
    'wait:1500 expect:standin:S-SECLOADED expect:standin:S-STALERAM read:0xa32de590:4 expect:mem:0xa32de590=ff030000', `read:${run}:16 expect:mem:${run}=${newHex}`,
    'expect:card:TEST/HELLO.TXT card-get:TEST/HELLO.TXT=got.txt', 's1 wait:1200 s2:down wait:300 s2:up wait:5000 expect:exif:DCIM/100OMSYS/*.JPG:Model~OM-3 exif:DCIM/100OMSYS/*.JPG',
    GET, 'switch:creative_dial=3', GET, 'menu power:off restart wait:1500 expect:standin:S-NVRAM', GET]);
  ok(r.rc === 0 && r.sum?.ok === true && r.steps.every((x) => x.ok), `E147 run: rc ${r.rc} ${r.err.slice(-600)}`);
  ok(r.err.includes(`session.mjs: patched firmware: 1 patch (16 bytes changed) from ${T('patch.json')}`) && r.err.includes('session.mjs: patch audit: no patched byte where the boot does not load'), `E147 the start lines: ${r.err.slice(0, 500)}`);
  ok(JSON.stringify(r.sum?.patch_audit) === '{"hooks":[],"ported":[],"unloaded":[],"tasks":[]}' && /^1 patch \(16 bytes changed\)/.test(r.sum?.patch ?? ''), `E147 the summary's patch and audit: ${r.sum?.patch} ${JSON.stringify(r.sum?.patch_audit)}`);
  ok(step(r, 'read:0xa32de590:4').hex === 'ff030000' && step(r, `read:${run}:16`).hex === newHex, `E147 the loaded mask and the patched bytes at run time: ${step(r, 'read:0xa32de590:4').hex} ${step(r, `read:${run}:16`).hex}`);
  ok(sameFile(T('out1', 'got.txt'), hello), 'E147 the card file read back');
  const ex = step(r, 'exif:DCIM/100OMSYS/*.JPG');
  ok(/OM-3/.test(ex.exif?.Model ?? '') && /OM Digital/.test(ex.exif?.Make ?? ''), `E147 S2's Exif: ${JSON.stringify(ex).slice(0, 300)}`);
  const gets = r.steps.filter((x) => x.token === GET).map((x) => x.d0);
  ok(JSON.stringify(gets) === '["0x00000385","0x00000383","0x00000383"]' && step(r, 'restart').carried?.creative_dial === 3,
    `E147 the creative dial's setting by the getter: ${JSON.stringify(gets)} (901 at position 1, 899 at 3, 899 after power:off and restart, the dial carried: ${JSON.stringify(step(r, 'restart').carried)})`);
  ok(JSON.stringify(step(r, 'restart').nvram?.loaded) === '["M","E","B"]' && r.sum.pokes.length === 0 && /^session\.mjs: passed; \d+ step\(s\) on E147, patched; no poke$/.test(r.last), `E147 power:off and restart, no poke: ${JSON.stringify(step(r, 'restart'))} | ${r.last}`);
  // control: a run past section 10's loaded end is reported (start line, audit), read as the fill; a write is a poke;
  // a failed expect exits 1
  const c = cli(['--model', 'E147', '--patch', T('tail.json'), 'wait:500', `read:${tail}:16`, `expect:mem:${tail}=${'a5'.repeat(16)}`, `write:${tail}=00`, 'expect:gui=NO_SUCH_STATE', 's1']);
  ok(c.rc === 1 && c.err.includes(`session.mjs: patch audit: 1 patched range(s) where the boot does not load, stale RAM on the camera`) && c.err.includes(`${tail}+16 (past section 10's loaded end`), `E147 control: the start line: rc ${c.rc} ${c.err.slice(0, 600)}`);
  ok(c.sum?.patch_audit?.unloaded?.length === 1 && c.sum.patch_audit.unloaded[0].at === tail && c.sum.patch_audit.unloaded[0].n === 10, `E147 control: the audit's unloaded: ${JSON.stringify(c.sum?.patch_audit)}`);
  ok(c.sum?.pokes?.length === 1 && c.sum.pokes[0].addr === tail && /^session\.mjs: FAILED at step 5 \(expect:gui=NO_SUCH_STATE\): .*; POKED: 1 write\(s\) \(step 4 0x/.test(c.last) && c.steps.length === 6,
    `E147 control: a poke and a failed expect: ${JSON.stringify(c.sum?.pokes)} | ${c.last}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = sessionUnits();
    console.log(`scripted session units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await sessionSession();
    const { MODEL } = await import('../src/fw/model.mjs');
    console.log(`scripted session (${MODEL}, bin/session.mjs): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
