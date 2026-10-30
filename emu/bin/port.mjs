#!/usr/bin/env node
// Port the lab to another camera's firmware: translate every E143 address the lab names to the same code or data in the
// other build (the cross-build map src/fw/xmap.mjs, its placement src/fw/place.mjs), write the model's address table
// into src/fw/ports.mjs (read at run time by A() in src/fw/model.mjs), and write
// emu/out/port/<MODEL>/{port.json,rev.bin}. An address the map cannot place becomes null in src/fw/ports.mjs
// (UNMAPPED(0x...), which src/lab refuses when it is used) and is listed in port.json with every place it occurs;
// src/fw/models.mjs's `overrides` place such an address by hand, each with its evidence. It also runs the rules of
// src/fw/facts.mjs on the model's firmware and writes what they read as src/fw/ports.mjs FACTS[MODEL] (src/fw/board.mjs
// BOARD, fact() in src/fw/model.mjs).
//   node emu/bin/port.mjs E147
//   node emu/bin/port.mjs E139 E134       several bodies in one process, in the order given
//   node emu/bin/port.mjs all             every model but E143, in src/fw/models.mjs's order
// The refresh after a change to the rules, src/lab or the overrides is `all`: one process shares what a run per body
// redoes (E143's image and seeds, each body's firmware and rules, a reference's chained port, a map's answers and the
// images' scans) and writes what one run per body writes, byte for byte. For the 17 bodies with every map from the
// cache it takes 52 s and 3.4 GB of memory, one run per body 119 s (X, 2026-10-20; 247 s before the placement and the
// rules shared their scans).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildMap, CODE_BASE } from '../src/fw/xmap.mjs';
import { seedsFor, placer, pairedTwice, carryOverrides, fillUnplaced } from '../src/fw/place.mjs';
import { KNOBS, knobAddresses, carryKnob } from '../src/fw/knobs.mjs';
import { MODELS, romPath, resPath } from '../src/fw/models.mjs';
import { resPrefix } from '../src/fw/resprefix.mjs';
import { loadAddress } from '../src/lab/resources.mjs';
import { expandImage } from '../src/fw/expand.mjs';
import { boardOf } from '../src/fw/board.mjs';
import { imageBase, resLoader, readFacts, readPlacedFacts, rulePlaces, placedRulePlaces, alias } from '../src/fw/facts.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const EMU = path.join(REPO, 'emu');
const PORTS_FILE = path.join(EMU, 'src', 'fw', 'ports.mjs');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const say = (s) => process.stderr.write(`port: ${s}\n`);
const PORTED = Object.keys(MODELS).filter((k) => k !== 'E143');
const codes = process.argv.length === 3 && process.argv[2] === 'all' ? PORTED : process.argv.slice(2);
if (!codes.length || codes.some((c) => !PORTED.includes(c)) || new Set(codes).size !== codes.length) {
  process.stderr.write(`port: usage: port.mjs MODEL... | all (each one of ${PORTED.join(', ')}, once)\n`); process.exit(2);
}

const A = fs.readFileSync(path.join(REPO, romPath(MODELS.E143)));
if (sha(A) !== MODELS.E143.rom_sha256) throw new Error('unpacked/E143 is not the E143 main code block');
const resA = fs.readFileSync(path.join(REPO, resPath(MODELS.E143)));
// the run-time bases (src/fw/models.mjs image_base), each checked against its reset head's jump (here and in body()):
// E143's literals are classified at E143's, every address written for the model is at the model's
const BASE_A = MODELS.E143.image_base;
const checkBase = (c, img, base) => {
  const r = imageBase(img);
  if (r.base !== base) throw new Error(`${c}: src/fw/models.mjs image_base 0x${base.toString(16)}, the reset head's jump at 0x${(CODE_BASE + r.at).toString(16)} gives 0x${r.base.toString(16)}`);
};
checkBase('E143', A, BASE_A);
const loaderA = resLoader(A, loadAddress(resA));

// A body's firmware as the port reads it: its main block (checked against its digest and its base), the facts the
// rules of src/fw/facts.mjs read from it (readFacts, on the block expanded in place: src/fw/ports.mjs FACTS[code]), its
// resource loader's slots and image-record destinations paired with E143's in both DRAM views (place(), how
// 'res-loader'; port.json res_loader_vs_map lists where the map alone answers otherwise), the other E143 addresses a
// rule places (rulePairs: src/fw/facts.mjs rulePlaces; the placed rules add theirs below), and its run-time image, the
// one the maps pair (the code as it runs: its preload rows at their run-time addresses).
const bodies = new Map();
function body(c) {
  if (bodies.has(c)) return bodies.get(c);
  const m = MODELS[c], raw = fs.readFileSync(path.join(REPO, romPath(m)));
  if (sha(raw) !== m.rom_sha256) throw new Error(`${romPath(m)} is not ${c}'s main code block (BLOBS.sha256)`);
  checkBase(c, raw, m.image_base);
  const res = fs.readFileSync(path.join(REPO, resPath(m))), board = boardOf(c);
  const img0 = expandImage(new Uint8Array(raw), { base: m.image_base, preload: [] });
  const facts = readFacts({ img: img0, family: board, resLoad: loadAddress(res) });
  const lb = resLoader(img0, loadAddress(res)), loaderPairs = new Map();
  for (const [va, vb] of [[loaderA.font.slot, lb.font.slot], [loaderA.images.first, lb.images.first],
    [loaderA.images.last, lb.images.last], [loaderA.string.slot, lb.string.slot]]) {
    loaderPairs.set(va, vb).set(alias(va), alias(vb));
  }
  const rulePairs = rulePlaces(facts);
  const img = Buffer.from(expandImage(new Uint8Array(raw), { base: m.image_base, preload: facts.board?.preload ?? board.preload }));
  const b = { code: c, base: m.image_base, res, board, facts, loaderPairs, rulePairs, img };
  bodies.set(c, b);
  return b;
}

// the source files to port, and every 32-bit hex literal in them
const SRC_DIRS = ['src', 'bin', 'host', 'scenarios', 'web', 'checks', 'refs', 'test'];
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'out' && e.name !== 'node_modules' && e.name !== '__pycache__') walk(p); } else files.push(p); } };
for (const d of SRC_DIRS) if (fs.existsSync(path.join(EMU, d))) walk(path.join(EMU, d));
for (const f of fs.readdirSync(EMU)) { const p = path.join(EMU, f); if (fs.statSync(p).isFile()) files.push(p); }
const LIT = /\b0x([0-9a-fA-F]{8})\b/g;
const lits = new Set();
// src/util holds no firmware addresses (its constants, sha256's among them, only look like some)
// nor do the board and the CPU (their constants are the address map's own: the regions, the reset and vector bases)
const ported = (rel) => rel.startsWith(`src${path.sep}`) && !rel.startsWith(`src${path.sep}util${path.sep}`) &&
  !rel.startsWith(`src${path.sep}core${path.sep}`) && rel !== path.join('src', 'machine.mjs') &&
  !rel.startsWith(`src${path.sep}fw${path.sep}`);                // the models' own values, the unpacker, the map
const portedText = files.filter((f) => f.endsWith('.mjs') && ported(path.relative(EMU, f))).map((f) => [path.relative(EMU, f), fs.readFileSync(f, 'utf8')]);
for (const [, t] of portedText) for (const m of t.matchAll(LIT)) lits.add(parseInt(m[1], 16) >>> 0);
const { seeds, entries } = seedsFor(A, BASE_A, lits);

// A map depends only on its two images, their bases, its seeds and xmap.mjs: cached under emu/out/port-cache as
// <name>-<key>.json (a re-port after a change to the lab or the overrides skips the minutes the walks take). The
// seeds keep the lab literals' order of first occurrence (the file walk, then the text), so a change to src/ that
// moves one literal's first occurrence ahead of another's also changes the key, with the same literal set (X:
// a comment of the K-CRT-134D change in src/lab/menu.mjs did, until the order was restored).
function cachedMap(name, a, b, baseA, baseB, mapSeeds) {
  const key = sha(Buffer.concat([Buffer.from(sha(a) + sha(b) + JSON.stringify([baseA, baseB, mapSeeds])), fs.readFileSync(new URL('../src/fw/xmap.mjs', import.meta.url))]));
  const file = path.join(EMU, 'out', 'port-cache', `${name}-${key.slice(0, 16)}.json`);
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const maps = (rows) => new Map(rows.map(([k, m]) => [k, new Map(m)]));
    say(`map ${name} from the cache`);
    return { code: new Int32Array(Buffer.from(j.code, 'base64').buffer.slice(0)), data: maps(j.data), calls: maps(j.calls), ext: maps(j.ext), stats: j.stats };
  }
  const t0 = Date.now();
  const m = buildMap(a, b, { baseA, baseB, seeds: mapSeeds, log: say });
  say(`map ${name} built in ${Math.round((Date.now() - t0) / 1000)} s`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = (mm) => [...mm].map(([k, v]) => [k, [...v]]);
  fs.writeFileSync(file, JSON.stringify({ code: Buffer.from(m.code.buffer, m.code.byteOffset, m.code.byteLength).toString('base64'), data: rows(m.data), calls: rows(m.calls), ext: rows(m.ext), stats: m.stats }));
  return m;
}
// E143 -> a body, seeded with the lab's literals
const directMaps = new Map();
const directMap = (c) => directMaps.get(c) ?? directMaps.set(c, cachedMap(c, A, body(c).img, BASE_A, body(c).base, seeds)).get(c);
const ownOverrides = (c) => new Map(Object.entries(MODELS[c].overrides ?? {}).map(([k, v]) => [parseInt(k, 16) >>> 0, v]));

// A chained port (MODELS port_via: a reference body ported before, whose hand overrides and knobs carry over): a
// body's effective overrides are its own and, with a reference, the reference's effective overrides carried through the
// map from the reference to the body (src/fw/place.mjs carryOverrides; recursive, so a reference may have its own).
// That map is seeded with the reference's override targets and knob addresses, not the lab's literals, so a change to
// the lab leaves its cache key as it is. effective(c): E143 address -> {to: number or null, how, fact?}; knobsOf(c):
// knob -> value, its own (MODELS) and those its `carry` lists, taken from the reference's (src/fw/knobs.mjs carryKnob,
// which throws where a check fails); then the lab literals the direct map leaves unplaced take the reference's own map
// answers through that map (src/fw/place.mjs fillUnplaced); chains[c]: the carry's report. Each is found once per body
// (effs) and kept for the bodies ported after it in the same process.
const chains = new Map(), effs = new Map();
const knobsOf = (c) => {
  const own = Object.fromEntries(Object.keys(KNOBS).filter((k) => MODELS[c][k] !== undefined).map((k) => [k, MODELS[c][k]]));
  return { ...own, ...(chains.get(c)?.knobs ?? {}) };
};
function effective(c) {
  if (effs.has(c)) return effs.get(c);
  const own = ownOverrides(c), eff = new Map([...own].map(([v, o]) => [v, { to: o.to === null ? null : parseInt(o.to, 16) >>> 0, how: 'override', fact: o.fact }]));
  const R = MODELS[c].port_via, carry = MODELS[c].carry ?? [];
  if (!R) { if (carry.length) throw new Error(`${c}: src/fw/models.mjs carry without port_via`); effs.set(c, eff); return eff; }
  if (!Object.hasOwn(MODELS, R) || R === 'E143' || R === c) throw new Error(`${c}: src/fw/models.mjs port_via ${JSON.stringify(R)} is not another ported model`);
  const ref = effective(R), refKnobs = knobsOf(R), rb = body(R), tb = body(c);
  for (const k of carry) {
    if (!Object.hasOwn(KNOBS, k)) throw new Error(`${c}: src/fw/models.mjs carry ${k}: not a knob that carries (src/fw/knobs.mjs KNOBS)`);
    if (MODELS[c][k] !== undefined) throw new Error(`${c}: src/fw/models.mjs gives ${k} by hand and carries it from ${R}`);
    if (refKnobs[k] === undefined) throw new Error(`${c}: src/fw/models.mjs carry ${k}: ${R} has no ${k}`);
  }
  const legAddrs = [...new Set([...[...ref.values()].filter((o) => o.to !== null).map((o) => o.to),
    ...Object.entries(refKnobs).flatMap(([k, v]) => knobAddresses(k, v))])].sort((x, y) => x - y);
  const leg = seedsFor(rb.img, rb.base, legAddrs);
  const legMap = cachedMap(`${R}-${c}`, rb.img, tb.img, rb.base, tb.base, leg.seeds);
  const legP = placer({ a: rb.img, b: tb.img, baseA: rb.base, baseB: tb.base, map: legMap, entries: leg.entries });
  const dirP = placer({ a: A, b: tb.img, baseA: BASE_A, baseB: tb.base, map: directMap(c), entries });
  const refOverrides = new Map([...ref].filter(([v]) => !own.has(v)));
  const r = carryOverrides({ overrides: refOverrides, leg: legP.mapPlace, direct: dirP.mapPlace, factsRef: rb.facts, factsTgt: tb.facts });
  const knobs = Object.fromEntries(carry.map((k) => [k, carryKnob(k, refKnobs[k], { a: rb.img, b: tb.img, map: legMap, mapPlace: legP.mapPlace })]));
  const refDirect = placer({ a: A, b: rb.img, baseA: BASE_A, baseB: rb.base, map: directMap(R), entries }).mapPlace;
  const f = fillUnplaced({ addrs: lits, skip: new Set([...own.keys(), ...ref.keys()]), leg: legP.mapPlace, direct: dirP.mapPlace, refDirect });
  chains.set(c, { ref: R, map: legMap.stats, report: { ...r.report, filled: f.report }, knobs });
  for (const [v, o] of r.carried) eff.set(v, o);
  for (const [v, o] of f.filled) eff.set(v, o);
  effs.set(c, eff);
  return eff;
}

// src/fw/ports.mjs as it is, each body's entries replaced as it is ported
let ports = {}, allFacts = {}, allKnobs = {};
if (fs.existsSync(PORTS_FILE)) {
  const mod = await import(new URL(`file://${PORTS_FILE}?t=${Date.now()}`).href);
  ports = { ...mod.PORTS };
  allFacts = { ...mod.FACTS };
  allKnobs = { ...mod.KNOBS };
}
const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
// a FACTS value as a literal: numbers in hex, arrays and objects on one line
const lit = (v) => (typeof v === 'number' ? '0x' + (v >>> 0).toString(16) : Array.isArray(v) ? `[${v.map(lit).join(', ')}]`
  : v !== null && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${lit(x)}`).join(', ')} }` : JSON.stringify(v));
function writePorts() {
  const portLines = [
    '// Cross-build address tables for ported models (generated by bin/port.mjs; read by A() in src/fw/model.mjs).',
    '// Each model maps E143 32-bit addresses that move to the model\'s address, or null when unmapped (UNMAPPED).',
    '// FACTS[model]: what src/fw/facts.mjs reads from its firmware (the parts: readFacts and readPlacedFacts there;',
    '// src/fw/board.mjs, fact()). KNOBS[model]: the knobs it carries from its reference (src/fw/models.mjs port_via,',
    '// carry; src/fw/knobs.mjs), read through knob().',
    'export const PORTS = {',
  ];
  for (const [mCode, tbl] of Object.entries(ports)) {
    const entries = Object.entries(tbl).sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => `${hex(Number(k))}: ${v === null ? 'null' : hex(v)}`);
    portLines.push(`  ${mCode}: {`);
    for (let i = 0; i < entries.length; i += 4) portLines.push(`    ${entries.slice(i, i + 4).join(', ')},`);
    portLines.push('  },');
  }
  portLines.push('};', 'export const FACTS = {');
  for (const [mCode, f] of Object.entries(allFacts)) portLines.push(`  ${mCode}: ${lit(f)},`);
  portLines.push('};', 'export const KNOBS = {');
  for (const [mCode, k] of Object.entries(allKnobs)) portLines.push(`  ${mCode}: ${lit(k)},`);
  portLines.push('};', '');
  fs.writeFileSync(PORTS_FILE, portLines.join('\n'));
}
// region constants of the address map itself, never translated: the notation's base, E143's run-time base (the lab
// uses IMAGE_BASE, src/fw/model.mjs), the two DRAM views
const FIXED = new Set([CODE_BASE, BASE_A, 0x60000000, 0xa0000000]);

// One body's port: its PORTS, FACTS and KNOBS entries, and emu/out/port/<code>. The placed rules add to copies of the
// body's facts and rule pairs, which a later body's chained port reads as the reference's (body()).
function port(code) {
  const M = MODELS[code], OUT = path.join(EMU, 'out', 'port', code);
  const { res, loaderPairs, img: B, base: BASE_B, board: BOARD_B } = body(code);
  const facts = { ...body(code).facts }, rulePairs = new Map(body(code).rulePairs);
  const map = directMap(code);
  for (const h of (process.env.PORT_DEBUG ?? '').split(',').filter(Boolean)) { const v = parseInt(h, 16) >>> 0; say(`votes ${h}: ${JSON.stringify([...(map.data.get(v) ?? new Map())].map(([k, n]) => [k.toString(16), n]))}`); }
  // The other build's value of an E143 literal: {to, how} or null (not an address of the image or the DRAM), or
  // {to: null} (an address that could not be placed): src/fw/place.mjs
  const overrides = ownOverrides(code);
  const carried = new Map([...effective(code)].filter(([v]) => !overrides.has(v)));
  const chain = chains.get(code) ?? null;
  const { place, mapPlace } = placer({ a: A, b: B, baseA: BASE_A, baseB: BASE_B, map, entries, scratch: BOARD_B.scratch, loaderPairs, rulePairs, overrides, carried });
  // the rules that read code relative to an E143 function, at its place here (src/fw/facts.mjs readPlacedFacts), and the
  // E143 addresses they place (src/fw/facts.mjs placedRulePlaces)
  Object.assign(facts, readPlacedFacts({ img: B, at: (v) => place(v)?.to ?? null }));
  for (const [v, p] of placedRulePlaces(facts, A, place)) rulePairs.set(v, p);
  // A fact the MODELS entry also gives by hand must agree with the rule; the lab then refuses it given both ways, so its
  // hand copy is to be deleted (listed at the end).
  const handGiven = [];
  for (const [part, read] of Object.entries(facts)) {
    for (const [k, v] of Object.entries(read ?? {})) {
      if (!Object.hasOwn(M[part] ?? {}, k)) continue;
      if (JSON.stringify(M[part][k]) !== JSON.stringify(v)) throw new Error(`${code}: src/fw/models.mjs ${part}.${k} ${JSON.stringify(M[part][k])}, src/fw/facts.mjs reads ${JSON.stringify(v)}`);
      handGiven.push(`${part}.${k}`);
    }
  }
  const table = new Map(), unmapped = new Map();
  for (const v of lits) {
    if (FIXED.has(v)) continue;
    const p = place(v); if (!p) continue;
    if (p.to === null) unmapped.set(v, []); else table.set(v, p);
  }
  // count A(0x...) sites in src/ and record unmapped locations
  let replaced = 0;
  for (const [rel, text] of portedText) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/\bA\(0x([0-9a-fA-F]{8})\)/g)) {
        const v = parseInt(m[1], 16) >>> 0;
        if (table.has(v)) replaced++;
        else if (unmapped.has(v)) unmapped.get(v).push(`${rel}:${i + 1}`);
      }
    }
  }
  // update src/fw/ports.mjs (every other model's PORTS, FACTS and KNOBS are kept as they are)
  const modelPort = {};
  for (const v of [...lits].sort((a, b) => a - b)) {
    if (table.has(v) && table.get(v).to !== v) modelPort[v] = table.get(v).to;
    else if (unmapped.has(v)) modelPort[v] = null;
  }
  ports[code] = modelPort;
  allFacts[code] = facts;
  if (chain && Object.keys(chain.knobs).length) allKnobs[code] = chain.knobs; else delete allKnobs[code];
  writePorts();

  fs.mkdirSync(OUT, { recursive: true });
  const report = {
    model: code, name: M.name, generated_from: 'emu/', map: map.stats, literals: lits.size, translated: table.size, replaced_sites: replaced,
    res_prefix_sha256: sha(resPrefix(res)),
    unmapped: [...unmapped].map(([v, at]) => ({ e143: '0x' + v.toString(16), at })).filter((u) => u.at.length),
    kept: [...table].filter(([, p]) => p.how === 'kept').map(([v]) => '0x' + v.toString(16)),
    by_how: [...table.values()].reduce((o, p) => { o[p.how] = (o[p.how] ?? 0) + 1; return o; }, {}),
  };
  // several E143 addresses placed at one model address (information: the walks, tablePlace and the votes can answer so
  // where a rebuild merged two objects, or wrongly; E146 maps three of E143's MM constructors to one, X)
  {
    const by = new Map();
    for (const [v, p] of table) { let l = by.get(p.to); if (!l) by.set(p.to, l = []); l.push([v, p.how]); }
    report.collisions = [...by].filter(([, l]) => l.length > 1).sort((x, y) => x[0] - y[0])
      .map(([to, l]) => ({ to: hex(to), e143: l.map(([v, how]) => `${hex(v)} (${how})`) }));
  }
  // the loader's pairs the map alone would place elsewhere or not at all (information: the res-loader answer is the
  // firmware's own, read by resLoader; a disagreement names map entries near it to doubt)
  report.res_loader_vs_map = [...loaderPairs].filter(([va]) => lits.has(va) && !FIXED.has(va)).map(([va, vb]) => [va, vb, mapPlace(va)])
    .filter(([, vb, m]) => (m?.to ?? null) !== vb).map(([va, vb, m]) => ({ e143: hex(va), res_loader: hex(vb), map: m?.to == null ? null : hex(m.to), how: m?.how ?? null }));
  // the overrides to an address that the map alone places there too (information: such an override can go)
  report.overrides_the_map_places = [...overrides].filter(([v, o]) => o.to !== null && lits.has(v) && mapPlace(v)?.to === (parseInt(o.to, 16) >>> 0))
    .map(([v, o]) => ({ e143: hex(v), to: o.to, how: mapPlace(v).how }));
  // the overrides to an address that a rule places there too (rulePairs, loaderPairs; an override wins in place(), so
  // the rule never answers there; information: such an override can go)
  const rulePlace = (v) => (loaderPairs.has(v) ? { to: loaderPairs.get(v), how: 'res-loader' } : rulePairs.get(v) ?? null);
  report.overrides_a_rule_places = [...overrides].filter(([v, o]) => o.to !== null && rulePlace(v)?.to === (parseInt(o.to, 16) >>> 0))
    .map(([v, o]) => ({ e143: hex(v), to: o.to, how: rulePlace(v).how }));
  // a chained port's carried overrides (src/fw/place.mjs carryOverrides), the lab's literals only: carried (the
  // reference's address, the target's, how leg 2 placed it, the direct map's answer where it differs), carry_failed
  // (unplaced, or the direct answer when to is not null) and ref_null_gated (the direct map answers)
  if (chain) {
    const pl = (p) => (p ? { to: p.to === null ? null : hex(p.to), how: p.how ?? null } : null);
    const mine = (l) => l.filter((x) => lits.has(x.v));
    report.port_via = { ref: chain.ref, map: chain.map };
    report.carried = mine(chain.report.carried).map((x) => ({ e143: hex(x.v), ref: x.ref === null ? null : hex(x.ref), to: x.to === null ? null : hex(x.to), how: x.how, ...(x.direct ? { direct: pl(x.direct) } : {}) }));
    report.carry_failed = mine(chain.report.carry_failed).map((x) => ({ e143: hex(x.v), ref: hex(x.ref), leg: pl(x.leg), direct: pl(x.direct), to: x.to === null ? null : hex(x.to) }));
    report.ref_null_gated = mine(chain.report.ref_null_gated).map((x) => ({ e143: hex(x.v), fact: x.fact, ref: x.ref, target: x.target, direct: pl(x.direct) }));
    report.filled = mine(chain.report.filled).map((x) => ({ e143: hex(x.v), ref: hex(x.ref), to: hex(x.to), how: x.how }));
  }
  // the flash-resident library (outside the image, so the lab hooks what it uses): the run-time targets of the paired
  // out-of-image calls in each build (map.ext), with their counts, those paired at least twice (inExt's rule)
  {
    const lib = [];
    for (const [ta, m] of map.ext) if (pairedTwice(m)) for (const [tb, n] of m) lib.push([ta, tb, n]);
    report.flash_library = lib.sort((x, y) => x[0] - y[0] || y[2] - x[2]).map(([ta, tb, n]) => `${hex(ta)} -> ${hex(tb)} x${n}`);
  }
  fs.writeFileSync(path.join(OUT, 'port.json'), JSON.stringify(report, null, 1));
  // the reverse code map (b offset -> a offset), for looking up a model address the ported lab meets (bin/xwhere.mjs)
  {
    const rev = new Int32Array(B.length).fill(-1);
    for (let o = 0; o < map.code.length; o++) if (map.code[o] >= 0 && rev[map.code[o]] === -1) rev[map.code[o]] = o;
    fs.writeFileSync(path.join(OUT, 'rev.bin'), new Uint8Array(rev.buffer));
  }
  say(`${code}: ${table.size} addresses translated (${JSON.stringify(report.by_how)}), ${replaced} A() sites; ${report.unmapped.length} unmapped used in code, ${report.collisions.length} collisions, ${report.res_loader_vs_map.length} res-loader pairs the map places otherwise (emu/out/port/${code}/port.json)`);
  say(`${code}: FACTS ${lit(facts)}`);
  if (chain && Object.keys(chain.knobs).length) say(`${code}: knobs carried from ${chain.ref}: ${lit(chain.knobs)}`);
  if (chain) say(`${code}: through ${chain.ref} (port_via): ${report.carried.length} of its overrides carried (${report.carried.filter((x) => x.to === null).length} nulls), ${report.carry_failed.length} failed, ${report.ref_null_gated.length} nulls gated by a fact (port.json carried, carry_failed, ref_null_gated); ${report.filled.length} unplaced addresses filled from its map (port.json filled)`);
  if (report.overrides_the_map_places.length) say(`${code}: the map now places ${report.overrides_the_map_places.length} overrides as they are (port.json overrides_the_map_places): their hand copies can go`);
  if (report.overrides_a_rule_places.length) say(`${code}: a rule places ${report.overrides_a_rule_places.length} overrides as they are (port.json overrides_a_rule_places): their hand copies can go`);
  if (handGiven.length) say(`${code}: ${handGiven.join(', ')} now read from the firmware (src/fw/ports.mjs FACTS): delete them from src/fw/models.mjs, the lab refuses a fact given both ways`);
}

// each body in turn; a direct map is kept (with its answers, src/fw/place.mjs placer) while a body still to port is
// its own or ports through it (port_via; a reference's chained port, once found, is kept in effs and chains)
for (const [i, c] of codes.entries()) {
  port(c);
  const rest = codes.slice(i + 1);
  for (const k of directMaps.keys()) if (!rest.some((r) => r === k || MODELS[r].port_via === k)) directMaps.delete(k);
}
