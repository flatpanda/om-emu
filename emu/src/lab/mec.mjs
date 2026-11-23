// H-MECCOUNT: the shutter mechanism driver's release count (docs/hle-gaps/4.6.md 4.6.6, section 7.2). The driver
// (gap@0x50108fe0 on E143) keeps the count in its global 0x6296597c and in the camera state kind 0x8344, a word of
// store E (template 0 at 0x600e56c8), which the hidden menu's PAGE 2 shows as its MS row (API 0x40406 index 0):
//   the init's read 0x5010f00f..0x5010f025, the end of the driver's counter init 0x5010efc6 (called by 0x501129b0
//     from the driver's init 0x50108fe0): `mov 0x8344,d0` (fc cc lo hi 00 00), `mov 0,a0` (90 00), `clr d1` (04), the
//     camera state read (dd rel32 c0 0c), `mov d0,(counter)` (fc 81 abs32), `ret [],4` (df 00 04);
//   the step 0x5010f8fe..0x5010f91d (called by the three exposure sequences' starts 0x5010f5c3, 0x5010f668,
//     0x5010f6fd): `mov (counter),a1` (fc a1 abs32), `mov 0x8344,d0`, `inc a1` (45), `mov a1,(counter)` (fc 84 abs32),
//     `mov 0,a0`, `clr d1`, the camera state write (dd rel32 f0 28), `ret [],4`.
// The lab runs the init's read at the bring-up (the init's head, its two 0x50114c1a records from the driver's own
// pool, which the driver's init sets up, is not run) and the step at each release S-RELSEQ makes, at its
// START_EXPOSE: the point S-SHUTTERSND stands for the mechanical shutter's start. Both are read by their instructions
// on each body (mecCountSite): the kind and the counter from the site's own bytes, the read and the write checked
// against the camera state read and write the port places; a body where they differ does not count.
import { A, isUnmapped } from '../fw/model.mjs';
import { runtime, FirmwareError } from './hle.mjs';

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const MEC_COUNT_READ = A(0x5010F00F), MEC_COUNT_STEP = A(0x5010F8FE);
export const STATE_READ = A(0x500417DA), STATE_WRITE = A(0x5004188B);
// {kind, counter, read_site, step, read, write, frame} or {why}
export function mecCountSite(v) {
  for (const [a, name] of [[MEC_COUNT_READ, 'the MS counter init\'s read (E143 0x5010f00f)'], [MEC_COUNT_STEP, 'the MS counter step (E143 0x5010f8fe)'],
    [STATE_READ, 'the camera state read (E143 0x500417da)'], [STATE_WRITE, 'the camera state write (E143 0x5004188b)']]) {
    if (isUnmapped(a)) return { why: `the port does not place ${name}` };
  }
  const check = (site, what, want) => {
    const at = runtime(site), bad = want.find(([k, x]) => v.u8(at + k) !== x);
    return bad ? `${what} at ${h8(site)}: byte +${bad[0]} is 0x${v.u8(at + bad[0]).toString(16)}, not 0x${bad[1].toString(16)}` : null;
  };
  const why = check(MEC_COUNT_READ, 'the MS counter init\'s read', [[0, 0xfc], [1, 0xcc], [4, 0], [5, 0], [6, 0x90], [7, 0], [8, 0x04], [9, 0xdd], [14, 0xc0], [15, 0x0c], [16, 0xfc], [17, 0x81], [22, 0xdf], [23, 0x00], [24, 0x04]])
    ?? check(MEC_COUNT_STEP, 'the MS counter step', [[0, 0xfc], [1, 0xa1], [6, 0xfc], [7, 0xcc], [10, 0], [11, 0], [12, 0x45], [13, 0xfc], [14, 0x84], [19, 0x90], [20, 0], [21, 0x04], [22, 0xdd], [27, 0xf0], [28, 0x28], [29, 0xdf], [30, 0x00], [31, 0x04]]);
  if (why) return { why };
  const r = runtime(MEC_COUNT_READ), s = runtime(MEC_COUNT_STEP);
  const kind = v.u16(r + 2), counter = v.u32(r + 18) >>> 0;
  const read = (MEC_COUNT_READ + 9 + (v.u32(r + 10) | 0)) >>> 0, write = (MEC_COUNT_STEP + 22 + (v.u32(s + 23) | 0)) >>> 0;
  if (v.u16(s + 8) !== kind) return { why: `the MS counter step at ${h8(MEC_COUNT_STEP)} writes kind 0x${v.u16(s + 8).toString(16)}, its init reads 0x${kind.toString(16)}` };
  if ((v.u32(s + 2) >>> 0) !== counter || (v.u32(s + 15) >>> 0) !== counter) return { why: `the MS counter step at ${h8(MEC_COUNT_STEP)} keeps another word than its init's ${h8(counter)}` };
  if (read !== STATE_READ) return { why: `the MS counter init's read at ${h8(MEC_COUNT_READ)} calls ${h8(read)}, not the camera state read ${h8(STATE_READ)}` };
  if (write !== STATE_WRITE) return { why: `the MS counter step at ${h8(MEC_COUNT_STEP)} calls ${h8(write)}, not the camera state write ${h8(STATE_WRITE)}` };
  return { kind, counter, read_site: MEC_COUNT_READ, step: MEC_COUNT_STEP, read, write, frame: [v.u8(r + 23), v.u8(r + 24)] };
}

// The count in a play session: bring_up() runs the init's read, step() the driver's step; status() for the session.
export class MecCount {
  constructor(session) { this.s = session; this.site = mecCountSite(session.tables.v); this.steps = 0; this.read = null; }
  get runs() { return !this.site.why; }
  bring_up() {
    if (!this.runs) return;
    const lab = this.s.lab;
    lab.call(this.site.read_site, null, null, this.site.frame, 200000);
    this.read = lab.sim.u32(this.site.counter) >>> 0;
  }
  step() {
    if (!this.runs) return;
    const lab = this.s.lab, before = lab.sim.u32(this.site.counter) >>> 0;
    lab.call(this.site.step, null, null, null, 200000);
    const after = lab.sim.u32(this.site.counter) >>> 0, kept = lab.call(STATE_READ, { d0: this.site.kind, d1: 0, a0: 0 }, null, null, 200000).d0 >>> 0;
    if (after !== ((before + 1) >>> 0) || kept !== after) throw new FirmwareError(`H-MECCOUNT: the step took the count ${before} to ${after}, the camera state 0x${this.site.kind.toString(16)} reads ${kept}`);
    this.steps += 1;
  }
  value() { return this.runs ? this.s.lab.sim.u32(this.site.counter) >>> 0 : null; }
  status() { return this.runs ? { kind: this.site.kind, read: this.read, steps: this.steps, count: this.value() } : { skipped: this.site.why }; }
}
