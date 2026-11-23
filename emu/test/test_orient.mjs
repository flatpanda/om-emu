// The picture's orientation tag: PER_ROTATE's getter read by TAKE's takepic into the shot's record, and the EXIF set's
// Orientation from that field (docs/hle-gaps.md 4.7.3, 2026-11-22):
//   orientUnits    (firmware-free) the session's tilt:roll=R[,pitch=P] token and the Player input it sends; malformed
//                  ones refused
//   orientSites    (firmware, no lab) on E143, E146 and E147, by their bytes in each body's main block: takepic's call
//                  of PER_ROTATE's getter followed by the store of its code into the record's field (E143 +38156,
//                  E146 and E147 +37808), and the EXIF set's read of that field, which keeps 6, 3 and 8 and writes 1
//                  for anything else into the Exif block's Orientation (+18)
//   orientSession  (firmware) on the body of OM_EMU_MODEL (E143 by default; bin/test.mjs runs E146 in a process of its
//                  own): through host/session.mjs with --rotate on, a tilt to roll 52 then S2: takepic's store
//                  carries 8, the EXIF set takes its keeping branch and the card's picture has Orientation 8; roll -52:
//                  6; the control without --rotate: the getter's 11 (PER_ROTATE's init not run), the EXIF set's other
//                  branch and Orientation 1. No poke
//   node emu/test/test_orient.mjs [--session]
import fs from 'node:fs';
import path from 'node:path';

// per body (D, read 2026-11-22): PER_ROTATE's getter; takepic's call of it (`call GETTER,[],0`, 7 bytes, then `mov
// d2,a0` and `movhu d0,(FIELD,a0)`: the record's field); the EXIF set's `add FIELD,a0` before its compares, with its
// keeping branch (the code reloaded, +0x14 from the add) and its other one (1, +0x1c)
export const ORIENT_SITES = {
  E143: { getter: 0x5005A155, call: 0x503BD0EE, field: 38156, read: 0x5042C428 },
  E146: { getter: 0x5005BBD7, call: 0x503BDA48, field: 37808, read: 0x504283B3 },
  E147: { getter: 0x50056DC1, call: 0x503C7CD8, field: 37808, read: 0x504366B9 },
};
const IMAGE = 0x50000000;          // the main block's notation base (tools/mn10300dis.sh)
const KEEP = 0x14, ONE = 0x1c;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export async function orientUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { parseToken, stepInputs, TokenError } = await import('../host/session.mjs');
  const inp = (t) => JSON.stringify(stepInputs(parseToken(t)));
  ok(inp('tilt:roll=52') === JSON.stringify([{ type: 'tilt', roll: 52, pitch: 0 }]), `tilt:roll=52: ${inp('tilt:roll=52')}`);
  ok(inp('tilt:pitch=-7.5,roll=90') === JSON.stringify([{ type: 'tilt', roll: 90, pitch: -7.5 }]), `tilt:pitch=-7.5,roll=90: ${inp('tilt:pitch=-7.5,roll=90')}`);
  for (const t of ['tilt', 'tilt:', 'tilt:yaw=3', 'tilt:roll=', 'tilt:roll=1,roll=2']) {
    let e = null;
    try { parseToken(t); } catch (x) { e = x; }
    ok(e instanceof TokenError && /tilt:roll=R|given twice/.test(e.message), `${t} is refused: ${e?.message}`);
  }
  return { checks, bad };
}

export async function orientSites() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODELS, romPath } = await import('../src/fw/models.mjs');
  const { REPO } = await import('../checks/lib/env.mjs');
  for (const [m, s] of Object.entries(ORIENT_SITES)) {
    const f = path.join(REPO, romPath(MODELS[m]));
    if (!fs.existsSync(f)) { ok(false, `${m}: no main block at ${f}`); continue; }
    const b = fs.readFileSync(f), at = (a, n) => [...b.subarray(a - IMAGE, a - IMAGE + n)];
    const rel = (s.getter - s.call) | 0;
    const call = [0xdd, ...le32(rel), 0x00, 0x00];      // call GETTER,[],0 (the register list and frame size 0)
    ok(at(s.call, 7).every((x, i) => x === call[i]), `${m}: takepic's ${h8(s.call)} is not \`call ${h8(s.getter)},[],0\` (${at(s.call, 7).map((x) => x.toString(16)).join(' ')})`);
    const store = [0xf1, 0xe8, 0xfc, 0x70, ...le32(s.field)];
    ok(at(s.call + 7, 8).every((x, i) => x === store[i]), `${m}: after the call no \`movhu d0,(${s.field},a0)\` on the record`);
    const read = [0xfc, 0xd0, ...le32(s.field), 0xf0, 0x60, 0xa0, 0x06, 0xc8, 0x0a, 0xa0, 0x03, 0xc8, 0x06, 0xa0, 0x08, 0xc9, 0x0a, 0xf0, 0x60, 0x5c, 0x08, 0x20, 0x12, 0xca, 0x08, 0x5c, 0x08, 0x80, 0x01, 0x20, 0x12, 0xf0, 0x70];
    ok(at(s.read, read.length).every((x, i) => x === read[i]), `${m}: the EXIF set's ${h8(s.read)} is not the read of +${s.field} keeping 6, 3, 8 and else 1 into the block's +18`);
  }
  return { checks, bad };
}

export async function orientSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { openSession } = await import('../host/session.mjs');
  const s = ORIENT_SITES[MODEL];
  if (!s) return { checks: 1, bad: [`${MODEL}: no orientation sites read (ORIENT_SITES)`] };
  const store = s.call + 9, keep = s.read + KEEP, one = s.read + ONE;
  // [roll, the getter's code takepic stores, the file's Orientation]: without --rotate PER_ROTATE's init has not run,
  // its index is 0 and the getter answers 11 (ROTATE_DISABLE), which the EXIF set writes as 1 (X)
  const runs = [[52, 8, 8], [-52, 6, 6], [null, 11, 1]];
  for (const [roll, code, want] of runs) {
    const tag = roll === null ? 'no --rotate' : `--rotate on, roll ${roll}`;
    const ses = await openSession(roll === null ? {} : { rotate: 'on' });
    try {
      const step = (t) => { const r = ses.step(t); if (!r.ok) throw new Error(`${tag}: ${t}: ${r.error}`); return r; };
      step('wait:3000');
      if (roll !== null) step(`tilt:roll=${roll}`);
      step('wait:600');
      step(`trace:${h8(store)},${h8(keep)},${h8(one)}`);
      const hits = step('s2').hits ?? [];
      step('wait:1500');
      const pcs = (pc) => hits.filter((x) => x.kind === 'pc' && parseInt(x.pc, 16) === pc);
      const st = pcs(store);
      ok(st.length === 1 && parseInt(st[0].regs.d0, 16) === code, `${tag}: takepic's store ${h8(store)} of the getter's code: ${st.map((x) => x.regs.d0).join(', ') || 'not run'}, want ${code}`);
      ok(pcs(want === 1 ? one : keep).length === 1 && pcs(want === 1 ? keep : one).length === 0, `${tag}: the EXIF set's ${want === 1 ? 'other' : 'keeping'} branch (${h8(keep)} ${pcs(keep).length}, ${h8(one)} ${pcs(one).length})`);
      const x = step('exif:DCIM/100OMSYS/*.JPG').exif;
      ok(x?.Orientation === want, `${tag}: the picture's Orientation ${x?.Orientation}, want ${want}`);
      ok(roll === null || ses.player.stand_ins_in_use().includes('H-ROTINIT'), `${tag}: H-ROTINIT in use`);
      ok(ses.pokes === undefined || ses.pokes.length === 0, `${tag}: no poke`);
    } finally { ses.close?.(); }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = await orientUnits(), i = await orientSites();
  console.log(`the tilt token: ${u.checks - u.bad.length}/${u.checks}; the orientation tag's sites on E143, E146, E147: ${i.checks - i.bad.length}/${i.checks}`);
  [...u.bad, ...i.bad].forEach((x) => console.log('  ', x));
  let fail = u.bad.length + i.bad.length;
  if (process.argv.includes('--session')) {
    const { MODEL } = await import('../src/fw/model.mjs');
    const s = await orientSession();
    console.log(`the picture's orientation in a ${MODEL} session: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
