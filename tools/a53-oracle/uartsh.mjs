// uartsh.mjs SOCK SCRIPT : type shell commands into the A53 console (ttyS0 RX,
// the om-isc "uart" chardev) at given times. The A53's inittab runs
// `console::respawn:-/bin/sh`, so this is an in-guest shell for the oracle (e.g.
// `ps`, an HTTP client for the CGI path, `nc` for sockets). SCRIPT lines are
// "afterMs command..."; blank lines and '#' lines are ignored. The guest's
// output arrives on QEMU's stderr (om-isc TX capture). Oracle only.
import fs from 'node:fs';
import net from 'node:net';
const [sockPath, script] = process.argv.slice(2);
const lines = fs.readFileSync(script, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const s = net.connect(sockPath);
s.on('error', (e) => console.log('[uartsh] error', e.message));
s.on('connect', () => {
  let last = 0;
  for (const l of lines) {
    const m = l.match(/^(\d+)\s+(.*)$/);
    if (!m) throw new Error(`bad line: ${l}`);
    last = Math.max(last, +m[1]);
    setTimeout(() => { console.log(`[uartsh] ${m[2]}`); s.write(m[2] + '\n'); }, +m[1]);
  }
  setTimeout(() => s.end(), last + 1000);
});
