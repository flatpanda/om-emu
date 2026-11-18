// The firmware's own setting names (docs/om1-settings-spec.md section 10), read from the user's firmware at run time:
// the repository publishes no firmware bytes, so no name table is committed, and a name is resolved per body from that
// body's own block. Container block 2 (the OE block with flags 0x0106, the large-data block: load 0x458c0000 on E143,
// E146 and E147), which the lab does not load, holds a run of 52-byte records, each one name NUL-padded, whose index is
// the setting id: MODE_DRIVE (id 0) to MODE_LABEL_PLAT_END, then other name groups (COUNT_STB_LIGHT, ...) whose ids are
// not checked and which this module does not read. Found by its form, never by an offset: the one place in the block
// where a record MODE_DRIVE is followed by records that start with MODE_, the run ending at the first record that is
// not one, and its last record MODE_LABEL_PLAT_END (X, a scan of the 19 MODELS bodies' block 2, 2026-11-17: nine hold
// it, test/test_facts.mjs NAMES_FOUND; E118, E122, E125, E129, E132 and E137 hold MODE_DRIVE in records of another
// form, 72 bytes with words after the name, which this rule does not read; E120, E140, E142 and E145 none). That the
// index is the setting id: X on E143, E146 and E147 (test/test_setnames.mjs: MODE_MOVIE is 44, the setting E147's
// still / movie switch moves, with MODE_ACTION_DIAL 2188; MODE_EXPOSE 24 reads the mode; MODE_SLEEP 32 the value SET
// wrote). A name longer than 51 characters is cut to 51 in its record, so several ids can read one name (E147's 1120 and
// 1125..1129): such a name is refused by name, its ids still name it. Worker-safe: pure functions of the block's bytes.
export const NAME_RECORD = 52, NAME_FIRST = 'MODE_DRIVE', NAME_LAST = 'MODE_LABEL_PLAT_END', NAME_PREFIX = 'MODE_';
export const NAMES_BLOCK_FLAGS = 0x0106;
const NAME_CHARS = /^[A-Z][A-Z0-9_]*$/;
const hx = (v) => '0x' + v.toString(16);
// What the rule or a lookup refuses: no table of the form in the block, two of them, a name or an id the body does
// not have
export class SettingNameError extends Error {}

// The name of the 52-byte record at o of a block: its characters (A-Z, 0-9, _), then NUL to the record's end; or null
export function recordAt(b, o) {
  if (o < 0 || o + NAME_RECORD > b.length) return null;
  let n = 0;
  while (n < NAME_RECORD && b[o + n] !== 0) n++;
  if (n === 0 || n === NAME_RECORD) return null;
  for (let k = o + n; k < o + NAME_RECORD; k++) if (b[k] !== 0) return null;
  const s = String.fromCharCode(...b.subarray(o, o + n));
  return NAME_CHARS.test(s) ? s : null;
}

// The table in a block 2 body (descrambled): {offset, count} (the first record's offset in the body; ids 0..count-1).
// Throws SettingNameError where the block holds no such run, or more than one.
export function nameTable(b) {
  const first = [...NAME_FIRST].map((c) => c.charCodeAt(0)), found = [];
  for (let o = b.indexOf(first[0]); o >= 0; o = b.indexOf(first[0], o + 1)) {
    if (!first.every((c, k) => b[o + k] === c) || recordAt(b, o) !== NAME_FIRST || !recordAt(b, o + NAME_RECORD)?.startsWith(NAME_PREFIX)) continue;
    let n = 0;
    for (let p = o; recordAt(b, p)?.startsWith(NAME_PREFIX); p += NAME_RECORD) n++;
    found.push({ offset: o, count: n, last: recordAt(b, o + (n - 1) * NAME_RECORD) });
  }
  if (!found.length) throw new SettingNameError(`no table of ${NAME_RECORD}-byte names from ${NAME_FIRST} in the block (${b.length} bytes)`);
  if (found.length > 1) throw new SettingNameError(`${found.length} tables of ${NAME_RECORD}-byte names from ${NAME_FIRST}, at ${found.map((f) => hx(f.offset)).join(', ')}; want one`);
  const [t] = found;
  if (t.last !== NAME_LAST) throw new SettingNameError(`the table at ${hx(t.offset)} ends at its record ${t.count - 1}, ${t.last}, not ${NAME_LAST}`);
  return { offset: t.offset, count: t.count };
}
// The names of a table nameTable found: the array whose index is the setting id
export function readNames(b, { offset, count }) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const s = recordAt(b, offset + i * NAME_RECORD);
    if (s === null) throw new SettingNameError(`record ${i} at ${hx(offset + i * NAME_RECORD)} is not a name`);
    out[i] = s;
  }
  return out;
}

// One body's names: name(id) (null past the table: an id the table does not name, such as 3265 or 4000), id(name)
// (SettingNameError for a name the body does not have), resolve(text) (an id given as a number or a name; what the
// tools take: setting:44 and setting:MODE_MOVIE).
export class SettingNames {
  constructor(names, { model = null, offset = null, source = null } = {}) {
    this.names = names;
    this.model = model; this.offset = offset; this.source = source;
    this.ids = new Map();
    for (const [i, s] of names.entries()) {
      // a name given twice (a long name cut to the record) is ambiguous: refused at its lookup
      this.ids.set(s, this.ids.has(s) ? -1 : i);
    }
  }
  get count() { return this.names.length; }
  name(id) { return Number.isInteger(id) && id >= 0 && id < this.names.length ? this.names[id] : null; }
  id(name) {
    const i = this.ids.get(name);
    if (i === undefined) throw new SettingNameError(`${this.model ?? 'this body'} has no setting named ${name} (its table: ${this.names.length} names, ids 0..${this.names.length - 1})`);
    if (i < 0) throw new SettingNameError(`${this.model ?? 'this body'}'s table names ${name} more than once`);
    return i;
  }
  // a setting given by id (decimal or 0x) or by name: {id, name}; name null for an id past the table
  resolve(text) {
    const s = String(text);
    if (/^(?:\d+|0x[0-9a-fA-F]+)$/.test(s)) {
      const id = Number(s);
      if (id > 0xffff) throw new SettingNameError(`setting ${s}: an id is 0..65535`);
      return { id, name: this.name(id) };
    }
    return { id: this.id(s), name: s };
  }
}
