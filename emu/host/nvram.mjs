// The camera's non-volatile state for a node-hosted lab (env.nvram, src/lab/menu.mjs S-NVRAM): the settings stores' flash
// images the firmware saves (M, the user settings, and E), the SCPU's backed-up words (the clock signature 0x00 and
// the B store 0x08..0x3c), kept in one JSON file between sessions, and the host's local time for the SCPU clock.
// Off unless the host passes a file (OM_EMU_NVRAM); node-only (host/).
import fs from 'node:fs';
import path from 'node:path';

export function fileNvram(file) {
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const write = (j) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(j));
    fs.renameSync(tmp, file);
  };
  const bytes = (s) => (typeof s === 'string' ? new Uint8Array(Buffer.from(s, 'base64')) : null);
  return {
    file,
    // {M, E: Uint8Array or null, scpu: {offset: word} or null}, or null for a camera that never saved
    load() {
      const j = read();
      return j ? { M: bytes(j.M), E: bytes(j.E), scpu: j.scpu ?? null, clock_offset: j.clock_offset ?? 0 } : null;
    },
    // the camera clock's offset from the host's local time in seconds (set by the camera's own clock setting)
    saveClockOffset(s) { const j = read() ?? { version: 1 }; j.clock_offset = s; write(j); },
    save(name, data) { const j = read() ?? { version: 1 }; j[name] = Buffer.from(data).toString('base64'); write(j); },
    saveScpu(words) { const j = read() ?? { version: 1 }; j.scpu = words; write(j); },
    // local time as seconds since 1970-01-01 00:00 (the SCPU clock word 0xe8 holds local time, 0x5012bf86)
    now() { const d = new Date(); return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60; },
  };
}
