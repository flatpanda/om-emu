// The golden traces of labs that live in child processes and worker threads: with OM_CHILD_TRACE=DIR set, bin/play.mjs
// and bin/nav.mjs trace every lab they create (the Session, Tracer and dump
// of bin/checktrace.mjs, the 'frame' events of OsdLab's drawing brackets included) and write each as DIR/<name>.json.
// OM_CHILD_TRACE_SLICE=N runs every continue in slices of N instructions (the traces must not change).
//
// Names: a child's is its --out directory's basename, '@' and the first 8 hex digits of the sha256 of
// spacedJson(argv after the script), every argument under the --out directory's parent written as '{tmp}/...' (so a
// name does not depend on where the output tree is); a second child with the same name takes '~2', '~3', ... (its
// file is reserved when its first lab is created); the k-th lab of one process gets '#k'. An in-process lab is named
// by its caller. A play session on the wall clock (--idle wall without --replay) is not traced, nor the --replay of a
// recording made on the wall clock (R-WALL and R-XR cover them).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { traceLabs } from './env.mjs';
import { Session, dump, FORMAT, FORMAT4 } from '../../src/trace/tracer.mjs';
import { DisplayLab } from '../../src/lab/display.mjs';
import { OsdLab } from '../../src/lab/osd.mjs';
import { spacedJson } from '../../src/util/tracejson.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

// The value after `opt` in argv ('--opt V' or '--opt=V'), or null.
function optValue(argv, opt) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === opt && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith(opt + '=')) return argv[i].slice(opt.length + 1);
  }
  return null;
}
// Is a play session with this argv traced? (a nav session always is) Not on the wall clock (--idle wall
// without --replay), and not the --replay of a session recorded on the wall clock (its session.jsonl, or its
// session.json, beside a session.json whose args say idle wall without replay): the recording, so the replay, differs
// between the sides by design (R-XR replays one recording on both sides instead).
export function tracedPlay(argv) {
  const replay = optValue(argv, '--replay');
  if (replay === null) return (optValue(argv, '--idle') ?? 'wall') !== 'wall';
  const sib = replay.endsWith('session.json') ? replay : path.join(path.dirname(replay), 'session.json');
  if (!replay.endsWith('session.json') && !replay.endsWith('session.jsonl')) return true;
  try {
    const a = JSON.parse(fs.readFileSync(sib, 'utf8')).args ?? {};
    if (a.idle === 'wall' && !a.replay) return false;
  } catch { /* no session.json beside it: traced */ }
  return true;
}
export function childName(argv) {
  const out = optValue(argv, '--out');
  const tmp = out ? path.dirname(path.resolve(out)) : null;
  const norm = argv.map((x) => (tmp && x.startsWith(tmp + '/') ? '{tmp}/' + x.slice(tmp.length + 1) : x));
  return (out ? path.basename(out) : 'noout') + '@' + sha(spacedJson(norm)).slice(0, 8);
}

// The traced drawing(): a 'frame' event per bracket, in the lab's own trace (OsdLab and its subclasses).
let framesPatched = false;
function patchFrames() {
  if (framesPatched) return;
  framesPatched = true;
  const P = OsdLab.prototype, enter0 = P.drawing_enter, exit0 = P.drawing_exit;
  const trOf = (lab) => lab.session?.tracer ?? null;
  const raisedFrame = (lab, e, expect) => {
    const tr = trOf(lab);
    if (tr) tr.events.push(['frame', { raised: e.constructor.name, expect: [...expect], planes: tr.planes() }]);
  };
  P.drawing_enter = function (expect = [], errlog = 0) {
    const tr = trOf(this);
    if (tr) tr.lab = this;
    this.engine.lastRaw = null;
    try { return enter0.call(this, expect, errlog); } catch (e) { raisedFrame(this, e, expect); throw e; }
  };
  P.drawing_exit = function (st, error = null) {
    let frame;
    try { frame = exit0.call(this, st, error); } catch (e) { raisedFrame(this, e, st.expect); throw e; }
    const tr = trOf(this);
    if (tr) {
      const rows = this.engine.lastRaw ?? [];
      tr.events.push(['frame', { result: frame.result, command_total: frame.command_total, error_total: frame.error_total,
        errors: frame.errors.map((e) => e.name), key_hits: frame.key_hits,
        errlog: frame.errlog.map(([c]) => '0x' + c.toString(16).padStart(8, '0')), logged: rows.length,
        exec_rows_sha: sha(spacedJson(rows)), expect: [...st.expect], planes: tr.planes() }]);
    }
    return frame;
  };
}

// Install the tracer for this process or thread: {name} (an in-process lab) or {argv} (a child: its name from the
// argv). Returns {fields (the lab env's tracing fields), finish(rc)}, or null when OM_CHILD_TRACE is not set.
// install: also install the fields as checks/lib/env.mjs's traceLabs (labEnv picks them up).
export function installChildTrace({ name = null, argv = null, install = true } = {}) {
  const dir = process.env.OM_CHILD_TRACE;
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const slice = Number(process.env.OM_CHILD_TRACE_SLICE ?? '') || null;
  let base = null;
  const reserve = () => {
    if (base !== null) return base;
    const want = name ?? childName(argv);
    for (let n = 1; ; n++) {
      const b = n === 1 ? want : `${want}~${n}`;
      try { fs.closeSync(fs.openSync(path.join(dir, `${b}.json`), 'wx')); base = b; return base; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  };
  const sessions = [];
  patchFrames();
  const fields = {
    ...(slice ? { slice } : {}),
    beginSession(lab) {
      const b = reserve();
      const s = new Session(sessions.length ? `${b}#${sessions.length + 1}` : b, createHash, true);
      const fmt = lab instanceof DisplayLab ? FORMAT4 : FORMAT;
      Object.assign(s.tracer, { fmt, fmt3: fmt === FORMAT4, fmt4: fmt === FORMAT4 });
      sessions.push(s);
      return s;
    },
  };
  if (install) traceLabs(fields);
  const source = name ?? `emu child ${(argv ?? []).join(' ')}`;
  let done = false;
  return {
    fields,
    finish(rc = 0) {
      if (done) return;
      done = true;
      for (const s of sessions) {
        try { if (s.tracer.final === null && s.hle) s.hle.close(); } catch { /* keep what the trace has */ }
        const doc = dump(s.tracer, createHash, { source, rc, env: { head: '', emu: true, node: process.version }, stdout: [] });
        fs.writeFileSync(path.join(dir, `${s.name}.json`), JSON.stringify(doc));
      }
    },
  };
}
