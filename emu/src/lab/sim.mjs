// The Simulator facade: the lab's debugger view of the machine (GDB remote packets, registers, memory, breakpoints),
// without the PERF2 machinery (no host reads, register cache, write elision or HLE builtins), over
// the machine API. Stats: g_count and g_digest (sha256 of every 'g' reply
// in order), insns (the sum of insns deltas between a register write or read and the next read), probes.
import { A, IMAGE_BASE, IMAGE_END, MODEL } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import { StrictLog, strictOn, strictCache } from './strict.mjs';
import { rangeMessage, POISON } from '../fw/sections.mjs';
import { sectionsFact, loadedRanges, secReadyWatch } from './patchaudit.mjs';
import { createMachine, RspError, UnloadedCode } from '../machine.mjs';
import { RuntimeError, FirmwareError, ValueError, AssertionError } from './errors.mjs';
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

export { sectionsFact, loadedRanges, secReadyWatch };

export class Simulator {
  // env: { rom, createHash, clock?, stats? (a Stats or null), slice? (instructions per continue slice), onSlice?,
  // machine? (the machine options passed to createMachine: mutant, a negative control's number, oneInsn, the
  // one-instruction mode, coverage, an execution-coverage collector, and hdmi, the HDMI port's devices; absent, none) };
  // insnLimit: None keeps 1,000,000, 0 disables. keepStderr: every stderr line is kept (stderrLines()).
  constructor(env, insnLimit = null, keepStderr = false) {
    this.env = env;
    const { mutant = 0, oneInsn = false, coverage = null, hdmi = false, audio = false, cores = null } = env.machine ?? {};
    // S-STALERAM (loadedRanges): the unloaded ranges and those not shown loaded filled, an instruction there refused
    // with its range named; unloaded: that option (src/debug/call.mjs checks a call's target against it), or null
    this.loads = loadedRanges(env);
    const f = this.loads ? sectionsFact() : null;
    this.unloaded = this.loads ? { gaps: [...this.loads.gaps, ...this.loads.unshown], fill: POISON, message: (g, pc) => rangeMessage(g, pc, IMAGE_BASE, f) } : null;
    const unloaded = this.unloaded;
    // --sec-ready (env.secReady, src/lab/secready.mjs): the patched instructions run in a section whose stage bit is
    // clear, recorded by a fetch audit; null without the option (no guard, nothing changes)
    this.secReady = env.secReady ? secReadyWatch(env) : null;
    // the strict mode (src/lab/strict.mjs): env.strict, the host's StrictLog for the run (or 'on' / 'off'), else
    // OM_STRICT; this.strict the log (null: off). env.stockRom, the stock run-time image beside an overlay, gives the
    // ranges the patch made the boot load (cave-store). Its data-cache model (--strict cache) is CPU 0's: with a second
    // core running it is refused
    this.strict = env.strict instanceof StrictLog ? env.strict : strictOn(env.strict) ? new StrictLog({ model: MODEL, cache: strictCache(env.strict) }) : null;
    if (this.strict?.cacheOpts && cores) throw new Error('strict cache: the data-cache model is CPU 0\'s; a second core (--cpu2 native) is not modelled with it');
    const strict = this.strict?.arm({ rom: env.rom, base: IMAGE_BASE, end: IMAGE_END, preload: BOARD.preload ?? [], loads: this.loads, patchRanges: env.patchRanges ?? null, stock: env.stockRom ?? null, dram: BOARD.dram_size }) ?? null;
    this.m = createMachine({ rom: env.rom, insnLimit: insnLimit === null ? 1000000 : insnLimit, ...(env.clock ? { clock: env.clock } : {}), mutant, oneInsn, keepStderr, coverage, hdmi, audio, cores, unloaded,
      fetchAudit: this.secReady?.guard ?? null, strict });
    this.breakpoints = new Set();
    this._bpRef = null;
    this._bpDebug = null;
    this._builtinsRef = null;
    this._regBuf = new Uint32Array(16);
    this.known_insns = 0; this.ran = false;
    this.fast = false;
    this.hle_window = null;
    this.stats = env.stats ?? null;
    this.observer = null;          // capture-equivalent tracer: onStop(kind), onG(text), onWrite(address, data)
    this.closed = false;
    this.kills = env.labKills?.() ?? 0;   // the node host's lab-kill count when this lab was made (see _alive)
    // The live debugger of a play session (src/debug/live.mjs; null, the default: none, and nothing changes):
    // {pcs (a Set), stopped(stop)}. Its breakpoints join the harness's at every continue, and a continue or step that
    // ends on one of its stops (a pc of pcs the harness did not ask for, a stopping watchpoint) is held in stopped()
    // until the debugger lets it go, then goes on (off a breakpoint by a single step), so the harness sees only its own
    // stops.
    this.debug = null;
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
    const value = this.m.getReg(15);
    if (this.ran) this.stats.insns += (value - this.known_insns) >>> 0;
    this.known_insns = value; this.ran = false;
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
  // One continue. env.slice: it runs in slices of that many instructions (cont/resume, the same stops and interrupt
  // looks as one continue), with env.onSlice() between slices (a Worker's yield point).
  _cont() {
    const m = this.m, slice = this.env.slice ?? Infinity;
    if (m.cont({ budget: slice }) === 'paused') {
      do { if (this.env.onSlice) this.env.onSlice(); } while (m.resume({ budget: slice }) === 'paused');
    }
  }
  // The live debugger's stops in a continue (this.debug): each is held in debug.stopped(), then the continue goes on
  // from where the debugger left the pc, unless that is one of the harness's breakpoints, which the harness takes as
  // its own stop. A continue from a breakpoint pc stops at once, so a debug breakpoint is left by a single step first
  // (no interrupt accepted; its own watch hit is a stop too), except where a watch stop ended right before it, whose
  // breakpoint is then reported (as a standalone continue does). A debugger that let go (stopped() cleared this.debug)
  // has cleared its stops, so a stop after that is the harness's.
  _debugCont() {
    const m = this.m;
    let st = m.lastStop();
    for (;;) {
      const d = this.debug;
      if (d === null) return;
      const pc = m.getRegs()[9] >>> 0;
      if (st?.kind === 'watch') d.stopped({ kind: 'watch', pc, watch: m.watchHit(), during: 'continue' });
      else if (st?.kind === 'break' && d.pcs.has(pc) && !this.breakpoints.has(pc)) d.stopped({ kind: 'break', pc, during: 'continue' });
      else return;
      const at = m.getRegs()[9] >>> 0;
      if (this.breakpoints.has(at)) return;
      if (this.debug?.pcs.has(at)) {
        if (st.kind === 'watch' && at === pc) { st = { kind: 'break' }; continue; }
        m.step();
        st = m.lastStop();
        if (st.kind === 'watch') { m.dropPendingStop(); continue; }
        if (st.kind !== 'break') return;                 // a fault or the insn limit: the harness's continue ended so
      }
      this._cont();
      st = m.lastStop();
    }
  }
  // The debugger's breakpoints with the harness's (break_at) on the machine.
  rearm() {
    const d = this.debug;
    this._bpRef = null;
    this._bpDebug = d;
    this.m.setBreakpoints(d === null || !d.pcs.size ? this.breakpoints : new Set([...this.breakpoints, ...d.pcs]));
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
          this._cont();
          if (this.debug !== null) this._debugCont();
          return 'T05thread:01;';
        }
        case 's': {
          if (this.observer) this.observer.beforeRun();
          m.step();
          if (this.debug !== null && m.lastStop()?.kind === 'watch') {      // a stopping watchpoint the step hit
            this.debug.stopped({ kind: 'watch', pc: m.getRegs()[9] >>> 0, watch: m.watchHit(), during: 'step' });
            m.dropPendingStop();
          }
          return 'T05thread:01;';
        }
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
      if (e instanceof UnloadedCode) throw new FirmwareError(e.message);       // S-STALERAM: the firmware ran there
      throw e;
    }
  }
  registers() {
    this._alive();
    const r = this.m.getRegs();
    if (this.stats !== null) {
      const st = this.stats;
      st.packets.set('g', (st.packets.get('g') || 0) + 1);
      st.g_count += 1;
      st.digest.update(regsHex(r));
      const value = r[15];
      if (this.ran) st.insns += (value - this.known_insns) >>> 0;
      this.known_insns = value;
      this.ran = false;
    }
    return {
      d0: r[0], d1: r[1], d2: r[2], d3: r[3],
      a0: r[4], a1: r[5], a2: r[6], a3: r[7],
      sp: r[8], pc: r[9], psw: r[10], mdr: r[11],
      lir: r[12], lar: r[13], fault: r[14], insns: r[15],
    };
  }
  set_registers(regs) {
    this._alive();
    const r = this._regBuf;
    r[0] = regs.d0 >>> 0; r[1] = regs.d1 >>> 0; r[2] = regs.d2 >>> 0; r[3] = regs.d3 >>> 0;
    r[4] = regs.a0 >>> 0; r[5] = regs.a1 >>> 0; r[6] = regs.a2 >>> 0; r[7] = regs.a3 >>> 0;
    r[8] = regs.sp >>> 0; r[9] = regs.pc >>> 0; r[10] = regs.psw >>> 0; r[11] = regs.mdr >>> 0;
    r[12] = regs.lir >>> 0; r[13] = regs.lar >>> 0; r[14] = regs.fault >>> 0; r[15] = regs.insns >>> 0;
    if (this.observer !== null && !this.observer.quiet) this.observer.onG('G' + regsHex(r));
    if (this.stats === null) {
      this.m.setRegs(r);
      return;
    }
    if (this.ran) this._probe();
    this.m.setRegs(r);
    const st = this.stats;
    st.packets.set('G', (st.packets.get('G') || 0) + 1);
    this.known_insns = r[15];
    this.ran = false;
  }
  reset(values = {}) {
    const regs = { d0: 0, d1: 0, d2: 0, d3: 0, a0: 0, a1: 0, a2: 0, a3: 0, sp: SP, pc: BASE, psw: 0, mdr: 0, lir: 0, lar: 0, fault: 0, insns: 0 };
    for (const [name, value] of Object.entries(values)) {
      if (!Object.hasOwn(regs, name)) throw new ValueError(`Unknown register: ${name}`);
      regs[name] = value >>> 0;
    }
    this.set_registers(regs);
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
    this._bpRef = null;
    this._bpDebug = this.debug;
    if (this.debug === null) this.m.setBreakpoints(this.breakpoints);
    else this.rearm();
  }
  // builtins: the stops that are PERF2 builtin pcs (HLE._loop), for the kick refusal (d)
  // immutable: caller guarantees stops and builtins arrays are fresh immutable snapshots (safe to skip by ref)
  run(stops = [], step = false, on_stop = null, builtins = [], immutable = false) {
    if (!step) {
      if (!(immutable && stops === this._bpRef && this.debug === this._bpDebug)) {
        this.break_at(stops);
        if (immutable) { this._bpRef = stops; this._bpDebug = this.debug; }
      }
      if (!(immutable && builtins === this._builtinsRef)) {
        this.m.setBuiltins(builtins);
        this._builtinsRef = immutable ? builtins : null;
      }
    }
    const stop = this.packet(step ? 's' : 'c');
    if (!(stop.startsWith('S') || stop.startsWith('T'))) throw new RuntimeError(`Unexpected stop: ${stop}`);
    if (on_stop !== null) on_stop();
    return this.registers();
  }
  cpu_store(address, value, stub) {
    const saved = this.registers();
    this.write(stub, new Uint8Array([0x60]));
    this.set_registers({ ...saved, pc: stub, d0: value >>> 0, a0: address, fault: 0 });
    this.packet('s');
    const after = this.registers();
    this.set_registers(saved);
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

