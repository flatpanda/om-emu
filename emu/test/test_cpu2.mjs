// CPU 2 natively (--cpu2 native, src/lab/cpu2.mjs, src/core/cores.mjs; docs/hle-gaps.md 4.6.1), E143:
//   cpu2Session  a default session has no second core (the machine's cores null, no cpu2 option, S-CPU2 serves the
//                Super Control Panel's post); with --cpu2 native the second core runs CPU 2 from its entry 0x50008f01
//                through its kernel (K-BOOTSYNC2, K-STARTBITS) to its idle loop's halt 0x50038b09 with its 37 static
//                tasks (and CPUCONN's proxy) created and its init task's starts made, its first device accesses and
//                its first cross-core call (USTART_L2's cpu_conn twai_sem on CPU 0's FLASH_CS1) as recorded,
//                AUD_LEVEL_MONITOR started on it through CPUCONN's proxy at AUD_MAIN's start, and the Super Control
//                Panel's posts answered by it with the frame and the reply bytes of the default session's S-CPU2; the
//                control cpu2-no-audmon (that task stood in) leaves the GUI waiting, which the step's check reports
//   coresUnits   (no firmware) the machine's second core on a blank image: each core reads its own core number at
//                0x8050, core 2 stores into its local RAM at 0x50000000 while core 0's flash view refuses a store, the
//                interleave gives core 2 a turn of the quantum per quantum of core 0, a doorbell on bank 2 raises core
//                2's request and not core 0's, and the machine refuses a snapshot
//   node emu/test/test_cpu2.mjs
import { fileURLToPath } from 'node:url';

// MN10300 code: mov (0x8050),d0; mov d0,(abs32); mov imm32,d0; inc d1 / d2; bra to the inc
const MOV_ID = [0x30, 0x50, 0x80], ST = (a) => [0xFC, 0x81, a & 0xff, (a >>> 8) & 0xff, (a >>> 16) & 0xff, a >>> 24];
const IMM = (v) => [0xFC, 0xCC, v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
export function coresUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  return import('../src/machine.mjs').then(({ createMachine }) => {
    const m = createMachine({ rom: new Uint8Array(0x1000), insnLimit: 0, cores: { second: 2, quantum: 1000 } });
    const P0 = 0xA3000000, P2 = 0xA3000100, OUT = 0xA3000800;
    // core 0: its core number to OUT, IRQ 324's level 2 into bank 2 (+0x510) and bank 2's pending bit 8, then a loop
    const p0 = [...MOV_ID, ...ST(OUT), ...IMM(4), ...ST(0x99B00510), ...IMM(8), ...ST(0x99B00808), 0x44, 0xCA, 0xFF];
    // core 2: its core number to OUT + 4 and into its local RAM 0x50002000, then a loop
    const p2 = [...MOV_ID, ...ST(OUT + 4), ...ST(0x50002000), 0x48, 0xCA, 0xFF];
    m.dbgWrite(P0, Uint8Array.from(p0)); m.dbgWrite(P2, Uint8Array.from(p2)); m.dbgWrite(OUT, new Uint8Array(8).fill(0xEE));
    const regs = m.getRegs(); regs[9] = P0; regs[10] = 0; regs[15] = 0; m.setRegs(regs);
    m.cores.start(P2, 0);
    m.cores.interleave = true;
    ok(m.cont({ budget: 10000 }) === 'paused', 'core 0 pauses at its budget');
    m.halt();
    const out = m.dbgRead(OUT, 8), u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
    const st = m.cores.state();
    ok(u32(out, 0) === 0 && u32(out, 4) === 2, `the core numbers: core 0 wrote ${u32(out, 0)}, core 2 ${u32(out, 4)}`);
    ok(!st.parked && st.turns >= 9 && st.insns >= 9000 && st.insns <= 11000, `core 2's turns ${st.turns}, instructions ${st.insns}, parked ${st.parked}`);
    ok(st.irqReq === true && m.devices.intc.presentedMask === 0, `bank 2's doorbell: core 2's request ${st.irqReq}, bank 0's mask ${m.devices.intc.presentedMask}`);
    ok(m.dbgRead(0x50002000, 4).every((b) => b === 0), 'core 0 sees its flash view at 0x50002000 (the blank image), not core 2\'s RAM');
    // core 0 stores into its flash view: a fault 2
    const st0 = [...ST(0x50002000)], at = 0xA3000200;
    m.dbgWrite(at, Uint8Array.from(st0));
    const r2 = m.getRegs(); r2[9] = at; m.setRegs(r2);
    m.step();
    ok(m.lastStop().kind === 'fault' && m.lastStop().code === 2, `core 0's store into the flash view: ${JSON.stringify(m.lastStop())}`);
    let refused = null;
    try { m.snapshot(); } catch (e) { refused = e.message; }
    ok(refused !== null && /second core/.test(refused), `snapshot refused: ${refused}`);
    return { checks, bad };
  });
}

const DEVICES = [['R', '0x98900284', 'om1.timer', '0x50002bfa'], ['W', '0x99b00514', 'om1.intc', '0x50008f72'],
  ['R', '0x97000000', 'om1.isc-locks', '0x50017bd8']];
const BOOT_LOG = ['skip H-CPU2CACHE: (0x98100808) = 16', 'skip H-CPU2UART: "2"', 'skip K-BOOTSYNC2: 0x50015a61',
  'stand-in K-STARTBITS: (u16)0x97f00000 0x0 -> 0xb', 'start BOOT_CPU2', 'start CPUCONN2', 'start CPUCALL2', 'start CONTEST_CPU2',
  'start USTART_L2'];
const STARTS = ['BOOT_CPU2', 'CPUCONN2', 'CPUCALL2', 'CONTEST_CPU2', 'USTART_L2', 'CPUCONN proxy (CPU 0)', 'AUD_LEVEL_MONITOR'];

export async function cpu2Session() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { CPU2_STAND_INS, KCB2 } = await import('../src/lab/cpu2.mjs');
  const { NativeKernel } = await import('../src/lab/kernel.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  const sha = (words) => createHash('sha256').update(new Uint8Array(words.buffer, words.byteOffset, words.byteLength)).digest('hex').slice(0, 16);
  // the shooting screen, 1 s, then OK opens the Super Control Panel, whose GUI posts to CPU 2 every ~210 ms (X)
  const scp = (s) => {
    const lab = s.lab;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) { s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); s.frame(); } };
    idle(1000);
    s.key('ok', 'down'); s.camapp.pump(); idle(100); s.key('ok', 'up'); s.camapp.pump(); idle(1000);
    const [, , words] = s.frame();
    return { gui: s.status().gui, frame: sha(words), reply: Array.from(lab.sim.read(0xA33DA484, 28)).join(','), posts: lab.xcpu_log.length,
      native: lab.xcpu_log.filter((x) => x.native).length, waiting: lab.xcpu_waiting };
  };
  let ref = null;
  {
    const pl = new Player(args, env);
    try {
      pl.open_session();
      const s = pl.session;
      ok(s.lab.sim.m.cores === null && !('cpu2' in pl.opts()) && s.cpu2 === null && pl.stand_ins_in_use().includes('S-CPU2')
        && !pl.stand_ins_in_use().some((x) => CPU2_STAND_INS.includes(x)),
        `default: no second core (cores ${s.lab.sim.m.cores}, options ${JSON.stringify(pl.opts())}), S-CPU2 in use`);
      ref = scp(s);
      ok(ref.gui === '0x0403' && ref.posts > 0 && ref.native === 0 && ref.waiting === 0, `default: S-CPU2 serves the panel's posts: ${JSON.stringify(ref)}`);
    } catch (e) { bad.push(`default: ${e.message.slice(0, 600)}`); }
    pl.close_session();
  }
  {
    const pl = new Player({ ...args, cpu2: 'native' }, env);
    try {
      pl.open_session();
      const s = pl.session, c2 = s.cpu2, st = c2.status(), lab = s.lab;
      const boot = s.steps.flatMap((x) => x.cpu2 ?? []).map(([k, d]) => `${k} ${d}`);
      ok(pl.opts().cpu2 === 'native' && CPU2_STAND_INS.every((x) => pl.stand_ins_in_use().includes(x)) && !pl.stand_ins_in_use().includes('S-CPU2'),
        `native: the option and the stand-ins (${pl.opts().cpu2}, ${pl.stand_ins_in_use().filter((x) => /CPU2|KICK|CORE|INTERLEAVE|STARTBITS|BOOTSYNC2/.test(x))})`);
      ok(st.boot.kind === 'halt' && st.boot.pc === '0x50038b09' && !st.parked && st.interleave,
        `native: core 2 boots to the idle loop's halt 0x50038b09 (${JSON.stringify(st.boot)}, parked ${st.parked})`);
      ok(JSON.stringify(boot.slice(0, BOOT_LOG.length)) === JSON.stringify(BOOT_LOG), `native: the boot's record ${JSON.stringify(boot)}, want ${JSON.stringify(BOOT_LOG)}...`);
      ok(JSON.stringify(st.started.map(([, n]) => n)) === JSON.stringify(STARTS), `native: core 2's task starts ${JSON.stringify(st.started)}`);
      const dev = c2.devices.slice(0, DEVICES.length).map(([d, a, , , r, pc]) => [d, a, r, pc]);
      ok(JSON.stringify(dev) === JSON.stringify(DEVICES), `native: core 2's first device accesses ${JSON.stringify(c2.devices.slice(0, 6))}`);
      const p0 = c2.posts[0];
      ok(p0 && p0.path === 'cpu_conn' && p0.object === '0x81' && p0.kind === 8 && p0.task === '0x2013',
        `native: the first cross-core call is USTART_L2's cpu_conn twai_sem (kind 8) on CPU 0's 0x81 (FLASH_CS1): ${JSON.stringify(p0)}`);
      // CPU 2's kernel: its 37 static tasks and CPUCONN's proxy created, its init task the running one (in the idle
      // loop, halted)
      const nk = new NativeKernel(lab, 2), tasks = nk.tasks(), boot2 = tasks.get(1);
      ok(nk.kcb_addr === KCB2 && tasks.size === 38 && boot2 && boot2[0] === 0x50008FBB && boot2[1] === 'RUN',
        `native: CPU 2's kernel has ${tasks.size} tasks, BOOT_CPU2 ${JSON.stringify(boot2)}`);
      const got = scp(s);
      const replies = c2.posts.filter((p) => p.path === 'sys_callrequest' && p.target === 0 && p.fn === '0x50aaaf97' && p.task === '0x200e').length;
      ok(got.gui === '0x0403' && got.native === got.posts && got.posts > 0 && replies === got.posts && got.waiting === 0,
        `native: AUD_LEVEL_MONITOR on core 2 answers every post (${JSON.stringify(got)}, replies ${replies})`);
      ok(ref !== null && got.frame === ref.frame && got.reply === ref.reply,
        `native: the panel's frame and reply bytes as S-CPU2's (${got.frame} ${got.reply} vs ${ref?.frame} ${ref?.reply})`);
      const after = c2.status();
      ok(after.turns > st.turns && after.wakes > 0 && !after.parked && after.accepted === after.presented,
        `native: core 2 takes its interrupts and sleeps between them (${JSON.stringify({ turns: after.turns, wakes: after.wakes, presented: after.presented, accepted: after.accepted })})`);
    } catch (e) { bad.push(`native: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  }
  {
    const pl = new Player({ ...args, cpu2: 'native', x_mutant: 'cpu2-no-audmon' }, env);
    let err = null;
    try { pl.open_session(); scp(pl.session); } catch (e) { err = e.message; }
    ok(err !== null && /the GUI waits for CPU 2's reply/.test(err), `control cpu2-no-audmon: the GUI's wait is reported (${err?.slice(0, 300)})`);
    pl.close_session();
  }
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const u = await coresUnits();
  console.log(`the machine's second core: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  const r = await cpu2Session();
  console.log(`CPU 2 natively: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || u.bad.length ? 1 : 0);
}
