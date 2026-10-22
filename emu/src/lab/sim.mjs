// The Simulator facade: the lab's debugger view of the machine (GDB remote packets, registers, memory, breakpoints),
// without the PERF2 machinery (no host reads, register cache, write elision or HLE builtins), over
// the machine API. Stats: g_count and g_digest (sha256 of every 'g' reply
// in order), insns (the sum of insns deltas between a register write or read and the next read), probes.
import { A, IMAGE_BASE, IMAGE_END } from '../fw/model.mjs';
import { createMachine, RspError } from '../machine.mjs';
import { RuntimeError, ValueError, AssertionError } from './errors.mjs';
import { bytesHex, hexBytes } from '../util/bytes.mjs';

export const REGS = ['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3', 'sp', 'pc', 'psw', 'mdr', 'lir', 'lar', 'fault', 'insns'];
export const BASE = 0x50000000;
export const LAND = A(0xA2021000), OUT = A(0xA2022000), STRUCT = A(0xA2023000), SP = A(0xA2200000);
export const MAX_READ = 0x800, MAX_WRITE = 0x400;
export class Stats {
  constructor(createHash) {
    this.packets = new Map(); this.stops = 0; this.insns = 0; this.g_count = 0; this.probes = 0;
    this.seconds = { c: 0, s: 0 };                 // wall seconds inside 'c' and 's' (check_perf P6's MIPS)
    this.digest = createHash('sha256');
  }
}
// The 'g' reply: 16 little-endian u32 as 128 lowercase hex digits.
export function regsHex(r16) {
  const b = new Uint8Array(r16.buffer, r16.byteOffset, 64);
  return bytesHex(b);
}
export function hexRegs(text) {
  const b = hexBytes(text);
  return new Uint32Array(b.buffer, 0, 16);
}
export function packRegs(regs) {
  const r = new Uint32Array(16);
  for (let k = 0; k < 16; k++) r[k] = regs[REGS[k]] >>> 0;
  return regsHex(r);
}
const u32le = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const le4 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

export class Simulator {
  // env: { rom, createHash, clock?, stats? (a Stats or null), slice? (instructions per continue slice), onSlice?,
  // machine? (the machine options passed to createMachine: mutant, a negative control's number, and oneInsn, the
  // one-instruction mode; absent, neither) }; insnLimit: None keeps 1,000,000, 0 disables. keepStderr: every stderr
  // line is kept (stderrLines()).
  constructor(env, insnLimit = null, keepStderr = false) {
    this.env = env;
    const { mutant = 0, oneInsn = false } = env.machine ?? {};
    this.m = createMachine({ rom: env.rom, insnLimit: insnLimit === null ? 1000000 : insnLimit, ...(env.clock ? { clock: env.clock } : {}), mutant, oneInsn, keepStderr });
    this.breakpoints = new Set();
    this.known_insns = 0; this.ran = false;
    this.fast = false;
    this.hle_window = null;
    this.stats = env.stats ?? null;
    this.observer = null;          // capture-equivalent tracer: onStop(kind), onG(text), onWrite(address, data)
    this.closed = false;
    this.kills = env.labKills?.() ?? 0;   // the node host's lab-kill count when this lab was made (see _alive)
  }
  // env.labKills (the node host's --debug-api SIGUSR2 count, a simulated lab crash; test/test_host.mjs): a kill since this
  // lab was made fails every later packet, read and write (status() then raises, so the
  // status has status_error and no lab fields); a lab made after the kill (Restart) is not affected.
  _alive() {
    if (this.env.labKills !== undefined && this.env.labKills() !== this.kills) throw new RuntimeError('lab killed from outside (SIGUSR2)');
  }
  close() {
    if (this.stats !== null && this.ran && !this.closed) this._probe();
    this.closed = true;
  }
  _probe() {
    this.stats.probes += 1;
    this._account(this._packet('g'));
  }
  _account(reply) {
    const value = parseInt(reply.slice(126, 128) + reply.slice(124, 126) + reply.slice(122, 124) + reply.slice(120, 122), 16);
    if (this.ran) this.stats.insns += (value - this.known_insns) >>> 0;
    this.known_insns = value; this.ran = false;
  }
  packet(text) {
    this._alive();
    const kind = text[0];
    if (kind === 'G' && this.observer) this.observer.onG(text);
    if (this.stats === null) return this._run_packet(text);
    if (kind === 'G' && this.ran) this._probe();
    const t0 = kind === 'c' || kind === 's' ? performance.now() : 0;
    const result = this._run_packet(text);
    const st = this.stats;
    if (kind === 'c' || kind === 's') st.seconds[kind] += (performance.now() - t0) / 1000;
    st.packets.set(kind, (st.packets.get(kind) || 0) + 1);
    if (kind === 'c' || kind === 's') { st.stops += 1; this.ran = true; }
    else if (kind === 'g') { st.g_count += 1; st.digest.update(result); this._account(result); }
    else if (kind === 'G') {
      const t = text.slice(121, 129);
      this.known_insns = parseInt(t.slice(6, 8) + t.slice(4, 6) + t.slice(2, 4) + t.slice(0, 2), 16); this.ran = false;
    }
    return result;
  }
  _run_packet(text) {
    const kind = text[0];
    if (kind === 'c' || kind === 's') {
      const result = this._packet(text);
      if (this.observer) this.observer.onStop(kind);
      return result;
    }
    return this._packet(text);
  }
  // The debug stub: the GDB remote packets the harness sends.
  _packet(text) {
    const m = this.m, kind = text[0];
    try {
      switch (kind) {
        case 'g': return regsHex(m.getRegs());
        case 'G': m.setRegs(hexRegs(text.slice(1))); return 'OK';
        case 'c': {
          if (this.observer) this.observer.beforeRun();
          // env.slice: the continue runs in slices of that many instructions (cont/resume, the same stops and
          // interrupt looks as one continue), with env.onSlice() between slices (a Worker's yield point).
          const slice = this.env.slice ?? Infinity;
          if (m.cont({ budget: slice }) === 'paused') {
            do { if (this.env.onSlice) this.env.onSlice(); } while (m.resume({ budget: slice }) === 'paused');
          }
          return 'T05thread:01;';
        }
        case 's': if (this.observer) this.observer.beforeRun(); m.step(); return 'T05thread:01;';
        case 'm': {
          const [a, n] = text.slice(1).split(',').map((v) => parseInt(v, 16));
          if (n > MAX_READ) throw new RspError('E22');
          return bytesHex(m.dbgRead(a, n));
        }
        case 'M': {
          const [head, data] = text.slice(1).split(':');
          m.dbgWrite(parseInt(head.split(',')[0], 16), hexBytes(data));
          return 'OK';
        }
        case 'Z': case 'z': return 'OK';
        case 'p': {
          const v = m.getReg(parseInt(text.slice(1), 16));
          if (v === null) throw new RspError('E14');
          return bytesHex(le4(v));
        }
        case 'P': {
          const [n, hex] = text.slice(1).split('=');
          if (!m.setReg(parseInt(n, 16), u32le(hexBytes(hex), 0))) throw new RspError('E14');
          return 'OK';
        }
        default: throw new Error(`facade: packet ${text.slice(0, 20)} not supported`);
      }
    } catch (e) {
      if (e instanceof RspError) throw new RuntimeError(`GDB ${text.slice(0, 80)}: ${e.code}`);
      throw e;
    }
  }
  registers() {
    const raw = this.packet('g');
    const r = hexRegs(raw), out = {};
    for (let k = 0; k < 16; k++) out[REGS[k]] = r[k];
    return out;
  }
  reset(values = {}) {
    const regs = {};
    for (const n of REGS) regs[n] = 0;
    regs.sp = SP; regs.pc = BASE;
    for (const [name, value] of Object.entries(values)) {
      if (!Object.hasOwn(regs, name)) throw new ValueError(`Unknown register: ${name}`);
      regs[name] = value >>> 0;
    }
    if (this.packet('G' + packRegs(regs)) !== 'OK') throw new AssertionError('');
  }
  write(address, data) {
    this._alive();
    if (this.observer && data.length) this.observer.onWrite(address, data);
    for (let offset = 0; offset < data.length; offset += MAX_WRITE) {
      const chunk = data.subarray(offset, offset + MAX_WRITE);
      this.m.dbgWrite((address + offset) >>> 0, chunk);
    }
  }
  _read_rsp(address, size) {
    this._alive();
    const out = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += MAX_READ) {
      const n = Math.min(MAX_READ, size - offset), a = address + offset;
      try { out.set(this.m.dbgRead(a >>> 0, n), offset); } catch (e) {
        if (e instanceof RspError) throw new RuntimeError(`GDB m${signedHex(a)},${n.toString(16)}: ${e.code}`);
        throw e;
      }
    }
    return out;
  }
  read(address, size) { return this._read_rsp(address, size); }
  u32(address) { return u32le(this.read(address, 4), 0); }
  word(address, value) { this.write(address, le4(value >>> 0)); }
  break_at(addresses) {
    this.breakpoints = new Set(addresses);
    this.m.setBreakpoints([...this.breakpoints]);
  }
  // builtins: the stops that are PERF2 builtin pcs (HLE._loop), for the kick refusal (d)
  run(stops = [], step = false, on_stop = null, builtins = []) {
    if (!step) { this.break_at(stops); this.m.setBuiltins(builtins); }
    const stop = this.packet(step ? 's' : 'c');
    if (!(stop.startsWith('S') || stop.startsWith('T'))) throw new RuntimeError(`Unexpected stop: ${stop}`);
    if (on_stop !== null) on_stop();
    return this.registers();
  }
  cpu_store(address, value, stub) {
    const saved = this.registers();
    this.write(stub, new Uint8Array([0x60]));
    const regs = { ...saved, pc: stub, d0: value >>> 0, a0: address, fault: 0 };
    if (this.packet('G' + packRegs(regs)) !== 'OK') throw new AssertionError('');
    this.packet('s');
    const after = this.registers();
    if (this.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
    return after;
  }
  // Up to count words upward from SP; stops at the first unreadable word (a debugger read error).
  // Addresses are unbounded ints: one past 0xffffffff is not wrapped (it is read as a 64-bit address,
  // outside the 32-bit address space: E14).
  stack(count, top = null) {
    const sp = this.registers().sp;
    const words = [];
    for (let index = 0; index < count; index++) {
      const address = sp + 4 * index;
      let value;
      try {
        if (address > 0xffffffff) throw new RuntimeError(`GDB m${address.toString(16)},4: E14`);
        value = this.u32(address);
      } catch (e) { if (e instanceof RuntimeError) break; throw e; }
      let line = `sp+0x${(4 * index).toString(16).padStart(3, '0')} 0x${address.toString(16).padStart(8, '0')}: 0x${value.toString(16).padStart(8, '0')}`;
      if ((BASE <= value && value < BASE + 0x2000000) || (IMAGE_BASE <= value && value < IMAGE_END)) line += ' code';
      if (top !== null && address === top) line += ' <- initial sp';
      words.push(line);
    }
    return words;
  }
  frame(size) {
    const top = SP + size;
    this.word(top, LAND);
    [0x22222222, 0x33333333, 0xaaaa2222, 0xaaaa3333].forEach((value, index) => this.word(top - 4 * (index + 1), value));
    return top;
  }
  stderrTail(size = 600) { return this.m.stderrTail(size); }
  // Every stderr line so far; throws if the machine dropped lines (no keepStderr).
  stderrLines() { return this.m.stderrSince(0); }
}
// a signed value in hex (negative: '-...')
function signedHex(a) { return a < 0 ? '-' + (-a).toString(16) : a.toString(16); }

