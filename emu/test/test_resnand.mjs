// The resource tables from the NAND (src/fw/nand.mjs; src/lab/resnand.mjs H-RESINIT, S-RESNAND; docs/hle-gaps.md 4.5):
//   resnandUnits    without firmware: the NAND view of a container (each block at its head's load address as head +
//                   descrambled body + tail; reads across the head, an unaligned body tail and the tail; a range
//                   outside every block or across two answered null; overlapping blocks refused), the resource body
//                   from the lab's copy (withBody; past it refused), the index rules (nandIndex: the head's version,
//                   the entries up to an empty or erased one), the extract a browser keeps (the heads and tails, the
//                   index areas, a sub-block's index, the small records; a large record refused; its bytes and back),
//                   the sound area builder in the TG-7's format with synthesized (lab-made) WAVE files read back by the
//                   firmware's index rules (the OE head at 0x4e420000 with the area's length and flags 0x0103, entry 0
//                   at +1024, 512-aligned entries padded with zeros, the container's checksum, each WAVE's format) and
//                   its refusals, and S-RESNAND's layer on a stub session (the sound area erased, the host's image,
//                   writes and erases kept inside the guard window and refused past it, reads past the window or the
//                   image served erased up to the RAM log and passed down from there, an access across the area's
//                   bounds refused, a container read served, anything else passed down)
//   resnandSession  (firmware: E143) play sessions with env.nand (the provisioned extract): H-RESINIT's table pointers
//                   and the resource API's answers natively (res_size(0, 0) = 0xe2800, res_size(3, 0) = 0x2800,
//                   res_size(0x8000, 0) = 0x167fc00, res_version 0x01000000; the erased sound area's res_size(2, 0) =
//                   0xffffffff, version 0xffff0000, USTART_L's sound 0 load taking its error path once, its one
//                   0x1f000003 log, and a later load answered from the descriptor it left without a log); the
//                   provisioned extract the one labNand makes from the .BIN, and the whole container giving the same
//                   session; with a lab-made sound area (env.soundArea) res_size(2, i), USTART_L's sound 0 load at
//                   0xa4000000, res_read(2, 1)'s descriptor {0xa4000000, size + 1024} with the WAVE at the pointer,
//                   and the firmware's own type-2 write (0x501a98c8: an erase and two writes inside the guard window)
//                   read back by res_read; an area larger than the guard window (a 2 s sound 1) read by res_read past
//                   the image's end, erased there
//   node emu/test/test_resnand.mjs [--session]
import { walk, sum32, PERM } from '../src/fw/olyfw.mjs';
import * as N from '../src/fw/nand.mjs';
import { ResNand, ResNandError } from '../src/lab/resnand.mjs';
import { MODELS } from '../src/fw/models.mjs';

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const throwsAs = (fn, cls, re = null) => { try { fn(); return false; } catch (e) { return e instanceof cls && (!re || re.test(e.message)); } };
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// a stored OE block: head, the body scrambled per aligned 16 bytes (flags != 0), tail with the checksum
function stored(flags, body, load, ver = 0x0100) {
  const head = (cks) => {
    const h = new Uint8Array(32), dv = new DataView(h.buffer);
    h[0] = 0x4F; h[1] = 0x45; h[2] = 0x14; h[3] = 0x30;
    dv.setUint32(8, load, true); dv.setUint32(12, body.length, true); dv.setUint16(16, ver, true); dv.setUint16(20, flags, true); dv.setUint32(28, cks, true);
    return h;
  };
  const out = new Uint8Array(64 + body.length), s = out.subarray(32, 32 + body.length), n = body.length - (body.length % 16);
  if (flags) { for (let g = 0; g < n; g += 16) for (let k = 0; k < 16; k++) s[g + PERM[k]] = body[g + k] ^ 0xff; s.set(body.subarray(n), n); } else s.set(body);
  out.set(head(0), 0);
  out.set(head((-(sum32(head(0)) * 2 + sum32(body))) >>> 0), 32 + body.length);
  return out;
}
const cat = (...parts) => { const o = new Uint8Array(parts.reduce((t, p) => t + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
let seed = 7;
const noise = (n) => Uint8Array.from({ length: n }, () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; });
// an index area: a head (load, length), entries [address, size], then fill to length
function indexed(load, entries, length, records) {
  const b = new Uint8Array(length - 64), dv = new DataView(b.buffer);
  entries.forEach(([a, z], i) => { dv.setUint32(16 * i, a, true); dv.setUint32(16 * i + 4, z, true); });
  for (const [a, bytes] of records) b.set(bytes, a - load - 32);
  return b;
}
// a lab-made tone: frames of a sine at hz, stereo PCM16
const tone = (hz, ms, rate = 48000) => {
  const n = Math.round(rate * ms / 1000), s = new Int16Array(2 * n);
  for (let i = 0; i < n; i++) s[2 * i] = s[2 * i + 1] = Math.round(8000 * Math.sin(2 * Math.PI * hz * i / rate));
  return N.pcmWav(s, { rate, channels: 2 });
};

export async function resnandUnits() {
  const bad = [];
  let checks = 0;
  const ok = (c, what) => { checks++; if (!c) bad.push(what); };
  // a container: code (outside the NAND window), a scrambled block with an unaligned body (1000 bytes), a plain one
  const A = 0x41000000, B = 0x42000000;
  const bodyA = noise(1000), bodyB = noise(512);
  const bin = cat(stored(0x0100, noise(64), 0x50000000), stored(0x0106, bodyA, A), stored(0, bodyB, B));
  const read = (off, len) => bin.slice(off, off + len);
  const { blocks } = await walk(read, bin.length);
  const src = N.nandSource(read, blocks);
  ok(src.areas.length === 2 && src.areas[0].load === A && src.areas[0].size === 1064 && src.areas[1].load === B, `the areas in the NAND window: ${JSON.stringify(src.areas)}`);
  const offA = 64 + 64;
  ok(same(src.read(A, 32), bin.subarray(offA, offA + 32)), 'a block\'s head at its load address, as stored');
  ok(same(src.read(A + 32, 1000), bodyA), 'its body descrambled');
  ok(same(src.read(A + 32 + 990, 10), bodyA.subarray(990)), 'an unaligned tail of the body as stored (unscrambled)');
  ok(same(src.read(A + 20, 40), cat(bin.subarray(offA + 20, offA + 32), bodyA.subarray(0, 28))) && same(src.read(A + 32 + 7, 13), bodyA.subarray(7, 20)), 'reads across the head and the body, and inside a scramble group');
  ok(same(src.read(A + 1000, 64), cat(bodyA.subarray(968), bin.subarray(offA + 1032, offA + 1064))), 'a read across the body\'s end into the tail');
  ok(same(src.read(B + 32, 512), bodyB), 'a plain block (flags 0) as stored');
  ok(src.read(A + 1060, 8) === null && src.read(0x50000000, 4) === null && src.read(A - 4, 8) === null, 'a range past a block, outside the window or across a load address: null');
  ok(throwsAs(() => N.nandAreas([{ typ: 'OE', load: A, len: 100, off: 0, flags: 1 }, { typ: 'OE', load: A + 100, len: 100, off: 0, flags: 1 }]), N.NandError, /overlap/), 'overlapping blocks are refused');
  // the resource body from the lab's own copy (a prefix of it), the head and tail from the container
  const copy = bodyA.slice(0, 600).fill(0x11, 0, 4), wb = N.withBody(src, A, copy);
  ok(same(wb.read(A, 40), cat(bin.subarray(offA, offA + 32), copy.subarray(0, 8))) && same(wb.read(A + 32 + 590, 10), copy.subarray(590)), 'withBody: the body from the lab\'s copy, the head from the container');
  ok(throwsAs(() => wb.read(A + 32 + 590, 20), N.NandError, /past the 600 bytes/) && same(wb.read(B + 32, 4), bodyB.subarray(0, 4)), 'withBody: a read past the copy refused; another block untouched');
  ok(throwsAs(() => N.withBody(src, A + 1, copy), N.NandError), 'withBody: a load no block has is refused');
  // the index rules
  const ix = N.nandIndex(cat(src.read(A, 32), new Uint8Array([0, 4, 0, 0x41, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array(16).fill(0xff), new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  ok(ix.typ === 'OE' && ix.load === A && ix.version === 0x01000000 && ix.flags === 0x0106 && ix.entries.length === 1 && ix.entries[0].address === 0x41000400 && ix.entries[0].size === 0x200,
    `nandIndex: the head's load and version << 16 (res_version), the entries up to an erased one: ${JSON.stringify(ix)}`);
  // the extract: a block whose index names a sub-block (an OE head of its own), a small record and a big one
  const L = 0x45000000, size = 0x40000, sub = L + 0x400, rec = L + 0x10000, big = L + 0x20000;
  const subBody = indexed(sub, [[sub + 0x400, 0x100], [sub + 0x500, 0x20000]], 0x8000, [[sub + 0x400, noise(0x100)]]);
  const subBlock = stored(0, subBody, sub).subarray(0, 0x8000 - 32);                // its head, index and data, no tail
  const top = indexed(L, [[sub, 0x8000], [rec, 0x300], [big, 0x18000]], size, [[sub, subBlock], [rec, noise(0x300)], [big, noise(0x18000)]]);
  const bin2 = stored(0x0106, top, L), read2 = (off, len) => bin2.slice(off, off + len), src2 = N.nandSource(read2, (await walk(read2, bin2.length)).blocks);
  ok(same(src2.read(sub, 4), [0x4F, 0x45, 0x14, 0x30]), 'the sub-block\'s OE head at its own address');
  return (async () => {
    const x = await N.nandExtract(src2.areas, src2.read);
    const back = N.extractSource(N.decodeExtract(N.encodeExtract(x)));
    const kept = (a, n) => { try { return same(back.read(a, n), src2.read(a, n)); } catch { return false; } };
    ok(kept(L, 0x400) && kept(L + size - 32, 32), 'the extract: the head with the index area (up to entry 0\'s data) and the tail');
    ok(kept(sub, 0x400) && kept(sub + 0x400, 0x100) && kept(rec, 0x300), 'the extract: a sub-block\'s index area and its small record, the top index\'s small record');
    ok(throwsAs(() => back.read(big, 16), N.NandError, /not in this host's extract/) && throwsAs(() => back.read(sub + 0x500, 16), N.NandError), `the extract: a record above ${N.RECORD_MAX} bytes is not kept, its read refused`);
    ok(back.read(0x50000000, 4) === null && x.spans.every(([a, b], i) => i === 0 || a >= x.spans[i - 1][0] + x.spans[i - 1][1].length), 'the extract: outside its areas null; its spans in order, not overlapping');
    const xs = await N.nandExtract(src2.areas, src2.read, { skip: [L] });
    ok(xs.spans.length === 2 && xs.spans.every(([, b]) => b.length === 32), 'the extract of a skipped block: its head and tail only');
    ok(throwsAs(() => N.decodeExtract(new Uint8Array(12)), N.NandError, /not a NAND extract/), 'the extract: other bytes refused');
    soundUnits(ok);
    resnandLayer(ok);
    return { checks, bad };
  })();
}

function soundUnits(ok) {
  const LOAD = 0x4E420000;
  const w0 = tone(2000, 90), w1 = tone(1000, 350), w2 = tone(500, 20);
  const img = N.soundArea([{ id: 1, wav: w1 }, { id: 0, wav: w0 }, { id: 2, wav: w2 }]);
  const dv = new DataView(img.buffer);
  ok(img[0] === 0x4F && img[1] === 0x45 && dv.getUint32(8, true) === LOAD && dv.getUint32(12, true) === img.length - 64 && dv.getUint16(20, true) === 0x0103 && dv.getUint16(16, true) === 0x0100,
    `soundArea: the OE head (load 0x4e420000, the body's length, flags 0x0103, version 0x0100): ${[...img.subarray(0, 24)]}`);
  ok(sum32(img) === 0 && img.length % 512 === 0, `soundArea: the container's checksum over head, body and tail is 0, the image 512-aligned (${img.length} bytes)`);
  const p = N.parseSoundArea(img);
  const want = [w0, w1, w2];
  ok(p.sounds.length === 3 && p.sounds[0].address === LOAD + 1024 && p.sounds.every((s, i) => s.address % 512 === 0 && s.size % 512 === 0 && s.size >= want[i].length && (i === 0 || s.address === p.sounds[i - 1].address + p.sounds[i - 1].size)),
    `soundArea: entry 0 at load + 1024, each entry 512-aligned and padded, in id order: ${JSON.stringify(p.sounds.map(({ address, size }) => [h8(address), size]))}`);
  ok(p.sounds.every((s, i) => same(s.bytes.subarray(0, want[i].length), want[i]) && s.bytes.subarray(want[i].length).every((b) => b === 0)), 'soundArea: each entry\'s bytes the WAVE file, then zeros');
  ok(p.sounds.every((s) => s.wav.format === 1 && s.wav.channels === 2 && s.wav.rate === 48000 && s.wav.bits === 16) && p.sounds[1].wav.data.length === 4 * 16800, `the WAVE files read back: PCM, 2 channels, 48 kHz, 16 bits: ${JSON.stringify(p.sounds.map((s) => s.wav))}`);
  ok(p.version === 0x01000000 && p.entries.length === 3 && N.nandIndex(img.subarray(0, 1024)).entries.length === 3, 'the index read as res_version and res_size read it: version 0x0100 << 16, three entries, the fourth empty');
  ok(N.parseSoundArea(N.soundArea([{ id: 0, wav: w0 }], { length: 0x40000 })).len === 0x40000 - 64, 'soundArea: a given length (the guard window\'s 256 KiB)');
  ok(throwsAs(() => N.soundArea([{ id: 1, wav: w0 }]), N.NandError, /ids/) && throwsAs(() => N.soundArea([{ id: 0, wav: w0 }, { id: 0, wav: w1 }]), N.NandError, /ids/), 'soundArea: ids not 0..n-1 refused');
  ok(throwsAs(() => N.soundArea([]), N.NandError) && throwsAs(() => N.soundArea(Array.from({ length: 63 }, (_, id) => ({ id, wav: w2 }))), N.NandError, /1 to 62/), 'soundArea: no sounds, or more than the 62 entries of the 1024-byte index, refused');
  ok(throwsAs(() => N.soundArea([{ id: 0, wav: new Uint8Array(64) }]), N.NandError, /RIFF/) && throwsAs(() => N.soundArea([{ id: 0, wav: w0 }], { length: 1024 }), N.NandError, /need/), 'soundArea: a file that is not WAVE, or a length too small, refused');
  ok(throwsAs(() => N.parseSoundArea(img, LOAD + 0x1000), N.NandError, /head/), 'parseSoundArea: a head at another load address refused');
}

// S-RESNAND's layer on a stub session: memory a Map, the hook's finish recorded
function resnandLayer(ok) {
  const info = MODELS.E143.res_nand, mem = new Map(), log = [];
  const sim = { write: (a, b) => { for (let i = 0; i < b.length; i++) mem.set(a + i, b[i]); }, read: (a, n) => Uint8Array.from({ length: n }, (_, i) => mem.get(a + i) ?? 0) };
  const nand = { areas: [{ load: 0x41000000, size: 0x100, len: 0xc0, off: 0, flags: 0, ver: 0x100 }], read: (a, n) => (a >= 0x41000000 && a + n <= 0x41000100 ? new Uint8Array(n).fill(0x5a) : null) };
  const mk = (image = null) => new ResNand({ lab: { sim }, env: {} }, info, nand, image);
  const h = { finish: (r, out) => log.push(['finish', out.d0]) };
  const prev = () => log.push(['prev']);
  const acc = (r, op, at, n, mem0 = 0xA0000000) => r._nand(h, { a0: mem0, a1: at, d0: n, d1: op, mdr: 0x60000000 }, prev);
  const R = 0x10200, W = 0x10100, E = info.erase, S = info.sound.load;
  let r = mk();
  acc(r, R, S, 1024);
  ok(sim.read(0xA0000000, 1024).every((b) => b === 0xff) && log.at(-1)[0] === 'finish', 'S-RESNAND: the sound area reads erased');
  sim.write(0xA1000000, Uint8Array.of(1, 2, 3, 4));
  acc(r, W, S + 0x400, 4, 0xA1000000);
  acc(r, R, S + 0x3fe, 8);
  ok(same(sim.read(0xA0000000, 8), [0xff, 0xff, 1, 2, 3, 4, 0xff, 0xff]) && r.writes === 1, 'S-RESNAND: a write inside the guard window kept for the session');
  acc(r, E, S + 0x400, 2);
  acc(r, R, S + 0x400, 4);
  ok(same(sim.read(0xA0000000, 4), [0xff, 0xff, 3, 4]) && r.erases === 1, 'S-RESNAND: an erase inside the window reads erased again');
  ok(throwsAs(() => acc(r, 0x10400, S, 4), ResNandError), 'S-RESNAND: another operation in the area refused');
  let n1 = log.length;
  acc(r, R, info.sound.guard[1] - 4, 8);
  ok(sim.read(0xA0000000, 8).every((b) => b === 0xff) && log.at(-1)[0] === 'finish', 'S-RESNAND: without an image, a read across the guard window\'s end reads erased');
  ok(throwsAs(() => acc(r, W, info.sound.guard[1], 4), ResNandError, /writes and erases inside/), 'S-RESNAND: a write past the guard window refused');
  acc(r, R, info.sound.end, 4);
  ok(JSON.stringify(log.slice(n1 + 1)) === JSON.stringify([['prev']]), `S-RESNAND: a read at the RAM log's address passed down: ${JSON.stringify(log.slice(n1))}`);
  n1 = log.length;
  ok(throwsAs(() => acc(r, R, info.sound.end - 4, 8), ResNandError, /crosses/) && throwsAs(() => acc(r, R, S - 4, 8), ResNandError, /crosses/) &&
    throwsAs(() => acc(r, W, S - 512, 1024), ResNandError, /crosses/) && log.length === n1, 'S-RESNAND: an access across the area\'s start or the RAM log\'s address refused, not passed down');
  const img = N.soundArea([{ id: 0, wav: tone(1000, 2000) }]);
  r = mk(img);
  acc(r, R, S, 64);
  const tail = img.length - 32;
  acc(r, R, S + tail, 32, 0xA2000000);
  ok(same(sim.read(0xA0000000, 64), img.subarray(0, 64)) && same(sim.read(0xA2000000, 32), img.subarray(tail)) && img.length > 0x40000,
    `S-RESNAND: the host's image served (${img.length} bytes, past the guard window too)`);
  ok(throwsAs(() => acc(r, W, info.sound.guard[1], 4), ResNandError, /writes and erases inside/), 'S-RESNAND: a write into the image past the guard window refused');
  n1 = log.length;
  acc(r, R, S + tail, 1056);
  ok(log.at(-1)[0] === 'finish' && same(sim.read(0xA0000000, 32), img.subarray(tail)) && sim.read(0xA0000000 + 32, 1024).every((b) => b === 0xff),
    'S-RESNAND: a read across the image\'s end (the last entry\'s size + 1024 bytes, as res_read of type 2 reads) served, erased past it');
  ok(throwsAs(() => mk(new Uint8Array(info.sound.end - S + 1)), ResNandError, /RAM log/), 'S-RESNAND: an image past the RAM log refused');
  const n0 = log.length;
  acc(r, R, 0x41000010, 16);
  acc(r, R, 0x41000100, 16);
  acc(r, W, 0x41000010, 16);
  ok(sim.read(0xA0000000, 16).every((b) => b === 0x5a) && JSON.stringify(log.slice(n0)) === JSON.stringify([['finish', 0], ['prev'], ['prev']]), `S-RESNAND: a container read served, a read outside it and a write passed down: ${JSON.stringify(log.slice(n0))}`);
}

export async function resnandSession() {
  const bad = [];
  let checks = 0;
  const ok = (c, what) => { checks++; if (!c) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const { TABLES, SUB_TABLES, SOUND_DESCRIPTOR, SOUND_LAST } = await import('../src/lab/resnand.mjs');
  if (!MODEL_INFO.res_nand) return { checks: 1, bad: ['the session tests run on E143 (MODELS res_nand)'] };
  const info = MODEL_INFO.res_nand;
  // --audio off: the sound area erased or the test's image (S-SOUNDRES's lab-made one, with the audio hardware, is
  // test_audio.mjs afBeepSession's)
  const open = (extra) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, audio: 'off' },
      { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000, ...extra });
    pl.open_session();
    return pl;
  };
  const api = (lab) => ({
    size: (t, i) => lab.call(info.size, { d0: t, d1: i }, null, null, 20000).d0 >>> 0,
    version: (t) => lab.call(0x501A971E, { d0: t }, null, null, 2000).d0 >>> 0,
    read: (t, i, n) => { const st = new Uint8Array(4); new DataView(st.buffer).setUint32(0, n, true); lab.call(info.read, { d0: t, d1: i, a0: info.slot, a1: 0 }, st, null, 2000000); return [lab.sim.u32(SOUND_DESCRIPTOR), lab.sim.u32(SOUND_DESCRIPTOR + 4)]; },
  });
  const tables = (lab) => [...Object.values(TABLES).flat(), ...Array.from({ length: 12 }, (_, i) => SUB_TABLES[1] + 4 * i)].map((a) => lab.sim.u32(a));
  // the NAND extract provisioning keeps in unpacked/<code>
  let pl = open({ nand: loadNand() });
  let s = pl.session, lab = s.lab;
  const used = pl.stand_ins_in_use(), bring = s.steps.find((x) => x.resnand)?.resnand;
  ok(used.includes('H-RESINIT') && used.includes('S-RESNAND'), `the stand-ins in use name H-RESINIT and S-RESNAND: ${used.filter((x) => /RES/.test(x))}`);
  // the pointers the loader set (X, round 1: 0xa32db180 = 0xa3220830 ...)
  ok(lab.sim.u32(0xA32DB17C) === 0xA3220810 && lab.sim.u32(0xA32DB180) === 0xA3220830 && lab.sim.u32(0xA32DB19C) === 0xA3220C40 && lab.sim.u32(0xA32DB1BC) === 0xA3223C50 && lab.sim.u32(0xA32DB32C) === 0xA32299C0,
    `H-RESINIT's tables: ${JSON.stringify(bring?.tables)}`);
  const reads = (bring?.log ?? []).filter(([k]) => k === 'nand' || k === 'sound');
  ok(reads.length >= 16 && reads[0][1].startsWith('read 1024 bytes at 0x4e420000') && reads.some(([, t]) => t.startsWith('read 2048 bytes at 0x41ec0000')) && reads.some(([, t]) => t.startsWith('read 1024 bytes at 0x458c0000')),
    `the loader's reads, the sound index first: ${reads.length} (${reads.slice(0, 3).map(([, t]) => t.split(' from')[0])})`);
  const A = api(lab);
  const sz = [[0, 0], [0, 37], [3, 0], [0x8000, 0], [0x8002, 0], [2, 0]].map(([t, i]) => A.size(t, i));
  ok(same(sz, [0xE2800, 0x1D7400, 0x2800, 0x167FC00, 0x800, 0xFFFFFFFF]), `res_size(0, 0), (0, 37), (3, 0), (0x8000, 0), (0x8002, 0), (2, 0): ${sz.map(h8)}`);
  const vs = [0, 1, 3, 0x8000, 2].map((t) => A.version(t));
  ok(same(vs, [0x01000000, 0x01000000, 0x01000000, 0x01000000, 0xFFFF0000]), `res_version(0, 1, 3, 0x8000, 2): ${vs.map(h8)}`);
  const soundStep = lab.steps.find((x) => /H-RESINIT sound 0/.test(x.name ?? ''));
  ok(JSON.stringify(bring?.sound0) === JSON.stringify([h8(0), h8(0)]) && lab.kernel.errors.filter(([c]) => c === 0x1F000003).length === 1 && JSON.stringify(soundStep?.errlog?.map(([c]) => c)) === JSON.stringify([h8(0x1F000003)]),
    `the erased area: USTART_L's sound 0 load takes its error path, descriptor ${JSON.stringify(bring?.sound0)}, its step's log ${JSON.stringify(soundStep?.errlog ?? null)}`);
  ok(lab.sim.u32(SOUND_LAST) === lab.sim.u32(TABLES[2][1]), `the erased area: res_read's last entry ${h8(lab.sim.u32(SOUND_LAST))} is the table's entry 0, as the firmware leaves it`);
  const lensRead = reads.find(([, t]) => / at 0x4709de00 /.test(t));
  ok(!!lensRead && (s.steps.find((x) => x.lens)?.lens?.log ?? []).every(([k, t]) => k !== 'nand' || !/read 0 bytes/.test(t)), `the lens data lookup reads its record (type 0x8002) instead of 0 bytes: ${lensRead?.[1]}`);
  const t0 = tables(lab);
  // a later sound 0 load into the slot (the UI_OUT handler's) answers the descriptor the bring-up's left, without a
  // read or a log (0x501a9333..47)
  const e0 = lab.kernel.errors.length, d0 = A.read(2, 0, (0xFFFFFFFF + 1024) >>> 0);
  ok(d0[0] === 0 && d0[1] === 0 && lab.kernel.errors.length === e0, `a later sound 0 load on the erased area: descriptor {${d0.map(h8)}}, logs ${lab.kernel.errors.slice(e0).map(([c]) => h8(c))}`);
  pl.close_session();
  // the extract labNand makes from the .BIN (the browser's) is the provisioned one; the whole container, read where the
  // firmware asks, gives the same tables and reads
  {
    const { labFirmware, labNand } = await import('../src/fw/labfw.mjs');
    const { walk } = await import('../src/fw/olyfw.mjs');
    const { binPin } = await import('../host/blobs.mjs');
    const fs = await import('node:fs'), path = await import('node:path');
    const { REPO, NAND } = await import('../checks/lib/env.mjs');
    const pin = binPin(MODEL_INFO), file = [path.join(REPO, pin.rel), process.env.OM_FW_DIR && path.join(process.env.OM_FW_DIR, MODEL_INFO.bin)].find((f) => f && fs.existsSync(f));
    if (!file) ok(false, `the .BIN (${pin.rel} or $OM_FW_DIR) for the extract's checks`);
    else {
      const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
      const read = (off, len) => { const b = new Uint8Array(len); fs.readSync(fd, b, 0, len, off); return b; };
      const fw = await labFirmware(read, size, createHash), x = await labNand(read, fw.blocks, createHash, fw.res_load);
      ok(x.sha256 === info.extract_sha256 && same(x.bytes, new Uint8Array(fs.readFileSync(NAND))), `labNand's extract of the .BIN is MODELS res_nand.extract_sha256 and the provisioned file: ${x.sha256.slice(0, 16)}`);
      pl = open({ nand: N.nandSource(read, (await walk(read, size)).blocks) });
      const t1 = tables(pl.session.lab), b1 = pl.session.steps.find((y) => y.resnand)?.resnand;
      ok(same(t1, t0) && JSON.stringify(b1?.log) === JSON.stringify(bring?.log), 'the whole container: the same tables and the same reads');
      pl.close_session();
      fs.closeSync(fd);
    }
  }
  // a lab-made sound area
  const w0 = tone(2000, 100), w1 = tone(1000, 300), img = N.soundArea([{ id: 0, wav: w0 }, { id: 1, wav: w1 }]), p = N.parseSoundArea(img);
  pl = open({ nand: loadNand(), soundArea: img });
  s = pl.session; lab = s.lab;
  const B = api(lab), st = s.steps.find((x) => x.resnand)?.resnand;
  ok(B.size(2, 0) === p.sounds[0].size && B.size(2, 1) === p.sounds[1].size && B.version(2) === 0x01000000, `with the area: res_size(2, 0), (2, 1) the entries' sizes, res_version(2) 0x01000000: ${h8(B.size(2, 0))} ${h8(B.size(2, 1))} ${h8(B.version(2))}`);
  ok(JSON.stringify(st?.sound0) === JSON.stringify([h8(info.slot), h8(p.sounds[0].size + 1024)]) && same(lab.sim.read(info.slot, 4), [0x52, 0x49, 0x46, 0x46]),
    `H-RESINIT's sound 0 (USTART_L's load) at 0xa4000000: ${JSON.stringify(st?.sound0)}`);
  const d = B.read(2, 1, p.sounds[1].size + 1024);
  ok(d[0] === info.slot && d[1] === p.sounds[1].size + 1024 && same(lab.sim.read(info.slot, w1.length), w1), `res_read(2, 1): descriptor {${d.map(h8)}}, the WAVE file at the pointer`);
  ok(!lab.kernel.errors.some(([c]) => c === 0x1F000003), 'no 0x1f000003 log with the area');
  // the firmware's type-2 write 0x501a98c8 (d0 type, d1 id, a0 data, a1 size; 0x501a9a1e): sound 0 rewritten with
  // another lab-made tone of its length, an erase up to entry 1 and the index and data writes kept in the guard
  // window, then read back by res_read (the write clears the last entry, 0x501a9ad4)
  const w0b = tone(3000, 100), src = info.slot + 0x100000, rn = s.resnand, k0 = [rn.writes, rn.erases];
  lab.sim.write(src, w0b);
  const e1 = lab.kernel.errors.length;
  lab.call(0x501A98C8, { d0: 2, d1: 0, a0: src, a1: w0b.length }, null, null, 2000000);
  ok(w0b.length === w0.length && rn.writes - k0[0] === 2 && rn.erases - k0[1] === 1 && lab.sim.u32(SOUND_LAST) === 0 && lab.kernel.errors.length === e1,
    `res_write(2, 0): ${rn.writes - k0[0]} writes, ${rn.erases - k0[1]} erases, last entry ${h8(lab.sim.u32(SOUND_LAST))}, logs ${lab.kernel.errors.slice(e1).map(([c]) => h8(c))}`);
  const d2 = B.read(2, 0, p.sounds[0].size + 1024);
  ok(d2[0] === info.slot && same(lab.sim.read(info.slot, w0b.length), w0b) && B.size(2, 0) === p.sounds[0].size, `res_read(2, 0) after the write: descriptor {${d2.map(h8)}}, the new WAVE file at the pointer, the index kept`);
  pl.close_session();
  // an area larger than the guard window (a short sound 0 and a 2 s sound 1): res_read(2, 1) reads the entry's size +
  // 1024 bytes, past the image's end, which S-RESNAND serves erased; read into UI_OUT's buffer for sounds above 512 KiB
  // (0xb5a0b780, 0x5014f7e0, D): at 0xa4000000 a sound of more than 0x3d000 bytes would run into the GUI's icons record
  // at 0xa403d000 (X: a 2 s tone as sound 0 stopped the application's start)
  const wl = tone(1000, 2000), big = N.soundArea([{ id: 0, wav: w0 }, { id: 1, wav: wl }]), pb = N.parseSoundArea(big), BIG_AT = 0xB5A0B780;
  pl = open({ nand: loadNand(), soundArea: big });
  lab = pl.session.lab;
  const n1 = pb.sounds[1].size + 1024, st1 = new Uint8Array(4);
  new DataView(st1.buffer).setUint32(0, n1, true);
  lab.call(info.read, { d0: 2, d1: 1, a0: BIG_AT, a1: 0 }, st1, null, 20000000);
  const db = [lab.sim.u32(SOUND_DESCRIPTOR), lab.sim.u32(SOUND_DESCRIPTOR + 4)];
  ok(pl.phase === 'running' && big.length > info.sound.guard[1] - info.sound.guard[0] && db[0] === BIG_AT && db[1] === n1 && same(lab.sim.read(BIG_AT, wl.length), wl) &&
    (() => { const past = big.length - (pb.sounds[1].address - info.sound.load); return past < n1 && lab.sim.read(BIG_AT + past, n1 - past).every((b) => b === 0xff); })(), `an area of ${big.length} bytes, past the guard window: res_read(2, 1) of ${n1} bytes runs past the image's end, served erased: {${db.map(h8)}}`);
  pl.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await resnandUnits();
  console.log(`resource tables' NAND units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const r = await resnandSession();
    console.log(`the resource tables in play: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
