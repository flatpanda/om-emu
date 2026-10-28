// The camera's non-volatile state for the browser player (env.nvram, src/lab/menu.mjs S-NVRAM; opt-in, the page's
// nvram=1): the same document host/nvram.mjs keeps in its file (the settings stores' flash images M and E as base64,
// the SCPU window's backed-up words, the sub-CPU's memory), held here in memory and written to this browser's OPFS
// (web/opfs.mjs storeNvram) after each save. The lab's calls are synchronous and OPFS is not, so a save returns at once
// and its write follows; writes go one at a time, each of the document as it is then (a save during a write is in the
// next one). A failed write is reported through onError and the session runs on. Worker-safe.
import { bytesBase64, base64Bytes } from '../src/util/bytes.mjs';

// doc: the kept document (web/opfs.mjs loadNvram), or null for a camera that never saved; store(text): the write, a
// promise; where: the place it is kept, for the page
export function browserNvram(doc, store, onError, where = 'OPFS') {
  let j = doc, writing = null, again = false;
  const flush = () => {
    if (writing !== null) { again = true; return; }
    writing = Promise.resolve().then(() => store(JSON.stringify(j))).catch(onError).finally(() => {
      writing = null;
      if (again) { again = false; flush(); }
    });
  };
  const bytes = (s) => (typeof s === 'string' ? base64Bytes(s) : null);
  return {
    file: where,
    // as host/nvram.mjs load(): {M, E, scpu, clock_offset, clock_status, scpu_words}, or null
    load() {
      return j ? { M: bytes(j.M), E: bytes(j.E), scpu: j.scpu ?? null, clock_offset: j.clock_offset ?? 0, clock_status: j.clock_status ?? 0, scpu_words: j.scpu_words ?? {} } : null;
    },
    saveScpuMemory(m) { j ??= { version: 1 }; Object.assign(j, { clock_offset: m.clock_offset, clock_status: m.clock_status, scpu_words: m.words }); flush(); },
    save(name, data) { j ??= { version: 1 }; j[name] = bytesBase64(data); flush(); },
    saveScpu(words) { j ??= { version: 1 }; j.scpu = words; flush(); },
    // local time as seconds since 1970-01-01 00:00 (host/nvram.mjs now())
    now() { const d = new Date(); return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60; },
    // the write in flight (a promise), or null: a test waits until there is none
    pending() { return writing; },
  };
}
