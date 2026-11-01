// Browser worker boot regression with the real OM-5 II updater file.
// OM_EMU_MODEL=E148 OM_BIN=<path to E148 .BIN> node emu/test/test_browser_e148.mjs
import fs from 'node:fs';
import { MODEL } from '../src/fw/model.mjs';

if (MODEL !== 'E148' || !process.env.OM_BIN) {
  console.error('Set OM_EMU_MODEL=E148 and OM_BIN to the OM-5 II updater file');
  process.exit(2);
}

globalThis.onmessage = null;
const result = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('browser worker boot timed out')), 120000);
  globalThis.postMessage = (msg) => {
    if (msg.type === 'error' || msg.type === 'boot-failed') {
      clearTimeout(timeout);
      reject(new Error(msg.message));
    } else if (msg.type === 'progress' && msg.stage === 'session') {
      clearTimeout(timeout);
      resolve();
    }
  };
});
await import('../web/worker.mjs');
const bytes = fs.readFileSync(process.env.OM_BIN);
onmessage({ data: { type: 'boot', file: new File([bytes], 'E148.BIN'), cache: false } });
await result;
console.log('E148 browser worker boot passed');
process.exit(0);
