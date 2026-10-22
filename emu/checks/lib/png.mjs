// The node side of the display harness's output files (checks only; src stays Worker-safe): write_png (an 8-bit RGB
// PNG, zlib level 6), a PNG reader (check_display's group 8 decodes its own PNGs back), write_outputs (<name>.png, the
// composite's raw words <name>.ycc and <name>.json) and jsonText, the JSON of those documents. A PNG is compared by
// its pixels, never by its bytes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { sortMembers } from '../../src/util/tracejson.mjs';
import { bytesHex } from '../../src/util/bytes.mjs';
import { DEVICE, ASSUMPTIONS, OPT_IN, STAND_INS_M8, words_to_rgb } from '../../src/lab/display.mjs';

const be32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
function chunk(kind, data) {
  const k = Buffer.from(kind, 'latin1');
  return Buffer.concat([be32(data.length), k, data, be32(zlib.crc32(Buffer.concat([k, data])))]);
}
// write_png: rows of 3 * width bytes, filter 0, zlib level 6
export function write_png(file, width, height, rgb) {
  const raw = Buffer.alloc((3 * width + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + 3 * width * y, 3 * width).copy(raw, (3 * width + 1) * y + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
// check_display.geometry's png(): [width, height, rows of 3 * width bytes] (filter 0 only, as write_png makes them)
export function read_png(file) {
  const data = fs.readFileSync(file);
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  const idat = [];
  for (let pos = 8; pos < data.length;) {
    const length = data.readUInt32BE(pos), kind = data.toString('latin1', pos + 4, pos + 8);
    if (kind === 'IDAT') idat.push(data.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rows = [];
  for (let y = 0; y < height; y++) rows.push(raw.subarray((3 * width + 1) * y + 1, (3 * width + 1) * (y + 1)));
  return [width, height, rows];
}

// The JSON text of an output document: JSON.stringify with the indent, a Map as an object (its keys as text), a Set
// as its sorted members, bytes as hex.
export function jsonText(v, indent = null) {
  return JSON.stringify(v, (k, x) => {
    if (x instanceof Map) return Object.fromEntries([...x].map(([key, y]) => [String(key), y]));
    if (x instanceof Set) return sortMembers(x);
    if (x instanceof Uint8Array) return bytesHex(x);
    return x;
  }, indent ?? undefined);
}

// write_outputs: <name>.png, <name>.ycc (the composite's words, little-endian) when there are words, and
// <name>.json (the composite, the registers, the routing and the session's logs). Returns [png path, sha256 or null].
export function write_outputs(lab, name, device, comp, dump, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const h = comp.header, words = comp.words;
  const png = path.join(outDir, `${name}.png`);
  let sha = null;
  if (words.length) {
    write_png(png, h.width, h.height, words_to_rgb(words));
    const raw = Buffer.from(Uint32Array.from(words).buffer);
    fs.writeFileSync(path.join(outDir, `${name}.ycc`), raw);
    sha = createHash('sha256').update(raw).digest('hex');
  }
  const notes = new Map();
  for (const n of lab.notes) { const t = [n.kind, n.channel, n.offset, n.pc]; notes.set(JSON.stringify(t), t); }
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
  const errlog = new Map();
  for (const s of lab.steps) for (const [c, caller] of s.errlog) { const k = `${c} from ${caller}`; errlog.set(k, (errlog.get(k) ?? 0) + 1); }
  const standIns = {};
  for (const [k, v] of Object.entries(STAND_INS_M8)) {
    if ((k === 'H-TIMER' && lab.timer_log && lab.timer_log.length) || (k === 'H-RESEND' && lab.steps.some((st) => st.name.includes('H-RESEND')))) standIns[k] = v;
  }
  const inUse = [...lab.assumptions_in_use].sort();
  const doc = new Map([['device', device], ['channel', DEVICE[device].channel], ['compose_status', comp.status], ['header', h],
    ['planes', comp.planes], ['errors', comp.errors], ['output_sha256', sha],
    ['registers', new Map([['written', dump.written], ['mirror', dump.mirror]])],
    ['displayed_palette', Object.fromEntries(Object.entries(dump.displayed_palette).map(([k, v]) => [k, '0x' + v.toString(16).padStart(4, '0')]))],
    ['out_ctrl', dump.out_ctrl], ['channel_state', dump.channel],
    ['assumptions', ASSUMPTIONS], ['assumptions_in_use', inUse], ['opt_in', Object.fromEntries(inUse.map((k) => [k, OPT_IN[k]]))],
    ['img', lab.img], ['img_path', lab.img_path], ['seeded', []],
    ['line_time', lab.line_ns], ['vsync_waits', lab.vsync_waits], ['vsync_frames', lab.vsync_frames],
    ['time_log', lab.time_log], ['notes', [...notes.values()].sort(cmp)], ['errlog', errlog], ['steps', lab.steps.map((s) => s.name)],
    ['stand_ins', standIns], ['h_timer', lab.timer_log]]);
  fs.writeFileSync(path.join(outDir, `${name}.json`), jsonText(doc, 1));
  return [png, sha];
}
