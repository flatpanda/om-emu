// S-HEAP's opt-in fill (src/lab/play.mjs heapFill, OM_HEAP_FILL / opts.heap_fill; FIDELITY-NOTES.md 7.1), E143:
//   heapFillUnits    (no firmware) the option's forms: off, empty and absent give no fill; a hex word with or
//                    without 0x gives 64 KiB of it little-endian; a short word is zero-extended; anything else refused
//   heapFillSession  a play session with the fill deadbeef, 5 s of idle: every block S-HEAP hands out reads the fill
//                    at malloc's return and every block it takes back reads it after free; the session runs on.
//                    Control: the same session without the fill hands out blocks that do not read it
//   node emu/test/test_heapfill.mjs
import { fileURLToPath } from 'node:url';
import { heapFill } from '../src/lab/play.mjs';

const FILL = 'deadbeef', WORD = 0xDEADBEEF, IDLE_S = 5;

export function heapFillUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  for (const v of [undefined, null, '', 'off']) ok(heapFill(v) === null, `heap fill ${JSON.stringify(v)} is off`);
  for (const v of ['deadbeef', '0xDEADBEEF', 'DeadBeef']) {
    const b = heapFill(v), dv = b && new DataView(b.buffer);
    ok(b && b.length === 0x10000 && dv.getUint32(0, true) === WORD && dv.getUint32(0xFFFC, true) === WORD, `heap fill ${v}: 64 KiB of 0xdeadbeef, little-endian`);
  }
  const s = heapFill('a5');
  ok(s && new DataView(s.buffer).getUint32(4, true) === 0xA5, 'heap fill a5: the word 0x000000a5');
  for (const v of ['xyz', '123456789', '0x', 'dead beef', '-1']) {
    let threw = false;
    try { heapFill(v); } catch { threw = true; }
    ok(threw, `heap fill ${v}: refused`);
  }
  return { checks, bad };
}

async function idleWithFill(fill) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  // the player passes no heap_fill (as power_later): the session reads OM_HEAP_FILL
  const was = process.env.OM_HEAP_FILL;
  if (fill === undefined) delete process.env.OM_HEAP_FILL; else process.env.OM_HEAP_FILL = fill;
  try { pl.open_session(); } finally { if (was === undefined) delete process.env.OM_HEAP_FILL; else process.env.OM_HEAP_FILL = was; }
  const s = pl.session, lab = s.lab, sim = lab.sim;
  const reads = (a, size) => { for (let k = 0; k < size; k += 4) if (sim.u32(a + k) !== WORD) return false; return true; };
  const seen = { malloc: 0, malloc_fill: 0, free: 0, free_fill: 0 };
  const m = lab._s_malloc.bind(lab), f = lab._s_free.bind(lab);
  lab._s_malloc = (hle, r, regs = r) => {
    const before = new Set(lab.heap_sizes.keys());
    m(hle, r, regs);
    for (const a of lab.heap_sizes.keys()) if (!before.has(a)) { seen.malloc++; if (reads(a, lab.heap_sizes.get(a))) seen.malloc_fill++; }
  };
  lab._s_free = (hle, r) => {
    const a = r.a0, size = lab.heap_sizes.get(a);
    f(hle, r);
    if (size !== undefined) { seen.free++; if (reads(a, size)) seen.free_fill++; }
  };
  const to = lab.lab_time() + IDLE_S * 1e9;
  while (lab.lab_time() < to) { s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); s.frame(); }
  const on = lab.heap_fill !== null;
  pl.close_session();
  return { on, seen };
}

export async function heapFillSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const a = await idleWithFill(FILL);
  ok(a.on, 'the fill deadbeef is on in the session');
  ok(a.seen.malloc > 0 && a.seen.malloc_fill === a.seen.malloc, `with the fill ${a.seen.malloc_fill} of ${a.seen.malloc} blocks handed out read 0xdeadbeef at malloc's return`);
  ok(a.seen.free > 0 && a.seen.free_fill === a.seen.free, `with the fill ${a.seen.free_fill} of ${a.seen.free} blocks taken back read 0xdeadbeef after free`);
  const b = await idleWithFill(undefined);
  ok(!b.on, 'without the option the fill is off');
  ok(b.seen.malloc > 0 && b.seen.malloc_fill < b.seen.malloc, `control: without the fill ${b.seen.malloc_fill} of ${b.seen.malloc} blocks handed out read 0xdeadbeef`);
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const u = heapFillUnits();
  console.log(`S-HEAP's fill option: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  const s = await heapFillSession();
  console.log(`S-HEAP's fill in play (E143, ${IDLE_S} s idle, with a control): ${s.checks - s.bad.length}/${s.checks}`);
  s.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length || s.bad.length ? 1 : 0);
}
