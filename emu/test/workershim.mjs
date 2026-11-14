// Hosts web/worker.mjs in a node worker thread for test_web.mjs (host/'s server hosts it the same way): the Worker
// globals it uses (onmessage, postMessage), and a boot message's binPath read into a File, as the page's file input
// hands it over. With OM_TEST_FAKE_OPFS in its env (JSON: the files to seed, {'dir/file': text}) the thread has an OPFS
// in memory (test/fakeopfs.mjs), which a {type: 'fake-opfs-dump'} message answers with {type: 'fake-opfs', files}.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDir, installFakeOpfs } from './fakeopfs.mjs';

const fake = process.env.OM_TEST_FAKE_OPFS ? new FakeDir().seed(JSON.parse(process.env.OM_TEST_FAKE_OPFS)) : null;
if (fake) installFakeOpfs(fake);
globalThis.onmessage = null;
globalThis.postMessage = (m, t) => parentPort.postMessage(m, t);
await import('../web/worker.mjs');
parentPort.on('message', (m) => {
  if (m.type === 'fake-opfs-dump') { parentPort.postMessage({ type: 'fake-opfs', files: fake ? fake.dump() : null }); return; }
  if (m.type === 'boot' && m.binPath) {
    const b = fs.readFileSync(m.binPath);
    m = { ...m, file: new File([b], path.basename(m.binPath)) };
    delete m.binPath;
  }
  globalThis.onmessage({ data: m });
});
