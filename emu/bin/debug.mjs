#!/usr/bin/env node
// The debug API's command line: runs firmware code on the JS machine from an entry point, plus a JSON-lines mode for
// agents.
//   node emu/bin/debug.mjs --entry ADDR [--image IMAGE] [--stop ADDR]... [--reg NAME=VALUE]... [--write ADDR=HEX]...
//                            [--read ADDR:SIZE]... [--step] [--stack [WORDS]] [--trace PATH] [--insn-limit N]
//   node emu/bin/debug.mjs --serve        one JSON request per line on stdin, one response per line on stdout
//                                           (src/debug/protocol.mjs lists the ops)
//   node emu/bin/debug.mjs --attach URL   the same lines to a running play session (bin/play.mjs --debug-api; URL:
//                                           its 'play: http://127.0.0.1:PORT/?t=TOKEN' line), the live route
//                                           (src/debug/live.mjs lists its ops), one request at a time in order
// The options parse as the checks' do (checks/lib/args.mjs: an unknown option or a malformed value, an item option's
// too, exits 2 with the usage line); ADDR, VALUE, SIZE and LEN are integers (decimal or 0x...), HEX pairs of hex
// digits; an ADDR outside 0..0xffffffff and a VALUE outside 32 bits (signed or unsigned) are usage errors. The run prints JSON on stdout (indent 2, registers as 0x%08x, memory and stack only when asked for); on a
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
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { PATCHED, createHash, envMachine, runMain, readBytes, readPatched } from '../checks/lib/env.mjs';
import { parseArgs, intValue } from '../checks/lib/args.mjs';
import { Simulator, SP } from '../src/lab/sim.mjs';
import { RuntimeError } from '../src/lab/errors.mjs';
import { Debugger } from '../src/debug/debugger.mjs';
import { Protocol } from '../src/debug/protocol.mjs';
import { execLine, mmioPcLine, irqLine } from '../src/debug/trace.mjs';
import { regsHex } from '../src/debug/regs.mjs';
import { openSink, disasm } from '../host/debughost.mjs';

export { openSink, disasm };

const PROG = 'debug.mjs';
const ACTIONS = [
  { opt: '--image', type: 'path', default: PATCHED },
  { opt: '--entry', type: 'int', required: true, metavar: 'ADDR' },
  { opt: '--attach', type: 'str', metavar: 'URL' },
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
  const address = (opt, item, text) => { const v = int(opt, item, text); if (v < 0 || v > 0xffffffff) args.error(`${opt} ${item}: ${text} is not a 32-bit address`); return v; };
  const value = (opt, item, text) => { const v = int(opt, item, text); if (v < -0x80000000 || v > 0xffffffff) args.error(`${opt} ${item}: ${text} is not a 32-bit value`); return v >>> 0; };
  const size = (opt, item, text) => { const v = int(opt, item, text); if (v < 0) args.error(`${opt} ${item}: ${text} is negative`); return v; };
  for (const [opt, v] of [['--entry', args.entry], ...args.stop.map((x) => ['--stop', x])]) {
    if (v !== undefined && (v < 0 || v > 0xffffffff)) args.error(`${opt} ${v}: not a 32-bit address`);
  }
  return {
    regs: args.reg.map((x) => { const [k, v] = split('--reg', x, '=', 2, 'NAME=VALUE'); return [k, value('--reg', x, v)]; }),
    writes: args.write.map((x) => {
      const [a, h] = split('--write', x, '=', 2, 'ADDR=HEX');
      if (!/^([0-9a-f]{2})*$/i.test(h)) args.error(`--write ${x}: HEX is pairs of hex digits`);
      return [address('--write', x, a), Uint8Array.from(Buffer.from(h, 'hex'))];
    }),
    reads: args.read.map((x) => { const [a, n] = split('--read', x, ':', 2, 'ADDR:SIZE'); return [address('--read', x, a), size('--read', x, n)]; }),
    watches: args.watch.map((x, k) => {
      const [a, l, kind = 'w'] = split('--watch', x, ':', 3, 'ADDR:LEN[:KIND]');
      const len = size('--watch', x, l);
      if (len < 1) args.error(`--watch ${x}: LEN is at least 1`);
      return { id: k, lo: address('--watch', x, a), len, kind, action: 'stop' };
    }),
    disasms: args.disasm.map((x) => { const [a, n] = split('--disasm', x, ':', 2, 'ADDR:LEN'); return [address('--disasm', x, a), size('--disasm', x, n)]; }),
  };
}

function main(argv) {
  const serve = argv.includes('--serve') || argv.includes('--attach');
  const actions = serve ? ACTIONS.map((a) => a.opt === '--entry' ? { ...a, required: false } : a) : ACTIONS;
  const args = parseArgs(PROG, argv, actions);
  if (args.attach !== undefined) {
    let url;
    try { url = new URL(args.attach); } catch { args.error(`--attach ${args.attach}: not a URL`); }
    if (url.protocol !== 'http:' || !url.searchParams.get('t')) args.error(`--attach ${args.attach}: the play server's http://127.0.0.1:PORT/?t=TOKEN`);
    startAttach(url);
    return 0;
  }
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

// --attach: each line POSTed to the play server's /api/debug (X-Token: the URL's t) in order, the next sent once the
// previous one is answered; a line that is not JSON, and a refused request (403: no --debug-api, a wrong token), are
// answered here in the protocol's error form; a server gone ends the client (exit 1).
function startAttach(url) {
  const token = url.searchParams.get('t');
  const post = (body) => new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const r = http.request(new URL('/api/debug', url), { method: 'POST', agent: false,
      headers: { 'X-Token': token, 'Content-Type': 'application/json', 'Content-Length': data.length } },
    (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') })); });
    r.on('error', reject);
    r.end(data);
  });
  const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const lines = [];
  let busy = false;
  const next = async () => {
    if (busy) return;
    busy = true;
    while (lines.length) {
      const line = lines.shift();
      let req;
      try { req = JSON.parse(line); } catch (e) { say({ id: null, ok: false, error: { type: 'BadRequest', message: `not JSON: ${e.message}` } }); continue; }
      try {
        const r = await post(JSON.stringify(req));
        if (r.status === 200) process.stdout.write(r.body + '\n');
        else say({ id: req?.id ?? null, ok: false, error: { type: 'HTTP', message: `${r.status} ${r.body}` } });
      } catch (e) {
        process.stderr.write(`${PROG}: ${url.origin}: ${e.message}\n`);
        process.exitCode = 1;
        lines.length = 0;
        rl.close();
        process.stdin.destroy();
      }
    }
    busy = false;
  };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  rl.on('line', (line) => { if (line.trim() && process.exitCode !== 1) { lines.push(line); next(); } });
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(PROG, main);
