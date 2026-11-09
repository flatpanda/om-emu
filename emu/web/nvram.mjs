// The camera's non-volatile state for the browser player (env.nvram, src/lab/menu.mjs S-NVRAM; kept by default, the
// page's nvram=0 for a blank camera): the same document host/nvram.mjs keeps in its file (src/lab/nvramdoc.mjs: the
// settings stores' flash images M and E as base64,
// the SCPU window's backed-up words, the sub-CPU's memory), held here in memory and written to this browser's OPFS
// (web/opfs.mjs storeNvram) after each save. The lab's calls are synchronous and OPFS is not, so a save returns at once
// and its write follows; writes go one at a time, each of the document as it is then (a save during a write is in the
// next one). A failed write is reported through onError and the session runs on. Worker-safe.
import { nvramDecode, nvramSave, nvramSaveScpu, nvramSaveScpuMemory, hostNow } from '../src/lab/nvramdoc.mjs';

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
  return {
    file: where,
    doc: () => j,
    // as host/nvram.mjs load(): {M, E, scpu, clock_offset, clock_status, scpu_words}, or null
    load() { return nvramDecode(j, where); },
    saveScpuMemory(m) { j = nvramSaveScpuMemory(j, m); flush(); },
    save(name, data) { j = nvramSave(j, name, data); flush(); },
    saveScpu(words) { j = nvramSaveScpu(j, words); flush(); },
    // local time as seconds since 1970-01-01 00:00 (host/nvram.mjs now())
    now: hostNow,
    // the write in flight (a promise), or null: a test waits until there is none
    pending() { return writing; },
  };
}
