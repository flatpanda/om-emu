// The offline decoder of the OM-1 (E143 v1.9) settings store (defaults, descriptors, property
// slots), the independent reference check_nav and check_menu compare the firmware's own getter with. It reads the
// main block only (passed in as bytes: refs/ has no file access) and imports only refs/ (test_pure.mjs). The getter
// model, its evidence and what is refused are documented below at each method.
// Injected: sha256 (bytes -> hex) for table_digest. Dicts keyed by an int are Maps,
// in insertion order.
import { ValueError } from './errors.mjs';

export const RT = 0x60021020;                       // E143's image base: this reference reads the E143 v1.9 block only
export const DEFAULT_TABLES = [[0, 2128, 0x605F9200], [10000, 10111, 0x605FB344], [15000, 15287, 0x605FB504]];
export const REGION_TABLE = 0x605FE664, REGION_PROPERTY = 4508, SPECIAL_CELL_ID = 6000;
export const KEY_SELECTORS = new Map([[0x603E68BB, 64], [0x603E68D9, 141]]);
export const DESCRIPTORS = 0x60615DE4, N_DESCRIPTORS = 1607, CUSTOM = 0x605C4680, N_CUSTOM = 262;
export const OBJECT_LISTS = [['image', 0x600979E0], ['F', 0x600BCACC], ['B', 0x6009796C], ['E', 0x600BEF30], ['M', 0x600E603C]];
export const DEFAULTS_DIGEST = 'f9963ec77a430381caac0b28fc22ebfef2d118957d5bbae2ebfff8b9e9b742f3';
export const SPOT = new Map([[21, 0], [32, 60], [115, 240], [161, 255], [179, 350], [360, 0], [425, 1], [450, 2], [773, 0], [1037, 60],
  [1072, 255], [1095, 1], [1129, 0], [1130, 0], [1131, 0], [1133, 0], [1400, 0], [2030, 0], [2031, 0], [1881, 1], [1882, 1], [1914, 1],
  [1915, 1], [1916, 1], [1917, 1], [1918, 1], [1919, 1], [3009, 1]]);

// SettingsError (a ValueError): the checks catch it as refs.S.SettingsError.
export class SettingsError extends ValueError {}
const err = (m) => new SettingsError(m);
const hex = (v) => (v >>> 0).toString(16);
const h8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
// The text of the small values the messages and the default table's digest hold (ints, null, arrays of them), as
// src/util/show.mjs writes them (refs/ imports only refs/): [a, b] with ', ' between items.
const show = (v) => (v === null || v === undefined ? 'null' : Array.isArray(v) ? `[${v.map(show).join(', ')}]` : String(v));

export class Settings {
  constructor(image, { sha256 = null } = {}) {
    this.d = image;
    this.sha256 = sha256;
    this.descriptors = new Map();
    for (let i = 0; i < N_DESCRIPTORS; i++) {
      const a = DESCRIPTORS + 20 * i, o = a - RT;
      const sid = this.u16(a), key2 = this.u16(a + 2), data = this.u32(a + 4), table = this.u32(a + 8);
      const nbytes = this.u16(a + 12), esize = this.u16(a + 14), b16 = this.d[o + 16], dtype = this.d[o + 17];
      if (!this.descriptors.has(sid)) this.descriptors.set(sid, []);
      this.descriptors.get(sid).push({ address: a, key2, data, table, bytes: nbytes, elem: esize, b16, type: dtype });
    }
    this.custom = new Map();
    for (let i = 0; i < N_CUSTOM; i++) {
      const a = CUSTOM + 60 * i;
      this.custom.set(this.u16(a), { address: a, getter: this.u32(a + 20), callback: this.u32(a + 24), setter: this.u32(a + 52) });
    }
    this.objects = new Map();
    this.duplicates = [];
    for (const [name, base] of OBJECT_LISTS) {
      for (const [index, obj] of this.parse_list(base)) {
        if (this.objects.has(index)) this.duplicates.push([index, this.objects.get(index).list, name]);
        this.objects.set(index, { ...obj, list: name });
      }
    }
  }
  // ---- image access
  u16(a) { const o = a - RT; return this.d[o] | this.d[o + 1] << 8; }
  u32(a) { const o = a - RT; return (this.d[o] | this.d[o + 1] << 8 | this.d[o + 2] << 16 | this.d[o + 3] << 24) >>> 0; }
  // ---- data objects
  // Element width: kind & 3, 0 -> 4 (0x5003f78d).
  static width(kind) { return (kind & 3) || 4; }
  // 0x50041e7a: (kind & 7) == 4 -> u32, == 2 -> u16, else u8; bit 3 of the kind selects the sign-extending loads.
  static read_elem(kind, data, index) {
    const t = kind & 7;
    let v, bits;
    if (t === 4) { const o = 4 * index; v = (data[o] | data[o + 1] << 8 | data[o + 2] << 16 | data[o + 3] << 24) >>> 0; bits = 32; }
    else if (t === 2) { const o = 2 * index; v = data[o] | data[o + 1] << 8; bits = 16; }
    else { v = data[index]; bits = 8; }
    if (kind & 8 && t !== 4 && v >> (bits - 1)) v -= 2 ** bits;
    return v;
  }
  // Map object index -> {kind, count, data} of a list {u16 kind, u16 count, data[count * width]}, 4-aligned, kind 0 ends it.
  parse_list(base) {
    const out = new Map();
    for (let a = base; ;) {
      const kind = this.u16(a), count = this.u16(a + 2);
      if (kind === 0) return out;
      const n = count * Settings.width(kind);
      out.set(kind >> 4, { kind, count, data: this.d.subarray(a + 4 - RT, a + 4 + n - RT) });
      a = (a + 4 + n + 3) & ~3;
    }
  }
  // [kind, index] of a property id (0x503ee4f0 / 0x503ee740), or null outside the mapped ranges (id 6000: its own cell).
  slot(sid) {
    if (sid >= 0 && sid <= 2128) return [this.u16(0x606217E4 + 4 * sid), this.u16(0x606217E6 + 4 * sid)];
    if (sid >= 3000 && sid <= 3035) { const a = 0x60623928 - 12000 + 4 * sid; return [this.u16(a), this.u16(a + 2)]; }
    if (sid >= 4000 && sid <= 4022) return [this.u16(0x606239E4 - 8000 + 2 * sid), 0];
    if (sid >= 4500 && sid <= 4521) return [this.u16(0x606239B8 - 9000 + 2 * sid), 0];
    if (sid >= 10000 && sid <= 10111) { const a = 0x60623A12 - 40000 + 4 * sid; return [this.u16(a), this.u16(a + 2)]; }
    if (sid >= 15000 && sid <= 15287) { const a = 0x60623BD2 - 60000 + 4 * sid; return [this.u16(a), this.u16(a + 2)]; }
    return null;
  }
  // Element value of the id in its image list (what the registry holds before the DB init).
  template(sid) {
    const m = this.slot(sid);
    if (!m || !m[0]) throw err(`${sid}: no property slot`);
    const [kind, index] = m;
    const obj = this.objects.get(kind >> 4);
    if (obj === undefined || index >= obj.count) throw err(`${sid}: data object ${kind >> 4} (kind 0x${hex(kind)}) index ${index} in no image list`);
    return Settings.read_elem(kind, obj.data, index);
  }
  // ---- defaults (0x503da453, 0x503d9bf3)
  default_table(sid) {
    for (const [lo, hi, base] of DEFAULT_TABLES) if (lo <= sid && sid <= hi) return this.u32(base + 4 * (sid - lo));
    return null;
  }
  region_rows() {
    const out = [];
    for (let a = REGION_TABLE; ; a += 12) {
      const region = this.u16(a), n = this.u16(a + 2), ids = this.u32(a + 4), values = this.u32(a + 8);
      out.push({ region, entries: range(0, n).map((i) => [this.u16(ids + 2 * i), this.u32(values + 4 * i)]) });
      if (region === 0) return out;
    }
  }
  // The first row whose region equals the value, else the terminator row (region 0).
  region_row(region) {
    const rows = this.region_rows();
    return rows.find((x) => x.region === region) ?? rows.at(-1);
  }
  // The override of sid if every row (incl. the terminator) sets it to the same value.
  region_value(sid) {
    const values = [];
    for (const row of this.region_rows()) {
      let v = null;
      for (const [k, x] of row.entries) if (k === sid) v = x;       // dict(entries).get(sid): the last entry wins
      if (!values.includes(v)) values.push(v);
    }
    if (values.length === 1 && values[0] === null) return null;
    if (values.length !== 1) throw err(`${sid}: region rows disagree ${show(values)}: property 4508 needed`);
    return values[0];
  }
  // What the property read returns after the property set stored raw: element width and sign.
  stored(sid, raw) {
    if (sid === SPECIAL_CELL_ID) return raw & 0xFFFF;
    const m = this.slot(sid);
    if (!m || !m[0]) return 0;
    const [kind, index] = m;
    const obj = this.objects.get(kind >> 4);
    if (obj === undefined || index >= obj.count) throw err(`${sid}: data object ${kind >> 4} in no image list: what the store holds is not modelled`);
    const w = Settings.width(kind), t = kind & 7;
    if (!((w === 4 && t === 4) || (w === 2 && t === 2)) && !(w === 1 && t !== 2 && t !== 4)) throw err(`${sid}: kind 0x${hex(kind)}: element width ${w} with read type ${t}: not modelled`);
    const data = new Uint8Array(4 * (index + 1));
    const v = Number(BigInt(raw) & ((1n << BigInt(8 * w)) - 1n));
    for (let k = 0; k < w; k++) data[w * index + k] = Math.floor(v / 2 ** (8 * k)) & 255;
    return Settings.read_elem(kind, data, index) >>> 0;
  }
  // [raw property value after the reset and the region overrides, derivation].
  raw_default(sid) {
    const rv = this.region_value(sid);
    if (rv !== null) return [this.stored(sid, rv), `region override 0x${h8(REGION_TABLE)}`];
    const d = this.default_table(sid);
    if (d === null) throw err(`${sid}: no default table entry and no region override`);
    return [this.stored(sid, d), 'default table'];
  }
  // ---- descriptors and the getter (0x503c5c26, 0x503da5dc)
  // The record the firmware's lookup 0x503da999 returns: the first record for the id in table order.
  descriptor(sid) {
    const ds = this.descriptors.get(sid);
    return ds && ds.length ? ds[0] : null;
  }
  // [function (disassembly), property] of the id's custom-object key selector (+20), or null.
  key_selector(sid) {
    const c = this.custom.get(sid);
    if (!c || !c.getter) return null;
    if (!KEY_SELECTORS.has(c.getter)) throw err(`${sid}: custom object +20 0x${h8(c.getter)} is not a known key selector`);
    return [c.getter - RT + 0x50000000, KEY_SELECTORS.get(c.getter)];
  }
  // Allowed-value list (descriptor +4, count = +12 / +14, element u8 or u16 by +14; 0x503da696).
  allowed(sid) {
    const d = this.descriptor(sid);
    if (d === null) return null;
    if (d.type === 6) throw err(`${sid}: group descriptor (type 6): not scalar`);
    const n = d.elem ? Math.floor(d.bytes / d.elem) : 0;
    if (d.elem === 1) return range(0, n).map((i) => this.d[d.data - RT + i]);
    if (d.elem === 2) return range(0, n).map((i) => this.u16(d.data + 2 * i));
    throw err(`${sid}: element size ${d.elem}: 0x503da696 searches none (index 0)`);
  }
  value_table(sid) {
    const d = this.descriptor(sid);
    if (d === null || !d.table) return null;
    return range(0, this.allowed(sid).length).map((i) => this.u32(d.table + 4 * i));
  }
  // Getter result for a raw property value (0x503da5dc); key-selected ids and groups raise.
  get(sid, raw) {
    const ks = this.key_selector(sid);
    if (ks) throw err(`${sid}: key selector 0x${h8(ks[0])} (property ${ks[1]}) picks the descriptor record by its +2 key (0x503da9a2): not modelled`);
    if (this.descriptor(sid) === null) return raw;
    const allowed = this.allowed(sid);
    const mask = this.descriptor(sid).elem === 1 ? 0xFF : 0xFFFF;
    let index = allowed.findIndex((v) => v === (raw & mask));
    if (index < 0) index = allowed.length;
    if (index >= allowed.length) index = 0;
    const table = this.value_table(sid);
    return table && table.length ? table[index] : raw;
  }
  // [getter value, derivation] after the blank-store init.
  default(sid) {
    const [raw, how] = this.raw_default(sid);
    return [this.get(sid, raw), how];
  }
  // True if a harness write of this id is allowed: descriptor present, not type 6, u8/u16 list.
  scalar(sid) {
    try { return this.allowed(sid) !== null; } catch (e) { if (e instanceof SettingsError) return false; throw e; }
  }
  // [sha256 of the JSON {"<id>": [raw default, "0x<kind>", index], ...} (keys sorted, ', ' and ': '), id count]
  table_digest() {
    const rows = [];
    for (const [lo, hi] of DEFAULT_TABLES) {
      for (let sid = lo; sid <= hi; sid++) {
        const m = this.slot(sid);
        rows.push([String(sid), `[${show(this.default_table(sid))}, "0x${hex(m[0])}", ${m[1]}]`]);
      }
    }
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));         // sort_keys: str order
    const text = '{' + rows.map(([k, v]) => `"${k}": ${v}`).join(', ') + '}';
    return [this.sha256(new TextEncoder().encode(text)), rows.length];
  }
}
// The self-test check_nav group 0 runs: the pinned digest, the spot values, three allowed lists, the key-selected ids,
// the property slots and the region rows.
export function self_test(s) {
  const problems = [];
  const [digest, n] = s.table_digest();
  if (n !== 2529) problems.push(`default table: ${n} ids, expected 2529`);
  if (digest !== DEFAULTS_DIGEST) problems.push(`default table digest ${digest} != pinned ${DEFAULTS_DIGEST}`);
  for (const [sid, want] of SPOT) {
    let got;
    try { [got] = s.default(sid); } catch (e) { if (!(e instanceof SettingsError)) throw e; got = `error ${e.message}`; }
    if (got !== want) problems.push(`${sid}: default ${got}, investigation read ${want}`);
  }
  const eq = (a, b) => a !== null && a.length === b.length && a.every((x, i) => x === b[i]);
  if (!eq(s.allowed(32), [0, 60, 180, 300]) || !eq(s.allowed(161), [8, 30, 60, 255]) || !eq(s.allowed(115), [0, 5, 30, 60, 240])) {
    problems.push(`allowed lists 32/161/115: ${show(s.allowed(32))} ${show(s.allowed(161))} ${show(s.allowed(115))}`);
  }
  const keyed = [...s.custom.keys()].filter((sid) => s.key_selector(sid)).sort((a, b) => a - b);
  if (!eq(keyed, [2, 3, 4, 6, 17, 86, 140, 475, 490, 491, 1667, 1668, 1669, 1670, 1671, 1672, 2089, 2090]) ||
      keyed.some((sid) => (s.descriptors.get(sid) ?? []).length < 2)) problems.push(`key-selected ids ${show(keyed)}`);
  if (s.slot(4000) === null || s.slot(4022) === null || s.slot(4023) !== null || s.slot(6000) !== null || s.stored(6000, 0x12345) !== 0x2345) {
    problems.push(`property slots 4000/4022/4023/6000: ${show(s.slot(4000))} ${show(s.slot(4022))} ${show(s.slot(4023))} ${show(s.slot(6000))}`);
  }
  const regions = s.region_rows().map((x) => x.region);
  if (!eq(regions, [1, 2, 3, 10, 8, 9, 0])) problems.push(`region rows ${show(regions)}`);
  return problems;
}
