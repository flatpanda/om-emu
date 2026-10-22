// Kernel-side stand-in for HLE sessions (RTOS wrapper stand-ins, error log,
// IRQ attach and its K-native observer, clock control, prints). Addresses are disassembly notation.
import { A } from '../fw/model.mjs';
import { ISR_CALLER, ISR_SP, FirmwareError, disasm, where } from './hle.mjs';
import { packRegs } from './sim.mjs';
import { RuntimeError, AssertionError } from './errors.mjs';
import { unpack } from '../util/bytes.mjs';
import { hexDigits as fx } from '../util/hex.mjs';

export const RTOS = new Map([
  [A(0x5002BD01), 'OlyEvSt'], [A(0x5002BD77), 'iOlyEvSt'], [A(0x5002BDD8), 'OlyEvWt'], [A(0x5002BEDD), 'OlyEvCl'],
  [A(0x5002C067), 'OlyQeRd'], [A(0x5002C151), 'OlyQeWr'], [A(0x5002C33E), 'OlySmWt'], [A(0x5002C41F), 'OlySmSi'],
  [A(0x5002C48A), 'OlySmSi(2)'], [A(0x5002C546), 'OlyTaSt'], [A(0x5002C5DA), 'OlyTaSp'], [A(0x5002C6A7), 'OlyTaWu'],
  [A(0x5002C6E5), 'OlyTaSS'], [A(0x5002C701), 'OlyTaSE'],
  [A(0x5002BC86), 'OlyEvDl'], [A(0x5002BFEC), 'OlyQeDl'], [A(0x5002C2C3), 'OlySmDl'], [A(0x5002C4CB), 'OlyTaDl'],
]);
export const IRQ_ATTACH = A(0x50053F76), HANDLER_TABLE = A(0xA32600C0), CLK_CTRL = A(0x50061C3A), ERRLOG = A(0x50047313);
export const PRINTS = new Map([[A(0x50002F6D), 'printf_x'], [A(0x50002F46), 'printf_d'], [A(0x50002EE6), 'puts'], [A(0x50002DD8), 'puts2']]);
export const DRAW_PATH_RTOS = new Set(['OlySmWt', 'OlySmSi', 'OlyEvWt', 'iOlyEvSt']);
const s32 = (v) => v | 0;
const h = (v) => v.toString(16);

export class Kernel {
  constructor(hle) {
    this.hle = hle;
    this.events = []; this.errors = []; this.flags = new Map(); this.irq_handlers = new Map();
    this.sources = []; this._delivered = []; this.intc = null; this._native_seen = 0;
    for (const [address, name] of RTOS) hle.hook(address, this._rtos(name), name);
    hle.hook(ERRLOG, (hh, r) => this._errlog(hh, r), 'errlog');
    hle.hook(IRQ_ATTACH, (hh, r) => this._irq_attach(hh, r), 'irq_attach');
    hle.hook(CLK_CTRL, (hh, r) => this._clk_ctrl(hh, r), 'clk_ctrl');
    for (const [address, name] of PRINTS) hle.hook(address, this._print(name), name);
    this.deliver = (bound = 8) => this._deliver(bound);
  }
  add_source(irq, pending) { this.sources.push([irq, pending]); }
  get delivered() { this._sync_native(); return this._delivered; }
  _sync_native() {
    if (this.intc !== null) {
      const log = this.intc.sync();
      this._delivered.push(...log.slice(this._native_seen));
      this._native_seen = log.length;
    }
  }
  go_native(intc) {
    this.intc = intc;
    this._native_seen = intc.sync().length;
    this.hle.hook(IRQ_ATTACH, (hh, r) => this._irq_attach_observer(hh, r), 'obs-irq_attach');
  }
  rtos_names() { return new Set(this.events.filter((e) => e[0] === 'rtos').map((e) => e[1])); }
  _deliver(bound = 8) {
    for (let i = 0; i < bound; i++) {
      const pending = this.sources.filter(([, check]) => check()).map(([irq]) => irq);
      if (!pending.length) return;
      for (const irq of pending) {
        const handler = this.irq_handlers.get(irq);
        if (handler === undefined) throw new FirmwareError(`IRQ ${irq} pending but the firmware attached no handler`);
        this._sync_native();
        this._delivered.push(irq);
        this.hle.calls(disasm(handler), null, ISR_SP, ISR_CALLER);
      }
    }
    throw new FirmwareError(`interrupt still pending after ${bound} handler runs`);
  }
  _rtos(name) {
    return (hle, r) => {
      this.events.push(['rtos', name, `d0=0x${h(r.d0)} d1=0x${h(r.d1)} a0=0x${h(r.a0)}`, where(r.mdr)]);
      if (name === 'OlyEvSt' || name === 'iOlyEvSt') {
        const id = r.d0 & 0xffff;
        this.flags.set(id, ((this.flags.get(id) ?? 0) | r.d1) >>> 0);
      } else if (name === 'OlyEvWt') {
        this._wait(hle, r);
        return;
      } else if (name === 'OlyEvCl') {
        throw new FirmwareError(`OlyEvCl from ${where(r.mdr)}: semantics not established`);
      }
      hle.finish(r, { d0: 0 });
    };
  }
  _wait(hle, r) {
    const saved = { ...r };
    this.deliver();
    if (hle.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
    const flag = saved.d0 & 0xffff, value = this.flags.get(flag) ?? 0;
    if (!(value & saved.d1)) {
      throw new FirmwareError(`OlyEvWt(flag ${flag}, 0x${h(saved.d1)}) from ${where(saved.mdr)} would block forever: no interrupt set the flag`);
    }
    if (saved.a0) hle.sim.word(saved.a0, value);
    this.flags.set(flag, (value & ~saved.d1) >>> 0);
    hle.finish(saved, { d0: 0 });
  }
  _errlog(hle, r) {
    const call = hle.sim.read(r.mdr - 7, 7);
    const size = call[0] === 0xDD ? call[6] : hle.sim.read(r.mdr - 5, 5)[4];
    const args = unpack('<6I', hle.sim.read(r.sp + size + 4, 24));
    this.errors.push([r.d0, r.d1, args, where(r.mdr)]);
    this.events.push(['errlog', `0x${fx(r.d0, 8)}`, args.map((a) => `0x${h(a)}`).join(' '), where(r.mdr)]);
    hle.finish(r);
  }
  _irq_attach(hle, r) {
    this.irq_handlers.set(r.d0, r.a0);
    this.events.push(['irq_attach', `irq=${r.d0} level=${r.d1}`, where(r.a0), where(r.mdr)]);
    hle.finish(r, { d0: 0 });
  }
  _irq_attach_observer(hle, r) {
    const irq = r.d0, handler = r.a0;
    this.irq_handlers.set(irq, handler);
    this.events.push(['irq_attach', `irq=${irq} level=${r.d1}`, where(handler), where(r.mdr)]);
    const ra = r.mdr;
    if (hle.hooks.has(ra)) throw new FirmwareError(`obs-irq_attach: return address ${where(ra)} is already hooked`);
    const back = (hle2, r2) => {
      hle2.hooks.delete(ra);
      const table = hle2.sim.u32(HANDLER_TABLE + 4 * irq);
      if (s32(r2.d0) !== 0 || table !== handler) {
        throw new FirmwareError(`attach(irq ${irq}, level ${r.d1}) from ${where(ra)}: returned ${s32(r2.d0)}, handler table 0x${fx(table, 8)}, want 0x${fx(handler, 8)}`);
      }
      hle2.sim.run([], true);
    };
    hle.hook_rt(ra, back, 'obs-irq_attach return');
    hle.sim.run([], true);
  }
  _clk_ctrl(hle, r) {
    this.events.push(['clk_ctrl', `d0=${r.d0} d1=${r.d1} a0=${r.a0}`, where(r.mdr)]);
    hle.finish(r, { d0: 0 });
  }
  _print(name) {
    return (hle, r) => {
      let text;
      try {
        const b = hle.sim.read(r.a0, 120), z = b.indexOf(0);
        text = ''; for (const c of (z < 0 ? b : b.subarray(0, z))) text += String.fromCharCode(c);
      } catch (e) {
        if (!(e instanceof RuntimeError)) throw e;
        text = `<0x${fx(r.a0, 8)}>`;
      }
      this.events.push(['print', name, text, where(r.mdr)]);
      hle.finish(r);
    };
  }
}
