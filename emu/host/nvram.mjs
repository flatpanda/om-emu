// The camera's non-volatile state for a node-hosted lab (env.nvram, src/lab/menu.mjs S-NVRAM): the settings stores' flash
// images the firmware saves (M, the user settings, and E), the SCPU window's backed-up words (the clock signature 0x00
// and the B store 0x08..0x3c) and the sub-CPU's own memory (src/lab/scpudev.mjs ScpuMemory: its RTC's date as an
// offset from the host's local time, the status a get would answer, its backup registers by number), kept in one JSON
// file between sessions (the document of src/lab/nvramdoc.mjs), and the host's local time for the clock.
// bin/play.mjs keeps it by default, one file per model (nvramChoice); node-only (host/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nvramDecode, nvramSave, nvramSaveScpu, nvramSaveScpuMemory, hostNow } from '../src/lab/nvramdoc.mjs';

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
  return {
    file,
    // the document as the file holds it, or null (none yet)
    doc: read,
    // {M, E: Uint8Array or null, scpu: {offset: word} or null, clock_offset, clock_status, scpu_words: {index: word}},
    // or null for a camera that never saved; a file of another model is refused
    load() { return nvramDecode(read(), file); },
    // the sub-CPU's memory {clock_offset: its RTC's date less the host's local time in seconds, clock_status, words: the backup registers}
    saveScpuMemory(m) { write(nvramSaveScpuMemory(read(), m)); },
    save(name, data) { write(nvramSave(read(), name, data)); },
    saveScpu(words) { write(nvramSaveScpu(read(), words)); },
    now: hostNow,
  };
}

// The player's default place for a model's state: ~/.om-emu/nvram-<model>.json; for patched firmware (--patch,
// --main) the build's own, ~/.om-emu/nvram-<model>-<the first 8 hex digits of its main code block's sha256>.json, so
// that a patched build and the stock one never load each other's state
export const nvramDefault = (model, build = null) => path.join(os.homedir(), '.om-emu', `nvram-${model}${build ? `-${build.slice(0, 8)}` : ''}.json`);

// bin/play.mjs's choice (host/playcli.mjs): arg, the --nvram value (on, off or a file) or null; env, OM_EMU_NVRAM (the
// same values; empty is unset); --nvram wins over OM_EMU_NVRAM, which wins over the default, on. unsupported: why this
// model cannot keep its state (src/lab/menu.mjs nvramUnsupported) or null; scpuNative: OM_EMU_SCPU=native on a body
// with the sub-CPU's own firmware (its backup domain is not kept, menu.mjs scpu_m4); replay: --replay is given, whose
// log decides (src/lab/player.mjs); build: patched firmware's main code block sha256 (null for stock), which keys the
// default file (nvramDefault). Returns {file (null: not kept), explicit (asked for by --nvram or OM_EMU_NVRAM, not
// by the default), custom (a file named, not the model's own), source (--nvram, OM_EMU_NVRAM or null), line (the
// startup line; null under --replay, whose line host/playcli.mjs writes from the log), envIgnored (--replay with
// OM_EMU_NVRAM set)}, or {refuse: the reason to stop before the server starts}.
export function nvramChoice({ arg, env, model, unsupported = null, scpuNative = false, replay = false, build = null }) {
  const source = arg !== null && arg !== undefined ? '--nvram' : env ? 'OM_EMU_NVRAM' : null;
  const value = source === '--nvram' ? arg : source ? env : 'on';
  if (value === '') return { refuse: '--nvram: on, off or a file' };
  if (replay) {
    if (source === '--nvram') return { refuse: '--nvram with --replay: a replay starts from the kept state its log records (or from a blank camera), never from a file' };
    return { file: null, explicit: false, custom: false, source, line: null, envIgnored: source !== null };
  }
  if (value === 'off') return { file: null, explicit: true, custom: false, source, line: `play: settings not kept (${source} off): a blank camera at each start (S-SETSAVE)` };
  const file = value === 'on' ? nvramDefault(model, build) : path.resolve(value), explicit = source !== null, custom = value !== 'on';
  const off = unsupported ?? (scpuNative ? 'OM_EMU_SCPU=native: the sub-CPU\'s own backup domain (its RTC and backup registers) is not kept between sessions' : null);
  if (off !== null) {
    if (explicit) return { refuse: `${source} ${value}: ${off}` };
    return { file: null, explicit: false, custom: false, source, line: `play: settings not kept on ${model}: ${off} (S-SETSAVE)` };
  }
  const own = build && value === 'on' ? `, the patched build's own file (its main code block's sha256 ${build.slice(0, 8)}...)` : '';
  return { file, explicit, custom, source, line: `play: settings and clock kept in ${file} (S-NVRAM${own}; --nvram off for a blank camera)` };
}
