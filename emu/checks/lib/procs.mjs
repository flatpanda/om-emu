// The process facts the checks read about their children, on any POSIX host (ps and lsof, as on Linux and macOS):
// the process table, a process's children, whether it is alive (not a
// zombie), its resident set size and the TCP ports it listens on.
import { execFileSync } from 'node:child_process';

// [{pid, ppid, state, rssKb, args}] of every process, from one ps call
export function processes() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,rss=,args='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const rows = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s?(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), state: m[3], rssKb: Number(m[4]), args: m[5] });
  }
  return rows;
}
const zombie = (p) => p.state.startsWith('Z');
// the pids whose parent is pid
export function children(pid) { return processes().filter((p) => p.ppid === pid).map((p) => p.pid); }
// pid exists and is not a zombie
export function alive(pid) { const p = processes().find((x) => x.pid === pid); return !!p && !zombie(p); }
// the live processes whose command line names text
export function naming(text) { return processes().filter((p) => !zombie(p) && p.args.includes(text)).map((p) => p.pid); }
// resident set size in kB, or null when pid is gone
export function rssKb(pid) { return processes().find((p) => p.pid === pid)?.rssKb ?? null; }
// the local addresses pid listens on over TCP, as 'host:port' (lsof, which exits 1 when nothing matches; a missing lsof
// is an error, not an empty list)
export function listening(pid) {
  let out;
  try { out = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    if (e.code === 'ENOENT') throw new Error('procs.listening: lsof is not installed');
    if (e.status !== 1) throw e;
    out = e.stdout ?? '';
  }
  return out.split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1));
}
