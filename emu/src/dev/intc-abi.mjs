// Shared ABI constants for the OM-1 interrupt controller debug window and doorbell
// (consumed by src/dev/intc.mjs, src/lab/irq.mjs, and src/trace/tracer.mjs).

export const DEBUG_BASE = 0x89A00000;
export const DEBUG_SIZE = 0x10000;
export const DOORBELL_BASE = 0x89A20000;
export const DEBUG_MAGIC = 0x43544E49; // 'INTC'

export const D_MAGIC = 0x000;
export const D_VERSION = 0x004;
export const D_GATE_MODE = 0x008;
export const D_GATE_PC = 0x00C;
export const D_PRESENTED_TOTAL = 0x010;
export const D_ACCEPTED_TOTAL = 0x014;
export const D_REQUEST = 0x018;
export const D_LEVEL_MASK = 0x01C;
export const D_ERR_TOTAL = 0x020;
export const D_IPI_WRITES = 0x024;
export const D_DOORBELL_RESULT = 0x028;
export const D_IPI_REPEATS = 0x02C;
export const D_PRESENT_NOW = 0x040;
export const D_PENDING = 0x060;
export const D_IPI_REQ = 0x070;
export const D_XCPU_TOTAL = 0x07C;
export const D_ERR_RING = 0x100;
export const ERR_SLOTS = 16;
export const D_LINES = 0x1000;
export const D_LEVELS = 0x2000;
export const D_TEST = 0x3000;
export const D_PRESENTED_RING = 0x4000;
export const D_ACCEPTED_RING = 0x5000;
export const RING_SLOTS = 256;
export const D_XCPU_RING = 0x6000;
export const XCPU_RING_SLOTS = 2048;

export const D = Object.freeze({
  MAGIC: D_MAGIC,
  VERSION: D_VERSION,
  GATE_MODE: D_GATE_MODE,
  GATE_PC: D_GATE_PC,
  PRESENTED_TOTAL: D_PRESENTED_TOTAL,
  ACCEPTED_TOTAL: D_ACCEPTED_TOTAL,
  REQUEST: D_REQUEST,
  LEVEL_MASK: D_LEVEL_MASK,
  ERR_TOTAL: D_ERR_TOTAL,
  IPI_WRITES: D_IPI_WRITES,
  DOORBELL_RESULT: D_DOORBELL_RESULT,
  IPI_REPEATS: D_IPI_REPEATS,
  PRESENT_NOW: D_PRESENT_NOW,
  PENDING: D_PENDING,
  IPI_REQ: D_IPI_REQ,
  XCPU_TOTAL: D_XCPU_TOTAL,
  ERR_RING: D_ERR_RING,
  ERR_SLOTS,
  LINES: D_LINES,
  LEVELS: D_LEVELS,
  TEST: D_TEST,
  PRESENTED_RING: D_PRESENTED_RING,
  ACCEPTED_RING: D_ACCEPTED_RING,
  RING_SLOTS,
  XCPU_RING: D_XCPU_RING,
  XCPU_RING_SLOTS,
});

export const GATE_OFF = 0;
export const GATE_PC = 1;
export const GATE_ANY = 2;

export const TEST_OFF = 0;
export const TEST_LEVEL = 1;
export const TEST_ONCE = 2;

export const ERR_UNKNOWN = 1;
export const ERR_LEVEL_VALUE = 2;
export const ERR_TEST_DRIVEN = 3;
export const ERR_DEBUG_CPU = 4;
export const ERR_DOORBELL = 5;

export const ERRORS = Object.freeze({
  [ERR_UNKNOWN]: 'UNKNOWN',
  [ERR_LEVEL_VALUE]: 'LEVEL_VALUE',
  [ERR_TEST_DRIVEN]: 'TEST_DRIVEN',
  [ERR_DEBUG_CPU]: 'DEBUG_CPU',
  [ERR_DOORBELL]: 'DOORBELL',
});
