// Register names of the debug API: the 16 of the GDB remote protocol's 'g' packet
// and the lab registers 16..19 (the UDF unit: HI and the context units C, D, V; 'p'/'P' only).
export const REGS = ['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3', 'sp', 'pc', 'psw', 'mdr', 'lir', 'lar', 'fault', 'insns'];
export const LAB_REGS = ['lab_hi', 'lab_unit_c', 'lab_unit_d', 'lab_unit_v'];
export const ALL_REGS = [...REGS, ...LAB_REGS];
// The register number of a name ('d0'..'insns' 0..15, 'lab_hi'..'lab_unit_v' 16..19), or -1.
export function regNumber(name) { return ALL_REGS.indexOf(String(name).toLowerCase()); }
export const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// {d0: '0x...', ...}: the registers as hex strings
export function regsHex(regs) { return Object.fromEntries(Object.entries(regs).map(([k, v]) => [k, hex8(v)])); }
