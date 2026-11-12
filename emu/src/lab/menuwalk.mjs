// Walking a menu by what the firmware draws, for a session that has to reach a menu item on any body without a
// list of key counts (test/test_storage.mjs's Format; docs/model-survey.md finding 153). Nothing here is a stand-in:
// the walker reads the lab's observers (src/lab/menu.mjs draw_log: every DrawText call's string and box, every
// rectangle fill) and the composed frame, and presses keys.
//   screenTexts   the texts on the screen: the DrawText calls since the text layer's last full clear (a rectangle of
//                 the clear colour over the whole frame on the text layer), a later draw at a place replacing the
//                 earlier one and a partial clear removing what it covers; each with its box on the screen (the
//                 call's box moved by the graphics context's origin, which the firmware keeps negated, and the draw
//                 offset)
//   rowsOf        a list's rows: the texts drawn with one text's left edge and box size at its pitch, from the top
//   bandColour    a row's band: the colour most pixels have in the strip left of its text, inside its box's height
//   cursorOf      the row under the cursor, by its band (the bodies' menus draw the cursor as a bar or a frame over
//                 the row: X, frames of E143, E147, E148, E144, E139 and E122; the rule at the function, I: a body
//                 that marks the cursor otherwise is refused or, at worst, walks to another row, which the caller's
//                 own check of what the last key did must catch). No row off: the cursor is not in the list (the
//                 Menu_Viewer bodies open the menu on the tab column)
//   MenuWalk.to   walks to the last of `goals`, in order: {row: [texts]} a row to put the cursor on and take with OK,
//                 {pass: [titles], key} a screen to leave with a key where it shows up (the two-slot bodies' card
//                 choice, whose rows are pictures). At each step the deepest goal on the screen decides; where none
//                 is, and the cursor is not in a list, DOWN goes to the next tab (until the first screen's texts come
//                 back: refused); a goal's row with the cursor outside the list takes RIGHT, another row UP or DOWN,
//                 one press at a time, the screen read again after each. The keys, the reads and what they found are
//                 kept in `log`
// Worker-safe.
import { LabError } from './errors.mjs';

export class MenuWalkError extends LabError {}

export const TEXT_LAYER = 1, CLEAR_COLOUR = 255;
const STRIP = [10, 3], INSET = 6, MIN_BAND = 4, LEARN_ROWS = 3;

// draws: draw_log entries ({op: 'text', text, colour, box, origin, draw_offset} and {op: 'rect', x, y, w, h, colour,
// layer}); [width, height]: the frame's
export function screenTexts(draws, [width, height]) {
  let from = -1;
  for (let i = draws.length - 1; i >= 0 && from < 0; i--) {
    const e = draws[i];
    if (e.op === 'rect' && e.layer === TEXT_LAYER && e.colour === CLEAR_COLOUR && e.x <= 0 && e.y <= 0 && e.x + e.w >= width && e.y + e.h >= height) from = i;
  }
  if (from < 0) throw new MenuWalkError(`menu walk: no full clear of the text layer among the last ${draws.length} draws`);
  let texts = [];
  for (const e of draws.slice(from + 1)) {
    if (e.op === 'rect' && e.layer === TEXT_LAYER && e.colour === CLEAR_COLOUR) {
      texts = texts.filter((t) => !(t.box[0] >= e.x && t.box[1] >= e.y && t.box[2] < e.x + e.w && t.box[3] < e.y + e.h));
    } else if (e.op === 'text' && e.text) {
      const dx = e.draw_offset[0] - e.origin[0], dy = e.draw_offset[1] - e.origin[1];
      const t = { text: e.text, colour: e.colour, box: [e.box[0] + dx, e.box[1] + dy, e.box[2] + dx, e.box[3] + dy] };
      texts = texts.filter((x) => x.box.join() !== t.box.join());
      texts.push(t);
    }
  }
  return texts;
}

// A list's rows: the texts drawn with one text's left edge and box size, at its pitch above and below it (the
// smallest distance to another such text: a title drawn alike elsewhere on the screen is not a row), from the top
const alike = (a, b) => a.box[0] === b.box[0] && a.box[2] - a.box[0] === b.box[2] - b.box[0] && a.box[3] - a.box[1] === b.box[3] - b.box[1];
export function rowsOf(texts, one) {
  const same = texts.filter((t) => t !== one && alike(t, one)), at = new Map(same.map((t) => [t.box[1], t]));
  const pitch = Math.min(...same.map((t) => Math.abs(t.box[1] - one.box[1])).filter((d) => d > 0));
  const rows = [one];
  if (!Number.isFinite(pitch)) return rows;
  for (let y = one.box[1] - pitch; at.has(y); y -= pitch) rows.unshift(at.get(y));
  for (let y = one.box[1] + pitch; at.has(y); y += pitch) rows.push(at.get(y));
  return rows;
}

// The colour most pixels have in the strip left of a row's text, inside the height of the box [x0, y0, x1, y1]; null
// where the strip leaves the frame. frame: [width, height, words]
export function bandColour([width, height, words], [x0, y0, , y1]) {
  const xa = x0 - STRIP[0], xb = x0 - STRIP[1], ya = y0 + INSET, yb = y1 - INSET;
  if (xa < 0 || xb >= width || ya < 0 || yb >= height || yb - ya < MIN_BAND) return null;
  const n = new Map();
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const c = words[y * width + x]; n.set(c, (n.get(c) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}

// The row under the cursor. bands: each row's band colour; above: the band one pitch above the first row (the page
// beside the list; null where there is none); bar: the unselected rows' bar colour learned before, or null.
// - three rows or more: the rows but at most one share a colour, and the other row has the cursor. Where that colour
//   is not the page's, the list draws its rows as bars, and their colour is learned
// - one or two rows: a row of the page's colour is unselected, the one off it has the cursor (a bar or a frame drawn
//   over the page); where every row is off the page's colour the rows are bars, and the one off the learned bar colour
//   has it (refused where none was learned: no guess)
// {cursor: the row's index or null, bar}
export function cursorOf(bands, above, bar) {
  if (bands.includes(null)) throw new MenuWalkError('menu walk: a row leaves no band to read in the frame');
  const hx = (c) => (c === null ? 'none' : `0x${c.toString(16)}`), one = (off, what) => {
    if (off.length > 1) throw new MenuWalkError(`menu walk: ${off.length} of ${bands.length} rows off ${what} (bands ${bands.map(hx).join(', ')})`);
    return off.length ? off[0] : null;
  };
  const offOf = (colour) => bands.flatMap((c, i) => (c === colour ? [] : [i]));
  if (bands.length >= LEARN_ROWS) {
    const n = new Map();
    for (const c of bands) n.set(c, (n.get(c) ?? 0) + 1);
    const [[common]] = [...n].sort((a, b) => b[1] - a[1]);
    return { cursor: one(offOf(common), `the common band ${hx(common)}`), bar: above !== null && common !== above ? common : bar };
  }
  if (above === null) throw new MenuWalkError(`menu walk: a list of ${bands.length} row(s) with no page above it to compare with`);
  if (bands.some((c) => c === above)) return { cursor: one(offOf(above), `the page's colour ${hx(above)}`), bar };
  if (bar === null) throw new MenuWalkError(`menu walk: ${bands.length} barred row(s) (bands ${bands.map(hx).join(', ')}, the page ${hx(above)}) and no bar colour learned from a longer list: which row has the cursor is not read`);
  return { cursor: one(offOf(bar), `the bar colour ${hx(bar)}`), bar };
}

export class MenuWalk {
  // io: {press(key): presses and releases the key and lets the screen settle, frame(): [width, height, words],
  // draws(): the session's draw_log}
  constructor(io, { limit = 40 } = {}) {
    this.io = io; this.limit = limit; this.bar = null; this.log = [];
  }
  read() {
    const frame = this.io.frame(), texts = screenTexts(this.io.draws(), frame);
    return { frame, texts };
  }
  // the list `one` is a row of, and its cursor
  list(scr, one) {
    const rows = rowsOf(scr.texts, one), [x0, y0, x1, y1] = rows[0].box;
    const pitch = rows.length > 1 ? rows[1].box[1] - y0 : y1 - y0 + 1;
    const r = cursorOf(rows.map((row) => bandColour(scr.frame, row.box)), bandColour(scr.frame, [x0, y0 - pitch, x1, y1 - pitch]), this.bar);
    this.bar = r.bar;
    return { rows, cursor: r.cursor };
  }
  // the longest list on the screen (most texts drawn alike), for a screen with no goal on it
  longest(scr) {
    let best = [];
    for (const t of scr.texts) { const rows = rowsOf(scr.texts, t); if (rows.length > best.length) best = rows; }
    return best;
  }
  press(key, why) { this.log.push(`${key}: ${why}`); this.io.press(key); }
  to(goals) {
    let first = null, tabs = 0;
    for (let n = 0; n < this.limit; n++) {
      const scr = this.read(), names = scr.texts.map((t) => t.text);
      // the deepest goal on the screen; of several texts that are it (a title and a row), the one in the longest list
      let at = -1, hit = null;
      goals.forEach((g, i) => {
        const hits = scr.texts.filter((t) => (g.row ?? g.pass).includes(t.text));
        if (hits.length) { at = i; hit = hits.reduce((a, b) => (rowsOf(scr.texts, b).length >= rowsOf(scr.texts, a).length ? b : a)); }
      });
      if (at < 0) {
        const rows = this.longest(scr);
        if (rows.length < LEARN_ROWS) throw new MenuWalkError(`menu walk: none of the goals on a screen with no list (${JSON.stringify(names.slice(0, 12))})`);
        const { cursor } = this.list(scr, rows[0]);
        if (cursor !== null) throw new MenuWalkError(`menu walk: none of the goals in the list the cursor is in (${JSON.stringify(rows.map((r) => r.text))})`);
        const key = names.join('\n');
        if (first === null) first = key;
        else if (key === first) throw new MenuWalkError(`menu walk: none of the goals on any of the ${tabs} tabs`);
        tabs += 1;
        this.press('down', `no goal among ${JSON.stringify(rows.map((r) => r.text).slice(0, 3))}..., the cursor on the tabs: the next tab`);
        continue;
      }
      const g = goals[at];
      if (g.pass) { this.press(g.key, `the screen ${JSON.stringify(hit.text)}`); continue; }
      const { rows, cursor } = this.list(scr, hit), want = rows.indexOf(hit);
      if (cursor === null) this.press('right', `${JSON.stringify(hit.text)} in a list the cursor is not in`);
      else if (cursor !== want) this.press(cursor < want ? 'down' : 'up', `${JSON.stringify(hit.text)} is row ${want}, the cursor on row ${cursor} (${JSON.stringify(rows[cursor].text)})`);
      else {
        this.press('ok', `the cursor on ${JSON.stringify(hit.text)}`);
        if (at === goals.length - 1) return;
      }
    }
    throw new MenuWalkError(`menu walk: the last goal not reached within ${this.limit} steps: ${this.log.slice(-6).join('; ')}`);
  }
}
