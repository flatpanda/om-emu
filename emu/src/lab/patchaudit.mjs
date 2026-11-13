// A patch overlay in the lab (env.patchRanges: the bytes of the main code block a patch overlay changed, sorted
// [offset, length] ranges, src/fw/patch.mjs applyPatches' changed). Ports, facts and the lab's hooks were written
// against the stock block, so the lab checks where they meet the patched bytes. "On patched bytes" is said of an
// address whose instruction (its length from the opcode, src/core/cpu.mjs insnLength; an opcode a patch changed is
// itself a changed byte) overlaps a changed byte, for a code address (a hook's pc, a task's entry, an address in the
// disassembly notation); of the byte itself for a run-time data address.
//   the hook rule    a lab hook reached at a pc on patched bytes stops the session (PatchHooked, from src/lab/hle.mjs
//                    _loop1): its stand-in would run in place of the patched code, so the session would not be
//                    running the firmware it claims to
//   H-PATCHTASK      a task start whose entry is on patched bytes is taken (src/lab/kernel.mjs LabTask._task_start):
//                    a task the patch made (no stock task's code is there), run natively and listed
//   patchAudit       after the bring-up (src/lab/player.mjs, host/navcli.mjs): the lab hooks installed then on patched
//                    bytes (each would stop the session when reached), and the model's ported addresses and facts
//                    (src/fw/ports.mjs PORTS and FACTS) on patched bytes: the lab calls or reads the patched bytes
//                    there, which is reported, not refused. E143 has no such table (its addresses are src/lab's own
//                    literals): ported is null there
import { insnLength } from '../core/cpu.mjs';
import { FirmwareError } from './errors.mjs';
import { IMAGE_BASE, MODEL, ON_LAB_MODEL } from '../fw/model.mjs';
import { PORTS, FACTS } from '../fw/ports.mjs';

export class PatchHooked extends FirmwareError {}

const CODE = 0x50000000;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// The changed ranges of one overlay over an image (the run-time image whose offset 0 is the main block's byte 0, base
// its run-time address)
export class PatchRanges {
  constructor(ranges, image, base = IMAGE_BASE) {
    this.ranges = ranges; this.image = image; this.base = base >>> 0;
    this.seen = new Map();             // the hook rule's verdict per pc
  }
  // the first range overlapping [off, off + len), or null
  hit(off, len) {
    const r = this.ranges;
    let lo = 0, hi = r.length;
    while (lo < hi) {                  // the first range that ends after off
      const mid = (lo + hi) >> 1;
      if (r[mid][0] + r[mid][1] <= off) lo = mid + 1; else hi = mid;
    }
    return lo < r.length && r[lo][0] < off + len ? r[lo] : null;
  }
  // the range the instruction at image offset off overlaps, or null (off outside the image: null)
  insnAt(off) {
    if (off < 0 || off >= this.image.length) return null;
    const op = this.image[off];
    return this.hit(off, insnLength(op, op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? this.image[off + 1] : 0));
  }
  // a run-time code address (a hook's pc, a task's entry)
  code(address) { return this.insnAt(((address >>> 0) - this.base) | 0); }
  // the hook rule: a lab hook reached at pc (run-time)
  refuseHook(pc, name) {
    let r = this.seen.get(pc);
    if (r === undefined) this.seen.set(pc, r = this.code(pc));
    if (r !== null) {
      throw new PatchHooked(`lab hook ${name} reached at ${hex8(pc)} (disasm ${hex8(pc - this.base + CODE)}), on bytes the patch overlay changed (body ${hex8(r[0])}+${r[1]}): the lab's stand-in would run in place of the patched code`);
    }
  }
}

// The audit's rules on given tables (patchAudit's, or a test's): ranges a PatchRanges; hooks [[run-time pc, name]];
// ports {model address: [E143 addresses]} or null; facts [[path, value]] or null; len the main block's length.
// {hooks: [{at (disasm), name}], ported: [{at, e143: [...]} | {at, fact}] or null}
export function auditTables(ranges, { hooks, ports, facts, len }) {
  const base = ranges.base, out = { hooks: [], ported: ports === null && facts === null ? null : [] };
  const hooked = new Set();
  for (const [pc, name] of hooks) {
    if (ranges.code(pc) === null) continue;
    hooked.add(pc - base + CODE >>> 0);
    out.hooks.push({ at: hex8(pc - base + CODE), name });
  }
  out.hooks.sort((a, b) => (a.at < b.at ? -1 : 1));
  // an address on patched bytes: in the disassembly notation the instruction there, at run time the byte
  const on = (v) => {
    v >>>= 0;
    if (v >= CODE && v < CODE + len) return !hooked.has(v) && ranges.insnAt(v - CODE) !== null;
    if (v >= base && v < base + len) return !hooked.has(v - base + CODE >>> 0) && ranges.hit(v - base, 1) !== null;
    return false;
  };
  if (out.ported !== null) {
    for (const [at, from] of Object.entries(ports ?? {})) if (on(Number(at))) out.ported.push({ at: hex8(Number(at)), e143: from.map(hex8) });
    for (const [path, v] of facts ?? []) if (on(v)) out.ported.push({ at: hex8(v), fact: path });
  }
  return out;
}

// [[path, value]] of every number in a FACTS entry
function leaves(x, path, out) {
  if (typeof x === 'number') out.push([path, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

// After the bring-up: the audit of lab's hooks and of this model's ports and facts against the overlay of its HLE
// (src/lab/hle.mjs patch), or null without one
export function patchAudit(lab) {
  const ranges = lab.patch;
  if (!ranges) return null;
  let ports = null, facts = null;
  if (!ON_LAB_MODEL) {
    ports = {};
    for (const [from, to] of Object.entries(PORTS[MODEL] ?? {})) if (to !== null) (ports[to >>> 0] ??= []).push(Number(from));
    facts = leaves(FACTS[MODEL] ?? {}, '', []);
  }
  const hooks = [...lab.hooks].map(([pc, [, name]]) => [pc, name]);
  return auditTables(ranges, { hooks, ports, facts, len: lab.image.length });
}

// The audit as one line (host/navcli.mjs; the play status carries the object)
export function auditLine(a, tasks = []) {
  const hooks = a.hooks.length ? `${a.hooks.length} lab hook(s) on patched bytes, each stopping the session when reached: ${a.hooks.map((h) => `${h.name} ${h.at}`).join(', ')}` : 'no lab hook on patched bytes';
  const ported = a.ported === null ? 'ports and facts not audited (E143: the lab\'s own build)'
    : a.ported.length ? `${a.ported.length} ported address(es) or fact(s) on patched bytes, which the lab calls or reads as patched: ${a.ported.map((p) => p.fact ? `${p.at} (fact ${p.fact})` : `${p.at} (E143 ${p.e143.join(', ')})`).join(', ')}`
      : 'no ported address or fact on patched bytes';
  return `${hooks}; ${ported}${tasks.length ? `; H-PATCHTASK: ${tasks.join(', ')}` : ''}`;
}
