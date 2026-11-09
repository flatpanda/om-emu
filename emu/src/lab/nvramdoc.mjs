// S-NVRAM's document (src/lab/menu.mjs): the camera's non-volatile state as the hosts keep it (host/nvram.mjs in a file,
// web/nvram.mjs in OPFS) and as a session log records it: {version: 1, model, M, E (the settings stores' flash images,
// base64), scpu (the SCPU window's backed-up words by offset), clock_offset, clock_status, scpu_words (the sub-CPU's
// memory, src/lab/scpudev.mjs ScpuMemory)}. A document names its model and is refused by another (one without a model,
// written before the field existed, is taken and stamped at its next save). Pure: no host APIs.
//   recordNvram(nv)   the Player's wrapper of a host's S-NVRAM: the same calls, plus the record of what each session
//                     started from (session.json's nvram, src/lab/player.mjs): {start, sessions: [{clock, doc?}]}, the
//                     document when the run began and, per session, the host's clock read at its start and, only
//                     where the host's document was not what this run's own saves left (another writer, a forget),
//                     that document
//   replayNvram(rec)  the same calls from such a record, in memory: --replay starts each session from what the
//                     recorded one started from, and never reads or writes the host's own state
import { bytesBase64, base64Bytes } from '../util/bytes.mjs';
import { MODEL } from '../fw/model.mjs';
import { ValueError } from './errors.mjs';

const copy = (j) => (j === null || j === undefined ? null : JSON.parse(JSON.stringify(j)));
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fresh = (j) => j ?? { version: 1, model: MODEL };
const stamp = (j) => { j.model ??= MODEL; return j; };

// the document as the lab's load() answers it: {M, E: Uint8Array or null, scpu, clock_offset, clock_status,
// scpu_words}, or null for a camera that never saved; where names the place in a refusal
export function nvramDecode(j, where) {
  if (j === null || j === undefined) return null;
  if (!isDict(j)) throw new ValueError(`S-NVRAM ${where}: not a JSON object`);
  if (j.model !== undefined && j.model !== MODEL) throw new ValueError(`S-NVRAM ${where}: the state of a ${j.model}, not of this ${MODEL}`);
  const bytes = (s, name) => {
    if (s === undefined || s === null) return null;
    const b = base64Bytes(s);
    if (b === null) throw new ValueError(`S-NVRAM ${where}: store ${name} is not base64`);
    return b;
  };
  return { M: bytes(j.M, 'M'), E: bytes(j.E, 'E'), scpu: j.scpu ?? null, clock_offset: j.clock_offset ?? 0, clock_status: j.clock_status ?? 0, scpu_words: j.scpu_words ?? {} };
}
// The saves, on a document (null: a new one); each returns the document
export function nvramSave(j, name, data) { j = stamp(fresh(j)); j[name] = bytesBase64(data); return j; }
export function nvramSaveScpu(j, words) { j = stamp(fresh(j)); j.scpu = { ...words }; return j; }
export function nvramSaveScpuMemory(j, m) {
  j = stamp(fresh(j));
  Object.assign(j, { clock_offset: m.clock_offset, clock_status: m.clock_status, scpu_words: { ...m.words } });
  return j;
}
// local time as seconds since 1970-01-01 00:00 (the SCPU clock word 0xe8 holds local time, 0x5012bf86)
export function hostNow() { const d = new Date(); return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60; }

// nv: a host's S-NVRAM (doc, load, save, saveScpu, saveScpuMemory, now); onRecord(record): after each session's start
// is recorded. The lab calls load() once at each session's store init, then now() once (menu.mjs store_init).
export function recordNvram(nv, onRecord = null) {
  const start = copy(nv.doc());
  let mirror = copy(start);
  const record = { start, sessions: [] };
  const nvram = {
    file: nv.file,
    doc: () => nv.doc(),
    load() {
      const out = nv.load(), j = copy(nv.doc()), s = {};      // the host's load (a refused document records nothing)
      if (JSON.stringify(j) !== JSON.stringify(mirror)) { s.doc = copy(j); mirror = j; }
      record.sessions.push(s);
      return out;
    },
    save(name, data) { nv.save(name, data); mirror = nvramSave(mirror, name, data); },
    saveScpu(words) { nv.saveScpu(words); mirror = nvramSaveScpu(mirror, words); },
    saveScpuMemory(m) { nv.saveScpuMemory(m); mirror = nvramSaveScpuMemory(mirror, m); },
    now() {
      const s = record.sessions.at(-1);
      if (!s || 'clock' in s) throw new Error('S-NVRAM: the clock read without a session load before it');
      s.clock = nv.now();
      onRecord?.(record);
      return s.clock;
    },
    ...(nv.pending ? { pending: () => nv.pending() } : {}),
  };
  return { nvram, record };
}

// A record as session.json keeps it, checked: the record, or a ValueError naming file
export function nvramRecord(rec, file) {
  const bad = (why) => new ValueError(`--replay ${file}: nvram ${why}`);
  if (!isDict(rec) || !Array.isArray(rec.sessions)) throw bad('is not {start, sessions: [...]}');
  if (rec.start !== null && !isDict(rec.start)) throw bad('start is not a document or null');
  rec.sessions.forEach((s, i) => {
    if (!isDict(s) || !Number.isSafeInteger(s.clock)) throw bad(`session ${i + 1}: no integer clock`);
    if ('doc' in s && s.doc !== null && !isDict(s.doc)) throw bad(`session ${i + 1}: doc is not a document or null`);
  });
  return rec;
}

// where: the log, for the session line and a refusal
export function replayNvram(rec, where) {
  let j = copy(rec.start), k = 0, cur = null;
  return {
    file: where,
    doc: () => j,
    load() {
      cur = rec.sessions[k++] ?? null;
      if (cur === null) throw new ValueError(`S-NVRAM ${where}: the log records ${rec.sessions.length} session start(s) with the kept state, and the replay opened another`);
      if ('doc' in cur) j = copy(cur.doc);
      return nvramDecode(j, where);
    },
    save(name, data) { j = nvramSave(j, name, data); },
    saveScpu(words) { j = nvramSaveScpu(j, words); },
    saveScpuMemory(m) { j = nvramSaveScpuMemory(j, m); },
    now() {
      if (cur === null) throw new Error('S-NVRAM: the clock read without a session load before it');
      return cur.clock;
    },
  };
}
