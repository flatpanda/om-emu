// The E143 (OM-1 v1.9) facts bin/fwmap.mjs's static pass starts from, as the specs give them. Offsets are body offsets
// of the main block (src/fw/models.mjs romPath), run-time addresses those of the copy at the image base (0x60021020).
export const MODEL = 'E143';

// Discovery roots: reset and the CPU 1..3 entries (docs/om1-cores-spec.md 3.1, 3.2).
export const ROOTS = [[0x0, 'reset'], [0x8b7c, 'cpu1-entry'], [0x8f01, 'cpu2-entry'], [0x928d, 'cpu3-entry']];
// The four static task tables: run-time address, entries, cpu (cores spec 2: kcb+124 tables of 28-byte
// {id, atr, exinf, task, pri, stksz, stk}, 311 tasks).
export const TASK_TABLES = [[0x60039038, 159, 0], [0x6003cef8, 97, 1], [0x6003e65c, 37, 2], [0x6003f0d0, 18, 3]];
// The kernel object-name table (cores spec 4): pointers at OBJECT_NAMES + 0x20 * type + 4 * cpu (run-time) to runs of
// {char name[24]; u16 index}.
export const OBJECT_NAMES = 0x6034d0d4;

// The kernel API (docs/om1-kernel-spec.md 2.4 and 3, src/lab/rtos.mjs, docs/om1-cores-spec.md 5.1): body offsets.
export const KERNEL_API = {
  OlyEvSt: 0x2bd01, iOlyEvSt: 0x2bd77, OlyEvWt: 0x2bdd8, OlyEvCl: 0x2bedd, OlyQeRd: 0x2c067, OlyQeWr: 0x2c151, OlySmWt: 0x2c33e,
  OlySmSi: 0x2c41f, OlySmSi2: 0x2c48a, OlyTaSt: 0x2c546, OlyTaSp: 0x2c5da, OlyTaWu: 0x2c6a7, OlyTaSS: 0x2c6e5, OlyTaSE: 0x2c701,
  OlyEvDl: 0x2bc86, OlyQeDl: 0x2bfec, OlySmDl: 0x2c2c3, OlyTaDl: 0x2c4cb,
  acre_Event1: 0x2c791, acre_Queue1: 0x2c866, acre_Semaphore1: 0x2c947, acre_Task: 0x2ca1f,
  acre_tsk: 0xf76f, act_tsk: 0xf879, ext_tsk: 0x107e8, ter_tsk: 0x15e87, chg_pri: 0xf9aa, sus_tsk: 0x17718, frsm_tsk: 0x17242,
  wup_tsk: 0x16bf0, dly_tsk: 0x10561, get_tid: 0x1091e, acre_sem: 0xf6d1, del_sem: 0x10279, sig_sem: 0x14fcb, isig_sem: 0x10f6a,
  twai_sem: 0x16749, acre_flg: 0xf343, del_flg: 0x10007, set_flg: 0x14ec7, iset_flg: 0x17a6b, clr_flg: 0xfbaf, wai_flg: 0x169d6,
  twai_flg: 0x17e85, acre_mtx: 0xf639, del_mtx: 0x17084, loc_mtx: 0x112f2, unl_mtx: 0x168fb, acre_dtq: 0xf3bb, del_dtq: 0x10129,
  tsnd_dtq: 0x16578, trcv_dtq: 0x1625e,
  sys_callrequest: 0x35afd, creq: 0x36120, irq_attach: 0x53f76, irq_attach_cpu: 0x53fcd, ssc_lock: 0x3b31e, ssc_unlock: 0x3b469,
  errlog: 0x47313, swtimer_create: 0x5899c, swtimer_delete: 0x589d7,
};
// The name-table type an API's d0 id refers to: 0 tasks, 1 semaphores, 2 flags (the per-core counts of the cores spec
// match), 5 queues (I: from its size), null none.
export const apiType = (n) => /Ta|tsk|Task/.test(n) ? 0 : /Sm|sem|Semaphore/.test(n) ? 1 : /Ev|flg|Event/.test(n) ? 2 : /Qe|dtq|Queue/.test(n) ? 5 : null;

// The CPU 2 overlay segments 1..10 (docs/om1-cores-spec.md 3.6), disassembly notation [start, end).
export const OVERLAY_SEGMENTS = [[0x50108fe0, 0x502d3fe0], [0x5038f7e0, 0x506f3fe0], [0x5072f7e0, 0x507f1fe0], [0x507f2fe0, 0x50a6e7e0],
  [0x50aa2fe0, 0x50aa67e0], [0x50aa6fe0, 0x50f07fe0], [0x51009fe0, 0x515a67e0], [0x516697e0, 0x517af7e0], [0x517d3fe0, 0x5196d7e0],
  [0x519c7fe0, 0x51a667e0]];

// Named MMIO regions (start inclusive, end exclusive) from the specs (src: which one says so); where a spec gives only
// the nearest source-file string the name says owner (I). An address outside all of them is grouped by its 64 KiB page.
const R = (start, end, name, src) => ({ start: start >>> 0, end: end >>> 0, name, src });
export const REGION_NAMES = [
  R(0x97000000, 0x97001000, 'ISC hardware semaphores', 'om1-cores-spec 6.1'),
  R(0x97f00000, 0x97f02000, 'shared on-chip SRAM (kcb pointers, boot words, core byte)', 'om1-cores-spec 6.2'),
  R(0x98100000, 0x98101000, 'bus window register / per-core cache control', 'om1-cores-spec 6.3, vsc spec (0x98100058)'),
  R(0x98700000, 0x98710000, 'UART', 'om1-cores-spec 3.1'),
  R(0x98800000, 0x98810000, 'clock / power gates (core start bits)', 'om1-cores-spec 3.1 (I)'),
  R(0x98900000, 0x98901000, 'timer block', 'om1-intc-timer-spec'),
  R(0x98d00000, 0x98d10000, 'CPU start-address registers 0x98d0014x / 0x98d018xx', 'om1-cores-spec 3.1 (I)'),
  R(0x98e00000, 0x98e00100, 'SCPU (sub-CPU) register window', 'om1-input-spec, om1-settings-spec'),
  R(0x99200000, 0x99201000, 'INTC bank CPU 0', 'om1-cores-spec 2'),
  R(0x99300000, 0x99301000, 'INTC bank CPU 1', 'om1-cores-spec 2'),
  R(0x99b00000, 0x99b01000, 'INTC bank CPU 2', 'om1-cores-spec 2'),
  R(0x99b80000, 0x99b81000, 'INTC bank CPU 3', 'om1-cores-spec 2'),
  R(0x99990000, 0x999a0000, 'lens OIS / IS info (I)', 'om1-shutter-spec 2.5'),
  R(0x9b000000, 0x9b010000, 'camera sequencer / SLVS (cam_seq_movie.c, I)', 'om1-shutter-spec 2.5'),
  R(0x9b080000, 0x9b090000, 'camera driver block (I)', 'om1-shutter-spec 2.5'),
  R(0x9b300000, 0x9b305000, 'ISP PRO1/PRO2 (cam_prepro.c, I)', 'om1-shutter-spec 2.4/2.5'),
  R(0x9b380000, 0x9b385000, 'AE / AWB statistics (cam_bright.c, I)', 'om1-shutter-spec 2.4/2.5'),
  R(0x9b400000, 0x9b402000, 'AF contrast (cam_contrast.c, I)', 'om1-shutter-spec 2.4/2.5'),
  R(0x9b480000, 0x9b490000, 'camera parameters (cam_param.c, I)', 'om1-shutter-spec 2.5'),
  R(0x9b500000, 0x9b510000, 'camera clocks (0x9b5008xx)', 'om1-shutter-spec 2.4/2.5'),
  R(0x9b580000, 0x9b590000, 'camera driver block 0x9b58 (I)', 'om1-shutter-spec 2.5'),
  R(0x9b600000, 0x9b610000, 'camera driver block 0x9b60 (I)', 'om1-shutter-spec 2.5'),
  R(0x9b880000, 0x9b890000, 'pin block (touch, lens, key GPIO)', 'om1-input-spec 5, om1-shutter-spec 2.5'),
  R(0x9ba00000, 0x9ba10000, 'PWM block', 'src/fw/board.mjs (E143 0x9ba00000 PWM)'),
  R(0x9bb80000, 0x9bba0000, 'VSC display compositor', 'om1-vsc-spec, src/fw/board.mjs vsc'),
  R(0x9bc00000, 0x9bc10000, 'OSD draw engine', 'src/fw/board.mjs engine'),
  R(0x9bf00000, 0x9bf10000, 'AF / FCS block (I)', 'om1-shutter-spec 2.5'),
];
