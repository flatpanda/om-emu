// Shared constants and pure helpers of the VSC model (vsc.mjs, vsccompose.mjs, vsccompose2.mjs).
import { BOARD } from '../fw/board.mjs';

export const PAL_BASE = 0x4400;
export const OUTPUT_SIZE = 0x800000;
export const E = { REG_UNKNOWN: 1, WIDTH: 2, MIRROR_WRITE: 3, MIRROR_LIVE: 4, RO_WRITE: 5, DEBUG_CPU_WRITE: 6, DOORBELL: 7,
  NOT_LATCHED: 8, FIELD_MODE: 9, WINDOW: 10, MIX_UNOBSERVED: 11, PLANC_UNOBSERVED: 12, FMT_UNMODELLED: 13,
  SPOS_UNMODELLED: 14, DMA_FIELD: 15, DMABN_SHORT: 16, DMA_RANGE: 17, RSZ_UNMODELLED: 18, PEAK_BC: 19, BG_FIELD: 20,
  OSDCP2_FIELD: 21, PAL_UNWRITTEN: 22, PAL_FIELD: 23, UNWRITTEN: 24, NOT_RUNNING: 25, ORDER: 26,
  FEATURE_UNOBSERVED: 27, HIST_UNMODELLED: 28 };
export const NOTE = { RESET_READ: 1, MIRROR_RESET_READ: 2, SRAM_RESET_READ: 3, OUT_READ: 4, MONI3_IDLE: 5,
  COMPOSE_RESET: 6, ASSUMED: 7, SPOS_A18: 8, PLANC_ZERO: 9, VIEW: 10, HIST_NO_SOURCE: 11 };
export const D = { MAGIC: 0x000, VERSION: 0x004, ERR_TOTAL: 0x008, NOTE_TOTAL: 0x00C, T_LO: 0x010, T_HI: 0x014,
  LAST_CMD: 0x018, LAST_RESULT: 0x01C, ARG0: 0x020, ARG1: 0x024, COMMANDS: 0x028, CPU_ACCESSES: 0x02C,
  EVENT_SOURCES: 0x030, HIST_ZERO_READS: 0x034, HIST_ASSUMED: 0x038, HIST_KEPT_READS: 0x03C, CHAN: 0x040, CHAN_SIZE: 0x40,
  HDR: 0x100, PLANE: 0x180,
  ERR_RING: 0x400, ERR_SLOTS: 64, NOTE_RING: 0x1000, NOTE_SLOTS: 512, FLAGS: 0x4000, FLAGS_SIZE: 0x1400, OUT_FLAGS: 0x8000 };
export const CH = { RUNNING: 0x00, FRAMES: 0x04, FIELD: 0x08, MONI3: 0x0C, IRQ: 0x10, LINE_NS: 0x14, START_LO: 0x18,
  START_HI: 0x1C, LEN: 0x20, LATCHED: 0x24, COMPOSE: 0x28, LINE_NS_EVF: 0x2C, ORDER: 0x30, ASSUME: 0x38, VIEW: 0x39,
  TIMING: 0x3A, HIST: 0x3B, HIST_RUNS: 0x3C };
// kinds 2 and 3: the plain storage's first local offset (a stored word at offset o is ch.store[(o - STORE_BASE) / 4],
// flagged in the palette flags at that index)
export const STORE_BASE = BOARD.vsc.kind === 3 ? BOARD.vsc.store[0] : 0x800;
export const FACE_FIRST = 0xD00, FACE_LAST = 0xD1C;
export const chanDbg = (c, f) => D.CHAN + D.CHAN_SIZE * c + f;
// floor(a / b) of non-negative integers below 2^53 (uint64 division in the C)
export function udiv(a, b) { let q = Math.floor(a / b); if (q * b > a) q--; return q; }
