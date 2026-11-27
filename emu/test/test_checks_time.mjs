// Architecture finding F40: portable /usr/bin/time command construction and peak RSS parsing in bin/checks.mjs
// across Linux (GNU time -o -f '%e %M', KiB) and macOS/BSD (BSD time -l on stderr; bytes on darwin, KiB on BSD).
// Firmware-free standalone unit test:
//   node emu/test/test_checks_time.mjs
import { Refusal, timeCommand, parseTimeRss } from '../bin/checks.mjs';

const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

const DARWIN_TIME_L = [
  '        0.11 real         0.02 user         0.02 sys',
  '            43417600  maximum resident set size',
  '                   0  average shared memory size',
  '                   0  average unshared data size',
  '                   0  average unshared stack size',
  '                1342  page reclaims',
  '                1809  page faults',
  '            12863288  peak memory footprint',
  '',
].join('\n');

const BSD_TIME_L = [
  '        0.11 real         0.02 user         0.02 sys',
  '               42400  maximum resident set size',
  '                   0  average shared memory size',
  '',
].join('\n');

export function checksTimeUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 1. Command construction when measure / timeFile is inactive (normal runJs path).
  const nodeArgs = ['emu/checks/check_kernel.mjs', '--foo', 'bar'];
  for (const platform of ['linux', 'darwin', 'freebsd', 'openbsd', 'netbsd', 'win32']) {
    const [bin, argv] = timeCommand(nodeArgs, { timeFile: null, platform, execPath: '/usr/local/bin/node' });
    ok(bin === '/usr/local/bin/node' && eqArr(argv, nodeArgs),
      `no timeFile (${platform}): got [${bin}, ${JSON.stringify(argv)}]`);
  }

  // 2. Command construction on Linux (GNU time with -o and -f '%e %M').
  {
    const [bin, argv] = timeCommand(nodeArgs, { timeFile: '/tmp/t.txt', platform: 'linux', execPath: '/usr/bin/node' });
    const want = ['-o', '/tmp/t.txt', '-f', '%e %M', '/usr/bin/node', ...nodeArgs];
    ok(bin === '/usr/bin/time' && eqArr(argv, want),
      `linux timeCommand: got [${bin}, ${JSON.stringify(argv)}], want [/usr/bin/time, ${JSON.stringify(want)}]`);
  }

  // 3. Command construction on macOS and BSD (BSD /usr/bin/time -l, no -o / -f).
  for (const platform of ['darwin', 'freebsd', 'openbsd', 'netbsd']) {
    const [bin, argv] = timeCommand(nodeArgs, { timeFile: '/tmp/t.txt', platform, execPath: '/usr/bin/node' });
    const want = ['-l', '/usr/bin/node', ...nodeArgs];
    ok(bin === '/usr/bin/time' && eqArr(argv, want),
      `${platform} timeCommand: got [${bin}, ${JSON.stringify(argv)}], want [/usr/bin/time, ${JSON.stringify(want)}]`);
  }

  // 4. Unsupported platform with timeFile throws Refusal.
  {
    let caught = null;
    try {
      timeCommand(nodeArgs, { timeFile: '/tmp/t.txt', platform: 'win32', execPath: 'node.exe' });
    } catch (e) {
      caught = e;
    }
    ok(caught instanceof Refusal, `win32 timeCommand should throw Refusal, got ${caught}`);
  }

  // 5. Linux GNU time RSS parsing (KiB).
  ok(parseTimeRss('0.42 42400\n', { platform: 'linux' }) === 42400, 'linux simple output');
  ok(parseTimeRss('2 102400\n', { platform: 'linux' }) === 102400, 'linux integer elapsed');
  ok(parseTimeRss('Command exited with non-zero status 1\n1.05 65536\n', { platform: 'linux' }) === 65536,
    'linux non-zero status prefix');
  ok(parseTimeRss('0.00 0\n', { platform: 'linux' }) === 0, 'linux zero RSS');

  // 6. macOS (darwin) BSD /usr/bin/time -l RSS parsing (bytes -> rounded KiB).
  ok(parseTimeRss(DARWIN_TIME_L, { platform: 'darwin' }) === 42400,
    `darwin exact KiB: got ${parseTimeRss(DARWIN_TIME_L, { platform: 'darwin' })}`);
  ok(parseTimeRss('  103000  maximum resident set size\n', { platform: 'darwin' }) === 101,
    'darwin rounds up >= 0.5 KiB');
  ok(parseTimeRss('  102800  maximum resident set size\n', { platform: 'darwin' }) === 100,
    'darwin rounds down < 0.5 KiB');
  // Child stderr before BSD time block (including a decoy line) must pick the final time block.
  const withStderr = 'warning: 1024  maximum resident set size\nsome other stderr\n' + DARWIN_TIME_L;
  ok(parseTimeRss(withStderr, { platform: 'darwin' }) === 42400,
    `darwin with preceding child stderr: got ${parseTimeRss(withStderr, { platform: 'darwin' })}`);

  // 7. FreeBSD / OpenBSD / NetBSD BSD /usr/bin/time -l RSS parsing (already KiB).
  for (const platform of ['freebsd', 'openbsd', 'netbsd']) {
    const got = parseTimeRss(BSD_TIME_L, { platform });
    ok(got === 42400, `${platform} KiB: got ${got}, want 42400`);
  }

  // 8. Malformed / missing / invalid RSS handling returns null.
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    for (const badInput of ['', '   \n', null, undefined, 12345, 'unrelated stderr output\n']) {
      const got = parseTimeRss(badInput, { platform });
      ok(got === null, `${platform} bad input ${JSON.stringify(badInput)}: got ${got}, want null`);
    }
  }
  for (const badLinux of ['42400\n', '0.42 NaN\n', '0.42 -100\n', '0.42 abc\n']) {
    ok(parseTimeRss(badLinux, { platform: 'linux' }) === null, `linux malformed ${JSON.stringify(badLinux)}`);
  }
  for (const badBsd of ['abc  maximum resident set size\n', '-4096  maximum resident set size\n', '4096  peak memory footprint\n']) {
    ok(parseTimeRss(badBsd, { platform: 'darwin' }) === null, `darwin malformed ${JSON.stringify(badBsd)}`);
    ok(parseTimeRss(badBsd, { platform: 'freebsd' }) === null, `freebsd malformed ${JSON.stringify(badBsd)}`);
  }
  ok(parseTimeRss('0.42 42400\n', { platform: 'win32' }) === null, 'unsupported platform returns null');

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = checksTimeUnits();
  console.log(`checks time: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
