// Unit tests for OM_HOST_MEM (host/memprobe.mjs): main and worker isolate sampling, rate limiting, and no-op when unset.
// Firmware-free standalone test:
//   node emu/test/test_memprobe.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { installMemProbe, createMemSampler } from '../host/memprobe.mjs';

const MEMPROBE_URL = new URL('../host/memprobe.mjs', import.meta.url).href;

function readLines(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function validSample(s, wantIsolate) {
  return s !== null && typeof s === 'object'
    && typeof s.t === 'number' && Number.isFinite(s.t)
    && Number.isInteger(s.heap) && s.heap > 0
    && Number.isInteger(s.ext) && s.ext >= 0
    && s.isolate === wantIsolate;
}

export async function memprobeTests() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 1. No-op when unset / empty
  const prev = process.env.OM_HOST_MEM;
  delete process.env.OM_HOST_MEM;
  try {
    ok(installMemProbe() === null, 'installMemProbe() returns null when OM_HOST_MEM is unset');
    ok(installMemProbe('') === null, 'installMemProbe("") returns null');
    ok(createMemSampler() === null, 'createMemSampler() returns null when OM_HOST_MEM is unset');
    ok(createMemSampler('') === null, 'createMemSampler("") returns null');
  } finally {
    if (prev !== undefined) process.env.OM_HOST_MEM = prev;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-memprobe-'));
  try {
    // 2. Rate-limited sampler with fake clock
    const f1 = path.join(dir, 'sampler.jsonl');
    let now = 10.0;
    const sampler = createMemSampler(f1, () => now, { isolate: 'worker', minIntervalS: 1 });
    ok(typeof sampler === 'function', 'createMemSampler returns a function when file is set');
    ok(sampler() === true, 'first sample runs');
    now = 10.5;
    ok(sampler() === false, 'sample within minIntervalS is skipped');
    now = 11.0;
    ok(sampler() === true, 'sample at minIntervalS runs');
    now = 11.1;
    ok(sampler(true) === true, 'forced sample runs within minIntervalS');
    const s1 = readLines(f1);
    ok(s1.length === 3, `expected 3 sampler lines, got ${s1.length}`);
    ok(s1.every((x) => validSample(x, 'worker')), `invalid worker sample(s): ${JSON.stringify(s1)}`);
    ok(s1[0].t === 10 && s1[1].t === 11 && s1[2].t === 11.1, `unexpected timestamps: ${s1.map((x) => x.t)}`);

    // 3. Main isolate timer probe + real worker_threads isolate writing to the same file
    const f2 = path.join(dir, 'both.jsonl');
    const timer = installMemProbe(f2, undefined, { intervalMs: 40 });
    ok(timer !== null, 'installMemProbe returns timer handle when file is set');
    try {
      await new Promise((resolve, reject) => {
        const w = new Worker(`
          import { createMemSampler } from ${JSON.stringify(MEMPROBE_URL)};
          const sample = createMemSampler(${JSON.stringify(f2)}, undefined, { minIntervalS: 1 });
          sample(true);
          const buf = Buffer.alloc(4 * 1024 * 1024, 7);
          sample(true);
          if (buf[0] !== 7) throw new Error('buf mutated');
        `, { eval: true });
        w.on('error', reject);
        w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
      });
      await new Promise((r) => setTimeout(r, 90));
    } finally {
      clearInterval(timer);
    }

    const s2 = readLines(f2);
    const mains = s2.filter((x) => x.isolate === 'main');
    const workers = s2.filter((x) => x.isolate === 'worker');
    ok(mains.length >= 2, `expected >= 2 main samples, got ${mains.length}`);
    ok(workers.length === 2, `expected 2 worker samples, got ${workers.length}`);
    ok(mains.every((x) => validSample(x, 'main')), `invalid main sample(s): ${JSON.stringify(mains)}`);
    ok(workers.every((x) => validSample(x, 'worker')), `invalid worker sample(s): ${JSON.stringify(workers)}`);
    ok(workers[1].ext >= workers[0].ext + 3 * 1024 * 1024,
      `worker external memory did not reflect 4 MiB Buffer: ${workers[0].ext} -> ${workers[1].ext}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad } = await memprobeTests();
  if (bad.length) {
    console.error(`test_memprobe: FAIL (${bad.length}/${checks}):\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`test_memprobe: PASS (${checks} checks)`);
}
