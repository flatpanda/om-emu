// Architecture finding F05 (ARCHITECTURE.md): rebasing a running VSC channel when LINE_NS changes in the debug window
// without write notification. Verifies without firmware that changing LINE_NS shorter or longer mid-frame preserves
// MONI3 line continuity, keeps frameStart <= clock.t and nextBoundary >= clock.t, lets CMD_RUN_TO_FRAME and direct
// clock.advance complete without an "event in the past" error, and stops the channel when LINE_NS is cleared to 0.
//   node emu/test/test_vsc_rebase.mjs
import { createMachine } from '../src/machine.mjs';
import { CH, CHAN_STRIDE, D, E, R, REG_WORDS, chanDbg } from '../src/dev/vsc.mjs';

const CMD_ADVANCE = 1, CMD_RUN_TO_FRAME = 2;

function fresh(c = 0) {
  const m = createMachine({ rom: new Uint8Array(0x1000) });
  const v = m.devices.vsc, clock = v.clock;
  // Seed minimal register tables so VSC read/write/boundary work without a firmware image.
  v.chanValid = new Uint8Array(REG_WORDS);
  v.outValid = new Uint8Array(REG_WORDS);
  const regs = [R.INTEN1, R.INTST1, R.MONI3, R.SYNC2, R.SYNC4, R.SYNC8].filter((x) => x !== undefined);
  v.chanRegs = [...new Set(regs)].sort((a, b) => a - b);
  for (const off of v.chanRegs) v.chanValid[off / 4] = 1;
  const base = c * CHAN_STRIDE;
  const regW = (off, val) => v.write(base + off, val, 4, false);
  const regR = (off) => v.read(base + off, 4, false);
  const setLineNs = (ns) => v.dset(chanDbg(c, CH.LINE_NS), ns);
  const advance = (ns) => {
    v.dset(D.ARG0, ns % 4294967296);
    v.dset(D.ARG1, Math.floor(ns / 4294967296));
    v.doorbell(0, CMD_ADVANCE | (c << 8), 4, false);
  };
  const runToFrame = () => {
    v.doorbell(0, CMD_RUN_TO_FRAME | (c << 8), 4, false);
    return v.dget(D.LAST_RESULT);
  };
  const line = () => v.moni3(c) & 0x7FFF;
  return { m, v, ch: v.ch[c], clock, regW, regR, setLineNs, advance, runToFrame, line };
}

export function vscRebaseUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 1. Shorter LINE_NS mid-frame (the classic past-event crash case), then longer LINE_NS in the next frame.
  {
    const t = fresh(0);
    t.setLineNs(1000);
    t.regW(R.SYNC2, 100);
    ok(t.ch.running && t.ch.curLineNs === 1000 && t.ch.frameStart === 0 && t.v.nextBoundary(0) === 100000,
      `start: running=${t.ch.running} curLineNs=${t.ch.curLineNs} frameStart=${t.ch.frameStart} next=${t.v.nextBoundary(0)}`);

    // Advance to line 80.5 (80500 ns)
    t.advance(80500);
    ok(t.clock.t === 80500 && t.line() === 80, `mid-frame: t=${t.clock.t} line=${t.line()}`);

    // Shorten LINE_NS to 500 (without rebase, 0 + 100 * 500 = 50000 < 80500 would be in the past)
    t.setLineNs(500);
    ok(t.line() === 80, `moni3 before sync must not jump: line=${t.line()}`);
    const m3 = t.regR(R.MONI3) & 0x7FFF; // triggers chanSync(0)
    ok(m3 === 80 && t.ch.curLineNs === 500 && t.ch.frameStart === 40500 && t.ch.frameStart <= t.clock.t,
      `after shorter sync: m3=${m3} curLineNs=${t.ch.curLineNs} frameStart=${t.ch.frameStart} t=${t.clock.t}`);
    ok(t.v.nextBoundary(0) === 90500 && t.v.nextBoundary(0) >= t.clock.t,
      `nextBoundary after shorter sync: ${t.v.nextBoundary(0)} vs t=${t.clock.t}`);

    // CMD_RUN_TO_FRAME completes the remaining 20 lines at 500 ns/line = 10000 ns
    const res1 = t.runToFrame();
    ok(res1 === 0 && t.clock.t === 90500 && t.ch.frames === 1 && t.ch.frameStart === 90500 && t.ch.curLineNs === 500,
      `runToFrame after shorter: res=${res1} t=${t.clock.t} frames=${t.ch.frames} frameStart=${t.ch.frameStart} curLineNs=${t.ch.curLineNs}`);

    // Advance 30 lines into frame 1 (15000 ns -> t = 105500), then lengthen LINE_NS to 2000
    t.advance(15000);
    ok(t.clock.t === 105500 && t.line() === 30, `frame 1 line 30: t=${t.clock.t} line=${t.line()}`);
    t.setLineNs(2000);
    // Drive directly via CMD_RUN_TO_FRAME (doorbell runs chanSync before clock.advance)
    const res2 = t.runToFrame();
    ok(res2 === 0 && t.clock.t === 245500 && t.ch.frames === 2 && t.ch.frameStart === 245500 && t.ch.curLineNs === 2000,
      `runToFrame after longer: res=${res2} t=${t.clock.t} frames=${t.ch.frames} frameStart=${t.ch.frameStart} curLineNs=${t.ch.curLineNs}`);
  }

  // 2. Lengthening LINE_NS near t=0 so rebased frameStart < 0 still preserves MONI3 and nextBoundary >= t.
  {
    const t = fresh(0);
    t.setLineNs(100);
    t.regW(R.SYNC2, 100);
    t.advance(5000); // line 50
    t.setLineNs(1000);
    const m3 = t.regR(R.MONI3) & 0x7FFF;
    ok(m3 === 50 && t.ch.frameStart === -45000 && t.ch.frameStart <= t.clock.t && t.v.nextBoundary(0) === 55000,
      `negative frameStart rebase: m3=${m3} frameStart=${t.ch.frameStart} next=${t.v.nextBoundary(0)}`);
    const res = t.runToFrame();
    ok(res === 0 && t.clock.t === 55000 && t.ch.frames === 1 && t.ch.frameStart === 55000,
      `runToFrame from negative frameStart: res=${res} t=${t.clock.t} frames=${t.ch.frames} frameStart=${t.ch.frameStart}`);
  }

  // 3. Multiple consecutive LINE_NS changes at the same clock.t keep line count invariant.
  {
    const t = fresh(0);
    t.setLineNs(1000);
    t.regW(R.SYNC2, 100);
    t.advance(50000); // line 50
    for (const ns of [250, 4000, 1000, 333]) {
      t.setLineNs(ns);
      const m3 = t.regR(R.MONI3) & 0x7FFF;
      ok(m3 === 50 && t.ch.curLineNs === ns && t.v.nextBoundary(0) >= t.clock.t,
        `repeated change to ${ns}: m3=${m3} curLineNs=${t.ch.curLineNs} next=${t.v.nextBoundary(0)}`);
    }
  }

  // 4. Setting LINE_NS = 0 stops the channel, and restoring a non-zero LINE_NS restarts it cleanly.
  {
    const t = fresh(0);
    t.setLineNs(1000);
    t.regW(R.SYNC2, 100);
    t.advance(25000);
    t.setLineNs(0);
    ok(t.v.moni3(0) === 0, `moni3 when LINE_NS=0: ${t.v.moni3(0)}`);
    const res = t.runToFrame();
    ok(res === E.NOT_RUNNING && !t.ch.running && t.ch.curLineNs === 0 && t.clock.t === 25000,
      `LINE_NS=0 stops channel: res=${res} running=${t.ch.running} curLineNs=${t.ch.curLineNs} t=${t.clock.t}`);

    // Restart with a new LINE_NS
    t.setLineNs(800);
    t.regR(R.MONI3);
    ok(t.ch.running && t.ch.curLineNs === 800 && t.ch.frameStart === 25000 && t.v.nextBoundary(0) === 105000,
      `restart after stop: running=${t.ch.running} curLineNs=${t.ch.curLineNs} frameStart=${t.ch.frameStart} next=${t.v.nextBoundary(0)}`);
  }

  // 5. Direct clock.advance (without VSC doorbell) after shortening LINE_NS rebases via clockNext().
  {
    const t = fresh(0);
    t.setLineNs(1000);
    t.regW(R.SYNC2, 100);
    t.clock.advance(80000, false);
    t.setLineNs(200); // old frameStart 0 + 100*200 = 20000 < 80000
    t.clock.advance(85000, false); // rebased boundary is 80000 + 20*200 = 84000
    ok(t.clock.t === 85000 && t.ch.frames === 1 && t.ch.frameStart === 84000 && t.ch.curLineNs === 200 && t.line() === 5,
      `direct clock.advance: t=${t.clock.t} frames=${t.ch.frames} frameStart=${t.ch.frameStart} curLineNs=${t.ch.curLineNs} line=${t.line()}`);
  }

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = vscRebaseUnits();
  console.log(`vsc rebase: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
