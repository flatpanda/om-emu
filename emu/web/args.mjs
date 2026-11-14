// The browser player's page query as bin/play.mjs's command line (web/worker.mjs boot): the options that move the
// lab; --no-browser, no --out. Pure, so the node tests read it as the Worker does.
import { PLAYER_PARSER } from '../scenarios/session_replay.mjs';

// q: the page's options (web/index.html ARGS, strings as the query gives them)
export function playerArgs(q = {}) {
  const a = { ...PLAYER_PARSER, no_browser: true, out: '<out>', no_wait_on_error: false };
  for (const k of ['lang', 'device', 'a15', 'start', 'tab', 'idle', 'touch', 'us_clock', 'compose', 'hdmi', 'audio', 'rotate']) if (typeof q[k] === 'string') a[k] = q[k];
  for (const k of ['no_bgdraw', 'debug_api']) if (q[k] !== undefined) a[k] = !!q[k];
  if (q.x_trim_keep !== undefined) a.x_trim_keep = q.x_trim_keep;
  // the creative dial's start position: decimal digits are the integer, as play.mjs's --creative-dial K reads them;
  // any other text ('' from ?creative_dial=, 'x') stays text, which the session refuses as no position (src/lab/
  // play.mjs PlaySession), where Number() made '' position 0
  if (typeof q.creative_dial === 'string') a.creative_dial = /^[0-9]+$/.test(q.creative_dial) ? Number(q.creative_dial) : q.creative_dial;
  return a;
}
