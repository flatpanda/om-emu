// The debug API's node callbacks: the trace files (openSink) and the disassembler (disasm), for bin/debug.mjs and the
// live route of a play session (src/debug/live.mjs, through the lab worker's env.debugHost). Node-only (host/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from '../checks/lib/env.mjs';

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
// The live route's host: trace paths are the play server's working directory's (path.resolve).
export const debugHost = { openSink, disasm, resolvePath: (p) => path.resolve(p) };
