// The date prompt's end within a display switch's step, read to its cause (src/lab/play.mjs live_switch's prompt rule;
// docs/hle-gaps/4.6.md 4.6.10), in play on the process's model (E143 here; bin/test.mjs runs E146 and E147 each in a
// process of its own):
//   promptendSession  the application's event ring: the settings init chain's step whose first call sizes it (E143's
//                     step 10, 0x503ea27e -> 0x503eb3df: `mov 300,d0`, the head, tail and base words, the size's
//                     halfword), read from the chain by its bytes; its size 300 after the start with the chain, 0
//                     with the off switch (OM_EMU_SETTINGS_CHAIN=0, the narrow H-STOREINIT). From the start's date
//                     prompt (0x0108 panel 324) a switch to the EVF builds the prompt again and, with the ring, lands
//                     on the shooting screen within the step (prompt_ended; on E143 EV_EYESENSOR_STATUS 198
//                     dispatched through 0x50ab8974 in the step). Control: the ring's size zeroed after the start
//                     (the narrow path's state of it): the switch ends on the prompt with no 198, and the prompt gives
//                     way to panel 10 at idle after the step
//   node emu/test/test_promptend.mjs              (OM_EMU_MODEL=E146 or E147 for those bodies)
import fs from 'node:fs';
import path from 'node:path';

const EMU = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IMG = 0x50000000;
const h8 = (v) => '0x' + (v >>> 0).toString(16);

// The ring's sizing in the chain: a step `clr d0; movhu d0,(abs32); call rel16` whose callee starts `mov 300,d0; mov
// imm32,a0; mov a0,(abs32) x3; movhu d0,(abs32)` (D: E143 0x503eb3df, E146 0x503e75d1, E147 0x503f52d7). Returns
// {step (1-based), init, size_at (the size halfword's address)} or null.
export function eventRing(rom, chain) {
  const b = (a, n) => rom.subarray(a - IMG, a - IMG + n);
  const u32 = (a) => new DataView(rom.buffer, rom.byteOffset + a - IMG, 4).getUint32(0, true);
  const found = [];
  chain.steps.forEach((s, i) => {
    const p = b(s, 10);
    if (!(p[0] === 0x00 && p[1] === 0xfc && p[2] === 0x83 && p[7] === 0xcd)) return;
    const init = (s + 7 + (((p[8] | p[9] << 8) << 16) >> 16)) >>> 0, q = b(init, 33);
    const form = q[0] === 0x2c && q[1] === 0x2c && q[2] === 0x01 && q[3] === 0xfc && q[4] === 0xdc
      && [9, 15, 21].every((k) => q[k] === 0xfc && q[k + 1] === 0x80) && q[27] === 0xfc && q[28] === 0x83;
    if (form) found.push({ step: i + 1, init, size_at: u32(init + 29) });
  });
  return found.length === 1 ? found[0] : null;
}

export async function promptendSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { settingsChainOf } = await import('../src/lab/menu.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const chain = settingsChainOf(env.rom), ring = chain && eventRing(env.rom, chain);
  ok(ring !== null && ring.step === 10, `${MODEL}: the chain's step that sizes the event ring: ${JSON.stringify(ring && { ...ring, init: h8(ring.init), size_at: h8(ring.size_at) })}`);
  if (!ring) return { checks, bad };
  // E143: the event object's dispatch (a0 the event, its code at +24) and the post of EV_EYESENSOR_STATUS, by bytes
  const E143 = MODEL === 'E143';
  const DISPATCH = 0x50AB8974, EV_EYESENSOR_STATUS = 198;
  if (E143) {
    const at = (a, hex) => Buffer.from(env.rom.subarray(a - IMG, a - IMG + hex.length / 2)).toString('hex') === hex;
    ok(at(DISPATCH, 'cf20f8fefc92ba00') && at(0x50B79AAE, 'fac8c600'), 'E143: the dispatch at 0x50ab8974 and the 198 post at 0x50b79aae by their bytes');
  }
  const open = (more = {}) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'auto', out: '<out>', no_wait_on_error: true }, { ...env, ...more });
    pl.open_session();
    return pl;
  };
  const size = (lab) => lab.sim.u32(ring.size_at) & 0xFFFF;
  const idle = (pl, ms) => { const s = pl.session, lab = s.lab; for (let t = lab.lab_time() + ms * 1e6; lab.lab_time() < t;) s.idle_slice(Math.min(t, lab.lab_time() + 50e6)); };
  const run = (zero) => {
    const pl = open(), s = pl.session, lab = s.lab, seen = [];
    const at = { state: lab.state(), panel: lab.panels.at(-1)?.[1], size: size(lab) };
    if (E143) {
      const f = (r) => seen.push(lab.sim.u32((r.a0 >>> 0) + 24));
      if (lab.hooks.has(runtime(DISPATCH))) lab.wrap(DISPATCH, (prev) => (h, r) => { f(r); return prev(h, r); });
      else lab.observe(DISPATCH, (l, r) => f(r), 'test: the event dispatch');
    }
    if (zero) lab.sim.write(ring.size_at, Uint8Array.of(0, 0));
    let rec = null, e = null;
    try { rec = s.display_input('eye', 1); } catch (x) { e = x.message.split('\n')[0]; }
    const step = { seen: [...seen], panel: lab.panels.at(-1)?.[1] };
    idle(pl, 400);
    const after = { panel: lab.panels.at(-1)?.[1], label: lab.panels.at(-1)?.[0] };
    try { pl.close_session(); } catch { /* the session ended */ }
    return { at, rec, e, step, after };
  };
  {
    const r = run(false), sw = r.rec?.switch;
    ok(r.at.state === 0x0108 && r.at.panel === 324 && r.at.size === 300, `${MODEL}: the start ends on the date prompt with the ring sized: ${JSON.stringify(r.at)}`);
    ok(r.e === null && sw?.prompt_ended === true && JSON.stringify(sw.panels_on_connect.slice(-3)) === '[0,324,10]' && r.step.panel === 10,
      `${MODEL}: the switch on the prompt lands on the shooting screen within its step: ${r.e ?? JSON.stringify({ prompt_ended: sw?.prompt_ended, panels: sw?.panels_on_connect, panel: r.step.panel })}`);
    if (E143) ok(r.step.seen.includes(EV_EYESENSOR_STATUS), `E143: EV_EYESENSOR_STATUS dispatched in the step: ${JSON.stringify(r.step.seen)}`);
  }
  {
    const r = run(true), sw = r.rec?.switch;
    ok(r.e === null && sw && sw.prompt_ended === undefined && JSON.stringify(sw.panels_on_connect.slice(-2)) === '[0,324]' && r.step.panel === 324
      && r.after.panel === 10 && r.after.label === 'idle',
      `${MODEL} control, the ring's size zeroed: the switch ends on the prompt, which gives way at idle: ${r.e ?? JSON.stringify({ prompt_ended: sw?.prompt_ended, panels: sw?.panels_on_connect, step: r.step.panel, after: r.after })}`);
    if (E143) ok(!r.step.seen.includes(EV_EYESENSOR_STATUS), `E143 control: no EV_EYESENSOR_STATUS in the step: ${JSON.stringify(r.step.seen)}`);
  }
  {
    const pl = open({ settings_chain: '0' }), n = size(pl.session.lab);
    ok(n === 0, `${MODEL}: with the off switch (the narrow H-STOREINIT) the ring's size stays ${n}`);
    try { pl.close_session(); } catch { /* the session ended */ }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(path.join(EMU, 'out'), { recursive: true });
  const r = await promptendSession();
  const { MODEL } = await import('../src/fw/model.mjs');
  console.log(`the date prompt's end at a switch (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
