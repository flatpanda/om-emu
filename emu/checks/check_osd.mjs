#!/usr/bin/env node
// The OSD checks: the HLE harness, native OSD init and the OSD engine model, checked through the
// firmware's own gpi* / osddraw calls on the JS lab (src/lab/osd.mjs) against references computed from the API
// arguments by refs/osdfmt.mjs (Surface, the bitmap decoder and encoder), never from the engine or the firmware. The
// seeded inputs come from refs/mt19937.mjs in a fixed order of draws (OM_RNG_TAPE writes the tape of draws); the
// resource records are scanned by checks/lib/resources_scan.mjs. stdout keeps the recorded report lines.
//   node emu/checks/check_osd.mjs [--seed N] [--kernel native|none] [--image PATH]
//
// env.rec (the recorder of checks/lib/osdcalls.mjs, optional): ctor(make) around the OsdLab constructor, mark(label,
// lab, result, end) at every group boundary (capture.Capture.install's group wrapper), logClear() before
// hle.log.clear().
import { labEnv, readBytes, ORIGINAL, runMain, SystemExit } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { newRandom } from './lib/rngtape.mjs';
import * as RES from './lib/resources_scan.mjs';
import * as fmt from '../refs/osdfmt.mjs';
import { decode_command, gui_palette } from '../src/lab/osdfmt.mjs';
import { CALLER, FREE, HEAP, HEAP_END, MALLOC, MEMCPY, MEMSET, runtime } from '../src/lab/hle.mjs';
import { CMDBUF, DEBUG, DRV_CMDBUF, DRV_MODE, ENGINE_ISR, EXPECTED_RECORDS, GPI_DRAW_OSD_RECTANGLE, IRQ_ENGINE, PALETTE_ARRAYS,
  EngineDebug, OsdLab, choose_palette } from '../src/lab/osd.mjs';
import { DRAW_PATH_RTOS } from '../src/lab/rtos.mjs';
import { MAX_READ, MAX_WRITE } from '../src/lab/sim.mjs';
import { LabError, AssertionError, FirmwareError, EngineError, KeyError, ValueError, RuntimeError } from '../src/lab/errors.mjs';
import { pred, fault } from './lib/pred.mjs';
import { isValueError } from './lib/errors.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show, asText } from '../src/util/show.mjs';
import { pack, unpack, hexBytes } from '../src/util/bytes.mjs';

const SCRATCH = 0xA2030000;
const STRIDE = fmt.STRIDE, WIDTH = fmt.WIDTH, HEIGHT = fmt.HEIGHT;
const BUFFERS = [0, 1, 2, 3, 4, 5];
const RANGE6 = { range: 6 };              // rng.choice(BUFFERS): BUFFERS is range(6)
let REC = null;                           // env.rec of the running check (osdcalls' recorder), or null
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// An assert through the predicate seam: AssertionError with `what` (a value, or a thunk built only on failure) as its
// text.
function check(cond, what = null) {
  if (!pred(!!cond, 2)) { const w = typeof what === 'function' ? what() : what; throw new AssertionError(w === null ? '' : asText(w)); }
}
const bytesEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const cat = (...parts) => { const o = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const repeat = (b, n) => { const o = new Uint8Array(b.length * n); for (let i = 0; i < n; i++) o.set(b, i * b.length); return o; };
const ints = (v) => Array.from(v);
// EngineDebug.exec_log (src/lab/osd.mjs): {seq, source, result, command: decode_command(words)} per raw row.
const commands = (frame) => frame.commands.map((r) => ({ seq: r[0], source: r[1], result: r[3], command: decode_command(r.slice(4, 4 + r[2])) }));

// OsdLab.drawing(expect, errlog) as a function of its body (contextlib.contextmanager: an Exception from the body is
// passed to _abandon and raised again; the frame is returned for use after the bracket).
function drawing(lab, body, { expect = [], errlog = 0 } = {}) {
  const st = lab.drawing_enter(expect, errlog);
  try { body(st.frame); } catch (e) {
    if (!(e instanceof LabError)) throw e;
    lab.drawing_exit(st, e);
  }
  return lab.drawing_exit(st, null);
}

class Session {
  constructor(lab, rng) {
    this.lab = lab; this.rng = rng;
    this.ref = new Map(BUFFERS.map((b) => [b, new fmt.Surface()]));
  }
  base(buffer) { return this.lab.surfaces[buffer].base; }
  compare(buffers = BUFFERS) {
    for (const b of buffers) {
      const ref = this.ref.get(b).data;
      const got = this.lab.sim.read(this.base(b), ref.length);
      if (!bytesEq(got, ref)) {
        let row = 0;
        while (row < this.ref.get(b).height && bytesEq(got.subarray(row * STRIDE, (row + 1) * STRIDE), ref.subarray(row * STRIDE, (row + 1) * STRIDE))) row++;
        let col = 0;
        while (col < STRIDE && got[row * STRIDE + col] === ref[row * STRIDE + col]) col++;
        throw new AssertionError(`buffer ${b}: first difference at x=${col} y=${row}: engine ${got[row * STRIDE + col]} reference ${ref[row * STRIDE + col]}`);
      }
    }
    return buffers.length;
  }
  clear(buffers = BUFFERS) {
    for (const b of buffers) { this.lab.clear(b); this.ref.set(b, new fmt.Surface()); }
  }
  draw_path_only() {
    const extra = [...this.lab.kernel.rtos_names()].filter((n) => !DRAW_PATH_RTOS.has(n));
    check(!extra.length, () => `unexpected RTOS services on the draw path: ${show(new Set(extra))}`);
  }
  fill_decoded(command, buffer, x, y, w, h, colour) {
    const c = command.command;
    check(command.result === 0 && c.name === 'FILL' && c.depth === 3 && c.dst_bit === 0, () => command);
    const got = [c.dst, c.w, c.h, c.color, c.stride];
    check(deepEqual(got, [this.base(buffer) + y * STRIDE + x, w, h, colour, STRIDE]), () => [got, x, y, w, h, colour]);
  }
}

// ---------------------------------------------------------------- 1
function stubs(lab) {
  let count = 0;
  check(deepEqual([MEMSET, MEMCPY, MALLOC, FREE, GPI_DRAW_OSD_RECTANGLE].map((f) => lab.frame(f)),     // HLE.frame: [mask, size]
 [[0xA0, 8], [0xF0, 28], [0, 4], [0, 4], [0xF0, 0x5C]]));
  count += 1;
  lab.sim.write(SCRATCH, new Uint8Array(120).fill(0x55));
  REC?.logClear();
  lab.log.length = 0;
  lab.call(0x51013B23, { a0: SCRATCH });
  check(deepEqual(lab.log, ['memset']) && bytesEq(lab.sim.read(SCRATCH, 120), cat(new Uint8Array(108), new Uint8Array(12).fill(0x55))));
  count += 1;
  lab.sim.write(SCRATCH, Uint8Array.from({ length: 64 }, (_, i) => i));
  lab.call(MEMSET, { a0: SCRATCH + 8, d0: 0x1a5, d1: 9 });
  check(bytesEq(lab.sim.read(SCRATCH, 20), cat(Uint8Array.from({ length: 8 }, (_, i) => i), new Uint8Array(9).fill(0xa5), new Uint8Array([17, 18, 19]))));
  count += 1;
  lab.call(MEMCPY, { a0: SCRATCH + 0x100, a1: SCRATCH + 32, d0: 3000 });
  check(bytesEq(lab.sim.read(SCRATCH + 0x100, 32), Uint8Array.from({ length: 32 }, (_, i) => 32 + i)));
  count += 1;
  const first = lab.call(MALLOC, { d0: 108 }).a0;
  const second = lab.call(MALLOC, { d0: 1 }).a0;
  check(HEAP <= first && first < HEAP_END && second === first + 112 && second % 16 === 0, () => [first, second]);
  lab.call(FREE, { a0: first });
  count += 1;
  lab.sim.write(CALLER + 0x40, hexBytes('cbcbcbcbcbcbcb'));
  lab.sim.reset({ pc: runtime(MEMSET), mdr: CALLER + 0x47 });
  try {
    lab.finish(lab.sim.registers());
    throw new AssertionError('finish accepted a non-CALL return address');
  } catch (e) {
    if (!(e instanceof FirmwareError)) throw e;
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------- 2
function native_init(s) {
  const lab = s.lab;
  let count = 0;
  check(deepEqual(lab.init_errors, []), () => lab.init_errors);
  EXPECTED_RECORDS.forEach(([base, kind], i) => {
    const r = lab.surfaces[i];
    check(r.address === 0x62B26558 + 16 * i && deepEqual([r.base, r.kind, r.stride, r.height], [base, kind, STRIDE, HEIGHT]), () => [i, r]);
  });
  let r = lab.surfaces[6];
  check(deepEqual([r.base, r.kind, r.stride, r.height], [0xB6ECC800, 3, STRIDE, 2400]), () => r);
  count += 1;
  check(deepEqual(lab.kernel.irq_handlers, new Map([[IRQ_ENGINE, runtime(ENGINE_ISR)]])), () => lab.kernel.irq_handlers);
  const attach = lab.kernel.events.filter((e) => e[0] === 'irq_attach');
  check(attach.length === 1 && attach[0][1] === 'irq=310 level=5', () => attach);
  count += 1;
  check(unpack('<H', lab.sim.read(DRV_MODE, 2))[0] === 1 && lab.sim.u32(DRV_CMDBUF) === 0xB729B880);
  const regs = new Map([0x18, 0x40, 0x44, 0x48, 0x50].map((o) => [o, lab.engine.register(o)]));
  check(deepEqual(regs, new Map([[0x18, 0x0B729B88], [0x40, 0x0B72AB80], [0x44, 0x68], [0x48, 0], [0x50, 0x88000000]])), () => regs);
  count += 1;
  check(deepEqual(lab.kernel.errors, []) && deepEqual(lab.kernel.rtos_names(), new Set(['OlySmWt', 'OlySmSi'])), () => lab.kernel.events);
  count += 1;
  const timer = [0, 1, 2].map(() => lab.sim.u32(0x98900284));
  check(new Set(timer).size === 1, () => timer);
  lab.sim.write(SCRATCH, hexBytes('f80000'));
  lab.sim.reset({ pc: SCRATCH, a0: 0x98900284 });
  check(lab.sim.run([], true).d0 === timer[0] && lab.sim.u32(0x98900284) === timer[0] - 1);
  count += 1;
  lab.sim.write(0xA2031000, new TextEncoder().encode('alias'));
  check(bytesEq(lab.sim.read(0x62031000, 5), new TextEncoder().encode('alias')));
  count += 1;
  lab.sim.write(SCRATCH, hexBytes('60'));
  lab.sim.reset({ pc: SCRATCH, a0: DEBUG + 0x200, d0: 1 });
  check(lab.sim.run([], true).fault === 2);
  // JS-only fault point (checks/lib/pred.mjs): the CPU store into the engine's debug window
  // once more, so the OSD engine records a second DEBUG_CPU_WRITE
  if (fault('osd-debug-write')) { lab.sim.reset({ pc: SCRATCH, a0: DEBUG + 0x200, d0: 1 }); lab.sim.run([], true); }
  check(deepEqual(lab.engine.errors().map((e) => e.name), ['DEBUG_CPU_WRITE']), () => lab.engine.errors());
  lab.engine.clear();
  count += 1;
  check(MAX_READ === 0x800 && MAX_WRITE === 0x400);
  check(lab.sim.packet(`m${SCRATCH.toString(16)},${MAX_READ.toString(16)}`).length === 2 * MAX_READ);
  try {
    lab.sim.packet(`m${SCRATCH.toString(16)},${(MAX_READ + 1).toString(16)}`);
    throw new AssertionError('the Simulator accepted an m packet over 0x800 bytes');
  } catch (e) {
    if (!(e instanceof RuntimeError)) throw e;
    check(e.message.endsWith('E22'), () => e.message);
  }
  const data = Uint8Array.from({ length: 3 * MAX_READ + 5 }, (_, k) => k % 251);
  lab.sim.write(SCRATCH + 3, data);
  check(bytesEq(lab.sim.read(SCRATCH + 3, data.length), data));
  count += 1;
  const stale = { u32: (address) => lab.sim.u32(address + 0x01000000) };
  try {
    new EngineDebug(stale);
    throw new AssertionError('EngineDebug accepted a machine without the debug window');
  } catch (e) {
    if (!(e instanceof FirmwareError)) throw e;
    check(e.message.includes('has no OSD engine debug window') && e.message.includes('E14'), () => e.message);
  }
  count += 1;
  r = null;
  return count;
}

// ---------------------------------------------------------------- 3, 4
function random_box(rng, line = false) {
  const x = rng.randrange(WIDTH), y = rng.randrange(HEIGHT);
  let w = rng.randrange(1, WIDTH - x + 1), h = rng.randrange(1, HEIGHT - y + 1);
  if (line) {
    if (rng.random() < 0.5) h = rng.randrange(1, Math.min(4, HEIGHT - y) + 1);
    else w = rng.randrange(1, Math.min(4, WIDTH - x) + 1);
  }
  return [x, y, w, h];
}
function boxes(s, kind) {
  const { lab, rng } = s;
  const draw = kind === 'rect' ? (...a) => lab.rectangle(...a) : (...a) => lab.line(...a);
  const counts = kind === 'rect' ? [10, 40, 10] : [30];
  for (const n of counts) {
    const calls = [];
    let frame = drawing(lab, () => {
      for (let i = 0; i < n; i++) {
        const [x, y, w, h] = random_box(rng, kind === 'line');
        const colour = rng.randrange(1, 256), buffer = rng.choice(RANGE6), layer = rng.randrange(3);
        draw(x, y, w, h, colour, layer, buffer);
        calls.push([buffer, x, y, w, h, colour]);
      }
    });
    const cmds = commands(frame);
    check(cmds.length === n, () => [cmds.length, n]);
    cmds.slice(0, calls.length).forEach((command, k) => {
      const [buffer, x, y, w, h, colour] = calls[k];
      s.fill_decoded(command, buffer, x, y, w, h, colour);
      s.ref.get(buffer).fill(x, y, w, h, colour);
    });
    frame = null;
  }
  s.compare();
  s.draw_path_only();
  return counts.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------- 5
function outlines(s) {
  const { lab, rng } = s;
  let n = 0;
  const bars = [];
  let frame = drawing(lab, () => {
    for (let i = 0; i < 20; i++) {
      const w = rng.randrange(4, 300);
      let h = rng.randrange(4, 300);
      const line = rng.randrange(1, Math.floor(Math.min(w, h) / 2) + 1);
      if (h === 2 * line) h += 1;
      const x = rng.randrange(WIDTH - w), y = rng.randrange(HEIGHT - Math.max(h, w));
      const colour = rng.randrange(1, 256), buffer = rng.choice(RANGE6);
      lab.outline(x, y, w, h, line, colour, 0, buffer);
      for (const [bx, by, bw, bh] of [[x, y, w, line], [x, y + line, line, h - 2 * line], [x + w - line, y + line, line, h - 2 * line], [x, y + w - line, w, line]]) {
        bars.push([buffer, bx, by, bw, bh, colour]);
      }
      n += 1;
    }
  });
  let cmds = commands(frame);
  check(cmds.length === bars.length);
  const pairs = cmds.map((c, k) => [c, bars[k]]).filter((p) => p[1] !== undefined);
  pairs.sort((a, b) => a[0].seq - b[0].seq);
  for (const [command, bar] of pairs) s.fill_decoded(command, ...bar);
  for (const command of cmds) {
    const c = command.command;
    const buffer = BUFFERS.find((b) => s.base(b) <= c.dst && c.dst < s.base(b) + STRIDE * HEIGHT);
    if (buffer === undefined) throw new RuntimeError('generator raised StopIteration');
    const off = c.dst - s.base(buffer);
    s.ref.get(buffer).fill(off % STRIDE, Math.floor(off / STRIDE), c.w, c.h, c.color);
  }
  const x = 500, y = 600, w = 40, line = 5, colour = 77;
  frame = drawing(lab, () => { lab.outline(x, y, w, 2 * line, line, colour, 0, 2); }, { expect: ['SIZE_4096', 'SIZE_4096'] });
  cmds = commands(frame);
  check(deepEqual(cmds.map((c) => c.result), [0, 12, 12, 0]), () => cmds);
  s.ref.get(2).fill(x, y, w, line, colour);
  s.ref.get(2).fill(x, y + w - line, w, line, colour);
  s.compare();
  return n + 1;
}

// ---------------------------------------------------------------- 6
function block_copies(s) {
  const { lab, rng } = s;
  let n = 0;
  drawing(lab, () => {
    for (let i = 0; i < 12; i++) {
      const [x, y, w, h] = random_box(rng);
      const colour = rng.randrange(1, 256), buffer = rng.choice(RANGE6);
      lab.rectangle(x, y, w, h, colour, 1, buffer);
      s.ref.get(buffer).fill(x, y, w, h, colour);
    }
  });
  let copies = 0, refused = 0;
  const expected = [];
  let frame = drawing(lab, (fr) => {
    while (copies + refused < 30) {
      const w = rng.randrange(1, 400), h = rng.randrange(1, 400);
      const sx = rng.randrange(WIDTH - w), sy = rng.randrange(HEIGHT - h);
      let dx, dy;
      if (rng.random() < 0.25) {
        dx = Math.min(WIDTH - w - 1, Math.max(0, sx + rng.randrange(-w + 1, w)));
        dy = Math.min(HEIGHT - h - 1, Math.max(0, sy + rng.randrange(-h + 1, h)));
      } else {
        dx = rng.randrange(WIDTH - w); dy = rng.randrange(HEIGHT - h);
      }
      const overlap = sx < dx + w && dx < sx + w && sy < dy + h && dy < sy + h;
      const corner = (sx <= dx && dx < sx + w && sy <= dy && dy < sy + h) || (dx <= sx && sx < dx + w && dy <= sy && sy < dy + h);
      if (overlap && !corner) continue;
      const buffer = rng.choice(RANGE6);
      lab.block_copy(sx, sy, w, h, dx, dy, 1, buffer);
      if (corner) { refused += 1; fr.expect_errlog = refused; continue; }
      copies += 1;
      expected.push([buffer, sx, sy, w, h, dx, dy]);
      s.ref.get(buffer).copy_from(s.ref.get(buffer), sx, sy, w, h, dx, dy);
    }
  });
  let cmds = commands(frame);
  check(cmds.length === copies && refused > 0, () => [cmds.length, copies, refused]);
  check(frame.errlog.every(([code, , args]) => code === 0x17001004 && deepEqual(args.slice(0, 3), [2, 195, 1])), () => frame.errlog);
  cmds.slice(0, expected.length).forEach((command, k) => {
    const [buffer, sx, sy, w, h, dx, dy] = expected[k];
    const c = command.command;
    const got = [c.name, c.src, c.dst, c.w, c.h, c.src_stride, c.dst_stride, command.result];
    check(deepEqual(got, ['COPY', s.base(buffer) + sy * STRIDE + sx, s.base(buffer) + dy * STRIDE + dx, w, h, STRIDE, STRIDE, 0]), () => got);
  });
  s.compare();
  n += copies + refused;
  frame = drawing(lab, () => { lab.block_copy(200, 300, 100, 80, 250, 260, 1, 3); }, { expect: ['COPY_OVERLAP'] });
  cmds = commands(frame);
  check(cmds.length === 1 && cmds[0].result === fmt.ERROR_CODE.COPY_OVERLAP);
  s.compare([3]);
  return n + 1 + cross_copies(s);
}

const OSD_DEBUG_PRINT = 0x603657C0;
const BCOPY_REFUSED = 'OSD DrawArea Err(Bcopy). \n';

function cross_copies(s) {
  const { lab, rng } = s;
  const kinds = [0, 1, 2, 3, 4, 5, 6].map((b) => lab.surfaces[b].kind);
  check(deepEqual(kinds, [0, 0, 1, 1, 2, 2, 3]), () => kinds);
  lab.clear(6);
  s.ref.set(6, new fmt.Surface(STRIDE, lab.surfaces[6].height));
  drawing(lab, () => {
    for (let i = 0; i < 4; i++) {
      const [x, y, w, h] = random_box(rng);
      const colour = rng.randrange(1, 256);
      lab.rectangle(x, y, w, h, colour, 1, 6);
      s.ref.get(6).fill(x, y, w, h, colour);
    }
  });
  const expected = [];
  let refused = 0, frame;
  lab.sim.write(OSD_DEBUG_PRINT, new Uint8Array([1]));
  const events = lab.kernel.events.length;
  try {
    frame = drawing(lab, () => {
      for (let a = 0; a < 7; a++) {
        for (let b = 0; b < 7; b++) {
          if (a === b) continue;
          const w = rng.randrange(1, 200), h = rng.randrange(1, 200);
          const sx = rng.randrange(WIDTH - w), sy = rng.randrange(HEIGHT - h);
          const dx = rng.randrange(WIDTH - w), dy = rng.randrange(HEIGHT - h);
          const result = lab.block_copy(sx, sy, w, h, dx, dy, 1, a, b);
          check((result.d0 & 0xFFFF) === 0, () => [a, b, result.d0]);
          if (kinds[a] === kinds[b] || kinds[a] === 3 || kinds[b] === 3) {      // not a predicate: which copies the model expects
            expected.push([a, b, sx, sy, w, h, dx, dy]);
            s.ref.get(b).copy_from(s.ref.get(a), sx, sy, w, h, dx, dy);
          } else refused += 1;
        }
      }
    });
  } finally {
    lab.sim.write(OSD_DEBUG_PRINT, new Uint8Array([0]));
  }
  const prints = lab.kernel.events.slice(events).filter((e) => e[0] === 'print' && e[2] === BCOPY_REFUSED);
  check(prints.length === refused && refused === 24 && expected.length === 18, () => [prints.length, refused, expected.length]);
  const cmds = commands(frame);
  check(cmds.length === expected.length, () => [cmds.length, expected.length]);
  cmds.slice(0, expected.length).forEach((command, k) => {
    const [a, b, sx, sy, w, h, dx, dy] = expected[k];
    const c = command.command;
    const got = [c.name, c.src, c.dst, c.w, c.h, command.result];
    check(deepEqual(got, ['COPY', s.base(a) + sy * STRIDE + sx, s.base(b) + dy * STRIDE + dx, w, h, 0]), () => [a, b, got]);
  });
  s.compare([...BUFFERS, 6]);
  return 42;
}

// ---------------------------------------------------------------- 7
function bitmaps(s) {
  const { lab, rng } = s;
  const recs = RES.records().filter((r) => r.width <= 1024 && r.lines <= 1024);
  const byFmt = new Map([0x0B, 0x03, 0x0A, 0x02].map((f) => [f, recs.filter((r) => r.fmt === f)]));
  const sample = [...rng.sample(byFmt.get(0x0B), 40), ...byFmt.get(0x03), ...byFmt.get(0x0A), ...rng.sample(byFmt.get(0x02), 20)];
  rng.shuffle(sample);
  const blobs = RES.blobs();
  RES.load(lab.sim, blobs, sample);
  s.clear();
  const plan = [];
  let buffer = 0, x = 0, y = 0, shelf = 0;
  for (const r of sample) {
    const data = RES.bitmap_bytes(r, blobs);
    const [width, lines, f, pixels, used] = fmt.decode_bitmap(data);
    check(width === r.width && lines === r.lines && f === r.fmt && used === r.size, () => r);
    if (x + width > WIDTH) { x = 0; y += shelf; shelf = 0; }
    if (y + lines > HEIGHT) { buffer += 1; x = 0; y = 0; shelf = 0; }
    check(buffer < BUFFERS.length, 'sample does not fit in six buffers');
    let lut;
    if (f === 0x02 || f === 0x0A) lut = Uint8Array.from([0, ...Array.from({ length: 15 }, () => rng.randrange(1, 256))]);
    else if (rng.random() < 0.5) lut = Uint8Array.from([0, ...Array.from({ length: 255 }, () => rng.randrange(1, 256))]);
    else lut = null;
    plan.push([r, buffer, x, y, width, lines, pixels, lut]);
    x += width; shelf = Math.max(shelf, lines);
  }
  let luts = 0;
  for (let start = 0; start < plan.length; start += 20) {
    const batch = plan.slice(start, start + 20);
    const frame = drawing(lab, () => {
      for (const [r, b, bx, by, width, lines, pixels, lut] of batch) {
        lab.bitmap(bx, by, r.address, lut, 1, b);
        s.ref.get(b).blit(bx, by, width, lines, pixels, lut);
      }
    });
    const fc = commands(frame), cmds = fc.map((c) => c.command);
    const expect = [];
    for (const [r, b, bx, by, , , , lut] of batch) {
      if (lut !== null && (r.fmt === 0x03 || r.fmt === 0x0B)) { expect.push(['LUT', null]); luts += 1; }      // not a predicate: the expected command list
      expect.push(['BITMAP', s.base(b) + by * STRIDE + bx]);
    }
    check(deepEqual(cmds.map((c) => [c.name, c.dst ?? null]), expect), () => cmds);
    check(fc.every((c) => c.result === 0));
    const tables = cmds.filter((c) => c.name === 'LUT').map((c) => c.table);
    check(deepEqual(tables, tables.map((_, k) => 0xA2F5C400 + 256 * k)), () => tables.map((t) => '0x' + t.toString(16)));
  }
  s.compare();
  const icon = byFmt.get(0x0B).find((r) => fmt.decode_bitmap(RES.bitmap_bytes(r, blobs))[3].includes(0));
  if (icon === undefined) throw new RuntimeError('generator raised StopIteration');
  RES.load(lab.sim, blobs, [icon]);
  drawing(lab, () => { lab.rectangle(100, 100, icon.width + 20, icon.lines + 20, 9, 1, 0); });
  s.ref.get(0).fill(100, 100, icon.width + 20, icon.lines + 20, 9);
  const frame = drawing(lab, () => { lab.bitmap(110, 110, icon.address, null, 1, 0); }, { expect: ['BMP_TRANSPARENCY'] });
  check(deepEqual(commands(frame).map((c) => c.command.name), ['BITMAP']));
  s.compare([0]);
  return [plan.length + 1, luts];
}

// ---------------------------------------------------------------- 8
function unknowns(s) {
  const lab = s.lab;
  let n = 0;
  const icon = RES.records()[0];
  const cases = [
    ['GUARD', () => lab.rectangle(1500, 1100, 200, 200, 3, 1, 2)],
    ['BMP_SCALE', () => lab.bitmap(10, 10, icon.address, null, 1, 1, 40, 20)],
    // (format 5: no bitmap record of E143's resources has it, X; format 1, the case before, is E145's 4-bit form since
    // 2026-10-29, docs/model-survey.md finding 20)
    ['BMP_FORMAT', () => lab.bitmap(10, 10, lab.alloc(cat(fmt.make_header(8, 4, 0x05), new Uint8Array(64)), 8), new Uint8Array([0, 1, 2, 3]), 1, 1)],
  ];
  for (const [name, draw] of cases) {
    drawing(lab, () => { draw(); }, { expect: [name] });
    const frame = drawing(lab, () => { lab.rectangle(5, 5, 3, 3, 1, 1, 5); });
    const cmds = commands(frame);
    check(cmds.length === 1 && cmds[0].result === 0);
    s.ref.get(5).fill(5, 5, 3, 3, 1);
    n += 1;
  }
  s.compare();
  return n;
}

// ---------------------------------------------------------------- 9
function fifo_mode(s) {
  const { lab, rng } = s;
  drawing(lab, () => { lab.set_fifo_mode(true); });
  check(unpack('<H', lab.sim.read(DRV_MODE, 2))[0] === 0);
  for (let k = 0; k < 4; k++) {
    const calls = [];
    const frame = drawing(lab, () => {
      for (let i = 0; i < 7; i++) {
        const [x, y, w, h] = random_box(rng);
        const colour = rng.randrange(1, 256), buffer = rng.choice(RANGE6);
        lab.rectangle(x, y, w, h, colour, 1, buffer);
        calls.push([buffer, x, y, w, h, colour]);
      }
    });
    check(lab.engine.register(0x24) === 2 && lab.engine.u32(0x20) === 0);
    const cmds = commands(frame);
    check(deepEqual(cmds.map((c) => c.source), Array(7).fill(0xF1F0)));
    cmds.slice(0, calls.length).forEach((command, i) => {
      const call = calls[i];
      s.fill_decoded(command, ...call);
      s.ref.get(call[0]).fill(...call.slice(1));
    });
  }
  let frame = drawing(lab, () => {
    for (let i = 0; i < 8; i++) lab.rectangle(10 + 20 * i, 1000, 10, 10, 30 + i, 1, 1);
  }, { errlog: 2 });
  check(deepEqual(frame.errlog.map(([code, , args]) => [code, args.slice(0, 2)]), [[0x17000005, [1, 1362]], [0x17001004, [2, 195]]]), () => frame.errlog);
  check(commands(frame).length === 7);
  for (let i = 0; i < 7; i++) s.ref.get(1).fill(10 + 20 * i, 1000, 10, 10, 30 + i);
  drawing(lab, () => { lab.set_fifo_mode(false); });
  check(unpack('<H', lab.sim.read(DRV_MODE, 2))[0] === 1 && lab.engine.register(0x18) === 0x0B729B88);
  check(lab.sim.u32(DRV_CMDBUF) === CMDBUF + 0x80);
  frame = drawing(lab, () => {
    for (let i = 0; i < 100; i++) {
      const [x, y, w, h] = random_box(rng);
      const colour = rng.randrange(1, 256), buffer = rng.choice(RANGE6);
      lab.rectangle(x, y, w, h, colour, 1, buffer);
      s.ref.get(buffer).fill(x, y, w, h, colour);
    }
  });
  check(lab.engine.register(0x24) === 1 && commands(frame).length === 100);
  s.compare();
  return 4 * 7 + 7 + 100;
}

// ---------------------------------------------------------------- 10
function palettes(s) {
  const lab = s.lab;
  let n = 0;
  for (const [layer, plane, pid, count] of [[0, 1, 62, 256], [1, 2, 63, 256], [2, 0, 61, 32]]) {
    const colours = gui_palette(lab.image, pid).slice(0, count);
    check(lab.sim.read(0x613286C4 + layer, 1)[0] === plane);
    lab.set_palette(layer, colours);
    const got = lab.sim.read(PALETTE_ARRAYS[plane], 4 * count);
    check(bytesEq(got, cat(...colours.map((c) => fmt.argb_to_osddraw(c)))), () => [layer, pid]);
    n += 1;
  }
  for (const [kind, pid] of fmt.SHOOTING_PALETTE_FOR_PLANE) check(choose_palette(lab.image, kind)[0] === pid);
  check(choose_palette(lab.image, 3, 61)[2] === 'given');
  for (const [kind, pid] of [[3, null], [0, 0], [0, -1], [0, 100000]]) {
    let raised = false;
    try { choose_palette(lab.image, kind, pid); } catch (e) { if (!isValueError(e)) throw e; raised = true; }
    if (!raised) throw new AssertionError(`palette for kind ${kind}, id ${pid} accepted`);
  }
  for (let pid = 1; pid < 131; pid++) if (gui_palette(lab.image, pid).length !== 256) { check(false); }
  return n;
}

// ---------------------------------------------------------------- 11
function registers(s) {
  const lab = s.lab;
  let n = 0;
  const store = '60', load = '70', storeByte = 'f050';
  const cpu = (code, address, value = 0) => {
    lab.sim.write(SCRATCH, hexBytes(code));
    lab.sim.reset({ pc: SCRATCH, a0: address, d0: value });
    return lab.sim.run([], true);
  };
  const expect = (names) => {
    const errors = lab.engine.errors().map((e) => e.name);
    check(deepEqual(errors, names), () => [errors, names]);
    lab.engine.clear();
    n += 1;
  };
  const runFifo = (words) => {
    for (const word of words) cpu(store, 0x9BC00028, word);
    cpu(store, 0x9BC00024, 2);
  };
  check(cpu(store, 0x9BC00010, 1).fault === 2);
  expect(['REG_UNKNOWN']);
  check(cpu(storeByte, 0x9BC00004, 1).fault === 2);
  expect(['REG_UNKNOWN']);
  check(cpu(load, 0x9BC00018).fault === 0);
  expect(['REG_READ_UNUSED']);
  cpu(store, 0x9BC00024, 3);
  expect(['START_MODE']);
  cpu(store, 0x9BC00030, 1);
  cpu(store, 0x9BC00030, 0);
  expect(['TRIGGER']);
  cpu(store, 0x9BC0002C, 1);
  for (let i = 0; i < 33; i++) cpu(store, 0x9BC00028, 0xFF);
  expect(['FIFO_OVERFLOW']);
  cpu(store, 0x9BC0002C, 1);
  check(lab.engine.u32(0x20) === 0);
  const dst = s.base(5) + 10;
  const fill = [(0x310 | (Math.floor(dst / 2 ** 29) << 24)) >>> 0, 5, (dst & 0x1FFFFFFF) * 8, ((STRIDE >> 7) << 23 | 1 << 11 | 1) >>> 0];
  check(fill[3] >>> 23 === 13 && decode_command(fill).dst === s.base(5) + 10);
  const cases = [
    [[0, 0xFF], ['OPCODE_UNKNOWN']],
    [[0xFF, 0x10], ['SEQUENCE']],
    [fill, ['SEQUENCE']],
    [[((fill[0] & ~0xFF00) | 0x500) >>> 0, ...fill.slice(1), 0xFF], ['DEPTH']],
    [[fill[0], 0x105, ...fill.slice(2), 0xFF], ['COLOR_HIGH']],
    [[(fill[0] | 1 << 22) >>> 0, ...fill.slice(1), 0xFF], ['WORD_BITS']],
    [[...fill.slice(0, 3), (fill[3] | 0x7FF) >>> 0, 0xFF], ['GUARD']],
    [[0x41, 0, 0xFF], ['OPCODE_UNMODELED']],
    [[0x40, 0x12345678 >> 6, 0xFF], ['DMA_RANGE']],
    [[0xDEAD00FF], ['WORD_BITS']],
    [[...fill, 0x100FF], ['WORD_BITS']],
    [[...fill, 0xFF], []],
  ];
  for (const [words, names] of cases) { runFifo(words); expect(names); }
  s.ref.get(5).fill(10, 0, 2, 2, 5);
  lab.sim.write(SCRATCH + 0x100, pack('<2I', 0x77, 0xFF));
  cpu(store, 0x9BC00018, (SCRATCH + 0x100) >>> 4);
  cpu(store, 0x9BC00024, 1);
  expect(['OPCODE_UNKNOWN']);
  lab.sim.write(SCRATCH + 0x100, pack('<I', 0xDEAD00FF));
  cpu(store, 0x9BC00024, 1);
  expect(['WORD_BITS']);
  const executed = lab.engine.u32(0x1C);
  lab.sim.write(SCRATCH + 0x100, repeat(pack('<2I', 0x40, (SCRATCH + 0x200) >>> 6), 0x2000));
  cpu(store, 0x9BC00024, 1);
  check(lab.engine.u32(0x1C) - executed === 0x2000 && lab.engine.exec_total() === 0x2000, () => lab.engine.u32(0x1C) - executed);
  check(lab.engine.error_total() === 1 && deepEqual(lab.engine.errors().map((e) => e.name), ['LIST_NO_END']), () => lab.engine.errors());
  lab.engine.clear();
  n += 1;
  for (let i = 0; i < 66; i++) cpu(load, 0x9BC00018);
  cpu(store, 0x9BC00024, 3);
  const errors = lab.engine.errors().map((e) => e.name);
  check(lab.engine.error_total() === 67 && deepEqual(errors, [...Array(63).fill('REG_READ_UNUSED'), 'START_MODE']), () => errors);
  lab.engine.clear();
  n += 1;
  cpu(store, 0x9BC00018, 0x0B729B88);
  cpu(store, 0x9BC00004, 3);
  check(lab.engine.irq_line() === 0 && lab.engine.register(0x18) === 0x0B729B88);
  s.compare();
  drawing(lab, () => { lab.rectangle(20, 20, 5, 5, 44, 1, 5); });
  s.ref.get(5).fill(20, 20, 5, 5, 44);
  s.compare([5]);
  return n - 1;
}

// ---------------------------------------------------------------- 12
function long_batch(s, count = 300) {
  const { lab, rng } = s;
  const calls = [], executed = lab.engine.u32(0x1C);
  const frame = drawing(lab, () => {
    for (let i = 0; i < count; i++) {
      const x = rng.randrange(WIDTH - 8), y = rng.randrange(HEIGHT - 8);
      const w = rng.randrange(1, 9), h = rng.randrange(1, 9), colour = rng.randrange(1, 256), buffer = rng.choice(RANGE6);
      lab.rectangle(x, y, w, h, colour, 1, buffer);
      s.ref.get(buffer).fill(x, y, w, h, colour);
      calls.push([buffer, x, y, w, h, colour]);
    }
  });
  check(frame.command_total === count && count === lab.engine.u32(0x1C) - executed, () => frame.command_total);
  const cmds = commands(frame);
  check(deepEqual(cmds.map((c) => c.seq), Array.from({ length: 256 }, (_, k) => count - 256 + k)));
  const tail = calls.slice(count - 256);
  cmds.slice(0, tail.length).forEach((command, k) => s.fill_decoded(command, ...tail[k]));
  s.compare();
  return count;
}

// ---------------------------------------------------------------- 13
function edges(s) {
  const lab = s.lab;
  let n = 0;
  const calls = [[1590, 0, 20, 5, 7], [1650, 10, 14, 5, 8], [-5, 20, 20, 5, 9]];
  let frame = drawing(lab, () => { for (const [x, y, w, h, colour] of calls) lab.rectangle(x, y, w, h, colour, 1, 3); });
  const cmds = commands(frame);
  check(cmds.length === calls.length);
  cmds.slice(0, calls.length).forEach((command, k) => {
    const [x, y, w, h, colour] = calls[k];
    const offset = y * STRIDE + (x & 0xFFFF);
    s.fill_decoded(command, 3, offset % STRIDE, Math.floor(offset / STRIDE), w, h, colour);
    s.ref.get(3).fill(offset % STRIDE, Math.floor(offset / STRIDE), w, h, colour);
    n += 1;
  });
  check(cmds[2].command.dst === s.base(3) + 59 * STRIDE + 635);
  drawing(lab, () => { lab.rectangle(0, 1196, 10, 5, 7, 1, 3); }, { expect: ['GUARD'] });
  n += 1;
  s.compare([3]);
  try {
    drawing(lab, () => {
      lab.rectangle(30, 30, 4, 4, 11, 1, 3);
      throw new KeyError('body');
    });
    throw new AssertionError('drawing() swallowed the exception');
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
    check(e.notes.some((note) => note.includes('exec_end returned 0x0')), () => e.notes);
  }
  check(deepEqual(lab.driver(), { open: 0, busy: 0, mode: 1, pointer: 0, count: 0 }), () => lab.driver());
  s.ref.get(3).fill(30, 30, 4, 4, 11);
  drawing(lab, () => { lab.rectangle(40, 30, 4, 4, 12, 1, 3); });
  s.ref.get(3).fill(40, 30, 4, 4, 12);
  s.compare([3]);
  n += 1;
  lab.sim.write(SCRATCH, hexBytes('70'));
  lab.sim.reset({ pc: SCRATCH, a0: 0x9BC00018 });
  check(lab.sim.run([], true).fault === 0);
  lab.rectangle(50, 30, 4, 4, 13, 1, 3);
  try {
    drawing(lab, () => { throw new AssertionError('drawing() entered with errors pending'); });
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    const text = e.message;
    check(text.includes('REG_READ_UNUSED') && text.includes('0x17000001') && text.includes('outside a drawing()'), () => text);
  }
  drawing(lab, () => { lab.rectangle(60, 30, 4, 4, 14, 1, 3); });
  s.ref.get(3).fill(60, 30, 4, 4, 14);
  s.compare([3]);
  n += 1;
  frame = null;
  return n;
}

// ---------------------------------------------------------------- 14
function key_register(s) {
  const { lab, rng } = s;
  const engine = lab.engine;
  check(engine.key_mode() === 'refuse', () => engine.key_mode());
  const w = 24, h = 10;
  const px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push((x + y) % 7 === 0 ? 0 : (x * y) % 11 === 3 ? 5 : rng.randrange(1, 256));
  const pixels = Uint8Array.from(px);
  let lut = Uint8Array.from([0, ...Array.from({ length: 255 }, () => rng.randrange(1, 256))]);
  lut = cat(lut.subarray(0, 5), new Uint8Array(1), lut.subarray(6));
  check(pixels.includes(0) && pixels.includes(5));
  const data = fmt.encode_bitmap(w, h, 0x0B, pixels);
  check(bytesEq(fmt.decode_bitmap(data)[3], pixels));
  const header = lab.alloc(data, 64);
  const plain = Uint8Array.from(pixels, (p) => 1 + (p % 255));
  const headerPlain = lab.alloc(fmt.encode_bitmap(w, h, 0x0B, plain), 64);
  const tokens = [0 << 4 | 0, 1 << 4 | 15, 1 << 4 | 15, 0, 0];
  let word = 0n;
  tokens.forEach((t, k) => { word += BigInt(t) << BigInt(12 * k); });
  const wb = new Uint8Array(8);
  for (let k = 0; k < 8; k++) wb[k] = Number((word >> BigInt(8 * k)) & 0xFFn);
  const headerBad = lab.alloc(cat(fmt.make_header(w, 1, 0x0B), wb), 64);
  let n = 0;
  const b = 1;
  const cases = [['refuse', 50, 50, ['BMP_TRANSPARENCY'], null],
    ['skip', 100, 50, [], (dst, i) => (i === 0 || lut[i] === 0 ? dst : lut[i])],
    ['write', 150, 50, [], (dst, i) => lut[i]]];
  for (const [mode, x, y, errors, rule] of cases) {
    engine.set_key_mode(mode);
    drawing(lab, () => { lab.rectangle(x - 2, y - 2, w + 4, h + 4, 9, 1, b); });
    s.ref.get(b).fill(x - 2, y - 2, w + 4, h + 4, 9);
    let frame = drawing(lab, () => { lab.bitmap(x, y, header, lut, 1, b); }, { expect: errors });
    check(frame.key_hits === 1, () => [mode, frame.key_hits]);
    if (rule) {
      const ref = s.ref.get(b);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const a = (y + r) * STRIDE + x + c;
        ref.data[a] = rule(ref.data[a], pixels[r * w + c]);
      }
    }
    s.compare([b]);
    n += 1;
    frame = drawing(lab, () => { lab.bitmap(x, y + 100, header, lut, 1, b); });
    s.ref.get(b).blit(x, y + 100, w, h, pixels, lut);
    check(frame.key_hits === 0, () => [mode, 'over zero', frame.key_hits]);
    frame = drawing(lab, () => { lab.bitmap(x, y + 200, headerPlain, null, 1, b); });
    s.ref.get(b).blit(x, y + 200, w, h, plain);
    check(frame.key_hits === 0, () => [mode, 'plain', frame.key_hits]);
    s.compare([b]);
    n += 2;
    drawing(lab, () => { lab.rectangle(x - 2, y + 298, w + 4, 5, 9, 1, b); });
    s.ref.get(b).fill(x - 2, y + 298, w + 4, 5, 9);
    frame = drawing(lab, () => { lab.bitmap(x, y + 300, headerBad, null, 1, b); }, { expect: ['BMP_TOKEN'] });
    check(frame.key_hits === 0, () => [mode, 'refused for BMP_TOKEN', frame.key_hits]);
    s.compare([b]);
    n += 1;
  }
  engine.set_key_mode('refuse');
  check(engine.key_mode() === 'refuse');
  try {
    engine.set_key_mode('maybe');
    throw new AssertionError('unknown key mode accepted');
  } catch (e) {
    if (!isValueError(e)) throw e;
    n += 1;
  }
  return n;
}

// capture.Capture.install's group wrapper: begin / end marks through env.rec (osdcalls' recorder), none otherwise.
function group(env, fn, label) {
  return (...args) => {
    const lab = args[0] instanceof OsdLab ? args[0] : args[0].lab;
    const extra = args.slice(1);
    // the label names the group's str arguments as the osd scenario's devices layer records it: begin boxes['rect']
    const begin = `begin ${label}${extra.length ? `[${extra.map((x) => `'${x}'`).join(', ')}]` : ''}`;
    env.rec?.mark(begin, lab);
    const result = fn(...args);
    env.rec?.mark(`end ${label}`, lab, result, true);
    return result;
  };
}

export function check_osd(env, image, seed = 1, kernel = 'native') {
  const say = env.print ?? ((line) => console.log(line));
  REC = env.rec ?? null;
  const G = Object.fromEntries(Object.entries({ stubs, native_init, boxes, outlines, block_copies, bitmaps, unknowns, fifo_mode,
    palettes, registers, long_batch, edges, key_register }).map(([k, f]) => [k, group(env, f, k)]));
  say(`seed ${seed}`);
  const rng = newRandom(seed);
  const start = performance.now();
  const make = () => new OsdLab({ ...env, rom: image }, 0, kernel);
  const lab = env.rec ? env.rec.ctor(make) : make();
  try {
    const s = new Session(lab, rng);
    say(`1 HLE stubs: ${G.stubs(lab)} checks passed`);
    say(`2 native init (15 MM constructors + osddraw_init), lab machine: ${G.native_init(s)} checks passed`);
    say(`3 gpiDrawOsdRectangle: ${G.boxes(s, 'rect')} rectangles, commands and 6 buffers match`);
    say(`4 gpiDrawOsdLine: ${G.boxes(s, 'line')} boxes match`);
    say(`5 osddraw_exec_rect outline: ${G.outlines(s)} outlines match (incl. h == 2*line -> SIZE_4096)`);
    say(`6 gpiDrawOsdBlockCopy: ${G.block_copies(s)} copies/refusals match (incl. COPY_OVERLAP; 42 cross-record calls: 18 COPY, 24 refused by kind)`);
    const [count, luts] = G.bitmaps(s);
    say(`7 gpiDrawBitmap: ${count - 1} resource bitmaps (${luts} with a LUT command) match; index 0 over pixels -> BMP_TRANSPARENCY`);
    say(`8 unknown behaviour is an error: ${G.unknowns(s)} cases (GUARD, BMP_SCALE, BMP_FORMAT)`);
    say(`9 FIFO mode and back: ${G.fifo_mode(s)} rectangles; 8th FIFO command refused by the firmware`);
    say(`10 GPISetPalette -> osddraw arrays: ${G.palettes(s)} layers match the image palettes`);
    say(`11 engine registers and command words outside the firmware paths: ${G.registers(s)} cases recorded as errors, plus a valid FIFO FILL`);
    say(`12 one batch of ${G.long_batch(s)} rectangles: engine counts all, keeps the newest 256 in its log, 6 buffers match`);
    say(`13 edges: ${G.edges(s)} cases (off-screen rectangles, GUARD at row 1200, drawing() after a raising body and after errors between brackets)`);
    say(`14 U1 key register: ${G.key_register(s)} cases (default refuse = BMP_TRANSPARENCY; A skip and B write give their predicted rasters; hit counter exact; key pixels over equal bytes, bitmaps without them and a bitmap refused for BMP_TOKEN never hit)`);
    s.draw_path_only();
    say(`engine IRQ ${IRQ_ENGINE} serviced ${lab.isr_runs} times by firmware handler ${h8(ENGINE_ISR)}; ${((performance.now() - start) / 1000).toFixed(1)} s`);
  } finally {
    lab.close();
  }
}

function main(argv) {
  const a = parseArgs('check_osd.mjs', argv, [
    { opt: '--image', type: 'path' }, { opt: '--seed', type: 'int' },
    { opt: '--kernel', type: 'str', choices: ['native', 'none'] },
  ]);
  try {
    check_osd(labEnv(), a.image ? readBytes(a.image) : readBytes(ORIGINAL), a.seed ?? 1, a.kernel ?? 'native');
  } catch (e) {
    if (e instanceof FirmwareError) throw new SystemExit(`FAILED: ${e.message}`);     // EngineError is a FirmwareError
    throw e;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_osd.mjs', main);
