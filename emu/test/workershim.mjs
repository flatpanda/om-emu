// Hosts web/worker.mjs in a node worker thread for test_web.mjs (host/'s server hosts it the same way): the Worker
// globals it uses (onmessage, postMessage), and a boot message's binPath read into a File, as the page's file input
// hands it over.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';

globalThis.onmessage = null;
globalThis.postMessage = (m, t) => parentPort.postMessage(m, t);
await import('../web/worker.mjs');
parentPort.on('message', (m) => {
  if (m.type === 'boot' && m.binPath) {
    const b = fs.readFileSync(m.binPath);
    m = { ...m, file: new File([b], path.basename(m.binPath)) };
    delete m.binPath;
  }
  globalThis.onmessage({ data: m });
});
