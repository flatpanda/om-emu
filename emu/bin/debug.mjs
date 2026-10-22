#!/usr/bin/env node
// The debug API's command line: runs firmware code on the JS machine from an entry point, plus a JSON-lines mode for
// agents.
//   node emu/bin/debug.mjs --entry ADDR [--image IMAGE] [--stop ADDR]... [--reg NAME=VALUE]... [--write ADDR=HEX]...
//                            [--read ADDR:SIZE]... [--step] [--stack [WORDS]] [--trace PATH] [--insn-limit N]
//   node emu/bin/debug.mjs --serve        one JSON request per line on stdin, one response per line on stdout
//                                           (src/debug/protocol.mjs lists the ops)
// The options parse as the checks' do (checks/lib/args.mjs: an unknown option or a malformed value, an item option's
// too, exits 2 with the usage line); ADDR, VALUE, SIZE and LEN are integers (decimal or 0x...), HEX pairs of hex
// digits. The run prints JSON on stdout (indent 2, registers as 0x%08x, memory and stack only when asked for); on a
// nonzero fault it prints the whole device and trap stderr after it and exits 1, and a debugger read error is an
// uncaught 'RuntimeError: GDB m...: E14' (its stack, exit 1). --image defaults to
// artifacts/nd128/OM1_v1.9_ND128.main-code.bin, built in memory from artifacts/nd128/manifest.json's patches (the file
// itself is not read). --trace PATH runs the machine in the one-instruction mode (every instruction a one-instruction
// TB) and writes QEMU -d exec's 'MN10300 pc=' lines (its 'Trace 0:' lines carry host pointers and are not written).
// As for the checks, OM_MACHINE gives the machine options (checks/lib/env.mjs). Also:
//   --serve                     the JSON-lines mode (no --entry needed)
//   --watch ADDR:LEN[:KIND]     a stopping watchpoint (KIND r, w or rw; default w), per virtual address; a stop on it
//                               adds "watch" to the output
//   --exec-trace PATH           every executed instruction as a QEMU -d exec line, with --trace-mode native (the
//                               default: the untraced run's interrupt timing) or one-insn (one-instruction TBs)
//   --mmio-trace PATH           every MMIO access as QEMU's memory_region_ops line plus the pc
//   --irq-trace PATH            every interrupt presentation and acceptance
//   --disasm ADDR:LEN           disassembly at the stop (tools/mn10300-objdump, or $OM_OBJDUMP), added as "disasm"
//   --max-ms N                  pause the continue after N ms of wall time (adds "paused": true)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { REPO, PATCHED, createHash, envMachine, runMain, readBytes, readPatched } from '../checks/lib/env.mjs';
import { parseArgs, intValue } from '../checks/lib/args.mjs';
import { Simulator, SP } from '../src/lab/sim.mjs';
import { RuntimeError } from '../src/lab/errors.mjs';
import { Debugger } from '../src/debug/debugger.mjs';
import { Protocol } from '../src/debug/protocol.mjs';
import { execLine, mmioPcLine, irqLine } from '../src/debug/trace.mjs';
import { regsHex } from '../src/debug/regs.mjs';

const PROG = 'debug.mjs';
const ACTIONS = [
  { opt: '--image', type: 'path', default: PATCHED },
  { opt: '--entry', type: 'int', required: true, metavar: 'ADDR' },
  { opt: '--stop', type: 'int', repeat: true, metavar: 'ADDR' },
  { opt: '--reg', type: 'str', repeat: true, metavar: 'NAME=VALUE' },
  { opt: '--write', type: 'str', repeat: true, metavar: 'ADDR=HEX' },
  { opt: '--read', type: 'str', repeat: true, metavar: 'ADDR:SIZE' },
  { opt: '--step', type: 'flag', default: false },
  { opt: '--stack', type: 'int', bare: 16, default: 0, metavar: 'WORDS' },
  { opt: '--trace', type: 'path', metavar: 'PATH' },
  { opt: '--insn-limit', type: 'int', metavar: 'N' },
  { opt: '--serve', type: 'flag', default: false },
  { opt: '--watch', type: 'str', repeat: true, metavar: 'ADDR:LEN[:KIND]' },
  { opt: '--exec-trace', type: 'path', metavar: 'PATH' },
  { opt: '--trace-mode', type: 'str', choices: ['native', 'one-insn'], default: 'native' },
  { opt: '--mmio-trace', type: 'path', metavar: 'PATH' },
  { opt: '--irq-trace', type: 'path', metavar: 'PATH' },
  { opt: '--disasm', type: 'str', repeat: true, metavar: 'ADDR:LEN' },
  { opt: '--max-ms', type: 'int', metavar: 'N' },
];
// A buffered line writer (the trace files). prepare (the protocol's trace op): the file is opened (created if missing)
// but not truncated until commit(); discard() closes it and removes it when this open created it.
export function openSink(file, { prepare = false } = {}) {
  const created = prepare && !fs.existsSync(file);
  const fd = fs.openSync(file, prepare ? fs.constants.O_WRONLY | fs.constants.O_CREAT : 'w');
  let buf = [], n = 0;
  const flush = () => { if (buf.length) { fs.writeSync(fd, buf.join('')); buf = []; n = 0; } };
  return {
    write(line) { buf.push(line + '\n'); n += line.length; if (n > 1 << 20) flush(); },
    close() { flush(); fs.closeSync(fd); },
    commit() { fs.ftruncateSync(fd, 0); },
    discard() { fs.closeSync(fd); if (created) fs.rmSync(file, { force: true }); },
  };
}
// The disassembly callback of the library: tools/mn10300-objdump (or $OM_OBJDUMP) on the bytes at their address.
export function disasm(addr, bytes) {
  const objdump = process.env.OM_OBJDUMP || path.join(REPO, 'tools/mn10300-objdump');
  if (!fs.existsSync(objdump)) throw new Error(`disasm: ${objdump} not found (build or copy tools/mn10300-objdump, or set OM_OBJDUMP)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-disasm-'));
  try {
    const f = path.join(dir, 'code.bin');
    fs.writeFileSync(f, bytes);
    const out = execFileSync(objdump, ['-D', '-b', 'binary', '-m', 'mn10300', `--adjust-vma=0x${addr.toString(16)}`, f], { encoding: 'utf8' });
    return out.split('\n').filter((l) => /^\s*[0-9a-f]+:\t/.test(l)).map((l) => l.trimEnd());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function loadImage(p) {
  try { return p === PATCHED ? readPatched() : readBytes(p); } catch (e) { throw new RuntimeError(`${PROG}: cannot read the image ${p} (${e.code ?? e.message})`); }
}
// The item options' fields: NAME=VALUE, ADDR=HEX, ADDR:SIZE, ADDR:LEN[:KIND], ADDR:LEN, a usage error when malformed.
function items(args) {
  const split = (opt, item, sep, n, form) => {
    const parts = item.split(sep);
    if (parts.length < 2 || parts.length > n) args.error(`${opt} ${item}: ${form}`);
    return parts;
  };
  const int = (opt, item, text) => { const v = intValue(text); if (v === null) args.error(`${opt} ${item}: ${text} is not an integer`); return v; };
  return {
    regs: args.reg.map((x) => { const [k, v] = split('--reg', x, '=', 2, 'NAME=VALUE'); return [k, int('--reg', x, v)]; }),
    writes: args.write.map((x) => {
      const [a, h] = split('--write', x, '=', 2, 'ADDR=HEX');
      if (!/^([0-9a-f]{2})*$/i.test(h)) args.error(`--write ${x}: HEX is pairs of hex digits`);
      return [int('--write', x, a) >>> 0, Uint8Array.from(Buffer.from(h, 'hex'))];
    }),
    reads: args.read.map((x) => split('--read', x, ':', 2, 'ADDR:SIZE').map((v) => int('--read', x, v))),
    watches: args.watch.map((x, k) => {
      const [a, l, kind = 'w'] = split('--watch', x, ':', 3, 'ADDR:LEN[:KIND]');
      return { id: k, lo: int('--watch', x, a), len: int('--watch', x, l), kind, action: 'stop' };
    }),
    disasms: args.disasm.map((x) => split('--disasm', x, ':', 2, 'ADDR:LEN').map((v) => int('--disasm', x, v))),
  };
}

function main(argv) {
  const serve = argv.includes('--serve');
  const actions = serve ? ACTIONS.map((a) => a.opt === '--entry' ? { ...a, required: false } : a) : ACTIONS;
  const args = parseArgs(PROG, argv, actions);
  if (serve) { startServe(); return 0; }
  const { regs, writes, reads, watches, disasms } = items(args);       // all checked before the machine starts
  const oneInsn = args.trace !== undefined || args.trace_mode === 'one-insn' && args.exec_trace !== undefined;
  const env = { rom: loadImage(args.image), createHash, machine: { ...envMachine(), ...(oneInsn ? { oneInsn } : {}) } };
  const sim = new Simulator(env, args.insn_limit ?? null);
  const dbg = Debugger.attach(sim, { disasm });
  const sinks = [];
  let trace = null;
  try {
    if (args.trace !== undefined) {
      trace = openSink(args.trace);
      dbg.traceExec((r) => trace.write(execLine(r)), { mode: 'one-insn' });
    } else if (args.exec_trace !== undefined) {
      const s = openSink(args.exec_trace); sinks.push(s);
      dbg.traceExec((r) => s.write(execLine(r)), { mode: args.trace_mode });
    }
    if (args.mmio_trace !== undefined) { const s = openSink(args.mmio_trace); sinks.push(s); dbg.traceMmio((r) => s.write(mmioPcLine(r))); }
    if (args.irq_trace !== undefined) { const s = openSink(args.irq_trace); sinks.push(s); dbg.traceIrq((r) => s.write(irqLine(r))); }
    const initial = new Map(regs);
    initial.set('pc', args.entry);
    sim.reset(Object.fromEntries(initial));
    for (const [address, bytes] of writes) sim.write(address, bytes);
    if (watches.length) dbg.watch(watches);
    let result, paused = false;
    if (args.max_ms !== undefined && !args.step) {
      const o = dbg.cont({ stops: args.stop, maxMs: args.max_ms });
      paused = o.stop === 'paused';
      result = sim.registers();
    } else result = sim.run(args.stop, args.step);
    const output = { registers: regsHex(result) };
    if (reads.length) {
      output.memory = {};
      for (const [address, size] of reads) output.memory[`0x${address.toString(16).padStart(8, '0')}`] = Buffer.from(size > 0 ? sim.read(address, size) : []).toString('hex');
    }
    if (args.stack) output.stack = sim.stack(args.stack, initial.has('sp') ? initial.get('sp') : SP);
    if (dbg.m.watchHit()) { const w = dbg.m.watchHit(); output.watch = { id: w.id, hit: `0x${w.hit.toString(16).padStart(8, '0')}`, dir: w.dir, size: w.size, pc: `0x${w.pc.toString(16).padStart(8, '0')}` }; }
    if (paused) output.paused = true;
    if (disasms.length) {
      output.disasm = {};
      for (const [a, l] of disasms) output.disasm[`0x${(a >>> 0).toString(16).padStart(8, '0')}`] = dbg.disasm(a, l);
    }
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    if (result.fault) {
      const lines = sim.m.stderrSince(0);
      if (lines.length) process.stderr.write(lines.join('\n') + '\n');
      return 1;
    }
    return 0;
  } finally {
    if (trace) trace.close();
    for (const s of sinks) s.close();
  }
}

function startServe() {
  const proto = new Protocol({ env: { createHash, machine: envMachine() }, defaultImage: PATCHED, loadImage, openSink, disasm, resolvePath: (p) => path.resolve(p) });
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  rl.on('line', (line) => {
    if (proto.done || !line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch (e) { process.stdout.write(JSON.stringify({ id: null, ok: false, error: { type: 'BadRequest', message: `not JSON: ${e.message}` } }) + '\n'); return; }
    process.stdout.write(JSON.stringify(proto.handle(req)) + '\n');
    if (proto.done) { rl.close(); process.stdin.destroy(); }
  });
  rl.on('close', () => { if (!proto.done) proto.handle({ op: 'quit' }); });
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(PROG, main);
