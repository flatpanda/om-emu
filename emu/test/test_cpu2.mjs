// CPU 2 natively (--cpu2 native, src/lab/cpu2.mjs, src/core/cores.mjs; docs/hle-gaps.md 4.6.1, 4.6.2), E143:
//   cpu2Session  a default session has no second core (the machine's cores null, no cpu2 option, S-CPU2 serves the
//                Super Control Panel's post); with --cpu2 native CPU 0's CPUCONN_CPU0 and CPUCALL_CPU0 start and wait
//                (H-CPUCONN0), then the second core runs CPU 2 from its entry 0x50008f01 through its kernel
//                (K-BOOTSYNC2, K-STARTBITS) to its idle loop's halt 0x50038b09 with its 37 static tasks (and CPUCONN's
//                proxy) created and its init task's starts made, USTART_L2 returning at its entry (H-CPU2LOADER) with
//                no cross-core call, its first device accesses as recorded; WB_MOV, MVR_MAIN, SDET and OSD_DRAW_CPU2
//                started through OlyTaSt from CPU 0 (H-CPU2TASKS) and waiting at their own waits with no device
//                access; AUD_LEVEL_MONITOR started on it through CPUCONN's proxy at AUD_MAIN's start, and the Super
//                Control Panel's posts answered by it with the frame and the reply bytes of the default session's
//                S-CPU2; the control cpu2-no-audmon (that task stood in) leaves the GUI waiting, which the step's check
//                reports; the halt word set, core 2 halts itself every pass of its idle loop, and the loop serves the
//                halt commands the test writes into CPU 2's slot of 0x97f000f0 (no CPU 0 writer is known): 0x40002
//                clears the halt word 0x97f00100 and the slot and sets 0x97f0010c (core 2 then sleeps at the loop's
//                head, H-CPU2POLL), 0x40001 sets the halt word again (D 0x50038a77..0x50038b27; the core goes on from
//                its halt when the interrupt that woke it returns)
//   cpu2Histogram  under control camapp 3 the GUI's drawHistogram sends go to OSD_DRAW_CPU2 on core 2, which draws
//                bin 5's column (the firmware's bins with IMG1 off) in both histogram buffers and answers each through
//                CPU 0's CPUCONN, where a camapp 3 session without CPU 2 leaves the background; the control cpu2-loader
//                (USTART_L2 natively) stops the session at the flash DMA 0x98d00200
//   coresUnits   (no firmware) the machine's second core on a blank image: each core reads its own core number at
//                0x8050, core 2 stores into its local RAM at 0x50000000 while core 0's flash view refuses a store, the
//                interleave gives core 2 a turn of the quantum per quantum of core 0, a doorbell on bank 2 and then
//                its level raise core 2's request (the level write recomputes it) and not core 0's, and the machine
//                refuses a snapshot
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
    // core 0: its core number to OUT, bank 2's pending bit 8, then IRQ 324's level 2 into bank 2 (+0x510): the level
    // write must raise core 2's request by itself; then a loop
    const p0 = [...MOV_ID, ...ST(OUT), ...IMM(8), ...ST(0x99B00808), ...IMM(4), ...ST(0x99B00510), 0x44, 0xCA, 0xFF];
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
const BOOT_LOG = ['start CPU 0: CPUCONN_CPU0 153, CPUCALL_CPU0 154', 'skip H-CPU2CACHE: (0x98100808) = 16', 'skip H-CPU2UART: "2"',
  'skip K-BOOTSYNC2: 0x50015a61', 'stand-in K-STARTBITS: (u16)0x97f00000 0x0 -> 0xb', 'start BOOT_CPU2', 'start CPUCONN2', 'start CPUCALL2',
  'start CONTEST_CPU2', 'start USTART_L2', 'skip H-CPU2LOADER: USTART_L2 returns to 0x5001182d', 'boot idle at 0x50038b09 after 35135 instructions'];
// H-CPU2TASKS, each through CPUCONN2's proxy for CPU 0: [name, id, the return address in its code its wait leaves on
// its stack]: WB_MOV in OlyQeRd on its queue 0x2006 (0x5046aadb), MVR_MAIN in OlyEvWt on its flag 0x2003
// (0x5045fd45 -> 0x5044ec9c), SDET in OlyEvWt on its flag 0x2005 (0x5050cd1d -> 0x50510aad), OSD_DRAW_CPU2 in OlyQeRd
// on 0x2013 (0x51015f4f)
const TASKS = [['WB_MOV', 0x200F, 0x5046AAE2], ['MVR_MAIN', 0x2002, 0x5045FD4C], ['SDET', 0x2010, 0x5050CD22], ['OSD_DRAW_CPU2', 0x2015, 0x51015F56]];
const PROXY = 'CPUCONN proxy (CPU 0)';
const STARTS = ['BOOT_CPU2', 'CPUCONN2', 'CPUCALL2', 'CONTEST_CPU2', 'USTART_L2', ...TASKS.flatMap(([n]) => [PROXY, n]), PROXY, 'AUD_LEVEL_MONITOR'];
// a CPU 2 task waits with the return address ret on its stack (the first 64 words above its TCB's saved sp)
function waitsAt(lab, k2, id, ret) {
  const sp = lab.sim.u32(k2.tcb(id) + 24) >>> 0, at = (ret + 0x10021020) >>> 0;
  for (let k = 0; k < 64; k++) if ((lab.sim.u32(sp + 4 * k) >>> 0) === at) return (k2.state(id) & 0xF) === 4;
  return false;
}

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
      // H-CPUCONN0: CPU 0's CPUCONN_CPU0 and CPUCALL_CPU0 wait; H-CPU2LOADER: USTART_L2 made no cross-core call and
      // is dormant again; H-CPU2TASKS: the four tasks wait where their code waits, with no device access of their own
      const link = [0x99, 0x9A].map((t) => lab.nk.state(t) & 0xF);
      ok(link.join() === '4,4' && st.tasks.map(([, n]) => n).join() === TASKS.map(([n]) => n).join(),
        `native: CPU 0's CPUCONN_CPU0 / CPUCALL_CPU0 wait (${link}), the CPU 2 tasks started ${JSON.stringify(st.tasks)}`);
      const nk = new NativeKernel(lab, 2), tasks = nk.tasks(), boot2 = tasks.get(1);
      const waiting = TASKS.filter(([, id, ret]) => !waitsAt(lab, nk, id, ret)).map(([n]) => n);
      ok(!waiting.length && !c2.posts.some((p) => p.task === '0x2013') && nk.state(0x2013) === 0x10,
        `native: USTART_L2 dormant with no cross-core call (${nk.state(0x2013)}), the tasks wait at their sites (not: ${waiting})`);
      // CPU 2's kernel: its 37 static tasks and CPUCONN's proxy created, its init task the running one (in the idle
      // loop, halted)
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
      // the halt word set, the loop halts itself every pass (H-CPU2POLL not used); no device access in the four tasks'
      // contexts; the GUI's histogram sends stay S-MODACK's under camapp 1 (nothing writes their bins there)
      const own = TASKS.filter(([, id]) => c2.run_devices.has('0x' + id.toString(16))).map(([n]) => n);
      ok(!after.polling && after.pc === '0x50038b09' && after.polled === 0 && !own.length && after.osd.routed === false && after.osd.taken === 0,
        `native: core 2 halts natively at 0x50038b09 (${after.pc}, polling ${after.polling}, H-CPU2POLL ${after.polled}), device accesses of ${own}, histogram ${JSON.stringify(after.osd)}`);
      // the halt commands in CPU 2's slot [1] of 0x97f000f0: the halt word 0x97f000fc, the pass word 0x97f00108
      const u32 = (a) => { const b = lab.sim.read(a, 4); return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; };
      const words = () => [u32(0x97F000F4), u32(0x97F00100), u32(0x97F0010C)].map((x) => x.toString(16)).join(',');
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) { s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); s.frame(); } };
      ok(words() === '0,1,0', `native: before the commands {slot, halt word, pass word} = ${words()}, want 0,1,0`);
      lab.sim.word(0x97F000F4, 0x40002); idle(20);
      const cleared = words(), st2 = c2.status();
      ok(cleared === '0,0,1' && st2.polling && st2.pc === '0x5003883a' && st2.polled > 0,
        `native: 0x40002 served (${cleared}, want 0,0,1; ${st2.pc} polling ${st2.polling}, H-CPU2POLL ${st2.polled})`);
      lab.sim.word(0x97F000F4, 0x40001); idle(20);
      const st3 = c2.status();
      ok(words() === '0,1,0' && !st3.parked && !st3.polling && st3.pc === '0x50038b09', `native: 0x40001 served (${words()}, want 0,1,0; ${st3.pc})`);
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

// OSD_DRAW_CPU2 natively under control camapp 3: the GUI's two histogram buffers (OSDControl::drawHistogram's
// requests: rectangle x 4, y 110, 256 x 63, stride 1664), and the firmware's bins with IMG1 off (0, and 64 in bin 5:
// the VSC histogram's cmd 16, docs/hle-gaps.md 4.2.1), whose column is bins 5's two columns x 14, 15
const HIST_BUFFERS = [0xB7493000, 0xB767A800], HIST_STRIDE = 1664, HIST_COLUMNS = [14, 15], HIST_ROWS = [110, 172];
export async function cpu2Histogram() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  // the column's pixels and the row above and below it, per buffer: {column: [values], edge: [values]}
  const column = (lab) => HIST_BUFFERS.map((base) => {
    const at = (x, y) => lab.sim.read(base + HIST_STRIDE * y + x, 1)[0], col = [], edge = [];
    for (const x of HIST_COLUMNS) {
      for (let y = HIST_ROWS[0]; y <= HIST_ROWS[1]; y++) col.push(at(x, y));
      edge.push(at(x, HIST_ROWS[0] - 1), at(x, HIST_ROWS[1] + 1), at(x - 2, HIST_ROWS[1]), at(x + 2, HIST_ROWS[1]));
    }
    return { column: [...new Set(col)].join(','), edge: edge.join(',') };
  });
  let ref = null;
  for (const native of [false, true]) {
    const pl = new Player({ ...args, ...(native ? { cpu2: 'native' } : {}) }, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    const tag = native ? 'camapp 3 --cpu2 native' : 'camapp 3';
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      idle(1000);
      const px = column(lab);
      if (!native) {
        ref = px;
        ok(px.every((b) => b.column === '52'), `${tag}: the histogram's column is the background (${JSON.stringify(px)}): S-MODACK answers the sends`);
        continue;
      }
      const c2 = s.cpu2, o = c2.osd, st = c2.status();
      const shapes = new Set(o.taken.map((t) => `${t.command} ${t.x},${t.y} ${t.w}x${t.h} n ${t.n} scale ${t.scale} ${t.reply_queue}`));
      const bases = new Set(o.taken.map((t) => t.base));
      ok(o.routed && o.sent > 0 && o.taken.length === o.sent && o.replies.length === o.sent && o.replies.every((r) => r.status === 0) &&
        shapes.size === 1 && [...shapes][0].startsWith('1 4,110 256x63 n 128 scale 64 ') && [...bases].sort().join() === '0xb7493000,0xb767a800',
        `${tag}: each drawHistogram send taken by OSD_DRAW_CPU2 and answered (${JSON.stringify(st.osd)}, ${[...shapes]}, bases ${[...bases]})`);
      // the reply: a cpu_conn tsnd_mbf (kind 1) from OSD_DRAW_CPU2 on CPU 0's reply queue, served by CPU 0's CPUCONN
      // through its proxy for CPU 2 (H-CPUCONN0)
      const q = '0x' + o.taken[0].reply_queue.toString(16), replies = c2.posts.filter((p) => p.task === '0x2015');
      const proxies = lab.lt.started.filter((e) => disasm(e) === 0x5002CF6E).length;
      ok(replies.length === o.sent && replies.every((p) => p.path === 'cpu_conn' && p.kind === 1 && p.object === q) && proxies >= o.sent,
        `${tag}: the replies go to CPU 0's queue ${q} by cpu_conn kind 1 (${replies.length} of ${o.sent}; ${JSON.stringify(replies[0])}), CPU 0's proxies ${proxies}`);
      ok(px.every((b) => b.column === '54') && ref !== null && px.every((b, k) => b.edge === ref[k].edge) && !c2.run_devices.has('0x2015'),
        `${tag}: OSD_DRAW_CPU2 draws bin 5's column in both buffers with no device access (${JSON.stringify(px)} vs ${JSON.stringify(ref)})`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  }
  // the control cpu2-loader: USTART_L2 natively gets FLASH_CS1 through CPU 0's CPUCONN, and its copy of segment 1
  // stops at the flash DMA (0x50001c4c, a bus error): the session stops
  {
    const pl = new Player({ ...args, cpu2: 'native', x_mutant: 'cpu2-loader' }, env);
    let err = null;
    try { pl.open_session(); } catch (e) { err = e.message; }
    ok(err !== null && /core 2 fault 2 at 0x60022c6c address 0x98d00200/.test(err), `control cpu2-loader: USTART_L2 stops at the flash DMA (${err?.slice(0, 300)})`);
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
  const h = await cpu2Histogram();
  console.log(`CPU 2's queues, the histogram on OSD_DRAW_CPU2: ${h.checks - h.bad.length}/${h.checks}`);
  h.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || u.bad.length || h.bad.length ? 1 : 0);
}
