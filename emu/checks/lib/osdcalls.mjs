// The osd scenario's inputs (scenarios/osd_replay.mjs), generated from the JS check_osd: seed 1 runs under a recorder of
// its top-level calls into the lab objects (the classes and methods below; a call made inside another is not one), the
// OsdLab constructor, hle.log.clear(), the drawing brackets and a mark with the lab state at every group boundary. Each
// call is written with its arguments bound to the method's parameters (scenarios/osd_replay.mjs OSD_CALLS, the binding
// the replay applies too) as keywords; the outcomes are not written. They are not committed, because the arguments
// carry memory the check copies out of the firmware image: bin/run.mjs and the gates generate them on first use.
//   osdInputs() -> {format, scenario, source, actions: [[seq, target, method, [], kwargs], ...]}
import { createHash } from 'node:crypto';
import { OSD_CALLS, OSD_INPUTS_FORMAT, labState } from '../../scenarios/osd_replay.mjs';
import { normOut } from '../../src/util/tracejson.mjs';
import { Simulator } from '../../src/lab/sim.mjs';
import { HLE } from '../../src/lab/hle.mjs';
import { OsdLab, EngineDebug } from '../../src/lab/osd.mjs';
import { Kernel } from '../../src/lab/rtos.mjs';
import { check_osd } from '../check_osd.mjs';
import { labEnv, loadImage } from './env.mjs';

const WRAP = {
  sim: [Simulator, ['registers', 'reset', 'write', 'read', 'u32', 'word', 'run', 'cpu_store', 'break_at', 'frame', 'packet', 'close']],
  lab: [HLE, ['hook', 'frame', 'finish', 'finish_calls', 'call', 'calls', 'stderr_tail', 'install_base_stubs', 'close']],
  'lab+': [OsdLab, ['kernel_native', 'rtos_observer', 'native_init', 'record', 'driver', 'alloc', 'plane', 'clear', 'outside_brackets',
    'rectangle', 'line', 'block_copy', 'bitmap', 'outline', 'set_fifo_mode', 'set_palette']],
  engine: [EngineDebug, ['u32', 'register', 'irq_line', 'set_guard', 'clear', 'set_key_mode', 'key_mode', 'key_hits', 'error_total', 'exec_total', 'errors', 'exec_log']],
  kernel: [Kernel, ['add_source', 'go_native', 'rtos_names', 'deliver']],
};
// JSON of an argument: bytes as {$bytes: hex}; an object of a class has no encoding
export function enc(v) {
  if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('hex') };
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return Array.from(v, enc);
  if (typeof v === 'function' || (typeof v === 'object' && Object.getPrototypeOf(v) !== Object.prototype)) {
    throw new Error(`osd inputs: an argument of type ${typeof v === 'function' ? 'function' : v.constructor?.name} has no encoding`);
  }
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = enc(x); return o; }
  return v;
}
// The keywords of a call: every parameter given or defaulted; a **kwargs parameter's entries spread among them
function keywords(name, args) {
  const sig = OSD_CALLS[name];
  if (!sig) throw new Error(`osd inputs: check_osd calls ${name}, which the replay has no adapter for`);
  if (name === 'sim.reset') return enc(args[0] ?? {});
  if (name === 'lab.finish') return enc({ regs: args[0], ...(args[1] ?? {}) });
  const k = {};
  sig.params.forEach((p, i) => { if (i < args.length && args[i] !== undefined) k[p] = args[i]; else if (Object.hasOwn(sig.defaults, p)) k[p] = sig.defaults[p]; });
  if (name === 'lab.call' && k.stack === null) k.stack = new Uint8Array(0);
  return enc(k);
}

let cached = null;
export function osdInputs() {
  if (cached) return cached;
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const actions = [];
  let depth = 0;
  const record = (target, method, kwargs, f) => {
    if (depth) return f();
    actions.push([actions.length, target, method, [], kwargs()]);
    depth++;
    try { return f(); } finally { depth--; }
  };
  const saved = [];
  for (const [target, [C, names]] of Object.entries(WRAP)) {
    const t = target.replace('+', '');
    for (const n of names) {
      if (!Object.hasOwn(C.prototype, n)) continue;
      const orig = C.prototype[n];
      saved.push([C.prototype, n, orig]);
      C.prototype[n] = function (...a) { return record(t, n, () => keywords(`${t}.${n}`, a), () => orig.apply(this, a)); };
    }
  }
  const O = OsdLab.prototype, de = O.drawing_enter, dx = O.drawing_exit;
  saved.push([O, 'drawing_enter', de], [O, 'drawing_exit', dx]);
  O.drawing_enter = function (expect = [], errlog = 0) { return record('lab', 'drawing.enter', () => enc({ expect: [...expect], errlog }), () => de.call(this, expect, errlog)); };
  O.drawing_exit = function (st, error = null) {
    return record('lab', 'drawing.exit', () => enc({ raised: error ? [error.name, error.message] : null, expect_errlog: st.frame.expect_errlog }), () => dx.call(this, st, error));
  };
  const env = labEnv({
    print() {},
    rec: {
      ctor(make) { return record('ctor', 'OsdLab', () => ({}), make); },
      logClear() { if (!depth) actions.push([actions.length, 'lab', 'log.clear', [], {}]); },
      mark(label, lab, result = null, end = false) {
        const info = { lab_state: labState(lab, sha) };
        if (end) info.result = normOut(result, sha);
        actions.push([actions.length, 'mark', label, [], info]);
      },
    },
  });
  try { check_osd(env, loadImage(), 1, 'native'); } finally { for (const [p, n, f] of saved) p[n] = f; }
  cached = { format: OSD_INPUTS_FORMAT, scenario: 'osd', source: 'emu/checks/lib/osdcalls.mjs: check_osd seed 1 (kernel native)', actions };
  return cached;
}
