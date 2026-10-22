// A hung-up terminal for the play server (checks/lib/playhttp.mjs): `script -qfec 'node rcwrap.mjs RCFILE CMD ...; true'`
// runs this process under sh -c, the session leader of a fresh pty. It ignores SIGHUP itself, runs CMD as a child in
// its process group (the terminal's foreground group: not detached) with the terminal on its stdio, and writes
// 'pid <child pid>' and then 'rc <exit status>' (minus the signal number for a signal) to RCFILE, the status `script`
// cannot report once it is killed. When the terminal hangs up, the kernel signals the session leader (sh exits) and
// then the foreground group: the SIGHUP reaches the child. (As the session leader itself, with exec, rcwrap took the
// hang-up alone and the child never saw it: X, part B.)
//   node emu/checks/lib/rcwrap.mjs RCFILE CMD [ARGS ...]
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

process.on('SIGHUP', () => {});
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});
const [rcfile, cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: 'inherit' });
fs.writeFileSync(rcfile, `pid ${child.pid}\n`);
child.on('exit', (code, signal) => {
  fs.appendFileSync(rcfile, `rc ${code ?? -(os.constants.signals[signal] ?? 0)}\n`);
  process.exit(0);
});
