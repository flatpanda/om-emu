// Firmware-free unit tests for browser player URL/session option parsing (web/args.mjs) and session info formatting
// (web/ui.mjs formatSessionText):
//   - defaults for cpu2 ('auto'), camapp ('1'), play_native ('auto')
//   - valid values for cpu2 (auto|stand-in|native), camapp (1|2|3), play_native (auto|on|off) matching host/playcli.mjs
//   - rejection (ValueError) of invalid values (empty string, out-of-range, wrong type, unknown text)
//   - session text includes cpu2 / camapp / play_native when non-default and omits them when default
//   node emu/test/test_web_args.mjs
import { playerArgs } from '../web/args.mjs';
import { formatSessionText } from '../web/ui.mjs';
import { ValueError } from '../src/lab/errors.mjs';

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

export function webArgsUnits() {
  const t = tester(), { ok } = t;

  // 1. Defaults when omitted
  for (const [label, q] of [['no arg', undefined], ['empty object', {}], ['null', null]]) {
    const a = playerArgs(q);
    ok(a.cpu2 === 'auto' && a.camapp === '1' && a.play_native === 'auto',
      `defaults (${label}): cpu2=${JSON.stringify(a.cpu2)}, camapp=${JSON.stringify(a.camapp)}, play_native=${JSON.stringify(a.play_native)}`);
  }

  // 2. Valid choices for cpu2, camapp, play_native
  for (const v of ['auto', 'stand-in', 'native']) {
    const a = playerArgs({ cpu2: v });
    ok(a.cpu2 === v, `cpu2=${v}: got ${JSON.stringify(a.cpu2)}`);
  }
  for (const v of ['1', '2', '3']) {
    const a = playerArgs({ camapp: v });
    ok(a.camapp === v, `camapp=${v}: got ${JSON.stringify(a.camapp)}`);
  }
  for (const v of ['auto', 'on', 'off']) {
    const a = playerArgs({ play_native: v });
    ok(a.play_native === v, `play_native=${v}: got ${JSON.stringify(a.play_native)}`);
  }

  // Combined valid options alongside existing options
  {
    const a = playerArgs({ cpu2: 'native', camapp: '3', play_native: 'on', hdmi: 'on', creative_dial: '2' });
    ok(a.cpu2 === 'native' && a.camapp === '3' && a.play_native === 'on' && a.hdmi === 'on' && a.creative_dial === 2,
      `combined options: ${JSON.stringify({ cpu2: a.cpu2, camapp: a.camapp, play_native: a.play_native, hdmi: a.hdmi, creative_dial: a.creative_dial })}`);
  }

  // 3. Invalid values are rejected with ValueError
  for (const [k, badVals] of [
    ['cpu2', ['', 'on', 'off', 'standin', 'AUTO', 0, null, true]],
    ['camapp', ['', '0', '4', 'native', '1a', 1, 2, null, false]],
    ['play_native', ['', '1', '0', 'true', 'false', 'native', 'ON', 1, null, true]],
  ]) {
    for (const v of badVals) {
      const e = thrown(() => playerArgs({ [k]: v }));
      ok(e instanceof ValueError && e.message.includes(k),
        `${k}=${JSON.stringify(v)} refused with ValueError: ${e ? `${e.name}: ${e.message}` : 'accepted'}`);
    }
  }

  // 4. formatSessionText reflects non-default cpu2 / camapp / play_native and omits defaults
  const base = { host: 'browser', lens: 'native', nvram: null, card: null, card_size: null, hdmi: 'off', rotate: 'on' };
  const defText = formatSessionText({ ...base, cpu2: 'auto', camapp: '1', play_native: 'auto' }, {}, 'HOW');
  ok(!defText.includes('cpu2') && !defText.includes('camapp') && !defText.includes('play_native'),
    `default sessionText omits cpu2/camapp/play_native: ${defText}`);
  const undefText = formatSessionText(base, {}, 'HOW');
  ok(undefText === defText, `sessionText with absent cpu2/camapp/play_native matches default`);
  const customText = formatSessionText({ ...base, cpu2: 'stand-in', camapp: '3', play_native: 'on' }, {}, 'HOW');
  ok(customText.includes('cpu2 stand-in') && customText.includes('camapp 3') && customText.includes('play_native on'),
    `non-default sessionText includes cpu2/camapp/play_native: ${customText}`);

  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = webArgsUnits();
  console.log(`web args units: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
