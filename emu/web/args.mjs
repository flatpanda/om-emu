// The browser player's page query as bin/play.mjs's command line (web/worker.mjs boot): the options that move the
// lab; --no-browser, no --out. Pure, so the node tests read it as the Worker does.
import { PLAYER_PARSER } from '../scenarios/session_replay.mjs';
import { ValueError } from '../src/lab/errors.mjs';

const CHOICES = {
  cpu2: ['auto', 'stand-in', 'native'],
  camapp: ['1', '2', '3'],
  play_native: ['auto', 'on', 'off'],
};
const DEFAULTS = { cpu2: 'auto', camapp: '1', play_native: 'auto' };

// q: the page's options (web/index.html ARGS, strings as the query gives them)
export function playerArgs(q = {}) {
  const src = q ?? {};
  const a = { ...PLAYER_PARSER, ...DEFAULTS, no_browser: true, out: '<out>', no_wait_on_error: false };
  for (const k of ['lang', 'device', 'a15', 'start', 'tab', 'idle', 'touch', 'us_clock', 'compose', 'hdmi', 'audio', 'rotate']) if (typeof src[k] === 'string') a[k] = src[k];
  for (const [k, choices] of Object.entries(CHOICES)) {
    if (src[k] === undefined) continue;
    if (typeof src[k] !== 'string' || !choices.includes(src[k])) {
      throw new ValueError(`${k}: invalid value ${JSON.stringify(src[k])} (expected ${choices.join(', ')})`);
    }
    a[k] = src[k];
  }
  for (const k of ['no_bgdraw', 'debug_api']) if (src[k] !== undefined) a[k] = !!src[k];
  if (src.x_trim_keep !== undefined) a.x_trim_keep = src.x_trim_keep;
  // the creative dial's start position: decimal digits are the integer, as play.mjs's --creative-dial K reads them;
  // any other text ('' from ?creative_dial=, 'x') stays text, which the session refuses as no position (src/lab/
  // play.mjs PlaySession), where Number() made '' position 0
  if (typeof src.creative_dial === 'string') a.creative_dial = /^[0-9]+$/.test(src.creative_dial) ? Number(src.creative_dial) : src.creative_dial;
  return a;
}
